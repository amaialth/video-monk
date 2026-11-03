// ElevenLabs text to speech for narration. Credentials come from the environment only (ELEVENLABS_API_KEY; never stored, never printed, never sent to the
// browser). Each request asks for character-level timestamps, which become word timings for captions and exact beat lengths. Audio is cached by content, so
// the same text with the same voice and settings is never paid for twice. Characters generated are counted in the local database for budgets.
// API reference: https://elevenlabs.io/docs/api-reference (text-to-speech/convert-with-timestamps, voices/search, models/list).
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { exists } from './core.js';
import { envKey } from './stock.js';

const fail = message => { throw new Error(`ElevenLabs: ${message}`); };
export const ELEVEN_HOST = 'https://api.elevenlabs.io';
export const ELEVEN_ENV = { key: 'ELEVENLABS_API_KEY', voice: 'ELEVENLABS_VOICE_ID', model: 'ELEVENLABS_MODEL_ID', format: 'ELEVENLABS_OUTPUT_FORMAT' };
export const DEFAULT_MODEL = 'eleven_multilingual_v2';
export const DEFAULT_FORMAT = 'mp3_44100_128';
const VOICE_ID = /^[A-Za-z0-9_-]{6,64}$/, MODEL_ID = /^[a-z0-9_.-]{3,64}$/, FORMAT = /^mp3_\d{4,5}_\d{2,3}$/;

// What is configured, without ever returning the key itself.
export async function elevenConfig(env = process.env, cwd = process.cwd()) {
  const get = name => envKey(name, env, cwd);
  const [key, voice, model, format] = await Promise.all([get(ELEVEN_ENV.key), get(ELEVEN_ENV.voice), get(ELEVEN_ENV.model), get(ELEVEN_ENV.format)]);
  return { hasKey: Boolean(key), voiceId: voice || null, modelId: model || DEFAULT_MODEL, outputFormat: format || DEFAULT_FORMAT };
}
const apiKeyOrFail = async (env, cwd) => { const key = await envKey(ELEVEN_ENV.key, env, cwd); if (!key) fail(`${ELEVEN_ENV.key} is not set. Put it in your environment or in a .env file (the name only is read; the value is never printed).`); return key; };

// A readable message from ElevenLabs' error shape { detail: { type, code, message } } (or { detail: [{ msg }] } for validation).
function describe(status, body) {
  const d = body && body.detail;
  const code = d && !Array.isArray(d) ? d.code || d.type : null;
  const message = d && !Array.isArray(d) ? d.message : Array.isArray(d) ? d.map(x => x.msg).join('; ') : '';
  if (status === 401) return `the key was rejected (${code || 'invalid_api_key'}): check ${ELEVEN_ENV.key}`;
  if (status === 402 || code === 'insufficient_credits') return 'your account is out of credits (insufficient_credits): add credits or choose a cheaper model';
  if (status === 403) return `not allowed (${code || 'forbidden'}): ${message || 'this key or plan cannot use that voice or model'}`;
  if (status === 404) return `not found (${code || 'not_found'}): ${message || 'check the voice id'}`;
  if (status === 429) return `too many requests (${code || 'rate_limit'}); try again in a moment${message ? `: ${message}` : ''}`;
  return `${status} ${code || ''} ${message || 'the request was refused'}`.replace(/\s+/g, ' ').trim();
}

