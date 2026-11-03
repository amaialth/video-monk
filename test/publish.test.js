import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson } from '../src/core.js';
import { auditSrt } from '../src/captions.js';
import { youtubePackage, validChapters, keywords } from '../src/publish.js';
import { reviewProduction, buildProduction } from '../src/production.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-publish-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);

test('caption audit finds overlap, fast reading, long pages, flicker and lone words', () => {
  const srt = ['1', '00:00:00,000 --> 00:00:02,000', 'A fine caption page', '', '2', '00:00:01,900 --> 00:00:03,000', 'overlaps the one before', '',
    '3', '00:00:03,000 --> 00:00:03,700', 'this page has far too many characters to be read in under a second', '', '4', '00:00:04,000 --> 00:00:04,300', 'so', ''].join('\n');
  const kinds = auditSrt(srt).map(i => i.kind);
  for (const k of ['overlap', 'fast', 'long', 'lone']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.deepEqual(auditSrt('1\n00:00:00,000 --> 00:00:02,000\nAll good here\n'), []);
});

test('publishing package: chapters only when YouTube would accept them, credits, tags, Shorts notes', () => {
  const words = 'Caching speeds up reads. Caching stores results near the user. Latency drops when caching works. Latency matters.'.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.deepEqual(keywords(words).slice(0, 2), ['caching', 'latency']);
  const frag = 'ce so anyone can use it. Apache has a community. It is big.'.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }));
  assert.match(youtubePackage({ title: 'x', duration: 40, width: 1080, height: 1920, words: frag, chapters: [], credits: [] }), /## Description\n\nApache has a community\./);
  assert.equal(validChapters([{ time: 0, title: 'a' }, { time: 30, title: 'b' }], 100).ok, false);
  assert.equal(validChapters([{ time: 5, title: 'a' }, { time: 30, title: 'b' }, { time: 60, title: 'c' }], 100).ok, false);
  const ok = [{ time: 0, title: 'Intro' }, { time: 20, title: 'How it works' }, { time: 50, title: 'Wrap up' }];
  const md = youtubePackage({ title: 'Caching', duration: 80, width: 1920, height: 1080, words, chapters: ok, credits: [{ attribution: 'Track by Artist', rights: 'Music licence', sourceUrl: 'https://example.com' }] });
  assert.match(md, /0:00 Intro\n0:20 How it works\n0:50 Wrap up/);
  assert.match(md, /Track by Artist \(https:\/\/example.com\)/);
  assert.match(md, /#caching #latency/);
  const short = youtubePackage({ title: 'Clip', duration: 200, width: 1080, height: 1920, words, chapters: [], credits: [] });
  assert.match(short, /#Shorts/); assert.match(short, /TOO LONG for Shorts/);
  const bad = youtubePackage({ title: 'x', duration: 40, width: 1920, height: 1080, words, chapters: [{ time: 0, title: 'a' }, { time: 15, title: 'b' }], credits: [] });
  assert.match(bad, /Chapters not included: fewer than three/);
});

test('a real build writes YOUTUBE.md and puts the logo bug in the chosen corner', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'bg.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=64x64:d=1', '-frames:v', '1', path.join(folder, 'logo.png')]);
  const file = path.join(folder, 'm.json');
  await writeJson(file, { version: 2, title: 'Logo test', fps: 24, width: 320, height: 180,
    assets: [{ id: 'bg', path: 'bg.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }, { id: 'logo', path: 'logo.png', kind: 'image', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'bg', duration: 2, purpose: 'x' }], watermark: { asset: 'logo', position: 'bottom-left', size: 0.2, opacity: 1, margin: 0.05 } });
  await reviewProduction(file, path.join(folder, 'r.json'), true);
  const out = path.join(folder, 'out');
  const report = await buildProduction(file, path.join(folder, 'r.json'), out, true, undefined, undefined, { quality: 'draft' });
  assert.equal(report.status, 'technical-checks-passed-needs-human-review');
  assert.match(await readFile(path.join(out, 'YOUTUBE.md'), 'utf8'), /Publishing package/);
  const pixel = async (x, y) => [...(await run('ffmpeg', ['-v', 'error', '-ss', '1', '-i', path.join(out, 'final.mp4'), '-frames:v', '1', '-vf', `scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout];
  const inCorner = await pixel(30, 150), elsewhere = await pixel(290, 20);
  assert.ok(inCorner[1] > 180 && inCorner[0] < 80, `logo bug present bottom-left: ${inCorner}`);
  assert.ok(elsewhere[1] < 40, `no logo top-right: ${elsewhere}`);
});
