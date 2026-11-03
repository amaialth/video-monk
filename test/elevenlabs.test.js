import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { elevenConfig, listVoices, listModels, wordsFromAlignment, synthesize, synthesizeCached, validateSpeech, countCharacters, ELEVEN_ENV } from '../src/elevenlabs.js';

const SECRET = 'sk_test_THIS_MUST_NEVER_APPEAR_ANYWHERE_123456';
const env = { [ELEVEN_ENV.key]: SECRET, [ELEVEN_ENV.voice]: 'voiceABC123', [ELEVEN_ENV.model]: 'eleven_flash_v2_5' };
async function temporary(t) { const f = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-el-'))); t.after(() => rm(f, { recursive: true, force: true })); return f; }
const noSleep = async () => {};

// a fake ElevenLabs: records what it was sent and answers like the real one
function server(handlers = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(u.origin, 'https://api.elevenlabs.io');
    for (const [match, fn] of Object.entries(handlers)) if (u.pathname.includes(match)) return fn(calls.length, u, init);
    return new Response('nope', { status: 404 });
  };
  fetcher.calls = calls;
  return fetcher;
}
const tts = (text = 'Hello there') => {
  const chars = [...text];
  return { audio_base64: Buffer.alloc(300, 1).toString('base64'), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05) } };
};

test('the configuration reports what is set without ever returning the key', async () => {
  const c = await elevenConfig(env, '/nonexistent');
  assert.deepEqual(c, { hasKey: true, voiceId: 'voiceABC123', modelId: 'eleven_flash_v2_5', outputFormat: 'mp3_44100_128' });
  assert.ok(!JSON.stringify(c).includes(SECRET));
  const none = await elevenConfig({}, '/nonexistent');
  assert.equal(none.hasKey, false);
  assert.equal(none.modelId, 'eleven_multilingual_v2');
  await assert.rejects(listVoices({ env: {}, cwd: '/nonexistent', fetcher: server() }), /ELEVENLABS_API_KEY is not set/);
});

test('a speech request carries the key header, the voice, model, format, settings and neighbours, and returns audio, words and length', async () => {
  const f = server({ '/with-timestamps': () => Response.json(tts('Hello there')) });
  const r = await synthesize({ text: 'Hello there', voiceId: 'voiceABC123', modelId: 'eleven_flash_v2_5', voiceSettings: { stability: 0.4, speed: 1.1 }, previousText: 'Before.', nextText: 'After.', seed: 7, env, cwd: '/nonexistent', fetcher: f });
  const call = f.calls[0];
  assert.equal(call.url.pathname, '/v1/text-to-speech/voiceABC123/with-timestamps');
  assert.equal(call.url.searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(call.headers['xi-api-key'], SECRET);
  assert.deepEqual(call.body, { text: 'Hello there', model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.4, speed: 1.1 }, previous_text: 'Before.', next_text: 'After.', seed: 7 });
  assert.deepEqual(r.words.map(w => w.text), ['Hello', 'there']);
  assert.equal(r.words[0].start, 0);
  assert.equal(r.spokenSeconds, 0.55);
  assert.equal(r.characters, 11);
  assert.equal(r.audio.length, 300);
});

test('errors say what to do, retry rate limits with backoff, and never contain the key', async () => {
  const body = (code, message, type = 'x') => ({ detail: { type, code, message } });
  const cases = [[401, body('invalid_api_key', 'bad'), /rejected.*ELEVENLABS_API_KEY/], [402, body('insufficient_credits', 'no credits'), /out of credits/], [404, body('voice_not_found', 'no such voice'), /not found.*voice/], [403, body('forbidden', 'plan'), /not allowed/]];
  for (const [status, data, pattern] of cases) {
    const f = server({ '/with-timestamps': () => Response.json(data, { status }) });
    await assert.rejects(synthesize({ text: 'Hi there', voiceId: 'voiceABC123', env, cwd: '/nonexistent', fetcher: f, sleep: noSleep }), error => { assert.match(error.message, pattern); assert.ok(!error.message.includes(SECRET)); assert.equal(error.status, status); return true; });
    assert.equal(f.calls.length, 1, `${status} is not retried`);
  }
  let n = 0;
  const limited = server({ '/with-timestamps': () => (++n < 3 ? Response.json(body('rate_limit_exceeded', 'slow down'), { status: 429 }) : Response.json(tts('Hi there'))) });
  assert.equal((await synthesize({ text: 'Hi there', voiceId: 'voiceABC123', env, cwd: '/nonexistent', fetcher: limited, sleep: noSleep })).words.length, 2);
  assert.equal(limited.calls.length, 3);
  const always = server({ '/with-timestamps': () => Response.json(body('system_busy', 'busy'), { status: 429 }) });
  await assert.rejects(synthesize({ text: 'Hi there', voiceId: 'voiceABC123', env, cwd: '/nonexistent', fetcher: always, sleep: noSleep }), /too many requests/);
  assert.equal(always.calls.length, 4, 'one try and three retries');
  const down = async () => { throw new Error(`socket hang up ${SECRET}`.replace(SECRET, 'x')); };
  await assert.rejects(synthesize({ text: 'Hi there', voiceId: 'voiceABC123', env, cwd: '/nonexistent', fetcher: down, sleep: noSleep }), /could not reach api\.elevenlabs\.io/);
});

