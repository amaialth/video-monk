// Environment readiness for the UI: required tools, optional integrations (names only, never key values).
import { run } from '../core.js';
import { findChrome } from '../chrome.js';
import { findWhisper, findModel, MODEL_DIR } from '../transcribe.js';
import { envKey } from '../stock.js';

const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const first = r => (r.stdout || r.stderr || '').trim().split(/\r?\n/)[0];

export async function environment() {
  const checks = [];
  const add = (id, label, ok, detail, extra = {}) => checks.push({ id, label, ok, detail, ...extra });
  add('node', 'Node.js', true, process.version);
  let filters = '', encoders = '';
  try { const r = await run(tool('ffmpeg'), ['-version'], { timeout: 10000 }); add('ffmpeg', 'FFmpeg', true, first(r)); filters = (await run(tool('ffmpeg'), ['-hide_banner', '-filters'], { timeout: 10000 })).stdout; encoders = (await run(tool('ffmpeg'), ['-hide_banner', '-encoders'], { timeout: 10000 })).stdout; }
  catch (e) { add('ffmpeg', 'FFmpeg', false, e.message, { fix: 'Install FFmpeg (macOS: brew install ffmpeg)' }); }
  try { add('ffprobe', 'ffprobe', true, first(await run(tool('ffprobe'), ['-version'], { timeout: 10000 }))); } catch (e) { add('ffprobe', 'ffprobe', false, e.message, { fix: 'Installed with FFmpeg' }); }
  if (filters) {
    const missing = ['zoompan', 'xfade', 'overlay', 'sidechaincompress', 'loudnorm', 'alimiter', 'silencedetect', 'tpad'].filter(f => !new RegExp(`\\s${f}\\s`).test(filters));
    add('filters', 'FFmpeg filters', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all required filters present', missing.length ? { fix: 'Use a full FFmpeg build' } : {});
    add('x264', 'H.264 encoder (libx264)', /\slibx264\s/.test(encoders), /\slibx264\s/.test(encoders) ? 'available' : 'missing', {});
  }
  try { add('chrome', 'Chrome (renders graphics)', true, await findChrome()); } catch (e) { add('chrome', 'Chrome (renders graphics)', false, e.message, { fix: 'Install Google Chrome, or set VIDEO_MONK_CHROME' }); }
  const whisper = await findWhisper().catch(() => null);
  add('whisper', 'whisper.cpp (transcription)', Boolean(whisper), whisper || 'not found', whisper ? {} : { fix: 'macOS: brew install whisper-cpp', optional: true });
  const model = await findModel().catch(() => null);
  add('model', 'Whisper model', Boolean(model), model || `none in ${MODEL_DIR}`, model ? {} : { fix: 'video-monk models --download base.en --allow-download', optional: true });
  let claude = null;
  try { claude = first(await run('claude', ['--version'], { timeout: 10000 })); } catch { /* not installed */ }
  add('claude', 'Claude Code CLI (smarter graphics and reviews)', Boolean(claude), claude || 'not found', { optional: true });
  const keys = {};
  for (const [id, label, name] of [['pixabay', 'Pixabay (B-roll video and photos)', 'PIXABAY_API_KEY'], ['unsplash', 'Unsplash (B-roll photos)', 'UNSPLASH_ACCESS_KEY'], ['mirelo', 'Mirelo (generated sound effects)', 'MIRELO_API_KEY'], ['pexels', 'Pexels (B-roll video)', 'PEXELS_API_KEY']]) {
    const present = Boolean(await envKey(name));
    keys[id] = present;
    add(`key-${id}`, label, present, present ? 'key found' : `${name} not set`, { optional: true });
  }
  const required = checks.filter(c => !c.optional);
  return { ready: required.every(c => c.ok), canTranscribe: Boolean(whisper && model), canUseClaude: Boolean(claude), keys, checks };
}
