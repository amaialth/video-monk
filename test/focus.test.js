import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, writeJson, readJson } from '../src/core.js';
import { focusScenes, focusManifest, findActivity, detectActivity } from '../src/focus.js';
import { focusExpressions } from '../src/build.js';
import { loadTimeline } from '../src/timeline.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-focus-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const manifest = (over = {}) => ({ version: 2, title: 'Rec', fps: 30, width: 640, height: 360, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
  scenes: [{ id: 's1', kind: 'video', asset: 'rec', in: 10, duration: 20, fit: 'cover', audio: {}, purpose: 'demo' }, { id: 's2', kind: 'video', asset: 'rec', in: 40, duration: 5, fit: 'cover', audio: {}, purpose: 'more' }], ...over });

test('clicks become focus points in scene time: inside the window only, speed-aware, ramped in before the click', () => {
  const { manifest: m, report } = focusScenes(manifest(), [{ at: 5, x: 0.1, y: 0.1 }, { at: 12, x: 0.3, y: 0.6 }, { at: 20, x: 0.7, y: 0.4, amount: 0.8 }, { at: 42, x: 0.5, y: 0.5 }]);
  assert.deepEqual(m.scenes[0].motion.points.map(p => [p.at, p.x, p.y]), [[2, 0.3, 0.6], [10, 0.7, 0.4]]);
  assert.equal(m.scenes[0].motion.points[1].amount, 0.8);
  assert.equal(m.scenes[0].motion.points[0].amount, 0.5);
  assert.equal(m.scenes[1].motion.points[0].at, 2);
  assert.deepEqual([report.scenes, report.points, report.dropped], [2, 3, 0]);
  const fast = focusScenes(manifest({ scenes: [{ ...manifest().scenes[0], speed: 2 }] }), [{ at: 14, x: 0.5, y: 0.5 }]).manifest;
  assert.equal(fast.scenes[0].motion.points[0].at, 2, '(14 - 10) / 2');
  const early = focusScenes(manifest(), [{ at: 10.1, x: 0.5, y: 0.5 }]).manifest;
  assert.equal(early.scenes[0].motion.points[0].at, 0.5, 'never starts before the scene');
});

test('clicks too close to ease back out are dropped, existing camera motion is kept unless replaced, and bad input is refused', () => {
  const close = focusScenes(manifest(), [{ at: 12, x: 0.3, y: 0.3 }, { at: 12.5, x: 0.4, y: 0.4 }, { at: 20, x: 0.5, y: 0.5 }]);
  assert.equal(close.report.dropped, 1);
  assert.equal(close.manifest.scenes[0].motion.points.length, 2);
  const moving = manifest(); moving.scenes[0].motion = { type: 'zoom-in', amount: 0.1 };
  const kept = focusScenes(moving, [{ at: 12, x: 0.3, y: 0.3 }]);
  assert.equal(kept.manifest.scenes[0].motion.type, 'zoom-in');
  assert.match(kept.report.skipped[0], /already has zoom-in/);
  assert.equal(focusScenes(moving, [{ at: 12, x: 0.3, y: 0.3 }], { replace: true }).manifest.scenes[0].motion.type, 'focus');
  assert.equal(focusScenes(manifest(), [{ at: 12, x: 0.3, y: 0.3 }], { asset: 'other' }).report.points, 0);
  assert.throws(() => focusScenes(manifest(), []), /nonempty/);
  assert.throws(() => focusScenes(manifest(), [{ at: 12, x: 1.5, y: 0.3 }]), /click 1 needs/);
  assert.throws(() => focusScenes(manifest(), [{ at: 12, x: 0.3, y: 0.3 }], { amount: 2 }), /amount/);
  assert.throws(() => focusScenes({ version: 1 }, [{ at: 1, x: 0, y: 0 }]), /version-2/);
});

