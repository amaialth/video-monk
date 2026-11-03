import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/core.js';
import { mireloKey, generate, cacheId, PROMPTS } from '../src/mirelo.js';
import { SFX_KINDS, synthesize, mireloSession, obtainFromMirelo, applySfx } from '../src/sfx.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-mirelo-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const KEY = 'sk-test-secret-123';

// A fake Mirelo: accepts creates (202 then succeeded on the second poll), serves a wav, charges credits per second.
function fakeMirelo(wav, { credits = 100, fail = null } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body });
    const json = (status, body, headers = {}) => ({ status, ok: status < 400, headers: { get: k => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
    if (u.endsWith('/v3/me')) return json(200, { credits_available: credits, provisioning_state: 'ready' });
    if (u.includes('/v3/models/')) return json(200, { id: 'sfx-2.0', credits_per_second: 10 });
    if (u.includes('/generations') && init.method === 'POST') { if (fail) return json(fail, { error: { message: 'nope' } }); return json(202, { id: 'job1', status: 'queued', urls: { self: 'https://api.mirelo.ai/v3/text-to-sfx/generations/job1' } }); }
    if (u.endsWith('/generations/job1')) return json(200, { id: 'job1', status: 'succeeded', credits: { charged: 10 }, result: { output: { variants: [{ status: 'succeeded', files: { audio: { url: 'https://files.example/a.wav' } } }] } } });
    if (u === 'https://files.example/a.wav') return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) };
    throw new Error(`unexpected ${u}`);
  };
  return { fetchFn, calls };
}

test('the key comes from the environment or a .env file, and is never exposed in errors', async t => {
  const folder = await temporary(t);
  await writeFile(path.join(folder, '.env'), `OTHER=1\nMIRELO_API_KEY="${KEY}"\n`);
  assert.equal(await mireloKey({}, folder), KEY);
  assert.equal(await mireloKey({ MIRELO_API_KEY: 'sk-env' }, folder), 'sk-env');
  assert.equal(await mireloKey({}, await temporary(t)), null);
  const { fetchFn } = fakeMirelo(Buffer.alloc(0), { fail: 500 });
  const failing = async (url, init) => { const r = await fetchFn(url, init); const text = r.text; r.text = async () => (await text()) + KEY; return r; };
  await assert.rejects(generate({ prompt: 'x', seconds: 1, key: KEY, file: path.join(folder, 'o.wav'), fetchFn: failing }), error => !error.message.includes(KEY) && /refused \(HTTP 500\)/.test(error.message));
});

test('generation: sends the bearer key to the API only, polls the job, downloads without the key, charges what the job says', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  await synthesize('pop', path.join(folder, 'src.wav'));
  const wav = await readFile(path.join(folder, 'src.wav'));
  const fake = fakeMirelo(wav);
  const made = await generate({ prompt: PROMPTS.pop, seconds: 0.3, key: KEY, file: path.join(folder, 'raw.wav'), fetchFn: fake.fetchFn });
  assert.equal(made.credits, 10);
  const create = fake.calls.find(c => c.method === 'POST');
  assert.equal(create.auth, `Bearer ${KEY}`);
  const body = JSON.parse(create.body);
  assert.deepEqual([body.model, body.duration_ms, body.num_variants, body.output.format], ['sfx-2.0', 300, 1, 'wav']);
  assert.match(body.input.negative_prompt, /speech/);
  assert.equal(fake.calls.find(c => c.url === 'https://files.example/a.wav').auth, undefined, 'the download link never gets the key');
  assert.equal((await readFile(path.join(folder, 'raw.wav'))).length, wav.length);
  await assert.rejects(generate({ prompt: 'x', seconds: 1, key: null, file: path.join(folder, 'n.wav') }), /no API key/);
  const noMoney = fakeMirelo(wav, { fail: 402 });
  await assert.rejects(generate({ prompt: 'x', seconds: 1, key: KEY, file: path.join(folder, 'm.wav'), fetchFn: noMoney.fetchFn }), /insufficient credits/);
});

test('using Mirelo needs explicit permission, a key, and respects the budget; a failure falls back to the built-in sound', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  await assert.rejects(mireloSession({ allow: false }), /--allow-mirelo/);
  const saved = process.env.MIRELO_API_KEY;
  process.env.MIRELO_API_KEY = KEY;
  t.after(() => { if (saved === undefined) delete process.env.MIRELO_API_KEY; else process.env.MIRELO_API_KEY = saved; });
  await synthesize('pop', path.join(folder, 'src.wav'));
  const wav = await readFile(path.join(folder, 'src.wav'));
  const fake = fakeMirelo(wav, { credits: 1000 });
  const session = await mireloSession({ allow: true, budget: 25, fetchFn: fake.fetchFn });
  assert.equal(session.cps, 10);
  const first = await obtainFromMirelo({ prompt: 'a', seconds: 1, file: path.join(folder, 'a.wav'), session });
  assert.equal(first.credits, 10); assert.equal(session.spent, 10);
  await assert.rejects(obtainFromMirelo({ prompt: 'b', seconds: 2, file: path.join(folder, 'b.wav'), session }), /budget would be exceeded/);
  // applySfx: Mirelo is refused for every kind (budget 0), so the run still completes with synthesised sounds and says so
  const broke = await mireloSession({ allow: true, budget: 0, fetchFn: fake.fetchFn });
  const manifest = { version: 2, title: 'T', fps: 24, width: 320, height: 180, assets: [], scenes: [{ kind: 'color', color: '#000000', duration: 20, purpose: 'x' }],
    globalOverlays: [{ template: 'chapter', props: { title: 'One' }, start: 1, duration: 3, placement: 'full' }] };
  const placed = await applySfx(manifest, { mode: 'subtle', engine: 'mirelo', session: broke, dir: path.join(folder, 'sfx'), relTo: folder });
  assert.equal(placed.events.length, 1);
  assert.match(placed.warnings[0], /used the built-in synthesised sound instead/);
  assert.match(placed.manifest.assets[0].rights, /Original synthesis/);
});

test('cache ids are stable per prompt, length and model; every kind has a prompt', () => {
  assert.equal(cacheId('p', 1), cacheId('p', 1));
  assert.notEqual(cacheId('p', 1), cacheId('p', 1.5));
  assert.notEqual(cacheId('p', 1), cacheId('q', 1));
  for (const k of SFX_KINDS) assert.ok(PROMPTS[k], `prompt for ${k}`);
});
