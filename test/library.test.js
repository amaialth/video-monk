import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Library, libraryRoot, textPreview } from '../src/library.js';
import { exists, run, writeJson, writeNew, readJson } from '../src/core.js';
import { reviewProduction, buildProduction } from '../src/production.js';
import { transcribeWhisper } from '../src/transcribe.js';
import { storyboardManifest } from '../src/storyboard.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-lib-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const openIn = async t => Library.open(await temporary(t));

test('library indexes files with rights, finds them by keyword and tag, and checks them out as manifest entries', async t => {
  const lib = await openIn(t);
  const folder = await temporary(t);
  await writeFile(path.join(folder, 'ambient-bed.mp3'), 'not really audio');
  const entry = await lib.add({ source: path.join(folder, 'ambient-bed.mp3'), kind: 'audio', name: 'Ambient bed', tags: ['Music', 'Calm'],
    description: 'Slow ambient pad for explainers', rights: 'YouTube Audio Library, free to use', attribution: 'Artist — Track', approved: true });
  assert.match(entry.id, /^audio-[0-9a-f]{12}$/);
  assert.deepEqual(entry.tags, ['music', 'calm']);
  assert.equal(lib.search('ambient pad')[0].id, entry.id);
  assert.equal(lib.search('', { kind: 'audio', tags: ['calm'] }).length, 1);
  assert.equal(lib.search('kafka').length, 0);
  const again = await lib.add({ source: path.join(folder, 'ambient-bed.mp3'), kind: 'audio', tags: ['loopable'] });
  assert.equal(again.id, entry.id, 'same content is one asset');
  assert.deepEqual(again.tags.sort(), ['calm', 'loopable', 'music']);
  assert.equal(again.rights, 'YouTube Audio Library, free to use', 'rights survive re-adding');
  const out = await lib.checkout(entry.id, path.join(folder, 'project', 'bed.mp3'));
  assert.equal(out.manifestEntry.kind, 'audio');
  assert.equal(out.manifestEntry.approved, true);
  assert.equal(out.manifestEntry.attribution, 'Artist — Track');
  assert.equal(lib.get(entry.id).uses, 1);
  await assert.rejects(lib.checkout(entry.id, path.join(folder, 'project', 'bed.mp3')), /exists/);
  await assert.rejects(lib.add({ source: path.join(folder, 'ambient-bed.mp3'), kind: 'bogus' }), /kind must be/);
  assert.equal((await Library.open(lib.root)).stats().entries, 1, 'index persists');
});

test('prune only removes generated kinds, oldest first, and never user-added licensed assets', async t => {
  const lib = await openIn(t);
  const folder = await temporary(t);
  await writeFile(path.join(folder, 'a.mp3'), 'x'.repeat(100));
  await writeFile(path.join(folder, 'b.json'), '{"x":1}');
  await lib.add({ source: path.join(folder, 'a.mp3'), kind: 'audio', name: 'music' });
  const sb = await lib.add({ source: path.join(folder, 'b.json'), kind: 'storyboard', name: 'old storyboard' });
  const index = JSON.parse(await readFile(lib.indexFile, 'utf8'));
  index.entries.find(e => e.id === sb.id).updatedAt = '2020-01-01T00:00:00.000Z';
  await writeFile(lib.indexFile, JSON.stringify(index));
  const dry = await lib.prune({ olderThanDays: 30 });
  assert.deepEqual(dry.removed, [sb.id]);
  assert.equal(dry.dryRun, true);
  assert.ok(await exists(lib.absolute(sb)), 'dry run keeps files');
  await lib.prune({ olderThanDays: 30, dryRun: false });
  assert.equal(lib.search('').length, 1);
  assert.equal(lib.search('')[0].kind, 'audio');
  const everything = await lib.prune({ maxBytes: 0, kinds: ['graphic', 'transcript', 'storyboard', 'thumbnail'], dryRun: false });
  assert.deepEqual(everything.removed, []);
});

test('library can be disabled and the root is configurable', () => {
  const saved = process.env.VIDEO_MONK_LIBRARY;
  process.env.VIDEO_MONK_LIBRARY = 'off';
  assert.equal(libraryRoot(), null);
  process.env.VIDEO_MONK_LIBRARY = saved;
  assert.equal(libraryRoot(), path.resolve(saved));
  assert.equal(textPreview({ a: 'x *y*', b: ['z', { c: 'w' }] }), 'x y · z · w');
});

