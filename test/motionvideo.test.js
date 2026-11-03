import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/core.js';
import { TYPES, reviewBrief, motionVideo } from '../src/motionvideo.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-mv-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

const brief = (over = {}) => ({ type: 'milestone', title: 'Ten thousand',
  beats: [
    { say: 'It started with one.', show: 'title', props: { title: 'From one to *ten thousand*' }, seconds: 3.5 },
    { say: 'Then people came.', show: 'stat', props: { value: 10000, label: 'members' }, seconds: 4 },
    { say: 'Thank you.', show: 'quote', props: { quote: 'Built by the people who showed up.' }, seconds: 3.5 }], ...over });

test('the six formats are defined with beat counts, lengths and a last-beat hold', () => {
  assert.deepEqual(Object.keys(TYPES).sort(), ['chart', 'explainer', 'launch', 'milestone', 'opener', 'promo']);
  for (const t of Object.values(TYPES)) { assert.equal(t.beats.length, 2); assert.ok(t.hold >= 3); }
});

test('a good brief passes; the type, beat count, last-beat hold and templates are enforced', () => {
  assert.deepEqual(reviewBrief(brief()).errors, []);
  assert.match(reviewBrief(brief({ type: 'nope' })).errors[0], /type must be one of/);
  assert.match(reviewBrief(brief({ beats: brief().beats.slice(0, 1) })).errors.join(), /needs 2-4 beats/);
  const short = brief(); short.beats[2].seconds = 2;
  assert.match(reviewBrief(short).errors.join(), /hold at least 3 s/);
  const badTemplate = brief(); badTemplate.beats[0].show = 'progress-bar';
  assert.match(reviewBrief(badTemplate).errors.join(), /not a template a beat can use/);
  const badProps = brief(); badProps.beats[2].props = { text: 'x' };
  assert.match(reviewBrief(badProps).errors.join(), /unsupported/);
  assert.match(reviewBrief(brief({ aspect: '3:2' })).errors.join(), /aspect must be/);
  assert.match(reviewBrief(brief({ music: { file: 'm.mp3' } })).errors.join(), /music needs file, rights and attribution/);
});

test('length outside the format and repeated templates are warnings, not errors', () => {
  const r = reviewBrief(brief({ beats: brief().beats.map(b => ({ ...b, show: 'title', props: { title: 'x' }, seconds: 6 })) }));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => /same template/.test(w)));
  assert.ok(r.warnings.some(w => /8-15 s/.test(w)));
});

test('numbers on screen need a fact list unless the beat is marked illustrative', async t => {
  const dir = await temporary(t);
  await writeFile(path.join(dir, 'brief.json'), JSON.stringify(brief()));
  await assert.rejects(motionVideo(path.join(dir, 'brief.json'), path.join(dir, 'out'), { sfx: 'off' }), /no fact list/);
  const ok = brief(); ok.type = 'chart'; ok.beats = [{ show: 'chart-morph', props: { labels: ['A', 'B', 'C'], values: [1, 2, 3], illustrative: true }, seconds: 6 }];
  await writeFile(path.join(dir, 'chart.json'), JSON.stringify(ok));
  const result = await motionVideo(path.join(dir, 'chart.json'), path.join(dir, 'chart-out'), { sfx: 'off' });
  assert.equal(result.scenes, 1);
});

test('a fact list must source every fact and list every number; then the manifest is written', async t => {
  const dir = await temporary(t);
  await writeFile(path.join(dir, 'brief.json'), JSON.stringify(brief()));
  await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ facts: [{ text: '500 members', source: 'x' }] }));
  await assert.rejects(motionVideo(path.join(dir, 'brief.json'), path.join(dir, 'o1'), { facts: path.join(dir, 'bad.json'), sfx: 'off' }), /not in the fact list/);
  await writeFile(path.join(dir, 'good.json'), JSON.stringify({ facts: [{ text: 'The community reached 10,000 members', source: 'membership count' }] }));
  const result = await motionVideo(path.join(dir, 'brief.json'), path.join(dir, 'o2'), { facts: path.join(dir, 'good.json'), sfx: 'off' });
  const m = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(m.version, 2);
  assert.deepEqual(m.scenes.map(s => s.kind), ['graphic', 'graphic', 'graphic']);
  assert.deepEqual(m.scenes.map(s => Boolean(s.transition)), [true, true, false]);
  assert.equal(m.scenes[0].purpose, 'It started with one.');
  assert.equal(result.facts.ok, true);
  assert.equal(m.assets.length, 0);
});

