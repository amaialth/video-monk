import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exists, run, writeJson, writeNew, readJson } from '../src/core.js';
import { pageWords, pagesToSrt, pagesToVtt, remapWords, validateWords } from '../src/captions.js';
import { planCuts, refineWords, autocut } from '../src/autocut.js';
import { parseWhisperJson } from '../src/transcribe.js';
import { validateProps, templateCatalog, TEMPLATES } from '../src/motion/templates.js';
import { placementBox } from '../src/motion/render.js';
import { loadTimeline, chapters } from '../src/timeline.js';
import { reviewProduction, buildProduction, inspectMedia } from '../src/production.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-auto-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

const W = (text, start, end) => ({ text, start, end });

test('caption paging breaks on sentences, gaps and limits without orphaning final words', () => {
  const words = [W('Welcome', 0.5, 0.9), W('to', 0.95, 1.05), W('the', 1.1, 1.2), W('system', 1.25, 1.6), W('design', 1.65, 2),
    W('breakdown.', 2.05, 2.6), W('Next', 4, 4.3), W('topic', 4.35, 4.8)];
  const pages = pageWords(words, { maxWords: 5, maxChars: 30 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].words.at(-1).text, 'breakdown.');
  assert.ok(pages[0].end <= pages[1].start);
  const srt = pagesToSrt(pages);
  assert.match(srt, /^1\n00:00:00,500 --> 00:00:02,600\nWelcome to the system design breakdown\.\n/);
  assert.match(pagesToVtt(pages), /^WEBVTT\n\n00:00:00\.500 --> /);
  assert.throws(() => validateWords([W('a', 1, 0.5)]), /invalid/);
  assert.throws(() => validateWords([W('a\nb', 0, 1)]), /invalid/);
});

test('word remapping follows kept ranges by overlap and drops removed words', () => {
  const ranges = [{ in: 0, out: 1.2, start: 0 }, { in: 1.6, out: 4.1, start: 1.2 }];
  const out = remapWords([W('channel.', 0.74, 1.67), W('gone', 1.3, 1.5), W('Today', 1.67, 2.17)], ranges);
  assert.deepEqual(out.map(w => w.text), ['channel.', 'Today']);
  assert.equal(out[0].end, 1.2);
  assert.equal(out[1].start, 1.27);
});

test('autocut planning removes silences and fillers, pads speech and frame-aligns ranges', () => {
  const words = [W('Hello', 0.1, 0.5), W('there.', 0.55, 1), W('Um,', 2.6, 3), W('so', 3.05, 3.3), W('yes', 3.35, 3.8)];
  const ranges = planCuts({ duration: 5, fps: 30, silences: [{ start: 1.05, end: 2.5 }, { start: 3.9, end: Infinity }], words });
  assert.equal(ranges.length, 2);
  for (const r of ranges) {
    assert.ok(Math.abs(r.in * 30 - Math.round(r.in * 30)) < 0.05, 'in aligned');
    assert.equal(Math.round((r.out - r.in) * 30), r.frames);
  }
  assert.ok(ranges[0].out <= 1.2 && ranges[0].out >= 1.0, 'tail padding after speech');
  assert.ok(ranges[1].in >= 3.0, 'filler excluded');
  assert.ok(ranges[1].out <= 4.05, 'trailing silence removed');
  const keepFillers = planCuts({ duration: 5, fps: 30, silences: [{ start: 1.05, end: 2.5 }], words, removeFillers: false });
  assert.ok(keepFillers[1].in < 2.6);
});

test('ASR words are refined against measured silence', () => {
  const refined = refineWords([W('channel.', 0.74, 1.67), W('That', 12.07, 12.31), W('is', 12.6, 12.8)],
    [{ start: 1.087, end: 1.67 }, { start: 11.918, end: 12.571 }]);
  assert.equal(refined[0].end, 1.087);
  assert.equal(refined[1].start, 12.571);
  assert.equal(refined[2].start, 12.6);
});

