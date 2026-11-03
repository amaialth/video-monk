import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson } from '../src/core.js';
import { concreteTerms, queryFor, planBroll, visualGaps, brollPlanMarkdown } from '../src/broll-plan.js';
import { chooseCandidate, fetchPlan, applyPlacements } from '../src/broll.js';
import { repeatsCaptions, finalizeStoryboard, planStoryboard } from '../src/explain.js';
import { reviewStoryboard } from '../src/stages.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-brollplan-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

// 90 s talking head: sentences of ~4 s. Concrete subjects at ~10 s (data center), ~40 s (warehouse), ~70 s (container ships).
function script() {
  const lines = Array.from({ length: 22 }, (_, i) => `Point number ${i} is about ideas and trade-offs here.`);
  lines[2] = 'Every request ends up in a huge data center somewhere.';
  lines[10] = 'Think of a busy warehouse shipping parcels all day.';
  lines[17] = 'Modern container ships carry almost everything we buy.';
  const words = [];
  lines.forEach((line, i) => line.split(' ').forEach((text, k, all) => words.push({ text, start: round(i * 4 + (k * 3.4) / all.length), end: round(i * 4 + (k * 3.4) / all.length + 0.3) })));
  return words;
}
const round = n => Math.round(n * 1000) / 1000;
const manifest = (extra = {}) => ({ version: 2, title: 'T', fps: 24, width: 1920, height: 1080, assets: [], scenes: [{ kind: 'color', color: '#000000', duration: 88, purpose: 'x' }], ...extra });

test('concrete subjects and draft queries come from the spoken line', () => {
  assert.deepEqual(concreteTerms('It lives in a huge data center.').map(f => f.term), ['data center']);
  assert.equal(queryFor('a busy warehouse shipping parcels', concreteTerms('a busy warehouse shipping parcels')), 'busy warehouse');
  assert.equal(concreteTerms('We discuss trade-offs and ideas.').length, 0);
});

test('B-roll is planned where something concrete is named and no graphic is on screen, and not in the hook or over graphics', () => {
  const words = script();
  const m = manifest({ globalOverlays: [{ template: 'bullets', props: {}, start: 38, duration: 6, placement: 'left' }, { template: 'flow', props: {}, start: 66, duration: 8, background: 'grid', placement: 'full' }] });
  const plan = planBroll(m, words, { density: 'medium' });
  assert.ok(plan.moments.length >= 1);
  assert.ok(plan.moments.every(x => x.at >= 5), 'never in the opening seconds');
  assert.ok(plan.moments.some(x => /data center/.test(x.query)), JSON.stringify(plan.moments.map(x => x.query)));
  for (const x of plan.moments) for (const [a, b] of [[38, 44], [66, 74]]) assert.ok(x.at + x.duration <= a || x.at >= b, `${x.id} at ${x.at} overlaps a graphic`);
  assert.ok(plan.stats.perMinute <= 3);
  assert.match(brollPlanMarkdown(plan), /\| b01 \|/);
});

test('long speaker-only stretches get a low-confidence B-roll proposal; screen and interview footage stay sparse; off means none', () => {
  const words = Array.from({ length: 80 }, (_, i) => ({ text: i % 9 === 8 ? 'done.' : 'alpha', start: i * 1.1, end: i * 1.1 + 0.3 }));
  const m = manifest();
  assert.ok(visualGaps(m, 88, 25).length >= 1);
  const plan = planBroll(m, words, { density: 'medium' });
  assert.ok(plan.moments.some(x => x.kind === 'gap' && x.confidence === 'low'));
  assert.ok(plan.stats.gapsAfter < plan.stats.gapsBefore);
  assert.equal(planBroll(m, words, { content: 'screen' }).density, 'light');
  assert.equal(planBroll(m, words, { density: 'off' }).moments.length, 0);
  assert.throws(() => planBroll(m, words, { density: 'lots' }), /density must be/);
});

test('captions already on screen make a top-bar pull-text strip unnecessary; it is not planned and the reviewer flags any that remain', () => {
  const words = 'So the cache stores recent results close to the user and that is the whole trick.'.split(' ').map((text, i) => ({ text, start: 3 + i * 0.4, end: 3.3 + i * 0.4 }));
  const strip = { template: 'kinetic-text', mode: 'overlay', start: 3.5, duration: 2.5, props: { text: 'the *cache* stores recent results' } };
  assert.equal(repeatsCaptions(strip, words), true);
  assert.equal(repeatsCaptions({ ...strip, props: { text: 'Latency drops *sharply*' } }, words), false, 'a different key phrase is kept');
  assert.equal(repeatsCaptions({ ...strip, mode: 'cutaway' }, words), false, 'only the top bar is judged');
  const built = [{ kind: 'phrase', mode: 'overlay', start: 3.5, duration: 2.5, score: 5, template: 'kinetic-text', props: strip.props, why: 'x', line: 'x' }];
  const on = finalizeStoryboard(built, { words, duration: 20, captionsOn: true });
  assert.equal(on.items.length, 0); assert.match(on.notes.join(' '), /already show the same words/);
  assert.equal(finalizeStoryboard(built, { words, duration: 20, captionsOn: false }).items.length, 1, 'with captions off the strip is the only text and stays');
  const sb = finalizeStoryboard(built, { words, duration: 20, captionsOn: false });
  const verdict = reviewStoryboard({ storyboard: sb, words, duration: 20, captionsOn: true });
  assert.ok(verdict.findings.some(f => f.id.startsWith('sb-caption-duplicate') && f.fix.op === 'dropItem'));
  assert.ok(!reviewStoryboard({ storyboard: sb, words, duration: 20, captionsOn: false }).findings.some(f => f.id.startsWith('sb-caption-duplicate')));
});