test('focusManifest writes a new manifest beside the old one, never overwrites, and says when no click lands in a scene', async t => {
  const dir = await temporary(t);
  await writeJson(path.join(dir, 'p.json'), manifest());
  await writeJson(path.join(dir, 'clicks.json'), { clicks: [{ at: 12, x: 0.3, y: 0.6 }] });
  const r = await focusManifest(path.join(dir, 'p.json'), path.join(dir, 'clicks.json'), path.join(dir, 'p.focus.json'));
  assert.equal(r.points, 1);
  assert.equal((await readJson(path.join(dir, 'p.focus.json'))).scenes[0].motion.type, 'focus');
  await assert.rejects(focusManifest(path.join(dir, 'p.json'), path.join(dir, 'clicks.json'), path.join(dir, 'p.focus.json')), /already exists/);
  await writeJson(path.join(dir, 'far.json'), [{ at: 500, x: 0.3, y: 0.6 }]);
  await assert.rejects(focusManifest(path.join(dir, 'p.json'), path.join(dir, 'far.json'), path.join(dir, 'p.far.json')), /no click falls inside/);
  await assert.rejects(focusManifest(path.join(dir, 'p.json'), path.join(dir, 'clicks.json'), path.join(tmpdir(), 'elsewhere.json')), /same folder/);
});

test('the timeline accepts a focus motion and rejects malformed ones', { skip: ffmpegOk ? false : 'needs ffmpeg' }, async t => {
  const dir = await temporary(t);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=d=6', '-shortest', '-pix_fmt', 'yuv420p', path.join(dir, 'rec.mp4')]);
  const base = { version: 2, title: 'Rec', fps: 30, width: 640, height: 360, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ id: 's1', kind: 'video', asset: 'rec', in: 0, duration: 5, fit: 'cover', audio: {}, purpose: 'demo', motion: { type: 'focus', points: [{ at: 1, x: 0.4, y: 0.5, amount: 0.6, hold: 1, ramp: 0.5 }] } }] };
  await writeJson(path.join(dir, 'ok.json'), base);
  assert.equal((await loadTimeline(path.join(dir, 'ok.json'))).timeline.length, 1);
  let n = 0;
  const bad = async motion => { const m = structuredClone(base); m.scenes[0].motion = motion; const f = path.join(dir, `bad${++n}.json`); await writeJson(f, m); return loadTimeline(f); };
  await assert.rejects(bad({ type: 'focus' }), /needs 1-40 focus points/);
  await assert.rejects(bad({ type: 'focus', points: [{ at: 1, x: 2, y: 0.5 }] }), /needs at \(seconds\), x and y/);
  await assert.rejects(bad({ type: 'focus', points: [{ at: 1, x: 0.5, y: 0.5, amount: 5 }] }), /amount 0\.1-1/);
  await assert.rejects(bad({ type: 'focus', amount: 0.2, points: [{ at: 1, x: 0.5, y: 0.5 }] }), /takes points, not amount/);
  await assert.rejects(bad({ type: 'zoom-in', points: [] }), /only belong to a focus motion/);
});

test('ffmpeg really zooms onto the target, eases in and out, and returns to the full picture', { skip: ffmpegOk ? false : 'needs ffmpeg' }, () => {
  const fps = 30, expr = focusExpressions([{ at: 1, x: 0.6, y: 0.5, amount: 1, hold: 1, ramp: 0.5 }], fps);
  const vf = `fps=${fps},scale=1280:720,zoompan=${expr}:d=1:s=640x360:fps=${fps},format=gray`;
  const src = 'color=c=black:s=640x360:r=30:d=4,drawbox=x=372:y=170:w=24:h=20:color=white:t=fill';   // box centred on (0.6, 0.5)
  const at = t => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', src, '-vf', vf, '-ss', String(t), '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1e8 }); let sx = 0, sy = 0, n = 0; for (let i = 0; i < raw.length; i++) if (raw[i] > 128) { sx += i % 640; sy += Math.floor(i / 640); n++; } return { cx: sx / n, cy: sy / n, area: n }; };
  const start = at(0.2), mid = at(0.75), peak = at(1.5), back = at(3.2);
  assert.ok(Math.abs(start.cx - 384) < 2 && Math.abs(start.cy - 180) < 2, 'untouched before the ramp');
  assert.ok(Math.abs(peak.cx - 320) < 2 && Math.abs(peak.cy - 180) < 2, 'the target sits in the centre at the peak');
  assert.ok(peak.area > start.area * 3.5, 'about 2x linear zoom');
  assert.ok(mid.area > start.area * 1.5 && mid.area < peak.area, 'eased, not a jump');
  assert.ok(Math.abs(back.cx - 384) < 2 && Math.abs(back.area - start.area) < 20, 'back to the full picture');
});