test('music keeps its licence, aspect sets the size and subtle sound effects are added', { skip: !ffmpegOk }, async t => {
  const dir = await temporary(t);
  const b = brief({ aspect: '9:16', music: { file: 'bed.mp3', rights: 'YouTube Audio Library', attribution: 'Track by Someone' } });
  b.beats[1] = { say: 'Growth.', show: 'chart-morph', props: { labels: ['A', 'B', 'C'], values: [1, 2, 3], illustrative: true }, seconds: 4 };
  await writeFile(path.join(dir, 'brief.json'), JSON.stringify(b));
  const result = await motionVideo(path.join(dir, 'brief.json'), path.join(dir, 'out'), { sfx: 'subtle' });
  const m = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(`${m.width}x${m.height}`, '1080x1920');
  assert.equal(m.assets[0].rights, 'YouTube Audio Library');
  assert.ok(m.audio.music[0].gainDb <= -12);
  assert.ok(m.audio.sfx.length >= 1 && m.audio.sfx.length <= 3);
});

// ---- 3D / library scenes as beats
import { libsNeeded, starterNames } from '../src/motionvideo.js';
import { mkdir as mk } from 'node:fs/promises';

async function withLib(t, ids) {
  const home = await temporary(t);
  const before = process.env.VIDEO_MONK_HOME;
  process.env.VIDEO_MONK_HOME = home;
  t.after(() => { if (before === undefined) delete process.env.VIDEO_MONK_HOME; else process.env.VIDEO_MONK_HOME = before; });
  for (const id of ids) { const d = path.join(home, 'libs', `${id}@1.0.0`); await mk(d, { recursive: true }); await writeFile(path.join(d, 'lib.json'), JSON.stringify({ id, version: '1.0.0', addedAt: '2026-11-01T00:00:00Z' })); }
  return home;
}
const sceneBrief = (over = {}) => ({ type: 'opener', title: 'Scene', beats: [{ say: 'A turn.', starter: 'gsap-timeline', seconds: 5 }, { say: 'Name.', show: 'title', props: { title: 'Done' }, seconds: 4 }], ...over });

test('starter beats are validated: known name, one kind of beat each', () => {
  assert.ok(starterNames().includes('three-showcase') && starterNames().length >= 9);
  assert.deepEqual(reviewBrief(sceneBrief()).errors, []);
  const unknown = sceneBrief(); unknown.beats[0].starter = 'nope';
  assert.match(reviewBrief(unknown).errors.join(), /starter must be one of/);
  const both = sceneBrief(); both.beats[0].show = 'title';
  assert.match(reviewBrief(both).errors.join(), /not more than one/);
});

test('a plan with a 3D scene refuses, without leaving a folder, until its library is installed', async t => {
  const dir = await temporary(t);
  await withLib(t, []);
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(sceneBrief()));
  await assert.rejects(motionVideo(path.join(dir, 'b.json'), path.join(dir, 'out'), { sfx: 'off' }), /libs --add gsap --allow-download/);
  await assert.rejects(readFile(path.join(dir, 'out', 'production.json')), /ENOENT/);
  assert.deepEqual(await libsNeeded(sceneBrief()), [{ id: 'gsap', installed: false, version: null }]);
});

test('with the library installed the scene is copied into the plan, listed in PLAN.md and used as a graphic scene', async t => {
  const dir = await temporary(t);
  await withLib(t, ['gsap']);
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(sceneBrief()));
  const r = await motionVideo(path.join(dir, 'b.json'), path.join(dir, 'out'), { sfx: 'off' });
  assert.deepEqual(r.libs, [{ id: 'gsap', version: '1.0.0' }]);
  const m = JSON.parse(await readFile(r.output, 'utf8'));
  assert.equal(m.scenes[0].graphic.html, path.join(dir, 'out', 'scenes', 'gsap-timeline.html'));
  assert.match(await readFile(m.scenes[0].graphic.html, 'utf8'), /<vm-lib name="gsap">/);
  assert.match(m.notes, /gsap@1\.0\.0/);
  const plan = await readFile(r.plan, 'utf8');
  assert.match(plan, /gsap 1\.0\.0/);
  assert.match(plan, /NOT covered by facts-check/);
  assert.deepEqual((await libsNeeded(sceneBrief())), [{ id: 'gsap', installed: true, version: '1.0.0' }]);
});

test('a scene that needs your own file asks for it and copies it next to the scene', async t => {
  const dir = await temporary(t);
  await withLib(t, ['three']);
  const b = sceneBrief(); b.beats[0] = { say: 'The model.', starter: 'three-gltf', seconds: 5 };
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(b));
  await assert.rejects(motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o1'), { sfx: 'off' }), /needs the file model\.glb/);
  await writeFile(path.join(dir, 'model.glb'), 'glTF');
  b.beats[0].assets = { 'model.glb': 'model.glb' };
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(b));
  const r = await motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o2'), { sfx: 'off' });
  assert.equal(await readFile(path.join(dir, 'o2', 'scenes', 'model.glb'), 'utf8'), 'glTF');
  assert.equal(r.libs[0].id, 'three');
});