// --- transcript reuse with a fake whisper pipeline ---
test('identical media reuses the stored transcript instead of running the model again', async t => {
  const folder = await temporary(t);
  const media = path.join(folder, 'talk.mp4');
  const model = path.join(folder, 'ggml-test.bin');
  await writeFile(media, 'media bytes');
  await writeFile(model, 'model');
  let whisperRuns = 0;
  const execute = async (command, args) => {
    if (command === 'whisper-cli' && args.includes('--help')) return { stdout: '' };
    if (command === 'whisper-cli') {
      whisperRuns++;
      await writeFile(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify({ transcription: [
        { text: ' Hello', offsets: { from: 100, to: 500 } }, { text: ' world.', offsets: { from: 600, to: 1200 } }] }));
      return { stdout: '' };
    }
    if (/ffprobe/.test(command)) return { stdout: JSON.stringify({ format: { duration: '3' }, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }) };
    return { stdout: '', stderr: '' };
  };
  const first = await transcribeWhisper(media, path.join(folder, 'out1'), { allowTranscribe: true, model, language: 'en' }, execute);
  assert.equal(first.report.cached, undefined);
  assert.equal(whisperRuns, 1);
  const second = await transcribeWhisper(media, path.join(folder, 'out2'), { allowTranscribe: true, model, language: 'en' }, execute);
  assert.equal(second.report.cached, true);
  assert.equal(whisperRuns, 1, 'the model did not run again');
  assert.deepEqual(second.words.map(w => w.text), ['Hello', 'world.']);
  assert.ok(await exists(path.join(folder, 'out2', 'transcript.txt')));
  await transcribeWhisper(media, path.join(folder, 'out3'), { allowTranscribe: true, model, language: 'en', prompt: 'new prompt' }, execute);
  assert.equal(whisperRuns, 2, 'different settings are a different transcript');
  const lib = await Library.open();
  assert.ok(lib.search('hello', { kind: 'transcript' }).length >= 1);
});

// --- paid storyboard reuse ---
test('a Claude storyboard is generated once and reused for the same transcript and settings', async t => {
  const folder = await temporary(t);
  await writeNew(path.join(folder, 'rec.mp4'), 'x');
  const text = 'Welcome to the course of Apache Camel. Camel is a framework that helps you move data between systems quickly. Today we will cover routes, endpoints, and components.';
  let at = 0;
  const words = text.split(' ').map(w => { const o = { text: w, start: Math.round(at * 100) / 100, end: Math.round((at + 0.3) * 100) / 100 }; at += 0.34; return o; });
  const duration = Math.ceil(at + 1);
  await writeJson(path.join(folder, 'words.json'), words);
  await writeJson(path.join(folder, 'production.json'), { version: 2, title: 'Reuse test', fps: 30, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'rec', in: 0, duration, purpose: 'x', audio: {} }], captions: { words: 'words.json' } });
  let claudeCalls = 0;
  const execute = async (command, args) => {
    if (command === 'claude') {
      claudeCalls++;
      return { stdout: JSON.stringify({ total_cost_usd: 0.04, structured_output: { items: [{ start: 3, end: 6, template: 'bullets', mode: 'cutaway', priority: 8, why: 'Agenda',
        props: { items: ['Routes', 'Endpoints', 'Components'], marker: 'check' }, cues: ['routes', 'endpoints', 'components'] }] } }) };
    }
    const name = path.basename(args.at(-1));
    return { stdout: JSON.stringify({ format: { duration: String(duration + 5) }, streams: name.endsWith('.wav') ? [{ codec_type: 'audio' }]
      : [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] }) };
  };
  const options = { engine: 'claude', allowLlm: true, theme: 'night', density: 'heavy' };
  const first = await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'a.json'), options, execute);
  assert.equal(first.cacheNote, null);
  const calls = claudeCalls;
  assert.ok(calls >= 1);
  const second = await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'b.json'), options, execute);
  assert.match(second.cacheNote, /reused from the asset library/);
  assert.equal(claudeCalls, calls, 'no second paid call');
  assert.deepEqual((await readJson(second.manifest)).globalOverlays.map(o => o.template), (await readJson(first.manifest)).globalOverlays.map(o => o.template));
  await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'c.json'), { ...options, density: 'light' }, execute);
  assert.ok(claudeCalls > calls, 'changed settings generate a new storyboard');
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeOk = await findChrome().then(() => true, () => false);
test('graphics rendered for one project are indexed and reused by the next', { skip: ffmpegOk && chromeOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'sine=f=220:d=3', path.join(folder, 'voice.wav')]);
  const manifest = {
    version: 2, title: 'Library reuse', fps: 24, width: 640, height: 360,
    assets: [{ id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'graphic', duration: 3, purpose: 'Explain', graphic: { template: 'stat', props: { value: 42, suffix: '%', label: 'Reusable *count*' } } }],
    audio: { narration: { asset: 'voice' } }
  };
  const build = async name => {
    const file = path.join(folder, `${name}.json`);
    await writeJson(file, manifest);
    await reviewProduction(file, path.join(folder, `${name}-review.json`), true);
    return buildProduction(file, path.join(folder, `${name}-review.json`), path.join(folder, `${name}-out`), true, undefined, undefined, { quality: 'draft' });
  };
  const first = await build('one');
  assert.equal(first.library.graphicsAdded, 1);
  assert.equal(first.library.graphicsReused, 0);
  const lib = await Library.open();
  const hit = lib.search('reusable count', { kind: 'graphic' });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].meta.template, 'stat');
  assert.ok(hit[0].tags.includes('landscape'));
  const second = await build('two');
  assert.equal(second.library.graphicsReused, 1, 'the identical graphic came from the library');
  assert.equal(second.library.graphicsAdded, 0);
  assert.equal((await Library.open()).get(hit[0].id).project, 'Library reuse');
});