test('findActivity proposes small local changes after a quiet stretch and ignores whole-screen changes (pure frames)', () => {
  const W = 64, H = 36, px = W * H, frames = new Uint8Array(px * 60);   // 12 s at 5 fps, all black
  const box = (f, x0, y0, v) => { for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 5; x++) frames[f * px + y * W + x] = v; };
  for (let f = 10; f < 60; f++) box(f, 44, 14, 255);              // appears at frame 10 (2 s) at about (0.7, 0.4) and stays
  for (let f = 30; f < 60; f++) box(f, 12, 28, 255);              // appears at frame 30 (6 s) at about (0.2, 0.8)
  for (let f = 45; f < 60; f++) for (let i = 0; i < px; i++) frames[f * px + i] = Math.max(frames[f * px + i], 200);   // whole screen lights up at 9 s: not a candidate
  const found = findActivity(frames, { width: W, height: H, fps: 5, minGap: 2 });
  assert.deepEqual(found.map(c => c.at), [2, 6]);
  assert.ok(Math.abs(found[0].x - 0.7) < 0.06 && Math.abs(found[0].y - 0.4) < 0.08, JSON.stringify(found[0]));
  assert.ok(Math.abs(found[1].x - 0.2) < 0.06 && Math.abs(found[1].y - 0.8) < 0.08, JSON.stringify(found[1]));
  assert.deepEqual(findActivity(new Uint8Array(px * 40), { width: W, height: H }), [], 'nothing moves, nothing proposed');
  assert.equal(findActivity(frames, { width: W, height: H, fps: 5, max: 1 }).length, 1);
  assert.equal(findActivity(frames, { width: W, height: H, fps: 5, minGap: 5 }).length, 1, 'min-gap keeps the stronger of two close moments');
});

