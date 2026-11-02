import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson } from '../src/core.js';
import { loadTimeline } from '../src/timeline.js';
import { applyStoryboard, planStoryboard } from '../src/explain.js';
import { resolveStyle, STYLES } from '../src/style.js';
import { autocut, ZOOM_HOLD } from '../src/autocut.js';
import { reviewCut, reviseCut } from '../src/stages.js';
import { reviewProduction, buildProduction } from '../src/production.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-layout-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const probe = async (_c, args) => ({ stdout: JSON.stringify({ format: { duration: '60' }, streams: [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] }) });

async function manifestFixture(t, overlay) {
  const folder = await temporary(t);
  await writeFile(path.join(folder, 'rec.mp4'), 'x');
  const file = path.join(folder, 'm.json');
  await writeJson(file, { version: 2, title: 't', fps: 30, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'rec', in: 0, duration: 10, purpose: 'x', audio: {} }],
    globalOverlays: [{ template: 'bullets', start: 2, duration: 5, props: { items: ['a'] }, ...overlay }] });
  return file;
}

test('layout split is validated: only side panels can shrink the picture', async t => {
  const ok = await manifestFixture(t, { placement: 'right', panel: true, layout: 'split' });
  assert.equal((await loadTimeline(ok, probe)).manifest.globalOverlays[0].layout, 'split');
  await assert.rejects(loadTimeline(await manifestFixture(t, { placement: 'top', layout: 'split' }), probe), /split needs placement left or right/);
  await assert.rejects(loadTimeline(await manifestFixture(t, { placement: 'right', layout: 'zoom' }), probe), /layout must be/);
});

test('bytemonk panels use the split layout; no camera motion is left under any graphic; plain keeps overlays', () => {
  const words = [];
  let t = 0;
  for (let r = 0; r < 4; r++) for (const w of 'Today we will cover routes, endpoints, and components. Camel is a framework that helps you move data between systems quickly.'.split(' ')) { words.push({ text: w, start: t, end: t + 0.3 }); t += 0.34; }
  const sb = planStoryboard(words, { duration: t + 1, density: 'heavy', graphics: 'panel', style: resolveStyle('bytemonk') });
  assert.ok(sb.items.some(i => i.mode === 'panel'));
  const base = { theme: {}, scenes: Array.from({ length: 20 }, (_, i) => ({ kind: 'video', duration: Math.min(3, Math.max(0.5, t / 20)), purpose: 'x', motion: { type: 'punch-in', amount: 0.08 }, asset: 'rec', id: `s${i}` })) };
  const styled = applyStoryboard(base, sb, resolveStyle('bytemonk'));
  assert.ok(styled.globalOverlays.some(o => o.layout === 'split' && o.placement === 'right'));
  const covered = [];
  let at = 0;
  styled.scenes.forEach(sc => { const s = at; at += sc.duration; if (sb.items.some(i => s < i.start + i.duration && s + sc.duration > i.start)) covered.push(sc); });
  assert.ok(covered.length > 0 && covered.every(sc => !sc.motion), 'scenes under graphics have no zoom');
  const plain = applyStoryboard(base, sb, STYLES.plain);
  assert.ok(plain.globalOverlays.every(o => o.layout === undefined));
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeOk = await findChrome().then(() => true, () => false);
const speech = (folder, name = 'rec.mp4') => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=30', '-f', 'lavfi', '-i',
  "aevalsrc='0.35*sin(2*PI*220*t)*(between(t,0.2,2.8)+between(t,4.0,7.5)+between(t,9,13)+between(t,14.5,19)+between(t,20.5,25)+between(t,26.5,29.5))':s=48000:d=30",
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(folder, name)]);

