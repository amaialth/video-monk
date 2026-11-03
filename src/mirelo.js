// Mirelo (mirelo.ai) text-to-sound-effect generation. Opt-in: a prompt is sent to Mirelo and credits are spent, so callers must pass
// allow. The key comes from MIRELO_API_KEY (environment or a .env file) and is never printed, logged or written anywhere.
// Generated sounds are post-processed, indexed in the asset library and reused, so the same sound is never paid for twice.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { run } from './core.js';

const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const BASE = process.env.MIRELO_API_BASE || 'https://api.mirelo.ai';
export const DEFAULT_MODEL = process.env.MIRELO_MODEL || 'sfx-2.0';
export const NEGATIVE = 'speech, voice, vocals, music, background noise, long reverb tail';
export const RIGHTS = 'Generated with Mirelo (output owned by the user per Mirelo terms; paid plan needed for commercial use). Fully automatic pipeline: no "Powered by Mirelo" badge required.';

// What to ask for, per built-in sound kind (matches src/sfx.js).
export const PROMPTS = {
  whoosh: 'Clean soft air whoosh, a quick transition sweep, dry, no music, no voice',
  swipe: 'Short subtle swipe, a light UI panel sliding in, clean and dry',
  pop: 'Single soft rounded bubble pop, clean UI sound, dry',
  chime: 'Gentle two-note bell chime, bright and clean, short natural decay',
  ding: 'Single clean notification bell ding, short decay',
  click: 'Soft crisp UI button click, dry, single',
  tick: 'Tiny light tick, one dry click, very short',
  impact: 'Soft low cinematic impact hit with a short sub tail, clean, no music',
  riser: 'Subtle rising sweep building for two seconds, ends abruptly, no music'
};

const fail = message => { throw new Error(`Mirelo: ${message}`); };

export async function mireloKey(env = process.env, cwd = process.cwd()) {
  if (env.MIRELO_API_KEY) return env.MIRELO_API_KEY.trim();
  for (const file of [path.join(cwd, '.env'), path.join(os.homedir(), '.video-monk', '.env')]) {
    try {
      const m = (await readFile(file, 'utf8')).match(/^\s*MIRELO_API_KEY\s*=\s*(.*)$/m);
      const value = m?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    } catch { /* not there */ }
  }
  return null;
}

// Remove the key from anything that might be shown.
const scrub = (text, key) => (key ? String(text).split(key).join('***') : String(text));

async function call(method, url, { key, body, headers = {}, fetchFn = fetch }) {
  const response = await fetchFn(url.startsWith('http') ? url : `${BASE}${url}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text: scrub(text, key).slice(0, 500), retryAfter: Number(response.headers.get('retry-after')) || null };
}

export async function account(key, fetchFn = fetch) {
  const r = await call('GET', '/v3/me', { key, fetchFn });
  if (r.status === 401 || r.status === 403) fail('the API key was rejected');
  if (r.status !== 200) fail(`account lookup failed (HTTP ${r.status})`);
  return { credits: r.json.credits_available, spendCapacity: r.json.spend_capacity, ready: r.json.provisioning_state === 'ready' };
}

export async function creditsPerSecond(key, model = DEFAULT_MODEL, fetchFn = fetch) {
  const r = await call('GET', `/v3/models/${model}`, { key, fetchFn });
  const v = r.json?.credits_per_second;
  return typeof v === 'number' ? v : (typeof v?.current === 'number' ? v.current : 15);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Generate one sound file (raw Mirelo output, mono wav). Returns { file, credits, jobId }.
export async function generate({ prompt, seconds, model = DEFAULT_MODEL, negative = NEGATIVE, key, file, fetchFn = fetch, timeoutMs = 180000 }) {
  if (!key) fail('no API key: set MIRELO_API_KEY in the environment or a .env file');
  if (!(seconds >= 0.1 && seconds <= 600)) fail('seconds must be 0.1 to 600');
  if (prompt.length > 2000) fail('the prompt is longer than 2000 characters');
  const body = { model, duration_ms: Math.round(seconds * 1000), num_variants: 1, input: { prompt, ...(model === 'sfx-2.0' && negative ? { negative_prompt: negative } : {}) }, output: { format: 'wav' } };
  const idem = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
  let r = await call('POST', '/v3/text-to-sfx/generations?wait=25', { key, body, headers: { 'Idempotency-Key': idem }, fetchFn });
  if (r.status === 429) { await sleep((r.retryAfter || 3) * 1000); r = await call('POST', '/v3/text-to-sfx/generations?wait=25', { key, body, headers: { 'Idempotency-Key': idem }, fetchFn }); }
  if (r.status === 402) fail('insufficient credits');
  if (![200, 202].includes(r.status)) fail(`generation was refused (HTTP ${r.status}): ${r.json?.error?.message || r.text}`);
  let job = r.json;
  const started = Date.now();
  while (!['succeeded', 'partially_succeeded', 'failed', 'canceled', 'expired'].includes(job.status)) {
    if (Date.now() - started > timeoutMs) fail(`timed out waiting for job ${job.id}`);
    await sleep(1500);
    const p = await call('GET', job.urls.self, { key, fetchFn });
    if (p.status !== 200) fail(`polling failed (HTTP ${p.status})`);
    job = p.json;
  }
  if (job.status === 'failed' || job.status === 'canceled' || job.status === 'expired') fail(`job ${job.status}: ${job.errors?.[0]?.message || 'no detail'}`);
  const variant = job.result?.output?.variants?.find(v => v.files?.audio?.url);
  if (!variant) fail('the job finished without an audio file');
  // The download link is pre-signed: do not send the API key to it.
  const audio = await fetchFn(variant.files.audio.url);
  if (!audio.ok) fail(`download failed (HTTP ${audio.status})`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await audio.arrayBuffer()));
  return { file, credits: job.credits?.charged ?? job.credits ?? null, jobId: job.id, model };
}

// Trim leading silence, fade, make stereo at 48 kHz and keep the peak safely below full scale.
export async function finish(raw, out, seconds, execute = run) {
  const fade = Math.min(0.05, seconds / 4);
  await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', raw, '-af',
    `silenceremove=start_periods=1:start_threshold=-55dB,aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,alimiter=limit=0.7:level=false,afade=t=in:d=0.003,areverse,afade=t=in:d=${fade.toFixed(3)},areverse`,
    '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return out;
}

export const cacheId = (kindOrPrompt, seconds, model = DEFAULT_MODEL) =>
  `sfx-mirelo-${createHash('sha256').update(JSON.stringify([kindOrPrompt, Math.round(seconds * 1000), model])).digest('hex').slice(0, 12)}`;