test('detectActivity reads a real recording and writes a reviewable file that focus accepts', { skip: ffmpegOk ? false : 'needs ffmpeg' }, async t => {
  const dir = await temporary(t);
  const vf = 'drawbox=x=428:y=129:w=40:h=30:color=white:t=fill:enable=gte(t\\,2),drawbox=x=108:y=274:w=40:h=30:color=white:t=fill:enable=gte(t\\,6),drawbox=x=0:y=0:w=640:h=360:color=gray:t=fill:enable=between(t\\,10\\,10.4)';
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=30:d=14,${vf}`, '-f', 'lavfi', '-i', 'sine=d=14', '-shortest', '-pix_fmt', 'yuv420p', path.join(dir, 'rec.mp4')]);
  const r = await detectActivity(path.join(dir, 'rec.mp4'), path.join(dir, 'clicks.json'), { minGap: 2 });
  const data = await readJson(path.join(dir, 'clicks.json'));
  assert.match(data.note, /not recorded clicks/);
  assert.equal(r.clicks, data.clicks.length);
  const near = (at, x, y) => data.clicks.some(c => Math.abs(c.at - at) < 0.6 && Math.abs(c.x - x) < 0.08 && Math.abs(c.y - y) < 0.1);
  assert.ok(near(2, 0.7, 0.4), JSON.stringify(data.clicks));
  assert.ok(near(6, 0.2, 0.8), JSON.stringify(data.clicks));
  assert.ok(!data.clicks.some(c => Math.abs(c.at - 10) < 0.5), 'the whole-screen flash is not a candidate');
  await assert.rejects(detectActivity(path.join(dir, 'rec.mp4'), path.join(dir, 'clicks.json')), /already exists/);
  await assert.rejects(detectActivity(path.join(dir, 'nope.mp4'), path.join(dir, 'c2.json')), /not found/);
  // the file goes straight into focus
  await writeJson(path.join(dir, 'p.json'), { version: 2, title: 'R', fps: 30, width: 640, height: 360, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }], scenes: [{ id: 's1', kind: 'video', asset: 'rec', in: 0, duration: 14, fit: 'cover', audio: {}, purpose: 'demo' }] });
  const f = await focusManifest(path.join(dir, 'p.json'), path.join(dir, 'clicks.json'), path.join(dir, 'p.focus.json'));
  assert.ok(f.points >= 2);
});

test('on a recording with a moving cursor and a ticking clock it finds the toast, the dimmed modal and the typing, and nothing else', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const dir = await temporary(t);
  const typing = [12, 12.3, 12.6, 12.9, 13.2, 13.5].map((at, i) => `drawbox=x=${30 + i * 10}:y=150:w=7:h=11:color=white:t=fill:enable='gte(t\\,${at})'`).join(',');
  const graph = `[0]drawbox=x=560:y=10:w=60:h=14:color=white:t=fill:enable='lt(mod(t\\,1)\\,0.5)',drawbox=x=300:y=320:w=170:h=24:color=0x4cc9f0:t=fill:enable='between(t\\,5\\,8)',eq=brightness=-0.25:enable='gte(t\\,9)',drawbox=x=220:y=110:w=200:h=130:color=white:t=fill:enable='gte(t\\,9)',${typing}[b];[b][1]overlay=x='20+560*t/16':y='60+200*abs(sin(t*0.9))'`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0x202833:s=640x360:r=30:d=16', '-f', 'lavfi', '-i', 'color=c=white:s=9x13:r=30:d=16', '-filter_complex', graph, '-pix_fmt', 'yuv420p', '-crf', '30', path.join(dir, 'rec.mp4')]);
  const { clicks } = await (async () => { await detectActivity(path.join(dir, 'rec.mp4'), path.join(dir, 'c.json')); return readJson(path.join(dir, 'c.json')); })();
  const near = (at, x, y) => clicks.some(c => Math.abs(c.at - at) < 0.8 && Math.abs(c.x - x) < 0.12 && Math.abs(c.y - y) < 0.12);
  assert.ok(near(5, 0.6, 0.92), 'the toast bar appears: ' + JSON.stringify(clicks));
  assert.ok(near(9, 0.5, 0.49), 'the modal opens over a dimmed screen: ' + JSON.stringify(clicks));
  assert.ok(near(12, 0.1, 0.43), 'typing starts: ' + JSON.stringify(clicks));
  assert.ok(clicks.length <= 4, 'the cursor and the clock add nothing: ' + JSON.stringify(clicks));
  assert.ok(clicks.every(c => c.at >= 1), 'the first second is ignored');
});

test('with the default settings a strong event does not hide a weaker real one 2.4 s away', () => {
  const W = 128, H = 72, px = W * H, frames = new Uint8Array(px * 60);
  const box = (f, x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) frames[f * px + y * W + x] = v; };
  for (let f = 10; f < 17; f++) box(f, 60, 30, 30, 18, 255);       // a big panel appears at 2 s and goes at 3.4 s
  for (let f = 22; f < 60; f++) box(f, 8, 58, 14, 7, 255);        // a small strip appears at 4.4 s and stays
  for (let f = 38; f < 60; f++) box(f, 100, 8, 14, 7, 255);       // another at 7.6 s
  const found = findActivity(frames, { width: W, height: H, fps: 5 });                 // all defaults
  assert.ok(found.some(c => Math.abs(c.at - 2) < 0.5), JSON.stringify(found));
  assert.ok(found.some(c => Math.abs(c.at - 4.4) < 0.6), 'the second event, 2.4 s after the first: ' + JSON.stringify(found));
  assert.ok(found.some(c => Math.abs(c.at - 7.6) < 0.6), JSON.stringify(found));
});
