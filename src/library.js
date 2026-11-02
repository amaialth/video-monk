// Shared asset library: an index of everything the pipeline generates (rendered graphics, transcripts, storyboards,
// stems, thumbnails) plus licensed assets you add by hand (music, SFX, images, fonts), so other projects can find and
// reuse them instead of regenerating. Layout under the library root (default ~/.video-monk/library, VIDEO_MONK_LIBRARY
// overrides, VIDEO_MONK_LIBRARY=off disables):
//   index.json                      entries (metadata, tags, rights, hashes, usage counts)
//   objects/<kind>/<id>/...         the files or directories themselves
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { exists } from './core.js';

export const KINDS = ['graphic', 'transcript', 'storyboard', 'audio', 'image', 'video', 'font', 'thumbnail', 'other'];
const fail = message => { throw new Error(`Library: ${message}`); };

export function libraryRoot() {
  const configured = process.env.VIDEO_MONK_LIBRARY;
  if (configured === 'off') return null;
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.video-monk', 'library');
}

export async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function treeBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await treeBytes(full) : (await stat(full)).size;
  }
  return total;
}

const words = text => String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export class Library {
  constructor(root) {
    this.root = root;
    this.indexFile = path.join(root, 'index.json');
    this.index = { version: 1, entries: [] };
    this.queue = Promise.resolve();
  }

  // Returns null when the library is disabled (VIDEO_MONK_LIBRARY=off).
  static async open(root = libraryRoot()) {
    if (!root) return null;
    const lib = new Library(root);
    await mkdir(path.join(root, 'objects'), { recursive: true });
    if (await exists(lib.indexFile)) {
      try { lib.index = JSON.parse(await readFile(lib.indexFile, 'utf8')); } catch { fail(`index is not valid JSON: ${lib.indexFile}`); }
      if (lib.index.version !== 1 || !Array.isArray(lib.index.entries)) fail('unsupported index format');
    }
    return lib;
  }

  objectDir(kind) { return path.join(this.root, 'objects', kind); }
  absolute(entry) { return path.join(this.root, entry.path); }

  // Serialised read-modify-write of the index; safe against parallel callers in this process.
  #write(mutator) {
    const run = this.queue.then(async () => {
      if (await exists(this.indexFile)) this.index = JSON.parse(await readFile(this.indexFile, 'utf8'));
      const result = await mutator(this.index);
      const temp = `${this.indexFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.index, null, 1)}\n`);
      await rename(temp, this.indexFile);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  get(id) { return this.index.entries.find(e => e.id === id) || null; }

  // Register something already inside objects/ (for example a motion-cache directory) or import a file/dir.
  async add({ id, kind, name, description = '', tags = [], source = null, relativePath = null, meta = {}, rights, attribution, sourceUrl, approved,
    createdBy = 'user', project = null, copy = true }) {
    if (!KINDS.includes(kind)) fail(`kind must be one of ${KINDS.join(', ')}`);
    let target = relativePath;
    let sha256 = null;
    let bytes = 0;
    if (source) {
      const absolute = path.resolve(source);
      const info = await stat(absolute);
      sha256 = info.isFile() ? await fileSha256(absolute) : null;
      id ||= `${kind}-${(sha256 || createHash('sha256').update(absolute + info.mtimeMs).digest('hex')).slice(0, 12)}`;
      target = path.join('objects', kind, id, info.isFile() ? path.basename(absolute) : '');
      const destination = path.join(this.root, target);
      if (copy && !(await exists(destination))) {
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(absolute, destination, { recursive: true });
      }
      bytes = info.isFile() ? info.size : await treeBytes(absolute);
    } else {
      if (!id || !target) fail('add needs a source or an id with relativePath');
      const absolute = path.join(this.root, target);
      if (!(await exists(absolute))) fail(`object not found: ${absolute}`);
      const info = await stat(absolute);
      bytes = info.isFile() ? info.size : await treeBytes(absolute);
      if (info.isFile()) sha256 = await fileSha256(absolute);
    }
    const now = new Date().toISOString();
    return this.#write(index => {
      const previous = index.entries.find(e => e.id === id);
      const entry = {
        ...(previous || { uses: 0, createdAt: now }), id, kind, name: name || previous?.name || id, description: description || previous?.description || '',
        tags: [...new Set([...(previous?.tags || []), ...tags.map(t => String(t).toLowerCase())])], path: target, sha256, bytes, createdBy,
        project: project ?? previous?.project ?? null, meta: { ...(previous?.meta || {}), ...meta },
        ...(rights !== undefined ? { rights } : previous?.rights ? { rights: previous.rights } : {}),
        ...(attribution !== undefined ? { attribution } : previous?.attribution ? { attribution: previous.attribution } : {}),
        ...(sourceUrl !== undefined ? { sourceUrl } : previous?.sourceUrl ? { sourceUrl: previous.sourceUrl } : {}),
        ...(approved !== undefined ? { approved } : previous?.approved !== undefined ? { approved: previous.approved } : {}), updatedAt: now
      };
      if (previous) Object.assign(previous, entry); else index.entries.push(entry);
      return entry;
    });
  }

  // Ranked keyword search over name, description, tags, kind and meta.text.
  search(query = '', { kind = null, tags = [], limit = 20 } = {}) {
    const terms = words(query);
    const wanted = tags.map(t => String(t).toLowerCase());
    const scored = [];
    for (const entry of this.index.entries) {
      if (kind && entry.kind !== kind) continue;
      if (wanted.length && !wanted.every(t => entry.tags.includes(t))) continue;
      const haystack = new Set(words([entry.name, entry.description, entry.tags.join(' '), entry.kind, entry.meta?.text, entry.meta?.template].join(' ')));
      let score = 0;
      for (const term of terms) if (haystack.has(term)) score += 2; else if ([...haystack].some(h => h.startsWith(term) || term.startsWith(h) && h.length > 3)) score += 1;
      if (!terms.length || score > 0) scored.push({ entry, score: score + Math.min(1, entry.uses / 10) });
    }
    return scored.sort((a, b) => b.score - a.score || b.entry.uses - a.entry.uses).slice(0, limit).map(s => s.entry);
  }

  async touch(id) {
    return this.#write(index => {
      const entry = index.entries.find(e => e.id === id);
      if (!entry) fail(`unknown asset: ${id}`);
      entry.uses = (entry.uses || 0) + 1;
      entry.lastUsedAt = new Date().toISOString();
      return entry;
    });
  }

  // Copy an asset into a NEW destination folder and return a v2 manifest asset entry for files.
  async checkout(id, destination) {
    const entry = this.get(id);
    if (!entry) fail(`unknown asset: ${id}`);
    const target = path.resolve(destination);
    if (await exists(target)) fail(`destination exists: ${target}`);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(this.absolute(entry), target, { recursive: true });
    await this.touch(id);
    const file = (await stat(target)).isFile() ? target : null;
    return { entry, path: target, manifestEntry: file && ['audio', 'image', 'video'].includes(entry.kind) ? {
      id: entry.id.replace(/[^\w-]/g, '-').slice(0, 64), path: path.basename(file), kind: entry.kind, approved: entry.approved === true,
      rights: entry.rights || 'REPLACE: confirm rights', attribution: entry.attribution || 'REPLACE: credit', ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}) } : null };
  }

  stats() {
    const byKind = {};
    for (const e of this.index.entries) {
      byKind[e.kind] ??= { count: 0, bytes: 0, uses: 0 };
      byKind[e.kind].count++; byKind[e.kind].bytes += e.bytes || 0; byKind[e.kind].uses += e.uses || 0;
    }
    return { root: this.root, entries: this.index.entries.length, bytes: this.index.entries.reduce((n, e) => n + (e.bytes || 0), 0), byKind };
  }

  // Remove least-recently-used entries (never user-added audio/image/video/font with rights) by age and/or size.
  async prune({ olderThanDays = null, maxBytes = null, kinds = ['graphic', 'transcript', 'storyboard', 'thumbnail'], dryRun = true } = {}) {
    if (await exists(this.indexFile)) this.index = JSON.parse(await readFile(this.indexFile, 'utf8'));
    const cutoff = olderThanDays === null ? null : Date.now() - olderThanDays * 86400_000;
    const stamp = e => Date.parse(e.lastUsedAt || e.updatedAt || e.createdAt) || 0;
    const candidates = this.index.entries.filter(e => kinds.includes(e.kind)).sort((a, b) => stamp(a) - stamp(b));
    let total = this.index.entries.reduce((n, e) => n + (e.bytes || 0), 0);
    const doomed = [];
    for (const e of candidates) {
      const tooOld = cutoff !== null && stamp(e) < cutoff;
      const tooBig = maxBytes !== null && total > maxBytes;
      if (tooOld || tooBig) { doomed.push(e); total -= e.bytes || 0; }
    }
    if (!dryRun) {
      for (const e of doomed) await rm(this.absolute(e), { recursive: true, force: true });
      await this.#write(index => { index.entries = index.entries.filter(e => !doomed.some(d => d.id === e.id)); });
    }
    return { removed: doomed.map(e => e.id), freedBytes: doomed.reduce((n, e) => n + (e.bytes || 0), 0), dryRun };
  }
}

export const textPreview = (value, max = 240) => {
  const parts = [];
  const walk = v => {
    if (typeof v === 'string') parts.push(v.replace(/\*/g, ''));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return parts.join(' · ').slice(0, max);
};