test('candidate choice prefers clips that are long enough, wide enough, on-topic and small', () => {
  const file = (id, width, bytes) => ({ id, width, height: Math.round(width * 9 / 16), bytes, url: `https://cdn.pixabay.com/${id}.mp4` });
  const cands = [{ id: '1', duration: 3, tags: 'data center', files: [file('medium', 1920, 1e7)] }, { id: '2', duration: 10, tags: 'office', files: [file('medium', 1920, 1e7)] },
    { id: '3', duration: 10, tags: 'data center, server', files: [file('small', 960, 2e6), file('medium', 1920, 2e7), file('large', 3840, 9e7)] }];
  const pick = chooseCandidate(cands, { needSeconds: 5, targetWidth: 1920, query: 'data center' });
  assert.equal(pick.candidate.id, '3'); assert.equal(pick.file.id, 'medium', 'smallest file that is wide enough');
  assert.equal(chooseCandidate([cands[0]], { needSeconds: 5, targetWidth: 1920, query: 'x' }), null, 'too short');
});

test('executing a plan: search, choose, download, preview, then apply the placements that were not dropped', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 200000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'color=c=0x2244aa:s=320x180:d=8:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'clip.mp4')]);
  const clip = await readFile(path.join(folder, 'clip.mp4'));
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=30:r=24', '-f', 'lavfi', '-i', 'sine=f=220:d=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(folder, 'rec.mp4')]);
  const hit = id => ({ id, pageURL: `https://pixabay.com/videos/id-${id}/`, tags: 'data center, server', duration: 8, user: 'Maker', user_id: 1, isAiGenerated: false, isLowQuality: false,
    videos: { medium: { url: `https://cdn.pixabay.com/video/${id}.mp4`, width: 1920, height: 1080, size: 1e6 }, small: { url: `https://cdn.pixabay.com/video/${id}s.mp4`, width: 1280, height: 720, size: 5e5 } } });
  const fetcher = async url => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/api/')) {
      const empty = u.searchParams.get('q') === 'nothing here';
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ hits: empty ? [] : [hit(11)] }) };
    }
    return { ok: true, status: 200, url: String(url), headers: { get: h => (h === 'content-type' ? 'video/mp4' : null) }, body: { async *[Symbol.asyncIterator]() { yield clip; } } };
  };
  const plan = { moments: [{ id: 'b01', at: 5, duration: 4, query: 'data center', alternatives: [] }, { id: 'b02', at: 15, duration: 4, query: 'nothing here', alternatives: [] }] };
  const m = { version: 2, title: 'F', fps: 24, width: 320, height: 180, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [0, 10, 20].map(i => ({ kind: 'video', asset: 'rec', in: i, duration: 10, audio: {}, purpose: `s${i}` })) };
  await writeJson(path.join(folder, 'm.json'), m);
  const dir = path.join(folder, 'broll');
  const got = await fetchPlan(plan, { dir, manifest: m, search: true, download: { allowDownload: true, rightsConfirmed: true }, fetcher, provider: 'pixabay' });
  assert.deepEqual(got.placements.map(p => p.status), ['downloaded', 'no-result']);
  assert.ok(got.placements[0].preview, 'a preview frame is written so the clip can be looked at');
  const applied = await applyPlacements(path.join(folder, 'm.json'), path.join(folder, 'm.broll.json'), got.file);
  assert.equal(applied.placed, 1);
  const out = await readJson(path.join(folder, 'm.broll.json'));
  assert.equal(out.scenes[0].broll[0].start, 5); assert.equal(out.scenes[0].broll[0].duration, 4);
  // a dropped placement is not applied
  const edited = await readJson(got.file); edited.placements[0].drop = true; await (await import('node:fs/promises')).writeFile(got.file, JSON.stringify(edited));
  await assert.rejects(applyPlacements(path.join(folder, 'm.json'), path.join(folder, 'm.none.json'), got.file), /no placement could be applied/);
});

test('with captions burned in, a planned storyboard has no top-bar strip repeating the spoken words; with captions off strips remain', () => {
  const words = 'What is caching. Caching keeps a copy of data close to the user. This makes every later request faster. Why does that matter. Because latency is what users feel most.'.split(' ').map((text, i) => ({ text, start: 2 + i * 0.4, end: 2.3 + i * 0.4 }));
  const duration = Math.ceil(words.at(-1).end + 1);
  const withCaptions = planStoryboard(words, { duration, density: 'heavy', captionsOn: true });
  const without = planStoryboard(words, { duration, density: 'heavy', captionsOn: false });
  assert.ok(!withCaptions.items.some(i => repeatsCaptions(i, words)), 'nothing repeats the captions');
  assert.ok(without.items.filter(i => i.template === 'kinetic-text' && i.mode === 'overlay').length >= withCaptions.items.filter(i => i.template === 'kinetic-text' && i.mode === 'overlay').length);
});