test('whisper.cpp full JSON is parsed into ordered words, skipping markers', () => {
  const words = parseWhisperJson({ transcription: [
    { text: '', offsets: { from: 0, to: 80 } },
    { text: ' [BLANK_AUDIO]', offsets: { from: 80, to: 200 } },
    { text: ' Hello', offsets: { from: 200, to: 500 } },
    { text: ' big world', offsets: { from: 500, to: 900 } },
    { text: ' And', offsets: { from: 1000, to: 1000 } }
  ] });
  assert.deepEqual(words.map(w => w.text), ['Hello', 'big', 'world', 'And']);
  assert.ok(words[3].end > words[3].start);
  assert.ok(words[1].end <= words[2].start + 1e-9);
});

test('motion template props are schema-validated and documented', () => {
  assert.ok(templateCatalog().length >= 17);
  assert.ok(!templateCatalog().some(t => t.name === 'captions'));
  assert.deepEqual(validateProps('stat', { value: 42, label: 'Median' }), { value: 42, label: 'Median' });
  assert.throws(() => validateProps('stat', { value: 42 }), /label is required/);
  assert.throws(() => validateProps('stat', { value: 42, label: 'x', script: 'alert(1)' }), /unsupported field/);
  assert.throws(() => validateProps('title', { title: 'x'.repeat(111) }), /at most 110/);
  assert.throws(() => validateProps('bar-chart', { bars: [{ label: 'a\u0007', value: 1 }] }), /control/);
  assert.throws(() => validateProps('bar-chart', { bars: [{ label: 'a', value: 1, color: 'red' }] }), /#RRGGBB/);
  assert.throws(() => validateProps('nope', {}), /unknown template/);
  assert.ok(validateProps('code', { code: 'a\n\tb' }).code.includes('\n'));
  for (const def of Object.values(TEMPLATES)) assert.equal(typeof def.render, 'function');
  assert.deepEqual(placementBox('right', 1920, 1080), { x: 960, y: 65, w: 883, h: 821 });
  assert.equal(placementBox('right', 1080, 1920).y > 900, true, 'portrait maps right to bottom half');
});

// Mocked ffprobe for structural timeline validation.
function mockProbe(durations) {
  return async (_cmd, args) => {
    const file = args.at(-1);
    const name = path.basename(file);
    const kind = name.endsWith('.wav') ? 'audio' : name.endsWith('.png') ? 'image' : 'video';
    const streams = kind === 'audio' ? [{ codec_type: 'audio' }] : kind === 'image' ? [{ codec_type: 'video', codec_name: 'png', width: 640, height: 360 }]
      : [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }];
    return { stdout: JSON.stringify({ format: { duration: String(durations[name] ?? 10) }, streams }) };
  };
}

async function timelineFixture(t, change = () => {}) {
  const folder = await temporary(t);
  for (const name of ['cam.mp4', 'voice.wav', 'music.wav', 'pic.png']) await writeNew(path.join(folder, name), name);
  await writeJson(path.join(folder, 'words.json'), [W('Hi', 0.2, 0.5), W('there', 0.6, 1)]);
  const m = {
    version: 2, title: 'Timeline test', fps: 30, width: 640, height: 360,
    assets: ['cam.mp4', 'voice.wav', 'music.wav', 'pic.png'].map(p => ({ id: p.split('.')[0], path: p,
      kind: p.endsWith('.wav') ? 'audio' : p.endsWith('.png') ? 'image' : 'video', approved: true, rights: 'Original', attribution: 'Me' })),
    scenes: [
      { kind: 'graphic', purpose: 'Hook', chapter: 'Intro', duration: 2, graphic: { template: 'title', props: { title: 'Hello' } }, transition: { type: 'fade', duration: 0.5 } },
      { kind: 'video', asset: 'cam', in: 1, duration: 3, purpose: 'Talk', chapter: 'Main', audio: {}, motion: { type: 'zoom-in' },
        overlays: [{ template: 'lower-third', start: 0, duration: 2, props: { name: 'Me' } }] },
      { kind: 'image', asset: 'pic', duration: 1, purpose: 'Still' }
    ],
    audio: { narration: { asset: 'voice' }, music: [{ asset: 'music', gainDb: -20 }] },
    captions: { words: 'words.json' }
  };
  change(m);
  const file = path.join(folder, 'production.json');
  await writeJson(file, m);
  return { folder, file, execute: mockProbe({ 'voice.wav': 5 }) };
}

