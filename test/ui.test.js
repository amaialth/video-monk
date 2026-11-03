import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, realpath, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/core.js';
import { startServer } from '../src/ui/server.js';
import { Store } from '../src/ui/store.js';

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-ui-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
async function app(t, home) {
  process.env.VIDEO_MONK_HOME = home;
  const server = await startServer({ port: 0, store: await Store.open(home) });
  t.after(() => server.close());
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(server.origin + url, { method, headers: { 'x-vm-token': server.token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { server, call };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 120000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(250); } }

test('the server is private: a token cookie is required, hosts and origins are checked, files cannot be read outside a project', async t => {
  const home = await temporary(t);
  const { server, call } = await app(t, home);
  const anon = await fetch(`${server.origin}/api/session`);
  assert.equal(anon.status, 401);
  const wrong = await fetch(`${server.origin}/?token=nope`, { redirect: 'manual' });
  assert.equal(wrong.status, 403);
  const ok = await fetch(`${server.origin}/?token=${server.token}`, { redirect: 'manual' });
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('set-cookie'), /vm_token=.*HttpOnly.*SameSite=Strict/);
  assert.equal((await call('GET', '/api/session')).status, 200);
  // DNS-rebinding guard: a request for another host name is refused
  const status = await new Promise(resolve => { const req = http.request({ host: '127.0.0.1', port: server.port, path: '/api/session', headers: { Host: 'evil.example', 'x-vm-token': server.token } }, res => { res.resume(); resolve(res.statusCode); }); req.end(); });
  assert.equal(status, 403);
  assert.equal((await call('POST', '/api/projects/import', { root: home }, { Origin: 'https://evil.example' })).status, 403);
  // static app and security headers
  const page = await call('GET', '/');
  assert.equal(page.status, 200); assert.match(page.text, /Video Monk/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const traversal = await call('GET', '/api/projects/p-000000000000-aaaaaa/file?p=../../etc/passwd');
  assert.ok([400, 404].includes(traversal.status));
  assert.equal((await call('GET', '/api/projects/not-valid/data/analysis')).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('environment, questions and the file browser work; only folders and videos are listed', { skip: ffmpegOk ? false : 'needs ffmpeg' }, async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  const env = (await call('GET', '/api/env')).json;
  assert.ok(env.checks.some(c => c.id === 'ffmpeg') && typeof env.ready === 'boolean');
  assert.ok(!JSON.stringify(env).match(/sk-|PIXABAY_API_KEY=/), 'no key values');
  const q = (await call('GET', '/api/brief/questions')).json;
  assert.ok(q.find(x => x.id === 'deliverable'));
  const media = path.join(home, 'media');
  await mkdir(path.join(media, 'sub'), { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=2:r=24', '-f', 'lavfi', '-i', 'sine=f=300:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(media, 'clip.mp4')]);
  await writeFile(path.join(media, 'notes.txt'), 'x'); await writeFile(path.join(media, '.hidden.mp4'), 'x');
  const listed = (await call('GET', `/api/fs/list?path=${encodeURIComponent(media)}`)).json;
  assert.deepEqual(listed.entries.map(e => `${e.type}:${e.name}`), ['dir:sub', 'media:clip.mp4']);
  const probe = (await call('GET', `/api/fs/probe?path=${encodeURIComponent(path.join(media, 'clip.mp4'))}`)).json;
  assert.equal(probe.width, 320); assert.equal(probe.hasAudio, true); assert.ok(probe.duration > 1.5);
  assert.equal((await call('GET', `/api/fs/probe?path=${encodeURIComponent(path.join(media, 'notes.txt'))}`)).status, 400);
  assert.equal((await call('GET', '/api/fs/list?path=/definitely/not/here')).status, 404);
});

test('a project runs end to end with real approvals: script, storyboard and final gates, an approval record, live events, and a read-only import', { skip: ffmpegOk ? false : 'needs ffmpeg and Chrome', timeout: 600000 }, async t => {
  const home = await temporary(t);
  const { server, call } = await app(t, home);
  const media = path.join(home, 'talk.mp4');
  // 14 s: speech-like bursts so the cut finds real pauses
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=14:r=24', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*220*t)*(between(t,0.2,3.5)+between(t,4.4,8)+between(t,9,13.4))':s=48000:d=14", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', media]);
  const text = 'So today we are talking about wrist APIs and how a wrist endpoint works over http. The server receives a request and then the server sends back a response. Caching keeps a copy of the data close to the user and that makes every later request faster. Redis is a popular cache and many teams use it.';
  const words = text.split(' ').map((w, i, all) => ({ text: w, start: 0.25 + i * 12.6 / all.length, end: 0.25 + i * 12.6 / all.length + 0.28 }));
  await writeFile(path.join(home, 'words.json'), JSON.stringify(words));

  // validation before anything runs
  assert.equal((await call('POST', '/api/projects', { media: path.join(home, 'missing.mp4'), options: {} })).status, 404);
  assert.equal((await call('POST', '/api/projects', { media, options: { engine: 'claude' } })).status, 400, 'Claude needs explicit permission');
  const draft = (await call('POST', '/api/projects', { media, name: 'Demo', options: { rightsConfirmed: false } })).json;
  assert.equal(draft.status, 'draft');
  assert.equal((await call('POST', `/api/projects/${draft.id}/start`)).status, 400, 'rights must be confirmed');

  const created = (await call('POST', '/api/projects', { media, name: 'Demo', start: true, options: { deliverable: 'long', content: 'explainer', graphics: 'heavy', quality: 'draft', wordsFile: path.join(home, 'words.json'),
    glossary: 'REST | api; http; endpoint\nRedis', rightsConfirmed: true, gates: { script: true, storyboard: true, final: true } } })).json;
  const id = created.id;
  const state = async () => (await call('GET', `/api/projects/${id}`)).json;

  // script gate
  const s1 = await until(async () => { const p = await state(); return p.pending?.gate === 'script' ? p : (p.status === 'failed' ? assert.fail(p.error) : null); });
  assert.equal(s1.pending.payload.candidates.length, 2);
  assert.deepEqual(s1.pending.payload.candidates.map(c => [c.heard, c.to]), [['wrist', 'REST'], ['wrist', 'REST']]);
  assert.equal((await call('POST', `/api/projects/${id}/gates/storyboard`, {})).status, 409, 'only the pending approval can be answered');
  assert.equal((await call('POST', `/api/projects/${id}/gates/script`, { accept: 'all' })).status, 400);
  assert.equal((await call('POST', `/api/projects/${id}/gates/script`, { accept: s1.pending.payload.candidates.map(c => c.id), note: 'right' })).status, 200);

  // storyboard gate: graphics are previewed and can be inspected before rendering starts
  const s2 = await until(async () => { const p = await state(); return p.pending?.gate === 'storyboard' ? p : (p.status === 'failed' ? assert.fail(p.error) : null); });
  assert.ok(s2.pending.payload.items.length >= 1);
  assert.equal(s2.steps.render.status, 'pending', 'nothing renders before approval');
  const item = s2.pending.payload.items[0];
  const png = await fetch(`${server.origin}/api/projects/${id}/preview?item=${item.id}`, { headers: { 'x-vm-token': server.token } });
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', `/api/projects/${id}/gates/storyboard`, { drop: [], note: 'ok' })).status, 200);

  // final gate: approval needs the whole checklist
  const s3 = await until(async () => { const p = await state(); return p.pending?.gate === 'final' ? p : (p.status === 'failed' ? assert.fail(p.error) : null); });
  assert.equal(s3.steps.render.status, 'done');
  assert.equal((await call('POST', `/api/projects/${id}/gates/final`, { approved: true, checklist: { watched: true } })).status, 400);
  assert.equal((await state()).status, 'waiting', 'a mistaken submission does not fail the run');
  const render = (await call('GET', `/api/projects/${id}/data/render`)).json;
  assert.ok(render.report.verification.checks.loudness);
  const video = await fetch(`${server.origin}${render.files.video}`, { headers: { 'x-vm-token': server.token, Range: 'bytes=0-99' } });
  assert.equal(video.status, 206); assert.equal((await video.arrayBuffer()).byteLength, 100);
  assert.equal((await call('POST', `/api/projects/${id}/gates/final`, { approved: true, checklist: { watched: true, facts: true, rights: true }, note: 'good' })).status, 200);
  const done = await until(async () => { const p = await state(); return p.status === 'done' ? p : null; });

  // the approval record
  assert.deepEqual(done.approvals.map(a => a.gate), ['script', 'storyboard', 'final']);
  assert.ok(done.approvals.every(a => a.by && a.at));
  assert.ok(done.approvals[1].fingerprint, 'the approved storyboard is fingerprinted');
  assert.match(await readFile(path.join(home, 'ui', 'projects', id, 'APPROVALS.md'), 'utf8'), /\| final \| approved \|/);
  assert.ok((await call('GET', `/api/projects/${id}/data/words`)).json.corrected, 'the corrected words are used');
  assert.match((await call('GET', `/api/projects/${id}/data/script`)).json.fixes, /wrist/);

  // events were recorded for replay
  const events = (await call('GET', `/api/projects/${id}/data/ledger`)).json;
  assert.ok(events.entries.some(e => e.kind === 'human-approve' && e.stage === 'storyboard'));
  const sse = await new Promise(resolve => { const req = http.get({ host: '127.0.0.1', port: server.port, path: `/api/projects/${id}/events?after=0`, headers: { 'x-vm-token': server.token } }, res => { let buf = ''; res.on('data', d => { buf += d; if ((buf.match(/\ndata: /g) || []).length >= 5) { req.destroy(); resolve(buf); } }); }); });
  assert.match(sse, /"type":"run-start"/); assert.match(sse, /"type":"step"/);

  // open the finished output folder as a read-only project
  const imported = (await call('POST', '/api/projects/import', { root: done.root })).json;
  assert.equal(imported.status, 'imported'); assert.equal(imported.steps.render.status, 'done');
  assert.equal((await call('POST', `/api/projects/${imported.id}/start`)).status, 400);
  assert.equal((await call('POST', '/api/projects/import', { root: home })).status, 400, 'a random folder is refused');
  await access(path.join(done.root, 'render', 'YOUTUBE.md'));
});

test('a run can be cancelled while it waits for approval', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  const media = path.join(home, 'a.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=6:r=24', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*220*t)*between(t,0.2,5.5)':s=48000:d=6", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', media]);
  await writeFile(path.join(home, 'w.json'), JSON.stringify('Wrist wrist test words here please now'.split(' ').map((w, i) => ({ text: w, start: 0.3 + i * 0.6, end: 0.6 + i * 0.6 }))));
  const { id } = (await call('POST', '/api/projects', { media, start: true, options: { wordsFile: path.join(home, 'w.json'), glossary: 'REST | api', rightsConfirmed: true, quality: 'draft', gates: { script: true, alwaysScript: true, storyboard: true, final: true } } })).json;
  await until(async () => (await call('GET', `/api/projects/${id}`)).json.status === 'waiting');
  assert.equal((await call('POST', `/api/projects/${id}/cancel`)).status, 200);
  const p = await until(async () => { const x = (await call('GET', `/api/projects/${id}`)).json; return x.status === 'cancelled' ? x : null; });
  assert.equal(p.pending, null);
  assert.equal((await call('DELETE', `/api/projects/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/projects/${id}`)).status, 404);
});


// ---------------------------------------------------------------------------------------------- persistence and resume
async function media(home, name = 'talk.mp4', seconds = 14) {
  const file = path.join(home, name);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:d=${seconds}:r=24`, '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*220*t)*(between(t,0.2,3.5)+between(t,4.4,8)+between(t,9,${seconds - 0.6}))':s=48000:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  const text = 'So today we are talking about wrist APIs and how a wrist endpoint works over http. The server receives a request and then the server sends back a response. Caching keeps a copy of the data close to the user and that makes every later request faster. Redis is a popular cache and many teams use it.';
  const words = text.split(' ').map((w, i, all) => ({ text: w, start: 0.25 + i * (seconds - 1.4) / all.length, end: 0.25 + i * (seconds - 1.4) / all.length + 0.28 }));
  await writeFile(path.join(home, `${name}.words.json`), JSON.stringify(words));
  return { file, words: path.join(home, `${name}.words.json`) };
}

test('a run can be resumed: approved steps are restored and not repeated, you are not asked again for what you approved, and the run history is kept', { skip: ffmpegOk ? false : 'needs ffmpeg and Chrome', timeout: 900000 }, async t => {
  const home = await temporary(t);
  const { server, call } = await app(t, home);
  const m = await media(home);
  const { id } = (await call('POST', '/api/projects', { media: m.file, name: 'Resume me', start: true, options: { content: 'explainer', graphics: 'heavy', quality: 'draft', wordsFile: m.words, glossary: 'REST | api; http; endpoint', rightsConfirmed: true, gates: { script: true, storyboard: true, final: true } } })).json;
  const state = async () => (await call('GET', `/api/projects/${id}`)).json;
  const waitFor = gate => until(async () => { const p = await state(); return p.pending?.gate === gate ? p : (p.status === 'failed' ? assert.fail(p.error) : null); });

  const s1 = await waitFor('script');
  await call('POST', `/api/projects/${id}/gates/script`, { accept: s1.pending.payload.candidates.map(c => c.id) });
  await waitFor('storyboard');
  // stop while it waits for the storyboard approval
  assert.equal((await call('POST', `/api/projects/${id}/cancel`)).status, 200);
  const cancelled = await until(async () => { const p = await state(); return p.status === 'cancelled' ? p : null; });
  const runs1 = (await call('GET', `/api/projects/${id}/runs`)).json;
  assert.equal(runs1.runs.length, 1); assert.equal(runs1.runs[0].status, 'cancelled');
  assert.deepEqual(Object.keys(runs1.checkpoints).sort(), ['cut', 'transcript', 'ui:inspect', 'ui:script', 'ui:transcript']);
  assert.equal(cancelled.steps.cut.status, 'done');

  // resume
  assert.equal((await call('POST', `/api/projects/${id}/resume`)).status, 200);
  const s2 = await waitFor('storyboard');
  assert.ok(s2.steps.inspect.restored && s2.steps.script.restored && s2.steps.cut.restored, 'finished steps are marked restored');
  assert.deepEqual(s2.approvals.map(a => a.gate), ['script'], 'the script was not asked again');
  assert.equal((await call('POST', `/api/projects/${id}/gates/storyboard`, { drop: [] })).status, 200);
  const s3 = await waitFor('final');
  assert.equal((await call('POST', `/api/projects/${id}/gates/final`, { approved: true, checklist: { watched: true, facts: true, rights: true } })).status, 200);
  const done = await until(async () => { const p = await state(); return p.status === 'done' ? p : null; });
  assert.equal(done.resumeCount, 1);
  assert.deepEqual(done.approvals.map(a => a.gate), ['script', 'storyboard', 'final']);
  const runs2 = (await call('GET', `/api/projects/${id}/runs`)).json.runs;
  assert.deepEqual(runs2.map(r => [r.status, r.resumed_from]), [['cancelled', null], ['done', runs2[0].id]]);
  const events = (await call('GET', `/api/projects/${id}/data/ledger`)).json;
  assert.ok(events.entries.filter(e => e.kind === 'review' && e.stage === 'cut').length <= 2, 'the cut was not reviewed a second time');
  const sse = await new Promise(resolve => { const req = http.get({ host: '127.0.0.1', port: server.port, path: `/api/projects/${id}/events?after=0`, headers: { 'x-vm-token': server.token } }, res => { let buf = ''; res.on('data', d => { buf += d; if (buf.includes('run-resumed') && buf.includes('"type":"done"')) { req.destroy(); resolve(buf); } }); setTimeout(() => { req.destroy(); resolve(buf); }, 4000); }); });
  assert.match(sse, /run-resumed/); assert.match(sse, /restored cut from the earlier run|restored .*cut/);
  // what you corrected is remembered for later projects, and so is the footage
  const terms = (await call('GET', '/api/terms')).json;
  assert.ok(terms.terms.some(x => x.heard === 'wrist' && x.term === 'REST'));
  assert.match(terms.glossary, /REST/);
  assert.equal((await call('GET', '/api/recent')).json[0].name, 'talk.mp4');
  assert.ok((await call('GET', '/api/approvals')).json.length >= 3, 'every approval is in the history across projects');
  assert.equal((await call('POST', `/api/projects/${id}/resume`)).status, 409, 'a finished project cannot be resumed');
});

test('after the app is closed mid-run the project is marked interrupted and can be resumed by a new server on the same database; remembered terms catch mishearings in the next project', { skip: ffmpegOk ? false : 'needs ffmpeg and Chrome', timeout: 900000 }, async t => {
  const home = await temporary(t);
  const m = await media(home);
  let first = await app(t, home);
  const { id } = (await first.call('POST', '/api/projects', { media: m.file, name: 'Crash me', start: true, options: { content: 'explainer', graphics: 'heavy', quality: 'draft', wordsFile: m.words, glossary: 'REST | api; http', rightsConfirmed: true, gates: { script: true, storyboard: true, final: true } } })).json;
  const waitFor = async (c, gate) => until(async () => { const p = (await c.call('GET', `/api/projects/${id}`)).json; return p.pending?.gate === gate ? p : (p.status === 'failed' ? assert.fail(p.error) : null); });
  const s1 = await waitFor(first, 'script');
  await first.call('POST', `/api/projects/${id}/gates/script`, { accept: s1.pending.payload.candidates.map(c => c.id) });
  await waitFor(first, 'storyboard');
  // simulate a crash: the process disappears without cancelling anything
  first.server.runner.active.clear();
  const store = first.server.store;
  const p = await store.get(id); p.status = 'running'; p.pending = null; p.steps.storyboard.status = 'running'; await store.save(p);
  await first.server.server.close(); first.server.server.closeAllConnections?.();
  // a new server on the same database
  const second = await app(t, home);
  const after = (await second.call('GET', `/api/projects/${id}`)).json;
  assert.equal(after.status, 'interrupted');
  assert.equal(after.steps.storyboard.status, 'interrupted');
  assert.equal((await second.call('POST', `/api/projects/${id}/start`)).status, 409);
  assert.equal((await second.call('POST', `/api/projects/${id}/resume`)).status, 200);
  const s2 = await waitFor(second, 'storyboard');
  assert.ok(s2.steps.cut.restored);
  await second.call('POST', `/api/projects/${id}/cancel`);
  await until(async () => (await second.call('GET', `/api/projects/${id}`)).json.status === 'cancelled');
  // the next project needs no glossary: what you approved is remembered
  const n = (await second.call('POST', '/api/projects', { media: m.file, name: 'Next one', start: true, options: { content: 'explainer', graphics: 'light', quality: 'draft', wordsFile: m.words, rightsConfirmed: true, gates: { script: true, storyboard: true, final: true } } })).json;
  const g = await until(async () => { const x = (await second.call('GET', `/api/projects/${n.id}`)).json; return x.pending?.gate === 'script' ? x : (x.status === 'failed' ? assert.fail(x.error) : null); });
  assert.ok(g.pending.payload.candidates.length >= 1, 'found without a glossary, from remembered terms');
  assert.deepEqual([g.pending.payload.candidates[0].heard, g.pending.payload.candidates[0].to], ['wrist', 'REST']);
  await second.call('POST', `/api/projects/${n.id}/cancel`);
});

test('presets, settings, remembered terms and the database summary are available, and a preset never carries the rights attestation', async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  const saved = (await call('POST', '/api/presets', { name: 'My explainers', options: { content: 'explainer', graphics: 'heavy', rightsConfirmed: true, wordsFile: '/x.json', pace: 'tight' } })).json;
  assert.equal(saved.name, 'My explainers'); assert.equal(saved.options.rightsConfirmed, undefined); assert.equal(saved.options.wordsFile, undefined); assert.equal(saved.options.pace, 'tight');
  assert.equal((await call('POST', '/api/presets', { name: '', options: {} })).status, 400);
  assert.equal((await call('GET', '/api/presets')).json.length, 1);
  assert.equal((await call('DELETE', `/api/presets/${saved.id}`)).json.deleted, 1);
  assert.deepEqual((await call('POST', '/api/settings', { theme: 'light', evil: 'x' })).json, { theme: 'light' }, 'only known settings are stored');
  const db = (await call('GET', '/api/db')).json;
  assert.equal(db.schema, 2); assert.match(db.file, /video-monk\.db$/); assert.ok(db.usage.unsplashHour);
});
