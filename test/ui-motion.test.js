import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/core.js';
import { startServer } from '../src/ui/server.js';
import { Store } from '../src/ui/store.js';

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-uim-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
async function app(t, home) {
  process.env.VIDEO_MONK_HOME = home;
  const server = await startServer({ port: 0, store: await Store.open(home) });
  t.after(() => server.close());
  const call = async (method, url, body) => {
    const r = await fetch(server.origin + url, { method, headers: { 'x-vm-token': server.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, json: type.includes('json') ? await r.json() : null, type, bytes: type.includes('json') ? 0 : (await r.arrayBuffer()).byteLength };
  };
  return { server, call };
}
const brief = () => ({ type: 'opener', title: 'Hello', beats: [
  { say: 'Hello.', show: 'title', props: { title: 'Hello *world*' }, seconds: 4 },
  { say: 'Close.', show: 'quote', props: { quote: 'Made with care.' }, seconds: 4 }] });

test('the motion studio lists templates with examples, the formats, the starters and the libraries', async t => {
  const { call } = await app(t, await temporary(t));
  const { status, json } = await call('GET', '/api/motion');
  assert.equal(status, 200);
  const effects = json.templates.filter(x => x.effect).map(x => x.name).sort();
  assert.equal(effects.length, 10);
  for (const name of effects) assert.ok(json.templates.find(x => x.name === name).example, name);
  assert.deepEqual(Object.keys(json.types).sort(), ['chart', 'explainer', 'launch', 'milestone', 'opener', 'promo']);
  assert.ok(json.starters.length >= 8 && json.starters.some(s => s.name === 'three-showcase' && s.libs.includes('three')));
  assert.ok(json.libs.find(l => l.id === 'gsap').license.includes('no charge'));
  assert.ok(json.libs.every(l => Array.isArray(l.installed)));
  assert.ok(json.unsupported['react-three-fiber']);
});

test('downloads need confirmation, unknown libraries and templates are refused, and starter previews say what to install', async t => {
  const { call } = await app(t, await temporary(t));
  assert.equal((await call('POST', '/api/libs/add', { id: 'three' })).status, 400);
  assert.equal((await call('POST', '/api/libs/add', { id: 'nope', confirm: true })).status, 400);
  assert.equal((await call('POST', '/api/libs/remove', { id: 'nope' })).status, 400);
  assert.equal((await call('GET', '/api/motion/preview?template=captions&props=%7B%7D')).status, 404);
  assert.equal((await call('GET', '/api/motion/preview?template=title&props=%7Bnope')).status, 400);
  assert.equal((await call('GET', '/api/motion/preview?template=title&props=%7B%7D')).status, 400);
  const starter = await call('GET', '/api/motion/starter-preview?name=three-showcase');
  assert.equal(starter.status, 409);
  assert.match(starter.json.error, /Install three/);
  assert.equal((await call('GET', '/api/motion/starter-preview?name=..%2F..%2Fetc%2Fpasswd')).status, 404);
});

test('the planner checks a brief, refuses bad folders and custom html, and writes a plan without building', async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  const many = { ...brief(), beats: [...brief().beats, ...brief().beats] };
  assert.match((await call('POST', '/api/motion/brief/check', { brief: many })).json.errors.join(), /needs 1-3 beats/);
  const short = brief(); short.beats[1].seconds = 2;
  assert.match((await call('POST', '/api/motion/brief/check', { brief: short })).json.errors.join(), /hold at least 3 s/);
  assert.equal((await call('POST', '/api/motion/video', { brief: brief(), output: 'relative/path' })).status, 400);
  const withHtml = brief(); withHtml.beats[0] = { show: undefined, html: '/etc/hosts', seconds: 4 };
  assert.match((await call('POST', '/api/motion/video', { brief: withHtml, output: path.join(home, 'x') })).json.error, /Custom HTML/);
  const out = path.join(home, 'plan');
  const ok = await call('POST', '/api/motion/video', { brief: brief(), output: out, sfx: 'off' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.scenes, 2);
  assert.match(ok.json.next[0], /production-review .*--approve-plan/);
  const manifest = JSON.parse(await readFile(path.join(out, 'production.json'), 'utf8'));
  assert.deepEqual(manifest.scenes.map(s => s.kind), ['graphic', 'graphic']);
  assert.equal((await call('POST', '/api/motion/video', { brief: brief(), output: out })).status, 400); // a plan already there is never overwritten
  const numbers = brief(); numbers.beats[1] = { show: 'stat', props: { value: 500, label: 'users' }, seconds: 4 };
  const refused = await call('POST', '/api/motion/video', { brief: numbers, output: path.join(home, 'plan2'), sfx: 'off' });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /fact list/);
});

test('the app shell offers the motion studio', async t => {
  const main = await readFile(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /#\/motion/);
  assert.match(await readFile(new URL('../web/js/views/motion.js', import.meta.url), 'utf8'), /Libraries and 3D/);
});

test('a template preview is a real PNG, cached and validated', { skip: ffmpegOk ? false : 'needs Chrome', timeout: 180000 }, async t => {
  const { call } = await app(t, await temporary(t));
  const props = encodeURIComponent(JSON.stringify({ title: 'Hello *world*' }));
  const r = await call('GET', `/api/motion/preview?template=title&props=${props}&at=2`);
  assert.equal(r.status, 200);
  assert.match(r.type, /png/);
  assert.ok(r.bytes > 2000);
});

test('the studio plans 3D scene beats, reports missing libraries when checking, and lists starter files', async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  const b = { type: 'opener', title: 'Scene', beats: [{ say: 'Turn.', starter: 'gsap-timeline', seconds: 5 }, { show: 'title', props: { title: 'Done' }, seconds: 4 }] };
  const check = await call('POST', '/api/motion/brief/check', { brief: b });
  assert.deepEqual(check.json.errors, []);
  assert.deepEqual(check.json.libs, [{ id: 'gsap', installed: false, version: null }]);
  const refused = await call('POST', '/api/motion/video', { brief: b, output: path.join(home, 'p1'), sfx: 'off' });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /libs --add gsap/);
  const d = path.join(home, 'libs', 'gsap@1.0.0'); await mkdir(d, { recursive: true });
  await writeFile(path.join(d, 'lib.json'), JSON.stringify({ id: 'gsap', version: '1.0.0', addedAt: '2026-11-01T00:00:00Z' }));
  const ok = await call('POST', '/api/motion/video', { brief: b, output: path.join(home, 'p2'), sfx: 'off' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.libs, [{ id: 'gsap', version: '1.0.0' }]);
  assert.match(await readFile(path.join(home, 'p2', 'PLAN.md'), 'utf8'), /gsap-timeline/);
  const list = await call('GET', '/api/motion');
  assert.deepEqual(list.json.starters.find(s => s.name === 'three-gltf').assets, ['model.glb']);
});

test('the captured HyperFrames catalog is served read-only with statuses, groups and links', async t => {
  const { call } = await app(t, await temporary(t));
  const { status, json } = await call('GET', '/api/motion/catalog');
  assert.equal(status, 200);
  assert.equal(json.count, json.items.length);
  assert.ok(json.count >= 440);
  const names = new Set(json.items.map(i => i.name));
  assert.equal(names.size, json.items.length);
  for (const i of json.items) { assert.ok(['adapt', 'have', 'defer', 'skip'].includes(i.status), i.name); assert.match(i.url, /^https:\/\/hyperframes\.heygen\.com\/catalog\//); assert.ok(i.group, i.name); }
  assert.ok(json.items.filter(i => i.top).length >= 30);
  assert.ok(json.items.find(i => i.name === 'cursor-zoom-follow').top);
  assert.ok(json.items.filter(i => i.status === 'defer').every(i => i.needs.includes('webgpu')));
  assert.ok(json.items.filter(i => i.status === 'skip').length >= 20);
  assert.match(json.source, /hyperframes\.heygen\.com/);
  assert.equal((await call('POST', '/api/motion/catalog', {})).status, 404);
});
