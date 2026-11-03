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

test('catalog blocks: import needs confirmation and refuses components and unknown names; imported blocks appear in the studio and can be planned as beats', async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  assert.equal((await call('POST', '/api/catalog/import', { name: 'lt-clean-bar' })).status, 400);
  const comp = await call('POST', '/api/catalog/import', { name: 'confetti', confirm: true });
  assert.equal(comp.status, 400);
  assert.match(comp.json.error, /component/);
  assert.match((await call('POST', '/api/catalog/import', { name: 'nope', confirm: true })).json.error, /not in the catalog inventory/);
  assert.equal((await call('GET', '/api/motion/catalog-preview?name=lt-test')).status, 404);
  assert.equal((await call('POST', '/api/catalog/remove', { name: 'lt-test' })).json.removed, 0);
  // an imported block (written by hand here) and the gsap library
  const d = path.join(home, 'catalog', 'lt-test'); await mkdir(d, { recursive: true });
  await writeFile(path.join(d, 'index.html'), '<head><script>window.__vmVariables = {};</script></head><body>x</body>');
  await writeFile(path.join(d, 'item.json'), JSON.stringify({ name: 'lt-test', title: 'Lower Third', license: 'Apache-2.0', width: 1920, height: 1080, duration: 4.8, variables: [{ id: 'name', label: 'Name', default: 'Ada' }], vars: {}, needs: { gsap: true, plugins: [] } }));
  const motion = await call('GET', '/api/motion');
  assert.deepEqual(motion.json.imported.map(i => i.name), ['lt-test']);
  assert.deepEqual((await call('GET', '/api/motion/catalog')).json.imported, ['lt-test']);
  assert.equal((await call('GET', '/api/motion/catalog-preview?name=lt-test')).status, 409); // gsap not installed yet
  const lib = path.join(home, 'libs', 'gsap@1.0.0'); await mkdir(lib, { recursive: true });
  await writeFile(path.join(lib, 'lib.json'), JSON.stringify({ id: 'gsap', version: '1.0.0', addedAt: '2026-11-01T00:00:00Z' }));
  const b = { type: 'opener', title: 'C', beats: [{ catalog: 'lt-test', vars: { name: 'Grace' }, seconds: 5 }, { show: 'title', props: { title: 'Done' }, seconds: 4 }] };
  const ok = await call('POST', '/api/motion/video', { brief: b, output: path.join(home, 'plan'), sfx: 'off' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(await readFile(path.join(home, 'plan', 'scenes', 'lt-test', 'index.html'), 'utf8'), /"name":"Grace"/);
  assert.equal((await call('POST', '/api/catalog/remove', { name: 'lt-test' })).json.removed, 1);
});

test('screen zoom: moments are proposed from a recording, and the ones you keep become a NEW plan (never overwriting)', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 180000 }, async t => {
  const home = await temporary(t);
  const { call } = await app(t, home);
  assert.equal((await call('POST', '/api/motion/focus/detect', { media: 'rec.mp4' })).status, 400);
  assert.match((await call('POST', '/api/motion/focus/detect', { media: path.join(home, 'notes.txt') })).json.error, /not a video/);
  assert.equal((await call('POST', '/api/motion/focus/detect', { media: path.join(home, 'nope.mp4') })).status, 404);
  const rec = path.join(home, 'rec.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', "color=c=0x202833:s=640x360:r=30:d=10,drawbox=x=300:y=320:w=170:h=24:color=0x4cc9f0:t=fill:enable='gte(t\\,5)'", '-pix_fmt', 'yuv420p', rec]);
  assert.match((await call('POST', '/api/motion/focus/detect', { media: rec, sensitivity: 9 })).json.error, /out of range/);
  const found = await call('POST', '/api/motion/focus/detect', { media: rec });
  assert.equal(found.status, 200);
  assert.ok(found.json.clicks.some(c => Math.abs(c.at - 5) < 0.8 && Math.abs(c.x - 0.6) < 0.12 && Math.abs(c.y - 0.92) < 0.1), JSON.stringify(found.json));
  const manifest = path.join(home, 'production.json');
  await writeFile(manifest, JSON.stringify({ version: 2, title: 'R', fps: 30, width: 640, height: 360, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }], scenes: [{ id: 's1', kind: 'video', asset: 'rec', in: 0, duration: 10, fit: 'cover', audio: {}, purpose: 'demo' }] }));
  const before = await readFile(manifest, 'utf8');
  assert.equal((await call('POST', '/api/motion/focus/apply', { manifest: 'production.json', clicks: found.json.clicks })).status, 400);
  assert.equal((await call('POST', '/api/motion/focus/apply', { manifest, clicks: [] })).status, 400);
  const a = await call('POST', '/api/motion/focus/apply', { manifest, clicks: found.json.clicks, amount: 0.6 });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.match(a.json.output, /production\.focus\.json$/);
  assert.equal(JSON.parse(await readFile(a.json.output, 'utf8')).scenes[0].motion.type, 'focus');
  const b = await call('POST', '/api/motion/focus/apply', { manifest, clicks: found.json.clicks });
  assert.match(b.json.output, /production\.focus2\.json$/);
  assert.match(a.json.next[0], /production-review .*--approve-plan/);
  assert.equal(await readFile(manifest, 'utf8'), before, 'the original plan is untouched');
  assert.ok(!(await readdirSafe(home)).some(f => /focus-clicks/.test(f)), 'the staging file is removed');
});
async function readdirSafe(dir) { const { readdir } = await import('node:fs/promises'); return readdir(dir); }
