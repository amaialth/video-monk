import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, exists } from '../src/core.js';
import { MotionRenderer } from '../src/motion/render.js';
import { loadTimeline } from '../src/timeline.js';
import { brandKit, motionMarkdown, writeBrand } from '../src/brand.js';
import { numbersIn, checkFacts, graphicTexts } from '../src/facts.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-pack-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

test('motion on twos holds every pose for two frames; without it every frame moves', { skip: ffmpegOk ? false : 'needs Chrome', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const frames = async theme => {
    const r = new MotionRenderer(); await r.start();
    try {
      const out = await r.render({ template: 'kinetic-text', props: { text: 'Motion on *twos* looks hand made' }, width: 480, height: 270, fps: 12, duration: 1.5, theme, background: 'grid', exit: false }, path.join(folder, JSON.stringify(theme).replace(/\W/g, '')));
      const list = (await readdir(out.dir)).filter(f => f.startsWith('frame-')).sort();
      return Promise.all(list.slice(0, 9).map(f => readFile(path.join(out.dir, f))));
    } finally { await r.close(); }
  };
  const same = (a, b) => Buffer.compare(a, b) === 0;
  const stepped = await frames({ preset: 'night', onTwos: true });
  for (const k of [0, 2, 4, 6]) assert.ok(same(stepped[k], stepped[k + 1]), `frames ${k + 1} and ${k + 2} are the same pose`);
  assert.ok([1, 3, 5].some(k => !same(stepped[k], stepped[k + 1])), 'the pose changes between pairs');
  const smooth = await frames({ preset: 'night' });
  assert.ok([0, 2, 4].some(k => !same(smooth[k], smooth[k + 1])), 'without it consecutive frames differ');
});

test('theme.onTwos must be a boolean in a manifest', async t => {
  const folder = await temporary(t);
  const base = { version: 2, title: 'T', fps: 24, width: 320, height: 180, assets: [], scenes: [{ kind: 'color', color: '#000000', duration: 2, purpose: 'x' }] };
  await writeJson(path.join(folder, 'ok.json'), { ...base, theme: { onTwos: true, calm: true } });
  assert.equal((await loadTimeline(path.join(folder, 'ok.json'))).manifest.theme.onTwos, true);
  await writeJson(path.join(folder, 'bad.json'), { ...base, theme: { onTwos: 'yes' } });
  await assert.rejects(loadTimeline(path.join(folder, 'bad.json')), /onTwos must be boolean/);
});

test('the brand kit writes brand.json and a MOTION.md that says ASK ME instead of guessing, and its theme is a valid manifest theme', async t => {
  const folder = await temporary(t);
  const result = await writeBrand(path.join(folder, 'kit'), { name: 'Acme Studio', accent: '#FF5A1F', background: '#0B0D12', onTwos: true, never: 'glow; bounce; typewriter text', feel: 'calm, premium' });
  const brand = JSON.parse(await readFile(path.join(result.dir, 'brand.json'), 'utf8'));
  assert.deepEqual(brand.theme, { background: '#0b0d12', accent: '#ff5a1f', onTwos: true });
  const md = await readFile(path.join(result.dir, 'MOTION.md'), 'utf8');
  assert.match(md, /Accent\*\* #ff5a1f/); assert.match(md, /Surface\*\* ASK ME/); assert.match(md, /\*\*on twos\*\*/); assert.match(md, /- glow\n- bounce\n- typewriter text/); assert.match(md, /Read this in full before you design/);
  await assert.rejects(writeBrand(path.join(folder, 'kit'), { name: 'Again' }), /folder exists/);
  assert.throws(() => brandKit({ name: 'X', accent: 'orange' }), /#RRGGBB/);
  assert.throws(() => brandKit({ name: '' }), /name/);
  assert.match(motionMarkdown(brandKit({ name: 'Bare' })), /Background\*\* ASK ME[\s\S]*ASK ME \(name five things/);
  await writeJson(path.join(folder, 'm.json'), { version: 2, title: 'T', fps: 24, width: 320, height: 180, assets: [], theme: brand.theme, scenes: [{ kind: 'color', color: '#000000', duration: 2, purpose: 'x' }] });
  assert.ok(await loadTimeline(path.join(folder, 'm.json')));
});

test('facts first: numbers on screen must be in the approved, sourced fact list', () => {
  assert.deepEqual(numbersIn('250,000 followers, 12.50% up, in 2026'), ['250000', '12.5', '2026']);
  const manifest = { version: 2, title: 'T', fps: 24, width: 320, height: 180, assets: [],
    scenes: [{ kind: 'graphic', duration: 4, purpose: 'x', graphic: { template: 'stat', props: { value: 250000, label: 'followers in March 2026', suffix: '', icon: '7', cues: [1, 2] } } },
      { kind: 'graphic', duration: 4, purpose: 'y', graphic: { template: 'bullets', props: { items: ['Up 12%', 'Chapter 03'] } } }] };
  const facts = { facts: [{ text: 'The channel reached 250,000 followers in March 2026', source: 'https://example.com/post' }, { text: 'Growth was 12% that quarter', source: 'analytics export' }], allow: ['03'] };
  const ok = checkFacts(manifest, facts);
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.checked, 4);
  assert.ok(!graphicTexts(manifest).some(x => x.text === '7' || x.text === '1'), 'icons and cues are not text on screen');
  const bad = checkFacts(manifest, { facts: [{ text: 'The channel reached 250,000 followers', source: 'x' }, { text: 'Growth was 12%' }] });
  assert.deepEqual(bad.unlisted.map(u => u.number), ['2026', '3']);
  assert.equal(bad.unsourced.length, 1); assert.equal(bad.ok, false);
});
