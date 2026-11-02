import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson } from '../src/core.js';
import { videoCapMbps, h264Level, resolveDelivery, videoArgs, hdrInfo, sourceColorFix, TARGETS } from '../src/delivery.js';
import { reviewProduction, buildProduction, inspectMedia } from '../src/production.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-delivery-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('bitrate caps, H.264 levels and targets follow resolution, frame rate and platform', () => {
  assert.equal(videoCapMbps(1920, 1080, 30), 16);
  assert.equal(videoCapMbps(1920, 1080, 60), 24);
  assert.equal(videoCapMbps(3840, 2160, 30), 55);
  assert.equal(videoCapMbps(1920, 1080, 30, 0.6), 9.6);
  assert.equal(h264Level(1920, 1080, 30), '4.0');
  assert.equal(h264Level(1920, 1080, 60), '4.2');
  assert.equal(h264Level(3840, 2160, 60), '5.2');
  assert.equal(resolveDelivery().target, 'youtube');
  assert.equal(resolveDelivery().audioKbps, 320);
  assert.equal(resolveDelivery({ target: 'web' }).lufs, -16);
  assert.equal(resolveDelivery({ target: 'youtube', targetLufs: -15 }).lufs, -15);
  assert.throws(() => resolveDelivery({ target: 'cinema' }), /target must be/);
  const enc = videoArgs({ width: 1920, height: 1080, fps: 60, delivery: { target: 'youtube' } });
  assert.equal(enc.capMbps, 24);
  for (const flag of ['-profile:v', 'high', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-maxrate', '24M', '-bufsize', '48M']) assert.ok(enc.args.includes(flag), flag);
  assert.equal(videoArgs({ width: 1920, height: 1080, fps: 30, delivery: { target: 'master' } }).capMbps, null, 'master is uncapped');
  assert.equal(videoArgs({ width: 1920, height: 1080, fps: 30, delivery: { maxrateMbps: 8 } }).args.includes('8M'), true);
  assert.ok(TARGETS.youtube.crf < TARGETS.web.crf);
});

test('HDR sources are detected and SD sources are converted to BT.709', () => {
  assert.equal(hdrInfo({ color_transfer: 'arib-std-b67' }).hdr, true);
  assert.equal(hdrInfo({ color_transfer: 'smpte2084' }).hdr, true);
  assert.equal(hdrInfo({ color_transfer: 'bt709' }).hdr, false);
  assert.match(sourceColorFix({ color_space: 'smpte170m' }), /colorspace=all=bt709:iall=bt601-6-525/);
  assert.equal(sourceColorFix({ color_space: 'bt709' }), '');
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeOk = await findChrome().then(() => true, () => false);
test('real build: BT.709 tags, High profile, capped bitrate, accurate graphic colours and 320 kb/s audio', { skip: ffmpegOk && chromeOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=3', path.join(folder, 'voice.wav')]);
  const file = path.join(folder, 'm.json');
  await writeJson(file, { version: 2, title: 'Delivery', fps: 30, width: 640, height: 360, theme: { preset: 'night', background: '#4cc9f0', surface: '#4cc9f0' },
    assets: [{ id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'graphic', duration: 3, purpose: 'x', graphic: { template: 'progress-bar', props: {}, background: 'plain' } }], audio: { narration: { asset: 'voice' } } });
  await reviewProduction(file, path.join(folder, 'r.json'), true);
  const report = await buildProduction(file, path.join(folder, 'r.json'), path.join(folder, 'out'), true, undefined, undefined, { quality: 'final' });
  assert.equal(report.status, 'technical-checks-passed-needs-human-review', JSON.stringify(report.verification.checks));
  assert.equal(report.verification.checks.colorTags, 'PASS');
  assert.equal(report.verification.checks.bitrate, 'PASS');
  const final = path.join(folder, 'out', 'final.mp4');
  const info = await inspectMedia(final);
  assert.equal(info.video.profile, 'High');
  assert.equal(info.video.color_space, 'bt709');
  assert.equal(info.video.color_range, 'tv');
  assert.ok(Number(info.audio.bit_rate) > 200000, `AAC bitrate ${info.audio.bit_rate} (the old default capped at 192k)`);
  // The plain background (#4cc9f0 = 76,201,240) must survive RGB -> YUV -> RGB within one level when decoded as BT.709.
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', '1', '-i', final, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24,crop=1:1:20:20', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  const [r, g, b] = [...stdout];
  assert.ok(Math.abs(r - 76) <= 3 && Math.abs(g - 201) <= 3 && Math.abs(b - 240) <= 3, `decoded ${r},${g},${b}`);
});
