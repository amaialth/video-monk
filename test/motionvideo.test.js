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