test('version-2 timelines account for transitions, chapters and frame totals', async t => {
  const f = await timelineFixture(t);
  const loaded = await loadTimeline(f.file, f.execute);
  assert.equal(loaded.duration, 5.5);
  assert.equal(loaded.totalFrames, 165);
  assert.deepEqual(loaded.timeline.map(x => x.startFrame), [0, 45, 135]);
  assert.deepEqual(chapters(loaded).map(c => c.label), ['0:00 Intro', '0:01 Main']);
  const review = await reviewProduction(f.file, path.join(f.folder, 'review.json'), true, f.execute);
  assert.equal(review.version, 2);
  assert.equal(review.transitions, 1);
  assert.equal(review.motionGraphics, 2);
});

for (const [label, change, error] of [
  ['narration past the end', m => { m.scenes[2].duration = 0.1; }, /runs past the timeline/],
  ['unknown template', m => { m.scenes[0].graphic.template = 'explode'; }, /unknown template/],
  ['bad template props', m => { m.scenes[0].graphic.props = { title: 'x', onload: 'x' }; }, /unsupported field/],
  ['overlay outside scene', m => { m.scenes[1].overlays[0].start = 2.5; }, /fit inside the scene/],
  ['transition on last scene', m => { m.scenes[2].transition = { type: 'fade', duration: 0.5 }; }, /last scene/],
  ['transition too long', m => { m.scenes[0].transition.duration = 2; }, /shorter than both/],
  ['unknown transition', m => { m.scenes[0].transition.type = 'spin'; }, /transition.type/],
  ['unaligned duration', m => { m.scenes[1].duration = 3.01; }, /align to timeline frames/],
  ['scene beyond source', m => { m.scenes[1].in = 8; }, /exceeds source/],
  ['unapproved asset', m => { m.assets[0].approved = false; }, /approved/],
  ['unknown field', m => { m.scenes[1].effect = 'glow'; }, /unsupported field/],
  ['missing captions file', m => { m.captions.words = 'missing.json'; }, /not found/]
]) {
  test(`version-2 timeline rejects ${label}`, async t => {
    const f = await timelineFixture(t, change);
    await assert.rejects(loadTimeline(f.file, f.execute), error);
  });
}

test('version-2 build requires approval of the exact fingerprint', async t => {
  const f = await timelineFixture(t);
  const review = path.join(f.folder, 'review.json');
  await reviewProduction(f.file, review, false, f.execute);
  await assert.rejects(buildProduction(f.file, review, path.join(f.folder, 'out'), true, f.execute), /approval/);
  await assert.rejects(buildProduction(f.file, review, path.join(f.folder, 'out2'), false, f.execute), /allow-render/);
  assert.equal(await exists(path.join(f.folder, 'out')), false);
});

const ffmpegAvailable = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeAvailable = await findChrome().then(() => true, () => false);
const skipReal = !ffmpegAvailable || !chromeAvailable || process.env.VIDEO_MONK_SKIP_REAL ? 'needs ffmpeg and Chrome (set VIDEO_MONK_SKIP_REAL=1 to skip)' : false;

