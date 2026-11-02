// Local speech-to-text with whisper.cpp (whisper-cli). Produces source-relative word timestamps,
// refined against measured silences so caption/cut boundaries do not bleed into pauses.
import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, rm, mkdtemp, writeFile, rename } from 'node:fs/promises';
import { exists, run, writeJson, writeNew } from './core.js';
import { inspectMedia } from './production.js';
import { detectSilence, refineWords } from './autocut.js';

const fail = message => { throw new Error(`Transcribe: ${message}`); };
export const MODEL_DIR = path.join(os.homedir(), '.cache', 'video-monk', 'models');
export const MODELS = ['tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small', 'medium.en', 'medium', 'large-v3-turbo', 'large-v3'];

export async function findWhisper(execute = run) {
  const candidates = [process.env.VIDEO_MONK_WHISPER, 'whisper-cli', 'whisper-cpp'].filter(Boolean);
  for (const bin of candidates) {
    try { await execute(bin, ['--help'], { timeout: 15000 }); return bin; } catch { /* next */ }
  }
  return null;
}

export async function findModel(model) {
  if (model && (model.includes('/') || model.includes('\\'))) return (await exists(model)) ? path.resolve(model) : null;
  const names = model ? [model] : ['base.en', 'small.en', 'base', 'small', 'medium.en', 'large-v3-turbo', 'tiny.en'];
  if (process.env.VIDEO_MONK_WHISPER_MODEL && !model) return process.env.VIDEO_MONK_WHISPER_MODEL;
  for (const name of names) {
    const file = path.join(MODEL_DIR, `ggml-${name}.bin`);
    if (await exists(file)) return file;
  }
  return null;
}

// Download a ggml whisper model from the official whisper.cpp Hugging Face repository (explicit opt-in).
export async function downloadModel(name, allowDownload, fetcher = fetch) {
  if (!allowDownload) fail('downloading a model requires --allow-download (≈75 MB for tiny, 150 MB base, 470 MB small)');
  if (!MODELS.includes(name)) fail(`model must be one of ${MODELS.join(', ')}`);
  await mkdir(MODEL_DIR, { recursive: true });
  const target = path.join(MODEL_DIR, `ggml-${name}.bin`);
  if (await exists(target)) return target;
  const url = new URL(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`);
  const response = await fetcher(url, { redirect: 'follow' });
  if (!response.ok || !response.body) fail(`model download failed: HTTP ${response.status}`);
  const partial = `${target}.partial`;
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, target);
  return target;
}

// Convert whisper.cpp -ojf output (with -ml 1 -sow) into [{text,start,end}] words.
export function parseWhisperJson(data) {
  const words = [];
  for (const segment of data.transcription || []) {
    const text = String(segment.text || '').trim();
    if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) continue;
    const start = segment.offsets.from / 1000;
    const end = Math.max(segment.offsets.to / 1000, start + 0.04);
    const parts = text.split(/\s+/).filter(Boolean);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let cursor = start;
    for (const part of parts) {
      const span = (end - start) * part.length / total;
      words.push({ text: part, start: round(cursor), end: round(cursor + span) });
      cursor += span;
    }
  }
  // Ensure ordering and positive durations.
  for (let i = 0; i < words.length; i++) {
    if (i && words[i].start < words[i - 1].start) words[i].start = words[i - 1].start;
    if (words[i].end <= words[i].start) words[i].end = round(words[i].start + 0.04);
  }
  return words;
}
const round = n => Math.round(n * 1000) / 1000;

export async function transcribeWhisper(media, output, options = {}, execute = run) {
  if (options.allowTranscribe !== true) fail('transcription requires --allow-transcribe (runs locally; no audio leaves this machine)');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const bin = await findWhisper(execute);
  if (!bin) fail('whisper.cpp not found. Install it (macOS: brew install whisper-cpp; others: build from github.com/ggml-org/whisper.cpp) or set VIDEO_MONK_WHISPER.');
  const model = await findModel(options.model);
  if (!model) fail(`no whisper model found in ${MODEL_DIR}. Run: video-monk models --download base.en --allow-download`);
  const source = path.resolve(media);
  const info = await inspectMedia(source, execute);
  if (!info.audio || !(info.duration > 0)) fail('input needs an audio stream with finite duration');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'video-monk-asr-'));
  try {
    const wav = path.join(temp, 'audio.wav');
    await execute(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source,
      '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 3600_000 });
    const args = ['-m', model, '-f', wav, '-ojf', '-ml', '1', '-sow', '-of', path.join(temp, 'out'), '-np',
      '-l', options.language || 'auto', '-t', String(Math.max(1, Math.min(8, os.cpus().length)))];
    if (options.prompt) args.push('--prompt', options.prompt);
    await execute(bin, args, { timeout: 6 * 3600_000 });
    const raw = JSON.parse(await readFile(path.join(temp, 'out.json'), 'utf8'));
    let words = parseWhisperJson(raw).filter(w => w.start < info.duration);
    if (!words.length) fail('no speech recognized');
    const silences = await detectSilence(source, {}, execute);
    words = refineWords(words, silences, info.duration);
    await mkdir(output, { recursive: true });
    await writeJson(path.join(output, 'words.json'), words);
    await writeNew(path.join(output, 'transcript.txt'), `${words.map(w => w.text).join(' ')}\n`);
    const report = {
      version: 1, engine: 'whisper.cpp', model: path.basename(model), language: options.language || 'auto', status: 'draft-needs-speech-review',
      source, duration: info.duration, wordCount: words.length,
      checks: { timestampBounds: 'PASS', silenceRefined: 'PASS', wordsAccuracy: 'NOT VERIFIED' },
      note: 'Source-relative word times. autocut remaps them onto the edited timeline for captions.'
    };
    await writeJson(path.join(output, 'transcription-report.json'), report);
    return { report, words };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export { writeFile };
