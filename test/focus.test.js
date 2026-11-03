import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, writeJson, readJson } from '../src/core.js';
import { focusScenes, focusManifest } from '../src/focus.js';
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