test('seams keep one direction of travel (the current): all slide the same way, and a ping-pong is warned about', async t => {
  const dir = await temporary(t);
  const b = brief({ type: 'launch', beats: Array.from({ length: 4 }, (_, i) => ({ say: `Beat ${i + 1}`, show: ['title', 'bullets', 'quote', 'title'][i], props: [{ title: 'A' }, { items: ['x'] }, { quote: 'Q' }, { title: 'B' }][i], seconds: 8 })) });
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(b));
  const r = await motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o'), { sfx: 'off' });
  const m = JSON.parse(await readFile(r.output, 'utf8'));
  assert.deepEqual(m.scenes.slice(0, -1).map(s => s.transition.type), ['slideleft', 'slideleft', 'slideleft']);
  b.current = 'up';
  await writeFile(path.join(dir, 'b2.json'), JSON.stringify(b));
  const up = JSON.parse(await readFile((await motionVideo(path.join(dir, 'b2.json'), path.join(dir, 'o2'), { sfx: 'off' })).output, 'utf8'));
  assert.ok(up.scenes.slice(0, -1).every(s => s.transition.type === 'slideup'));
  assert.match(reviewBrief({ ...b, current: 'sideways' }).errors.join(), /current must be one of/);
  const pp = { ...b, current: undefined, beats: b.beats.map((x, i) => ({ ...x, transition: ['slideleft', 'slideright', 'slideleft', undefined][i] })) };
  assert.ok(reviewBrief(pp).warnings.some(w => /opposite transitions/.test(w)));
});

// ---- imported catalog blocks as beats
async function fakeImport(home, name = 'lt-test', over = {}) {
  const d = path.join(home, 'catalog', name);
  await mk(d, { recursive: true });
  await writeFile(path.join(d, 'index.html'), '<head><script>window.__vmVariables = {"name":"Ada"};</script></head><body>block</body>');
  await writeFile(path.join(d, 'item.json'), JSON.stringify({ name, title: 'Lower Third', license: 'Apache-2.0', author: 'Someone', width: 1920, height: 1080, duration: 4.8, variables: [{ id: 'name' }], vars: {}, needs: { gsap: true, plugins: [] }, ...over }));
}
const catBrief = (beat = {}) => ({ type: 'opener', title: 'Catalog', beats: [{ say: 'Name.', catalog: 'lt-test', seconds: 5, ...beat }, { say: 'Close.', show: 'title', props: { title: 'Done' }, seconds: 4 }] });

test('a catalog beat needs the block imported and gsap installed, and the check says so', async t => {
  const dir = await temporary(t);
  const home = await withLib(t, []);
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(catBrief()));
  await assert.rejects(motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o'), { sfx: 'off' }), /lt-test is not imported: run  video-monk catalog --import lt-test --allow-download/);
  await fakeImport(home);
  await assert.rejects(motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o'), { sfx: 'off' }), /needs gsap: run  video-monk libs --add gsap/);
  assert.deepEqual(await libsNeeded(catBrief()), [{ id: 'gsap', installed: false, version: null }]);
  const mixed = catBrief(); mixed.beats[0].show = 'title';
  assert.match(reviewBrief(mixed).errors.join(), /not more than one/);
  assert.match(reviewBrief(catBrief({ vars: { a: [1] } })).errors.join(), /vars must be/);
});

test('with the block imported and gsap installed the block is copied into the plan with its licence, variables are overridden and warnings are given', async t => {
  const dir = await temporary(t);
  const home = await withLib(t, ['gsap']);
  await fakeImport(home);
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(catBrief({ vars: { name: 'Grace' }, seconds: 9 })));
  const r = await motionVideo(path.join(dir, 'b.json'), path.join(dir, 'o'), { sfx: 'off' });
  const m = JSON.parse(await readFile(r.output, 'utf8'));
  assert.equal(m.scenes[0].graphic.html, path.join(dir, 'o', 'scenes', 'lt-test', 'index.html'));
  const html = await readFile(m.scenes[0].graphic.html, 'utf8');
  assert.match(html, /window\.__vmVariables = \{"name":"Grace"\};/);
  await assert.rejects(readFile(path.join(dir, 'o', 'scenes', 'lt-test', 'item.json')), /ENOENT/);
  assert.ok(r.warnings.some(w => /holds its last frame/.test(w)));
  assert.deepEqual(r.libs, [{ id: 'gsap', version: '1.0.0' }]);
  const plan = await readFile(r.plan, 'utf8');
  assert.match(plan, /catalog block "lt-test"/);
  assert.match(plan, /## Catalog items/);
  assert.match(plan, /Apache License 2\.0/);
  await writeFile(path.join(dir, 'b2.json'), JSON.stringify(catBrief({ vars: { nope: 'x' } })));
  await assert.rejects(motionVideo(path.join(dir, 'b2.json'), path.join(dir, 'o2'), { sfx: 'off' }), /no variable "nope"/);
  await writeFile(path.join(dir, 'b3.json'), JSON.stringify(catBrief({ })));
  await fakeImport(home, 'lt-test', { width: 1080, height: 1920 });
  assert.ok((await motionVideo(path.join(dir, 'b3.json'), path.join(dir, 'o3'), { sfx: 'off' })).warnings.some(w => /laid out for its own size/.test(w)));
});
