import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEMPLATES, validateProps } from '../src/motion/templates.js';
import { EFFECTS3 } from '../src/motion/effects3.js';
import { EXAMPLES } from '../src/motion/examples.js';
import { MotionRenderer } from '../src/motion/render.js';
import { findChrome } from '../src/chrome.js';
import { starterNames } from '../src/motionvideo.js';

const chrome = await findChrome().then(() => true, () => false);
async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-fx3-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('code morph, push-in, pull-back reveal, logo outro, CTA close and chat thread are registered with valid examples', () => {
  assert.deepEqual(Object.keys(EFFECTS3).sort(), ['chat-thread', 'code-morph', 'cta-close', 'logo-outro', 'pull-back-reveal', 'push-in']);
  for (const name of Object.keys(EFFECTS3)) { assert.ok(TEMPLATES[name]); assert.doesNotThrow(() => validateProps(name, EXAMPLES[name]), name); }
});

test('their props are checked', () => {
  assert.throws(() => validateProps('code-morph', { before: 'a' }), /after/);
  assert.throws(() => validateProps('pull-back-reveal', { value: '1', label: 'x', context: [{ value: '1', label: 'a' }] }), /needs 2-4/);
  assert.throws(() => validateProps('chat-thread', { messages: [{ from: 'user', text: 'hi' }] }), /needs 2-5/);
  assert.throws(() => validateProps('chat-thread', { messages: [{ from: 'bot', text: 'hi' }, { from: 'user', text: 'yo' }] }), /one of/);
  assert.throws(() => validateProps('push-in', { text: 'x', amount: 2 }), /from 0\.02 to 0\.4/);
  assert.throws(() => validateProps('cta-close', { headline: 'x' }), /action/);
  assert.throws(() => validateProps('logo-outro', { name: 'x'.repeat(40) }), /at most 30/);
});

test('the 3D starters for the exploded stack and the extruded mark ship and name their library', async () => {
  for (const name of ['three-exploded-stack', 'three-extruded-mark']) {
    assert.ok(starterNames().includes(name), name);
    const html = await readFile(new URL(`../assets/motion-starters/${name}.html`, import.meta.url), 'utf8');
    assert.match(html, /<vm-lib name="three">/);
    assert.match(html, /window\.__seek/);
    assert.match(html, /window\.__vmReady = true/);
    assert.doesNotMatch(html, /Math\.random|https?:\/\/(?!www\.w3)/);
  }
});

test('each renders, animates and is deterministic', { skip: chrome ? false : 'needs Chrome', timeout: 300000 }, async t => {
  const dir = await temporary(t);
  const r = new MotionRenderer();
  t.after(() => r.close());
  await r.start();
  const still = async (name, template, at) => { const f = path.join(dir, `${name}.png`); await r.still({ template, props: EXAMPLES[template], width: 640, height: 360, fps: 10, duration: 6, theme: { preset: 'night' }, background: 'grid', exit: false }, at, f); assert.ok((await stat(f)).size > 1500, name); return createHash('sha1').update(await readFile(f)).digest('hex'); };
  for (const name of Object.keys(EFFECTS3)) {
    const a = await still(`${name}-a`, name, 0.1), b = await still(`${name}-b`, name, 2.8);
    assert.notEqual(a, b, `${name} changes over time`);
    assert.equal(await still(`${name}-c`, name, 2.8), b, `${name} is deterministic`);
  }
});
