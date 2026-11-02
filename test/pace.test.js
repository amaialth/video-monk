import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson, exists } from '../src/core.js';
import { chooseNoiseDb, quietRuns, unionRanges, trimByLevel, planCuts, autocut, PACE, LEVEL_STEP } from '../src/autocut.js';
import { remapWords } from '../src/captions.js';
import { loadTimeline } from '../src/timeline.js';
import { reviewProduction, buildProduction, inspectMedia } from '../src/production.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-pace-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
// 20 ms level frames from a list of [dB, seconds] segments.
const frames = segs => segs.flatMap(([db, s]) => new Array(Math.round(s / LEVEL_STEP)).fill(db));

test('noise threshold is measured from the recording: valley between room noise and speech, clamped', () => {
  const levels = frames([[-58, 20], [-24, 40], [-56, 15], [-26, 30]]);
  const { noiseDb, floorDb, speechDb } = chooseNoiseDb(levels);
  assert.ok(noiseDb <= -30 && noiseDb >= -48, `noiseDb ${noiseDb}`);
  assert.ok(noiseDb > -56 && noiseDb < -26, 'between the modes');
  assert.ok(floorDb < -50 && speechDb > -30);
  assert.equal(chooseNoiseDb([-50, -50]).noiseDb, -35, 'too little data falls back');
  // A very quiet recording clamps to the floor of the allowed range, a loud noisy one to the ceiling.
  assert.equal(chooseNoiseDb(frames([[-80, 10], [-70, 10]])).noiseDb, -48);
  assert.equal(chooseNoiseDb(frames([[-20, 10], [-5, 10]])).noiseDb, -30);
});

