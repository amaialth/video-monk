import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson } from '../src/core.js';
import { SFX_KINDS, SFX, synthesize, planSfx, graphicsOf, applySfx } from '../src/sfx.js';
import { reviewProduction, buildProduction } from '../src/production.js';
import { resolveBrief } from '../src/brief.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-sfx-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

const manifest = () => ({ version: 2, title: 'S', fps: 24, width: 320, height: 180, assets: [{ id: 'bg', path: 'bg.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
  scenes: [{ kind: 'video', asset: 'bg', duration: 20, purpose: 'x' }],
  globalOverlays: [
    { template: 'chapter', props: { title: 'One' }, start: 1, duration: 3, placement: 'full' },
    { template: 'bar-chart', props: {}, start: 1.5, duration: 4, background: 'grid', placement: 'full' },
    { template: 'bullets', props: {}, start: 6, duration: 4, placement: 'left' },
    { template: 'stat', props: {}, start: 8, duration: 3, placement: 'right' },
    { template: 'kinetic-text', props: {}, start: 12, duration: 2, placement: 'strip-top' },
    { template: 'term', props: {}, start: 15, duration: 3, placement: 'center' }] });

test('SFX planning: right sound for each kind of graphic, spaced out, capped per minute, off means none', () => {
  const items = graphicsOf(manifest());
  assert.deepEqual(items.map(i => i.mode), ['panel', 'cutaway', 'panel', 'panel', 'overlay', 'panel']);
  const subtle = planSfx(items, { mode: 'subtle', duration: 20 });
  assert.equal(subtle[0].kind, 'chime');
  assert.ok(subtle.every((e, i) => i === 0 || e.at - subtle[i - 1].at >= 2), 'at least 2 s apart');
  assert.ok(subtle.some(e => e.kind === 'swipe'));
  assert.ok(subtle.every(e => e.gainDb <= -15), 'quiet by default');
  const full = planSfx(items, { mode: 'full', duration: 20 });
  assert.ok(full.length >= subtle.length);
  assert.deepEqual(planSfx(items, { mode: 'off' }), []);
  const dense = Array.from({ length: 40 }, (_, i) => ({ start: i * 2.5, duration: 2, template: 'bullets', mode: 'panel' }));
  assert.ok(planSfx(dense, { mode: 'subtle', duration: 100 }).filter(e => e.at < 60).length <= 5, 'at most 5 a minute');
});

test('the brief asks about SFX and defaults to subtle for explainers only', () => {
  assert.equal(resolveBrief({ deliverable: 'long', content: 'explainer' }).sfx, 'subtle');
  assert.equal(resolveBrief({ deliverable: 'long', content: 'interview' }).sfx, 'off');
  assert.equal(resolveBrief({ deliverable: 'long', content: 'explainer', sfx: 'off' }).sfx, 'off');
});

test('every synthesised sound exists, has the stated length and a safe peak', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  for (const kind of SFX_KINDS) {
    const file = path.join(folder, `${kind}.wav`);
    await synthesize(kind, file);
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    const max = Number(String(stderr).match(/max_volume: (-?[\d.]+) dB/)?.[1]);
    const dur = String(stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
    const seconds = Number(dur[2]) * 60 + Number(dur[3]);
    assert.ok(max < -1.5 && max > -20, `${kind} peak ${max} dB`);
    assert.ok(Math.abs(seconds - SFX[kind].seconds) < 0.05, `${kind} lasts ${seconds}s`);
  }
  await assert.rejects(synthesize('nope', path.join(folder, 'x.wav')), /unknown kind/);
});

test('a real build with SFX places the cues and passes loudness and peak checks', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=6:r=24', '-f', 'lavfi', '-i', 'sine=f=220:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(folder, 'bg.mp4')]);
  const m = manifest(); m.scenes[0].duration = 6; m.scenes[0].audio = {};
  m.globalOverlays = [{ template: 'chapter', props: { title: 'One', number: '01' }, start: 1, duration: 2.5, placement: 'full' }, { template: 'bullets', props: { items: ['A', 'B'] }, start: 3.5, duration: 2, placement: 'left' }];
  const placed = await applySfx(m, { mode: 'subtle', dir: path.join(folder, 'sfx'), relTo: folder });
  assert.ok(placed.events.length >= 2);
  const file = path.join(folder, 'm.json');
  await writeJson(file, placed.manifest);
  assert.ok(placed.manifest.assets.some(a => a.id === 'sfx-chime'));
  await reviewProduction(file, path.join(folder, 'r.json'), true);
  const report = await buildProduction(file, path.join(folder, 'r.json'), path.join(folder, 'out'), true, undefined, undefined, { quality: 'draft' });
  assert.equal(report.status, 'technical-checks-passed-needs-human-review', JSON.stringify(report.verification.checks));
  assert.equal((await readJson(file)).audio.sfx.length, placed.events.length);
});
