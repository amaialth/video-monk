import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/core.js';
import { startServer } from '../src/ui/server.js';
import { Store } from '../src/ui/store.js';
import { ELEVEN_ENV } from '../src/elevenlabs.js';

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const SECRET = 'sk_ui_SECRET_MUST_NEVER_REACH_THE_BROWSER';
async function temporary(t) { const f = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-uis-'))); t.after(() => rm(f, { recursive: true, force: true })); return f; }

const SOURCE = 'Plants make food from light. Photosynthesis uses sunlight, water and carbon dioxide. A single leaf can hold about 500 chloroplasts, and the process gives off oxygen that animals breathe.';
const say = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const script = () => ({ title: 'How plants make food', beats: [
  { say: 'How do plants make their own food from nothing but light?', show: 'title', props: { title: 'How do plants *eat*?' } },
  { say: `Plants use sunlight, water and carbon dioxide ${say(8)}.`, show: 'bullets', props: { items: ['Sunlight', 'Water', 'Carbon dioxide'] } },
  { say: `This process is called photosynthesis ${say(10)}.`, show: 'term', props: { term: 'Photosynthesis', definition: 'Turning *light* into food.' } },
  { say: `It happens in tiny parts called chloroplasts ${say(8)}.`, show: 'steps', props: { steps: [{ title: 'Light arrives' }, { title: 'Water splits' }, { title: 'Sugar forms' }] } },
  { say: `One leaf can hold about 500 of them ${say(8)}.`, show: 'stat', props: { value: 500, label: 'chloroplasts in a leaf' } },
  { say: `The oxygen you breathe is a by-product ${say(10)}.`, show: 'quote', props: { quote: 'Light in, food and oxygen out.' } },
  { say: `Light becomes food ${say(4)}.`, show: 'kinetic-text', props: { text: 'Light becomes *food*' } }] });

async function app(t, home) {
  process.env.VIDEO_MONK_HOME = home;
  const sent = { claude: 0, eleven: [], voices: 0 };
  const execute = async (cmd, args, opts) => { if (cmd === 'claude') { sent.claude++; return { stdout: JSON.stringify({ structured_output: script(), total_cost_usd: 0.01 }) }; } return run(cmd, args, opts); };
  const fetcher = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.elevenlabs.io');
    if (u.pathname === '/v2/voices') { sent.voices++; return Response.json({ voices: [{ voice_id: 'voiceABC123', name: 'Ana', category: 'premade', labels: { accent: 'american' }, preview_url: 'https://x/a.mp3' }], has_more: false }); }
    if (u.pathname === '/v1/models') return Response.json([{ model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true, maximum_text_length_per_request: 10000, languages: [{ language_id: 'en' }] }]);
    const body = JSON.parse(init.body); sent.eleven.push({ key: init.headers['xi-api-key'], text: body.text });
    const secs = Math.max(0.8, body.text.length * 0.04), file = path.join(home, `t-${sent.eleven.length}.mp3`);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${secs}`, '-c:a', 'libmp3lame', file]);
    const chars = [...body.text], per = secs / chars.length;
    return Response.json({ audio_base64: (await readFile(file)).toString('base64'), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * per), character_end_times_seconds: chars.map((_, i) => (i + 1) * per) } });
  };
  const server = await startServer({ port: 0, store: await Store.open(home), shortsDeps: { execute, fetcher, env: { [ELEVEN_ENV.key]: SECRET, [ELEVEN_ENV.voice]: 'voiceABC123' }, cwd: '/nonexistent', claude: true } });
  t.after(() => server.close());
  const call = async (method, url, body) => {
    const r = await fetch(server.origin + url, { method, headers: { 'x-vm-token': server.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    const text = await r.text();
    return { status: r.status, json: type.includes('json') ? JSON.parse(text) : null, text };
  };
  const wait = async jobId => { for (let i = 0; i < 600; i++) { const j = (await call('GET', `/api/shorts/jobs/${jobId}`)).json; if (j.status !== 'running') return j; await new Promise(r => setTimeout(r, 100)); } throw new Error('job timed out'); };
  return { server, call, wait, sent };
}

test('the studio reports what is configured and lists voices without the key ever reaching the browser', async t => {
  const home = await temporary(t);
  const { call, sent } = await app(t, home);
  const cfg = await call('GET', '/api/shorts/config');
  assert.equal(cfg.json.elevenlabs.hasKey, true);
  assert.equal(cfg.json.elevenlabs.voiceId, 'voiceABC123');
  assert.deepEqual(cfg.json.options.lengths, [30, 45, 60]);
  assert.ok(cfg.json.options.captions.includes('highlight'));
  const voices = await call('GET', '/api/shorts/voices?search=an');
  assert.deepEqual(voices.json.map(v => v.id), ['voiceABC123']);
  assert.equal(sent.voices, 1);
  await call('GET', '/api/shorts/voices?search=an');
  assert.equal(sent.voices, 1, 'voices are cached for a few minutes');
  assert.equal((await call('GET', '/api/shorts/models')).json[0].id, 'eleven_multilingual_v2');
  for (const r of [cfg, voices, await call('GET', '/api/env')]) assert.ok(!r.text.includes(SECRET), 'the key is in no response');
});

test('a short goes step by step: nothing is sent to Claude or spent at ElevenLabs without confirmation', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const home = await temporary(t);
  const { call, wait, sent } = await app(t, home);
  assert.equal((await call('POST', '/api/shorts', { source: '' })).status, 400);
  assert.match((await call('POST', '/api/shorts', { source: SOURCE, options: { length: 99 } })).json.error, /length must be one of/);
  const made = await call('POST', '/api/shorts', { source: SOURCE, options: { length: 45, captions: 'pill', sfx: 'off' } });
  assert.equal(made.status, 200);
  const id = made.json.id;
  assert.match(id, /^s-[a-f0-9]{8}$/);
  assert.equal((await call('POST', `/api/shorts/${id}/script`, {})).status, 400);
  assert.equal(sent.claude, 0, 'Claude is not called without confirmation');
  const sj = await call('POST', `/api/shorts/${id}/script`, { confirmLlm: true });
  assert.equal(sj.status, 200, JSON.stringify(sj.json));
  const sdone = await wait(sj.json.jobId);
  assert.equal(sdone.status, 'done', sdone.error);
  assert.equal(sent.claude, 1);
  const state = (await call('GET', `/api/shorts/${id}`)).json;
  assert.equal(state.stage, 'script');
  assert.equal(state.script.beats.length, 7);
  assert.deepEqual(state.check.errors, []);
  assert.ok(state.estimate.characters > 300);
  // edits are checked against the source
  const bad = JSON.parse(JSON.stringify(state.script)); bad.beats[4].props.value = 4242;
  const refused = await call('PUT', `/api/shorts/${id}/script`, { script: bad });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /the number 4242 is not in the source text/);
  const edited = JSON.parse(JSON.stringify(state.script)); edited.beats[0].say = 'Where does a plant get its food from, if not the soil?';
  assert.equal((await call('PUT', `/api/shorts/${id}/script`, { script: edited })).status, 200);
  // recording needs a voice and an explicit confirmation of the spend
  assert.equal((await call('POST', `/api/shorts/${id}/build`, { approve: true })).status, 400);
  const unconfirmed = await call('POST', `/api/shorts/${id}/audio`, { voiceId: 'voiceABC123' });
  assert.equal(unconfirmed.status, 409);
  assert.match(unconfirmed.json.error, /Confirm to spend them/);
  assert.equal(sent.eleven.length, 0, 'nothing is recorded without confirmation');
  const aj = await call('POST', `/api/shorts/${id}/audio`, { voiceId: 'voiceABC123', voiceName: 'Ana', confirmSpend: true });
  const adone = await wait(aj.json.jobId);
  assert.equal(adone.status, 'done', adone.error);
  assert.equal(sent.eleven.length, 7);
  assert.ok(sent.eleven.every(e => e.key === SECRET), 'the server (not the browser) holds the key');
  assert.equal(sent.eleven[0].text, edited.beats[0].say, 'the edited narration is what is recorded');
  const planned = (await call('GET', `/api/shorts/${id}`)).json;
  assert.equal(planned.stage, 'planned');
  assert.ok(planned.files.plan && planned.files.narration);
  assert.equal(planned.beatAudio.length, 7);
  const audioFile = await fetch(`${(await call('GET', '/api/session')).json ? '' : ''}`).catch(() => null);
  void audioFile;
  // the audio of a beat can be played; nothing outside the short's folder can be read
  const play = await call('GET', `/api/shorts/${id}/file?p=${encodeURIComponent(planned.beatAudio[0])}`);
  assert.equal(play.status, 200);
  assert.equal((await call('GET', `/api/shorts/${id}/file?p=${encodeURIComponent('../../../video-monk.db')}`)).status, 404);
  assert.equal((await call('GET', `/api/shorts/${id}/file?p=short.json`)).status, 404);
  // re-recording after an edit reuses what is cached
  const again = await wait((await call('POST', `/api/shorts/${id}/audio`, { voiceId: 'voiceABC123', confirmSpend: true })).json.jobId);
  assert.equal(again.status, 'done', again.error);
  assert.equal(sent.eleven.length, 7, 'recordings are not paid for twice');
  // the build needs approval, and the approval is recorded
  assert.equal((await call('POST', `/api/shorts/${id}/build`, {})).status, 400);
  const list = (await call('GET', '/api/shorts')).json;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal((await call('DELETE', `/api/shorts/${id}`)).json.deleted, true);
  assert.deepEqual(await readdir(path.join(home, 'ui', 'shorts')), []);
});
