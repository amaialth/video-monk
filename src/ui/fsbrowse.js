// Local file browsing for the "choose a video" step: a browser cannot hand a server a path, so the server lists folders itself.
// Read-only, loopback-only, and only folders and media files are shown.
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { exists, run } from '../core.js';
import { uiHome } from './store.js';

export const MEDIA_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mxf', '.mts', '.m2ts']);
const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;

export async function roots() {
  const home = os.homedir();
  const candidates = [['Home', home], ['Desktop', 'Desktop'], ['Movies', 'Movies'], ['Videos', 'Videos'], ['Downloads', 'Downloads'], ['Documents', 'Documents']];
  const list = [];
  for (const [label, p] of candidates) { const full = path.isAbsolute(p) ? p : path.join(home, p); if (await exists(full)) list.push({ label, path: full }); }
  try { for (const v of await readdir('/Volumes')) list.push({ label: v, path: path.join('/Volumes', v), volume: true }); } catch { /* not macOS */ }
  return list;
}

export async function list(dir) {
  const target = path.resolve(dir || os.homedir());
  if (!path.isAbsolute(target)) throw Object.assign(new Error('Use an absolute path'), { status: 400 });
  let entries;
  try { entries = await readdir(target, { withFileTypes: true }); }
  catch (error) { throw Object.assign(new Error(error.code === 'ENOENT' ? 'Folder not found' : error.code === 'EACCES' || error.code === 'EPERM' ? 'No permission to read this folder (macOS may need Full Disk Access for the terminal app)' : error.message), { status: error.code === 'ENOENT' ? 404 : 403 }); }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(target, e.name);
    if (e.isDirectory()) { out.push({ name: e.name, path: full, type: 'dir' }); continue; }
    if (!e.isFile() || !MEDIA_EXT.has(path.extname(e.name).toLowerCase())) continue;
    try { const s = await stat(full); out.push({ name: e.name, path: full, type: 'media', size: s.size, mtime: s.mtimeMs }); } catch { /* unreadable */ }
    if (out.length > 3000) break;
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, entries: out };
}

export async function probeMedia(file) {
  const full = path.resolve(file);
  if (!MEDIA_EXT.has(path.extname(full).toLowerCase())) throw Object.assign(new Error('Not a supported video file'), { status: 400 });
  if (!(await exists(full))) throw Object.assign(new Error('File not found'), { status: 404 });
  const { stdout } = await run(tool('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', full], { timeout: 30000 });
  const data = JSON.parse(stdout);
  const v = data.streams.find(s => s.codec_type === 'video'), a = data.streams.find(s => s.codec_type === 'audio');
  const [num, den] = String(v?.avg_frame_rate || '0/1').split('/').map(Number);
  return { path: full, name: path.basename(full), size: Number(data.format.size) || (await stat(full)).size, duration: Number(data.format.duration) || 0,
    width: v?.width || 0, height: v?.height || 0, fps: den ? Math.round(num / den * 100) / 100 : 0, videoCodec: v?.codec_name || null, audioCodec: a?.codec_name || null,
    hasAudio: Boolean(a), sampleRate: a ? Number(a.sample_rate) : null, channels: a?.channels || null, hdr: /smpte2084|arib-std-b67/.test(v?.color_transfer || '') };
}

// A JPEG frame (cached by file identity) for the file picker and the footage step.
export async function thumbnail(file, at = null, width = 480) {
  const full = path.resolve(file);
  const s = await stat(full);
  const key = createHash('sha256').update(`${full}|${s.size}|${s.mtimeMs}|${at}|${width}`).digest('hex').slice(0, 24);
  const dir = path.join(uiHome(), 'cache', 'thumbs');
  const out = path.join(dir, `${key}.jpg`);
  if (await exists(out)) return out;
  await mkdir(dir, { recursive: true });
  let t = at;
  if (t === null) { try { t = Math.max(0, (await probeMedia(full)).duration * 0.1); } catch { t = 1; } }
  await run(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(t), '-i', full, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out], { timeout: 60000 });
  return out;
}