test('input is checked before anything is sent', () => {
  assert.throws(() => validateSpeech({ text: '', voiceId: 'voiceABC123' }), /no text/);
  assert.throws(() => validateSpeech({ text: 'x'.repeat(5000), voiceId: 'voiceABC123' }), /at most 4500/);
  assert.throws(() => validateSpeech({ text: 'Hi', voiceId: '' }), /choose a voice/);
  assert.throws(() => validateSpeech({ text: 'Hi', voiceId: '../etc' }), /choose a voice/);
  assert.throws(() => validateSpeech({ text: 'Hi', voiceId: 'voiceABC123', outputFormat: 'pcm_44100' }), /only mp3/);
  assert.throws(() => validateSpeech({ text: 'Hi', voiceId: 'voiceABC123', voiceSettings: { speed: 3 } }), /speed must be from 0\.7 to 1\.2/);
  assert.throws(() => validateSpeech({ text: 'Hi', voiceId: 'voiceABC123', voiceSettings: { loudness: 1 } }), /unknown voice setting/);
  assert.doesNotThrow(() => validateSpeech({ text: 'Hi', voiceId: 'voiceABC123', voiceSettings: { stability: 0.5, use_speaker_boost: true } }));
  assert.equal(countCharacters(['abc', 'de']), 5);
});

test('words come from character timings: punctuation stays with its word, runs of spaces do not make empty words, and an offset shifts them', () => {
  const text = 'Hi,  big world!';
  const chars = [...text];
  const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.08) };
  const words = wordsFromAlignment(alignment, 10);
  assert.deepEqual(words.map(w => w.text), ['Hi,', 'big', 'world!']);
  assert.equal(words[0].start, 10);
  assert.equal(words[1].start, 10.5);
  assert.ok(words[2].end > words[2].start);
  assert.deepEqual(wordsFromAlignment(null), []);
});

test('voices are paged and models are limited to those that can speak', async () => {
  const f = server({
    '/v2/voices': (n, u) => (u.searchParams.get('next_page_token') ? Response.json({ voices: [{ voice_id: 'v3', name: 'Cara', category: 'premade', labels: { accent: 'british' } }], has_more: false }) : Response.json({ voices: [{ voice_id: 'v1', name: 'Ana', preview_url: 'https://x/a.mp3' }, { voice_id: 'v2', name: 'Ben' }], has_more: true, next_page_token: 'tok' })),
    '/v1/models': () => Response.json([{ model_id: 'eleven_flash_v2_5', name: 'Flash', can_do_text_to_speech: true, maximum_text_length_per_request: 40000, languages: [{ language_id: 'en' }], model_rates: { character_cost_multiplier: 0.5 } }, { model_id: 'scribe', name: 'STT', can_do_text_to_speech: false }])
  });
  const voices = await listVoices({ env, cwd: '/nonexistent', fetcher: f, search: 'a' });
  assert.deepEqual(voices.map(v => v.id), ['v1', 'v2', 'v3']);
  assert.equal(voices[0].previewUrl, 'https://x/a.mp3');
  assert.equal(f.calls[0].url.searchParams.get('search'), 'a');
  const models = await listModels({ env, cwd: '/nonexistent', fetcher: f });
  assert.deepEqual(models, [{ id: 'eleven_flash_v2_5', name: 'Flash', maxChars: 40000, languages: ['en'], costFactor: 0.5 }]);
});

test('audio is cached by content: the same request is not sent or counted twice, and any change makes a new one', async t => {
  const dir = await temporary(t);
  const usage = [];
  const db = { addUsage: (service, units, extra) => usage.push([service, units, extra.projectId]) };
  const f = server({ '/with-timestamps': () => Response.json(tts('Hello there')) });
  const opts = { text: 'Hello there', voiceId: 'voiceABC123', env, cwd: '/nonexistent', fetcher: f, cacheDir: dir, db, projectId: 'p1' };
  const first = await synthesizeCached(opts);
  const second = await synthesizeCached(opts);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(usage, [['elevenlabs', 11, 'p1']]);
  assert.deepEqual(second.words, first.words);
  assert.equal((await readFile(second.file)).length, 300);
  await synthesizeCached({ ...opts, voiceSettings: { stability: 0.9 } });
  await synthesizeCached({ ...opts, text: 'Hello there!' });
  assert.equal(f.calls.length, 3);
  assert.equal((await readdir(dir)).filter(x => x.endsWith('.mp3')).length, 3);
  for (const file of await readdir(dir)) assert.ok(!(await readFile(path.join(dir, file))).includes(SECRET), 'the key is not in any cached file');
});
