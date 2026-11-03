// Project store for the web UI: one folder per project under ~/.video-monk/ui/projects (or $VIDEO_MONK_HOME/ui/projects).
//   project.json   the project state (settings, step statuses, pending approval, approvals)
//   events.jsonl   every progress event, replayed when a page opens
//   run/           the pipeline output folder (same layout as `video-monk auto`)
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, rename, writeFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export const uiHome = () => path.join(process.env.VIDEO_MONK_HOME || path.join(os.homedir(), '.video-monk'), 'ui');
const ID = /^p-[a-z0-9-]{6,48}$/;
export const validId = id => ID.test(String(id));

export class Store extends EventEmitter {
  constructor(root = path.join(uiHome(), 'projects')) { super(); this.root = root; this.seq = new Map(); this.queues = new Map(); }

  dir(id) { if (!validId(id)) throw Object.assign(new Error('Invalid project id'), { status: 400 }); return path.join(this.root, id); }

  async list() {
    await mkdir(this.root, { recursive: true });
    const out = [];
    for (const name of await readdir(this.root)) {
      if (!validId(name)) continue;
      try { out.push(JSON.parse(await readFile(path.join(this.root, name, 'project.json'), 'utf8'))); } catch { /* half-written or foreign folder */ }
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(id) {
    try { return JSON.parse(await readFile(path.join(this.dir(id), 'project.json'), 'utf8')); }
    catch (error) { if (error.status) throw error; throw Object.assign(new Error('Project not found'), { status: 404 }); }
  }

  // Serialised atomic writes per project, so rapid status changes never interleave.
  save(project) {
    project.updatedAt = new Date().toISOString();
    const file = path.join(this.dir(project.id), 'project.json');
    const snapshot = `${JSON.stringify(project, null, 1)}\n`;
    const previous = this.queues.get(project.id) || Promise.resolve();
    const next = previous.then(async () => { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; await writeFile(tmp, snapshot); await rename(tmp, file); });
    this.queues.set(project.id, next.catch(() => {}));
    this.emit('project', project.id, project);
    return next;
  }

  async create(data) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const id = `p-${stamp}-${randomBytes(3).toString('hex')}`;
    const project = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', steps: {}, approvals: [], pending: null, ...data };
    await this.save(project);
    return project;
  }

  async appendEvent(id, event) {
    const seq = (this.seq.get(id) ?? (await this.events(id)).length) + 1;
    this.seq.set(id, seq);
    const full = { seq, at: new Date().toISOString(), ...event };
    await appendFile(path.join(this.dir(id), 'events.jsonl'), `${JSON.stringify(full)}\n`);
    this.emit('event', id, full);
    return full;
  }

  async events(id, after = 0) {
    try { return (await readFile(path.join(this.dir(id), 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.seq > after); }
    catch { return []; }
  }
}