test('zoom is off by default and, when enabled, changes at most once per hold period', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  await speech(folder);
  const calm = await autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'calm'), { rightsConfirmed: true, rights: 'T', attribution: 'T' });
  assert.ok(calm.manifest.scenes.every(s => !s.motion), 'bytemonk style: no zoom');
  assert.equal(calm.manifest.scenes[0].fit, 'cover');
  const zoomy = await autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'zoomy'), { rightsConfirmed: true, rights: 'T', attribution: 'T', jumpZoom: true, fit: 'contain' });
  const starts = [];
  let at = 0;
  zoomy.manifest.scenes.forEach((s, i) => { if (i && Boolean(s.motion) !== Boolean(zoomy.manifest.scenes[i - 1].motion)) starts.push(at); at += s.duration; });
  assert.ok(starts.length >= 1, 'zoom is used when asked for');
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= ZOOM_HOLD - 0.01, `flip gap ${starts[i] - starts[i - 1]}`);
  assert.equal(zoomy.manifest.scenes[0].fit, 'contain');
  // The reviewer flags a flickery edit and the reviser calms it.
  const flicker = JSON.parse(JSON.stringify(zoomy.manifest));
  flicker.scenes.forEach((s, i) => { if (i % 2) s.motion = { type: 'punch-in', amount: 0.08 }; else delete s.motion; });
  const artifact = { result: { ...zoomy, manifest: flicker }, context: zoomy.context, version: 1 };
  const verdict = reviewCut(artifact);
  const finding = verdict.findings.find(f => f.id === 'cut-zoom-flicker');
  assert.ok(finding, JSON.stringify(verdict.metrics));
  const { artifact: fixed, changed } = await reviseCut(artifact, [finding], { root: folder });
  assert.ok(changed.includes('removed the per-cut zoom'));
  assert.ok(fixed.result.manifest.scenes.every(s => !s.motion));
  assert.ok(!reviewCut(fixed).findings.some(f => f.id === 'cut-zoom-flicker'));
});

test('real render: the picture scales down beside a side panel and back again; overlay layout still covers it', { skip: ffmpegOk && chromeOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'red.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'sine=f=220:d=8', path.join(folder, 'voice.wav')]);
  const build = async (name, layout) => {
    const file = path.join(folder, `${name}.json`);
    await writeJson(file, { version: 2, title: name, fps: 30, width: 640, height: 360, theme: { preset: 'night', background: '#0d0f14' },
      assets: [{ id: 'red', path: 'red.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }, { id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Own', attribution: 'Me' }],
      scenes: [{ kind: 'video', asset: 'red', in: 0, duration: 8, purpose: 'x' }], audio: { narration: { asset: 'voice' } },
      globalOverlays: [{ template: 'bullets', start: 2, duration: 4, placement: 'right', panel: true, ...(layout ? { layout } : {}), props: { title: 'Panel', items: ['one', 'two'] } }] });
    await reviewProduction(file, path.join(folder, `${name}-review.json`), true);
    const report = await buildProduction(file, path.join(folder, `${name}-review.json`), path.join(folder, `${name}-out`), true, undefined, undefined, { quality: 'draft' });
    return { report, video: path.join(folder, `${name}-out`, 'final.mp4') };
  };
  const pixel = async (file, time, x, y) => {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    return [...stdout];
  };
  const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 90;
  const isDark = ([r, g, b]) => r < 70 && g < 70 && b < 90;
  const split = await build('split', 'split');
  assert.equal(split.report.timeline.splitLayouts, 1);
  assert.ok(isRed(await pixel(split.video, 1, 5, 5)), 'before the panel the picture fills the frame');
  assert.ok(isDark(await pixel(split.video, 4, 5, 5)), 'mid panel: the corner shows the background, the picture has shrunk');
  assert.ok(isRed(await pixel(split.video, 4, 100, 180)), 'mid panel: the picture is still there, left of the panel');
  assert.ok(isRed(await pixel(split.video, 7.2, 5, 5)), 'after the panel the picture is full-frame again');
  const mid = await pixel(split.video, 2.2, 5, 5);
  assert.ok(!isRed(mid) || !isDark(mid), 'the shrink is eased, not a hard cut');
  assert.equal(split.report.status, 'technical-checks-passed-needs-human-review');
  const cover = await build('cover');
  assert.equal(cover.report.timeline.splitLayouts, 0);
  assert.ok(isRed(await pixel(cover.video, 4, 5, 5)), 'overlay layout leaves the picture full-frame behind the panel');
});