// One request with a timeout and a few retries for rate limits and server hiccups (exponential backoff, as the docs advise).
async function request(method, pathname, { body, query, apiKey, fetcher = fetch, retries = 3, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const url = new URL(pathname, ELEVEN_HOST);
  if (url.origin !== ELEVEN_HOST) fail('refusing to call another host');
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetcher(url.href, { method, redirect: 'error', signal: AbortSignal.timeout(180_000), headers: { 'xi-api-key': apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (error) {
      if (attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
      fail(`could not reach api.elevenlabs.io (${String(error.message).slice(0, 120)})`);
    }
    if (res.ok) return res.json();
    let data = null; try { data = await res.json(); } catch { /* not JSON */ }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
    const error = new Error(`ElevenLabs: ${describe(res.status, data)}`);
    error.status = res.status; error.code = data?.detail?.code || null;
    throw error;
  }
}

export async function listVoices({ search = '', env = process.env, cwd = process.cwd(), fetcher = fetch, max = 200, sleep } = {}) {
  const apiKey = await apiKeyOrFail(env, cwd);
  const out = [];
  let token = null;
  do {
    const page = await request('GET', '/v2/voices', { apiKey, fetcher, sleep, query: { page_size: 100, search, next_page_token: token, include_total_count: false } });
    for (const v of page.voices || []) out.push({ id: v.voice_id, name: v.name, category: v.category || null, labels: v.labels || {}, description: v.description || '', previewUrl: v.preview_url || null });
    token = page.has_more ? page.next_page_token : null;
  } while (token && out.length < max);
  return out.slice(0, max);
}

export async function listModels({ env = process.env, cwd = process.cwd(), fetcher = fetch, sleep } = {}) {
  const apiKey = await apiKeyOrFail(env, cwd);
  const models = await request('GET', '/v1/models', { apiKey, fetcher, sleep });
  return (Array.isArray(models) ? models : []).filter(m => m.can_do_text_to_speech).map(m => ({ id: m.model_id, name: m.name, maxChars: m.maximum_text_length_per_request || null,
    languages: (m.languages || []).map(l => l.language_id), costFactor: m.model_rates?.character_cost_multiplier ?? m.token_cost_factor ?? 1 }));
}

// Words from character timings: whitespace separates words; a word starts when its first character starts and ends when its last one ends.
export function wordsFromAlignment(alignment, offset = 0) {
  const chars = alignment?.characters || [], starts = alignment?.character_start_times_seconds || [], ends = alignment?.character_end_times_seconds || [];
  const words = [];
  let cur = null, tag = false;
  for (let i = 0; i < chars.length; i++) {
    // Eleven v3 audio tags ([whispers]) are directions, not words: they never become caption text.
    if (chars[i] === '[') { tag = true; if (cur) { words.push(cur); cur = null; } continue; }
    if (tag) { if (chars[i] === ']') tag = false; continue; }
    if (/\s/.test(chars[i])) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { text: '', start: starts[i] + offset, end: ends[i] + offset };
    cur.text += chars[i]; cur.end = ends[i] + offset;
  }
  if (cur) words.push(cur);
  return words.map(w => ({ text: w.text, start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 }));
}

export const countCharacters = texts => texts.reduce((n, t) => n + String(t).length, 0);

export function validateSpeech({ text, voiceId, modelId = DEFAULT_MODEL, outputFormat = DEFAULT_FORMAT, voiceSettings, maxChars = 4500 }) {
  if (typeof text !== 'string' || !text.trim()) fail('there is no text to speak');
  if (text.length > maxChars) fail(`the text is ${text.length} characters; one request takes at most ${maxChars}`);
  if (!VOICE_ID.test(String(voiceId || ''))) fail(`choose a voice (set ${ELEVEN_ENV.voice}, or pass a voice id)`);
  if (!MODEL_ID.test(modelId)) fail('the model id looks wrong');
  if (!FORMAT.test(outputFormat)) fail('only mp3 output formats are supported (for example mp3_44100_128)');
  if (voiceSettings !== undefined) {
    const ranges = { stability: [0, 1], similarity_boost: [0, 1], style: [0, 1], speed: [0.7, 1.2] };
    for (const [k, v] of Object.entries(voiceSettings)) {
      if (k === 'use_speaker_boost') { if (typeof v !== 'boolean') fail('use_speaker_boost must be true or false'); continue; }
      if (!ranges[k]) fail(`unknown voice setting ${k}`);
      if (!Number.isFinite(v) || v < ranges[k][0] || v > ranges[k][1]) fail(`${k} must be from ${ranges[k][0]} to ${ranges[k][1]}`);
    }
  }
}

// Speak one piece of text. previousText / nextText keep the delivery continuous across beats. Returns the mp3 bytes, word timings and the spoken length.
export async function synthesize(options) {
  validateSpeech(options);
  const { text, voiceId, modelId = DEFAULT_MODEL, outputFormat = DEFAULT_FORMAT, voiceSettings, previousText, nextText, seed, languageCode, env = process.env, cwd = process.cwd(), fetcher = fetch, sleep } = options;
  const apiKey = await apiKeyOrFail(env, cwd);
  const body = { text, model_id: modelId };
  if (voiceSettings) body.voice_settings = voiceSettings;
  if (previousText) body.previous_text = previousText.slice(-500);
  if (nextText) body.next_text = nextText.slice(0, 500);
  if (Number.isInteger(seed)) body.seed = seed;
  if (languageCode) body.language_code = languageCode;
  const data = await request('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, { apiKey, fetcher, sleep, body, query: { output_format: outputFormat } });
  if (!data?.audio_base64) fail('the response had no audio');
  const audio = Buffer.from(data.audio_base64, 'base64');
  if (audio.length < 100) fail('the audio came back empty');
  const alignment = data.alignment || null;
  const words = wordsFromAlignment(alignment);
  const last = alignment?.character_end_times_seconds?.length ? alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] : null;
  return { audio, words, spokenSeconds: last, characters: text.length };
}

// The same, cached on disk by content (and counted once in the usage table when it is actually generated).
const cacheKey = o => createHash('sha256').update(JSON.stringify([o.voiceId, o.modelId || DEFAULT_MODEL, o.outputFormat || DEFAULT_FORMAT, o.voiceSettings || null, o.text, o.previousText || '', o.nextText || '', o.seed ?? null, o.languageCode || ''])).digest('hex').slice(0, 32);
// What is already recorded for this exact request, or null. Nothing is sent and nothing is spent.
export async function cachedSpeech(options) {
  validateSpeech(options);
  const key = cacheKey(options), audioFile = path.join(options.cacheDir, `${key}.mp3`), metaFile = path.join(options.cacheDir, `${key}.json`);
  if (await exists(audioFile) && await exists(metaFile)) return { file: audioFile, ...JSON.parse(await readFile(metaFile, 'utf8')), cached: true };
  return null;
}
export async function synthesizeCached(options) {
  const { cacheDir, db = null, projectId = null } = options;
  const hit = await cachedSpeech(options);
  if (hit) return hit;
  const key = cacheKey(options);
  const audioFile = path.join(cacheDir, `${key}.mp3`), metaFile = path.join(cacheDir, `${key}.json`);
  const made = await synthesize(options);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(audioFile, made.audio);
  const meta = { words: made.words, spokenSeconds: made.spokenSeconds, characters: made.characters, model: options.modelId || DEFAULT_MODEL, voiceId: options.voiceId, key };
  await writeFile(metaFile, JSON.stringify(meta));
  db?.addUsage('elevenlabs', made.characters, { projectId, note: `${meta.model} ${options.voiceId}` });
  return { file: audioFile, ...meta, cached: false };
}

export const ELEVEN_RIGHTS = 'Generated with ElevenLabs text to speech. Commercial use needs a paid ElevenLabs plan; on the free plan the audio is for non-commercial use with attribution (see elevenlabs.io/terms-of-use).';
