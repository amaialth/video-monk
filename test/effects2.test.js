import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEMPLATES, validateProps } from '../src/motion/templates.js';
import { EFFECTS2 } from '../src/motion/effects2.js';
import { EXAMPLES } from '../src/motion/examples.js';
import { MotionRenderer } from '../src/motion/render.js';
import { findChrome } from '../src/chrome.js';

const chrome = await findChrome().then(() => true, () => false);
async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-fx2-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('the build-next templates are registered with schemas and valid examples', () => {
  assert.deepEqual(Object.keys(EFFECTS2).sort(), ['annotate', 'bar-chart-race', 'code-diff', 'code-focus', 'confetti', 'success-check']);
  for (const name of Object.keys(EFFECTS2)) { assert.ok(TEMPLATES[name]); assert.doesNotThrow(() => validateProps(name, EXAMPLES[name]), name); }
  assert.equal(TEMPLATES.annotate.fullFrame, true);
});

test('props are checked: annotation kinds and geometry, diff text, race data, lower-third styles, new reveals', () => {
  assert.throws(() => validateProps('annotate', { kind: 'spiral', x: 0.1, y: 0.1, w: 0.1, h: 0.1 }), /one of/);
  assert.throws(() => validateProps('annotate', { kind: 'circle', x: 2, y: 0.1, w: 0.1, h: 0.1 }), /from 0 to 1/);
  assert.throws(() => validateProps('code-diff', { before: 'a' }), /after/);
  assert.throws(() => validateProps('code-focus', { code: 'a', lines: [] }), /needs 1-6/);
  assert.throws(() => validateProps('bar-chart-race', { periods: ['a'], items: [] }), /needs 2-12|needs 2-8/);
  assert.doesNotThrow(() => validateProps('lower-third', { name: 'A', style: 'bold-block' }));
  assert.throws(() => validateProps('lower-third', { name: 'A', style: 'neon' }), /one of/);
  for (const reveal of ['scramble', 'tracking']) assert.doesNotThrow(() => validateProps('kinetic-text', { text: 'Hi there', reveal }));
});

test('manifests accept the new caption styles and backgrounds', async () => {
  const src = await readFile(new URL('../src/timeline.js', import.meta.url), 'utf8');
  for (const style of ['highlight', 'pill', 'slam', 'wipe', 'weight']) assert.match(src, new RegExp(`'${style}'`));
  for (const bg of ['mesh', 'aurora', 'dots']) assert.ok(src.split(`'${bg}'`).length >= 3, `${bg} allowed for overlays and scenes`);
});

test('every new template, lower-third style, reveal, background and caption style renders, and animates', { skip: chrome ? false : 'needs Chrome', timeout: 300000 }, async t => {
  const dir = await temporary(t);
  const r = new MotionRenderer();
  t.after(() => r.close());
  await r.start();
  const hash = async f => createHash('sha1').update(await readFile(f)).digest('hex');
  const still = async (name, job, at) => { const f = path.join(dir, `${name}.png`); await r.still({ width: 640, height: 360, fps: 10, duration: 6, theme: { preset: 'night' }, background: 'grid', exit: false, ...job }, at, f); assert.ok((await stat(f)).size > 1500, name); return hash(f); };
  for (const name of Object.keys(EFFECTS2)) {
    const a = await still(`${name}-a`, { template: name, props: EXAMPLES[name] }, 0.1), b = await still(`${name}-b`, { template: name, props: EXAMPLES[name] }, 2.5);
    assert.notEqual(a, b, `${name} changes over time`);
    assert.equal(await still(`${name}-c`, { template: name, props: EXAMPLES[name] }, 2.5), b, `${name} is deterministic`);
  }
  const looks = new Set();
  for (const style of ['default', 'clean-bar', 'bold-block', 'accent-underline', 'soft-pill', 'side-rule']) looks.add(await still(`lt-${style}`, { template: 'lower-third', props: { name: 'Alex Morgan', role: 'Founder', style } }, 1.6));
  assert.equal(looks.size, 6, 'six distinct lower-third looks');
  for (const reveal of ['scramble', 'tracking']) assert.notEqual(await still(`kt-${reveal}-a`, { template: 'kinetic-text', props: { text: 'Say it clearly', reveal } }, 0.2), await still(`kt-${reveal}-b`, { template: 'kinetic-text', props: { text: 'Say it clearly', reveal } }, 2));
  const bgs = new Set();
  for (const background of ['grid', 'mesh', 'aurora', 'dots', 'gradient']) bgs.add(await still(`bg-${background}`, { template: 'title', props: { title: 'Hello' }, background }, 2));
  assert.equal(bgs.size, 5, 'five distinct backgrounds');
  const words = [['Make', 0.2, 0.6], ['it', 0.6, 0.8], ['clear', 0.8, 1.3]].map(([text, start, end], i) => ({ text, start, end, stress: i === 2 }));
  const caps = new Set();
  for (const style of ['kinetic', 'karaoke', 'highlight', 'pill', 'slam', 'wipe', 'weight']) caps.add(await still(`cap-${style}`, { template: 'captions', props: { style, position: 'bottom', pages: [{ start: 0.1, end: 2.4, words }] }, duration: 3 }, 1.0));
  assert.equal(caps.size, 7, 'seven distinct caption styles');
});