test('real automated edit: autocut + motion graphics + transitions + captions + ducked music + mastering', { skip: skipReal, timeout: 300000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  // Synthetic "talk" with tone bursts separated by silences.
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i',
    "aevalsrc='0.4*sin(2*PI*220*t)*(lt(mod(t,2),1.2))':s=48000:d=6", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(folder, 'rec.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'sine=f=110:d=30', path.join(folder, 'music.wav')]);
  await writeJson(path.join(folder, 'words.json'), [W('one', 0.1, 1), W('um', 2.1, 2.9), W('three.', 4.1, 5)]);
  const cut = await autocut(path.join(folder, 'rec.mp4'), path.join(folder, 'edit'), { words: path.join(folder, 'words.json'), rightsConfirmed: true, rights: 'Test', attribution: 'Test' });
  assert.equal(cut.report.fillersRemoved, 1);
  assert.equal(cut.ranges.length, 2, 'pauses and the filler-only burst are removed');
  assert.ok(cut.report.editedDuration < 3);
  const manifest = await readJson(path.join(folder, 'edit', 'production.json'));
  manifest.assets.push({ id: 'music', path: '../music.wav', kind: 'audio', approved: true, rights: 'Test', attribution: 'Test' });
  manifest.scenes.unshift({ id: 'intro', kind: 'graphic', purpose: 'Hook', chapter: 'Intro', duration: 1,
    graphic: { template: 'stat', props: { value: 42, suffix: '%', label: 'Test stat' } }, transition: { type: 'fade', duration: 0.2 } });
  manifest.scenes[1].overlays = [{ template: 'bar-chart', start: 0, duration: 0.6, placement: 'right', props: { bars: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] } }];
  manifest.audio = { music: [{ asset: 'music', gainDb: -24 }] };
  // Captions were remapped for the cut-only timeline; shift them by the inserted intro (1s - 0.2s transition).
  const shifted = (await readJson(path.join(folder, 'edit', 'words.timeline.json'))).map(w => ({ ...w, start: w.start + 0.8, end: w.end + 0.8 }));
  await writeJson(path.join(folder, 'edit', 'words.shifted.json'), shifted);
  manifest.captions.words = 'words.shifted.json';
  const file = path.join(folder, 'edit', 'production2.json');
  await writeJson(file, manifest);
  await reviewProduction(file, path.join(folder, 'review.json'), true);
  const out = path.join(folder, 'render');
  const report = await buildProduction(file, path.join(folder, 'review.json'), out, true, undefined, undefined, { quality: 'draft' });
  assert.equal(report.status, 'technical-checks-passed-needs-human-review', JSON.stringify(report.verification));
  for (const name of ['final.mp4', 'captions.srt', 'captions.vtt', 'chapters.txt', 'thumbnail.png', 'contact-sheet.png', 'timeline.xml',
    'stems/voice.wav', 'stems/music.wav', 'stems/master.wav', 'REVIEW.txt', 'CREDITS.txt', 'report.json']) {
    assert.ok(await exists(path.join(out, name)), name);
  }
  assert.equal(await exists(path.join(out, 'work', 'motion')), false, 'motion frames cleaned up');
  const info = await inspectMedia(path.join(out, 'final.mp4'));
  assert.equal(info.video.width, manifest.width);
  assert.ok(Math.abs(info.duration - (1 + cut.report.editedDuration - 0.2)) < 0.1);
  assert.match(await readFile(path.join(out, 'captions.srt'), 'utf8'), /three\./);
  assert.match(await readFile(path.join(out, 'chapters.txt'), 'utf8'), /^0:00 Intro/);
  // The intro stat counts up, so early and late frames must differ.
  const frame = async n => (await run('ffmpeg', ['-v', 'error', '-i', path.join(out, 'final.mp4'), '-vf', `select=eq(n\\,${n}),scale=32:18`,
    '-frames:v', '1', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
  assert.notDeepEqual(await frame(2), await frame(20));
  assert.ok((await stat(path.join(out, 'thumbnail.png'))).size > 1000);
});