test('quiet stretches (breaths, hums) are found only when long enough, and ranges union cleanly', () => {
  const levels = frames([[-24, 1], [-38, 0.34], [-24, 1], [-38, 0.1], [-24, 1]]);
  const runs = quietRuns(levels, -36, 0.3);
  assert.equal(runs.length, 1, 'the 0.1 s dip between words is natural speech');
  assert.ok(Math.abs(runs[0].start - 1) < 0.03 && Math.abs(runs[0].end - 1.34) < 0.03);
  assert.deepEqual(unionRanges([{ start: 0, end: 1 }, { start: 3, end: 4 }], [{ start: 0.5, end: 2 }]), [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
});

test('edge trimming removes long quiet lead-ins and tails but keeps short soft consonants', () => {
  const levels = frames([[-37, 0.3], [-22, 1], [-37, 0.3], [-37, 0.06], [-22, 1]]);
  const [a, b] = trimByLevel([{ in: 0, out: 1.6 }, { in: 1.6, out: 2.66 }], levels, { onsetDb: -36, offsetDb: -36, lead: 0.05, tail: 0.07, maxTrim: 0.4, minRun: 0.12 });
  assert.ok(a.in > 0.2 && a.in < 0.3, `leading breath trimmed: ${a.in}`);
  assert.ok(a.out < 1.5, `trailing breath trimmed: ${a.out}`);
  assert.ok(b.in <= 1.6 + 0.05, `short soft onset (0.06 s) is kept: ${b.in}`);
});

test('pace presets: natural keeps the old behaviour; tight and extra measure the noise floor and trim edges', () => {
  assert.equal(PACE.natural.noiseDb, -35);
  assert.equal(PACE.tight.noiseDb, 'auto');
  assert.ok(PACE.tight.minSilence < PACE.natural.minSilence);
  assert.ok(PACE.extra.padAfter < PACE.tight.padAfter);
  const levels = frames([[-24, 1], [-38, 0.4], [-24, 1]]);
  const words = [{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 1.4, end: 2.4 }];
  const natural = planCuts({ duration: 2.4, fps: 30, silences: [], words });
  assert.equal(natural.length, 1, 'no silence found: one range');
  const tight = planCuts({ duration: 2.4, fps: 30, silences: quietRuns(levels, -36, 0.3), words, levels, trim: { onsetDb: -36, offsetDb: -36 }, padBefore: 0.05, padAfter: 0.08, mergeGap: 0.06 });
  assert.equal(tight.length, 2);
});

test('speed remaps caption words by range speed', () => {
  const ranges = [{ in: 10, out: 14, start: 0, speed: 2 }, { in: 20, out: 22, start: 2, speed: 2 }];
  const out = remapWords([{ text: 'x', start: 12, end: 13 }, { text: 'y', start: 20.5, end: 21 }], ranges);
  assert.deepEqual(out.map(w => [w.start, w.end]), [[1, 1.5], [2.25, 2.5]]);
});

const probe = async (_c, args) => {
  const name = path.basename(args.at(-1));
  return { stdout: JSON.stringify({ format: { duration: name === 'rec.mp4' ? '20' : '5' }, streams: [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] }) };
};
test('timeline validates scene speed against source consumption', async t => {
  const folder = await temporary(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(folder, 'rec.mp4'), 'x');
  const make = async (scene, name) => {
    await writeJson(path.join(folder, name), { version: 2, title: 't', fps: 30, width: 640, height: 360,
      assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
      scenes: [{ kind: 'video', asset: 'rec', in: 0, duration: 10, purpose: 'x', audio: {}, ...scene }] });
    return path.join(folder, name);
  };
  assert.equal((await loadTimeline(await make({ speed: 1.5 }, 'a.json'), probe)).duration, 10, 'consumes 15 s of a 20 s source');
  await assert.rejects(loadTimeline(await make({ speed: 2.5 }, 'b.json'), probe), /speed must be/);
  await assert.rejects(loadTimeline(await make({ speed: 2, in: 5 }, 'c.json'), probe), /exceeds source/);
  await assert.rejects(loadTimeline(await make({ kind: 'color', asset: undefined, in: undefined, color: '#112233', speed: 1.2 }, 'd.json'), probe), /only video scenes/);
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeOk = await findChrome().then(() => true, () => false);
test('real run: tight pace removes quiet gaps and breaths, speed shortens the video, sync is kept', { skip: ffmpegOk && chromeOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  // 12 s: tone bursts (speech) with silences, a faint "hum" (0.6 s) and a long dead pause.
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=12', '-f', 'lavfi', '-i',
    "aevalsrc='(0.35*sin(2*PI*220*t))*(between(t,0.2,1.8)+between(t,3.0,4.6)+between(t,7.0,8.6)+between(t,10.0,11.6))+(0.004*sin(2*PI*140*t))*between(t,5.0,5.6)':s=48000:d=12",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(folder, 'rec.mp4')]);
  const run1 = await autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'edit'), { rightsConfirmed: true, rights: 'Test', attribution: 'Test' });
  assert.equal(run1.report.settings.pace, 'tight');
  assert.ok(run1.report.editedDuration < 7.5, `tight edit ${run1.report.editedDuration}s`);
  assert.equal(run1.ranges.length, 4, 'four speech bursts; the hum and pauses are cut');
  const fast = await autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'fast'), { rightsConfirmed: true, rights: 'Test', attribution: 'Test', speed: 1.25 });
  assert.ok(Math.abs(fast.report.editedDuration - run1.report.editedDuration / 1.25) < 0.4, `${fast.report.editedDuration}`);
  assert.equal((await readJson(path.join(folder, 'fast', 'production.json'))).scenes[0].speed, 1.25);
  const manifest = path.join(folder, 'fast', 'production.json');
  const review = path.join(folder, 'fast', 'review.json');
  await reviewProduction(manifest, review, true);
  const out = path.join(folder, 'fast', 'render');
  const report = await buildProduction(manifest, review, out, true, undefined, undefined, { quality: 'draft' });
  assert.equal(report.status, 'technical-checks-passed-needs-human-review', JSON.stringify(report.verification));
  const info = await inspectMedia(path.join(out, 'final.mp4'));
  assert.ok(Math.abs(info.duration - fast.report.editedDuration) < 0.15, `rendered ${info.duration}s vs planned ${fast.report.editedDuration}s`);
  assert.ok(info.audio && info.video);
  assert.ok(await exists(path.join(out, 'stems', 'master.wav')));
  await assert.rejects(autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'bad'), { speed: 3 }), /speed must be/);
  await assert.rejects(autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'bad2'), { pace: 'wild' }), /pace must be/);
});

test('timeline frame totals are exact for many millisecond-rounded scenes (regression: 22143 vs 22144 frames)', async t => {
  const folder = await temporary(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(folder, 'rec.mp4'), 'x');
  const scenes = Array.from({ length: 150 }, () => ({ kind: 'video', asset: 'rec', in: 0, duration: 0.017, purpose: 'x', audio: {} }));
  await writeJson(path.join(folder, 'm.json'), { version: 2, title: 't', fps: 60, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }], scenes });
  const loaded = await loadTimeline(path.join(folder, 'm.json'), async () => ({ stdout: JSON.stringify({ format: { duration: '20' }, streams: [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '60/1' }, { codec_type: 'audio' }] }) }));
  assert.equal(loaded.totalFrames, 150, 'sum of per-scene frames, not round(sum of rounded seconds * fps)');
  assert.equal(loaded.timeline.at(-1).startFrame + loaded.timeline.at(-1).frames, 150);
});
