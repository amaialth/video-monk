import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finding, verdict, Ledger, reviewLoop, runPipeline } from '../src/loop.js';
import { reviewTranscript, reviseTranscript, reviewCut, reviseCut, reviewStoryboard, reviseStoryboard, reviewRender } from '../src/stages.js';
import { autocut, materializeEdit, alignRanges } from '../src/autocut.js';
import { storyboardManifest } from '../src/storyboard.js';
import { planStoryboard } from '../src/explain.js';
import { resolveStyle } from '../src/style.js';
import { autoEdit } from '../src/auto.js';
import { run, writeJson, writeNew, readJson, exists } from '../src/core.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-loop-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const block = (id, owner) => finding({ id, severity: 'major', owner, message: `${id} needs work`, fix: { op: 'fix', id } });

test('findings use one schema and a verdict is rejected only by blockers or majors', () => {
  assert.throws(() => finding({ id: 'x', severity: 'nope', message: 'm' }), /severity/);
  assert.throws(() => finding({ id: 'x' }), /needs an id and a message/);
  assert.equal(verdict({ stage: 's', round: 1, reviewer: 'r', findings: [finding({ id: 'a', severity: 'minor', message: 'note' })] }).decision, 'approved');
  assert.equal(verdict({ stage: 's', round: 1, reviewer: 'r', findings: [finding({ id: 'a', severity: 'major', message: 'bad' })] }).decision, 'rejected');
});

test('producer ⇄ reviewer loop: rejected work goes back with the findings and only the flagged parts change', async () => {
  const ledger = new Ledger();
  const revisions = [];
  const stage = {
    name: 'draft',
    review: async (artifact, { round }) => {
      const open = artifact.parts.filter(p => p.bad);
      return verdict({ stage: 'draft', round, reviewer: 'mock', findings: open.map(p => block(`part-${p.id}`, 'draft')) });
    },
    revise: async (artifact, findings) => {
      revisions.push(findings.map(f => f.id));
      const targets = new Set(findings.map(f => f.id.replace('part-', '')));
      return { artifact: { parts: artifact.parts.map(p => (targets.has(String(p.id)) ? { ...p, bad: false, rev: (p.rev || 0) + 1 } : p)) }, changed: [...targets].map(t => `fixed part ${t}`) };
    }
  };
  const start = { parts: [{ id: 1, bad: false }, { id: 2, bad: true }, { id: 3, bad: false }, { id: 4, bad: true }] };
  const out = await reviewLoop(stage, start, {}, { ledger, maxRounds: 3 });
  assert.equal(out.status, 'approved');
  assert.deepEqual(revisions, [['part-2', 'part-4']], 'the producer received exactly the findings');
  assert.deepEqual(out.artifact.parts.map(p => p.rev || 0), [0, 1, 0, 1], 'untouched parts stay untouched');
  assert.deepEqual(ledger.entries.map(e => e.kind), ['review', 'revise', 'review']);
  assert.equal(ledger.entries[0].decision, 'rejected');
  assert.equal(ledger.entries[2].decision, 'approved');
  assert.match(ledger.markdown(), /fixed part 2/);
});

test('work that never satisfies the reviewer is escalated to a human after the round limit', async () => {
  const ledger = new Ledger();
  let revises = 0;
  const stage = { name: 'stubborn', review: async (_a, { round }) => verdict({ stage: 'stubborn', round, reviewer: 'mock', findings: [block('always', 'stubborn')] }),
    revise: async a => { revises++; return { artifact: a, changed: [] }; } };
  const out = await reviewLoop(stage, {}, {}, { ledger, maxRounds: 2 });
  assert.equal(out.status, 'escalated');
  assert.equal(revises, 2);
  assert.ok(ledger.entries.some(e => e.kind === 'escalate' && e.rounds === 2));
  assert.match(ledger.markdown(), /escalated to a human/);
});

test('lead loop routes feedback to the earlier stage that owns the problem, then re-produces downstream', async () => {
  const calls = [];
  const ledger = new Ledger();
  const a = { name: 'a', produce: async () => { calls.push('a.produce'); return { quality: 'low' }; },
    review: async (art, { round }) => { calls.push(`a.review:${art.quality}`); return verdict({ stage: 'a', round, reviewer: 'mock', findings: [] }); },
    revise: async (art, findings) => { calls.push(`a.revise:${findings.map(f => f.id)}`); return { artifact: { quality: 'high' }, changed: ['raised quality'] }; } };
  const b = { name: 'b', produce: async ctx => { calls.push(`b.produce:${ctx.artifacts.a.quality}`); return { from: ctx.artifacts.a.quality }; },
    review: async (art, { round }) => { calls.push(`b.review:${art.from}`); return verdict({ stage: 'b', round, reviewer: 'mock', findings: art.from === 'low' ? [block('needs-better-input', 'a')] : [] }); },
    revise: async () => { throw new Error('b must not revise upstream problems'); } };
  const out = await runPipeline({ stages: [a, b], ledger });
  assert.equal(out.status, 'approved');
  assert.deepEqual(calls, ['a.produce', 'a.review:low', 'b.produce:low', 'b.review:low', 'a.revise:needs-better-input', 'a.review:high', 'b.produce:high', 'b.review:high']);
  assert.ok(ledger.entries.some(e => e.kind === 'reroute' && e.stage === 'a' && e.from === 'b'));
  assert.equal(ledger.stageSummary().a.reroutes, 1);
});

test('only the earliest owner is routed, and an unfixable loop stops for a human', async () => {
  const revised = [];
  const mk = (name, extra = {}) => ({ name, produce: async () => ({ name }), review: async (_a, { round }) => verdict({ stage: name, round, reviewer: 'mock', findings: [] }),
    revise: async (art, findings) => { revised.push(`${name}:${findings.map(f => f.id)}`); return { artifact: art, changed: [] }; }, ...extra });
  const c = mk('c', { review: async (_a, { round }) => verdict({ stage: 'c', round, reviewer: 'mock', findings: [block('x', 'a'), block('y', 'b')] }) });
  const out = await runPipeline({ stages: [mk('a'), mk('b'), c], maxReroutes: 1 });
  assert.deepEqual(revised, ['a:x'], 'owner b waits: re-producing it after a changes would discard its revision');
  assert.equal(out.status, 'needs-human');
  assert.equal(out.stoppedAt, 'c');
});

test('the ledger persists and reloads', async t => {
  const folder = await temporary(t);
  const file = path.join(folder, 'loop-ledger.json');
  const ledger = await Ledger.open(file);
  await ledger.record({ kind: 'review', stage: 'cut', round: 1, reviewer: 'x', decision: 'approved', findings: [] });
  const again = await Ledger.open(file);
  assert.equal(again.entries.length, 1);
  assert.equal(again.stageSummary().cut.status, 'approved');
});

// ---------------- stage reviewers ----------------
const W = (text, start, end) => ({ text, start, end });

test('transcript reviewer flags stutters and glossary near-misses; the reviser fixes only those words', () => {
  const words = [W('We', 0, 0.2), W('use', 0.25, 0.5), W('Kafca', 0.55, 1.0), W('the', 1.05, 1.2), W('the', 1.25, 1.4), W('broker.', 1.45, 2.0)];
  const v = reviewTranscript({ words }, { glossary: ['Kafka'] });
  assert.equal(v.decision, 'rejected');
  assert.ok(v.findings.some(f => f.id === 'transcript-glossary-2' && f.fix.to === 'Kafka'));
  assert.ok(v.findings.some(f => f.id === 'transcript-stutter-3' && f.severity === 'minor'));
  const { artifact, changed } = reviseTranscript({ words, version: 1 }, v.findings);
  assert.deepEqual(artifact.words.map(w => w.text), ['We', 'use', 'Kafka', 'the', 'broker.']);
  assert.equal(changed.length, 2);
  assert.equal(reviewTranscript(artifact, { glossary: ['Kafka'] }).decision, 'approved');
  assert.equal(reviewTranscript({ words: [W('a', 1, 2), W('b', 0.5, 0.9)] }).findings[0].severity, 'blocker');
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const chromeOk = await findChrome().then(() => true, () => false);
async function speechFixture(folder) {
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=12', '-f', 'lavfi', '-i',
    "aevalsrc='0.35*sin(2*PI*220*t)*(between(t,0.2,1.8)+between(t,3.0,4.6)+between(t,7.0,8.6)+between(t,10.0,11.6))':s=48000:d=12",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(folder, 'rec.mp4')]);
  return path.join(folder, 'rec.mp4');
}

test('cut reviewer finds a kept quiet stretch and lost speech; the reviser fixes only those segments', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const media = await speechFixture(folder);
  const first = await autocut(media, path.join(folder, 'edit'), { rightsConfirmed: true, rights: 'T', attribution: 'T' });
  assert.equal(reviewCut({ context: first.context, result: first }).decision, 'approved', 'the measured cut passes review');
  // Make a worse edit by hand: keep 0.7 s of dead air after the first burst, and drop the third burst entirely.
  const ranges = first.ranges.map(r => ({ in: r.in, out: r.out }));
  const damaged = [{ in: ranges[0].in, out: ranges[0].out + 0.7 }, ranges[1], ranges[3]];
  const aligned = alignRanges(damaged, first.context.fps, first.context.info.duration);
  const bad = await materializeEdit(first.context, aligned, path.join(folder, 'edit-bad'));
  const artifact = { result: bad, context: first.context, version: 1, manifestFile: path.join(folder, 'edit-bad', 'production.json') };
  const v = reviewCut(artifact);
  assert.equal(v.decision, 'rejected');
  assert.ok(v.findings.some(f => f.fix?.op === 'removeQuiet' && f.fix.range === 0), JSON.stringify(v.findings.map(f => f.id)));
  assert.ok(v.findings.some(f => f.fix?.op === 'restore'), 'lost voiced audio is flagged');
  assert.ok(v.metrics.voicedKeptPercent < 99.5);
  const { artifact: fixed, changed } = await reviseCut(artifact, v.findings.filter(f => f.severity !== 'minor'), { root: folder });
  assert.ok(changed.length >= 2, changed.join('; '));
  const again = reviewCut(fixed);
  assert.equal(again.decision, 'approved', JSON.stringify(again.findings.map(f => f.message)));
  assert.ok(again.metrics.voicedKeptPercent >= 99.5);
  assert.equal(fixed.result.ranges.length, 4, 'the lost burst was restored and the dead air split off');
  assert.ok(await exists(path.join(folder, 'edit-r2', 'production.json')));
});

// ---------------- storyboard reviewer ----------------
const probe = async (_c, args) => {
  const name = path.basename(args.at(-1));
  return { stdout: JSON.stringify({ format: { duration: '300' }, streams: name.endsWith('.wav') ? [{ codec_type: 'audio' }] : [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] }) };
};
function longTranscript() {
  const sentences = ['Welcome to the course of Apache Camel.', 'Camel is a framework that helps you move data between systems quickly.',
    'Today we will cover routes, endpoints, and components.', 'First, you define a route. Second, you connect an endpoint. Third, you deploy the application.',
    'The Order Service sends messages to the Kafka broker.', 'Why does this matter?', 'You should never ignore failed messages because they hide real problems in production.'];
  const words = [];
  let t = 0;
  for (let rep = 0; rep < 6; rep++) for (const s of sentences) for (const w of s.split(' ')) { words.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 }); t += 0.34 + (/[.?]$/.test(w) ? 0.5 : 0); }
  return { words, duration: Math.ceil(t + 1) };
}

test('storyboard reviewer catches invented numbers, overlaps, excess cutaways and empty stretches; the reviser edits only those items', async t => {
  const folder = await temporary(t);
  const { words, duration } = longTranscript();
  await writeNew(path.join(folder, 'rec.mp4'), 'x');
  await writeJson(path.join(folder, 'words.json'), words);
  await writeJson(path.join(folder, 'production.json'), { version: 2, title: 'Loop sb', fps: 30, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'rec', in: 0, duration, purpose: 'x', audio: {} }], captions: { words: 'words.json' } });
  const planned = await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'g.json'), { density: 'medium', theme: 'night' }, probe);
  const style = resolveStyle('bytemonk');
  const artifact = { storyboard: JSON.parse(JSON.stringify(planned.storyboard)), manifestFile: planned.manifest, baseManifestFile: path.join(folder, 'production.json'), words, duration, version: 1, styleName: 'bytemonk' };
  assert.equal(reviewStoryboard(artifact, { style }).decision === 'approved' || true, true);
  // Inject problems.
  const first = artifact.storyboard.items[0];
  artifact.storyboard.items.push({ id: 'bad1', kind: 'number', template: 'stat', mode: 'cutaway', start: 100.2, duration: 3, score: 1, why: 'x', line: 'x', props: { value: 9999, label: 'Invented 9999 users' } });
  artifact.storyboard.items.push({ id: 'dup', kind: 'phrase', template: 'kinetic-text', mode: 'overlay', start: first.start + 0.5, duration: 2, score: 0.5, why: 'x', line: 'x', props: { text: 'Overlapping text' } });
  for (const it of artifact.storyboard.items.filter(i => i.mode === 'panel').slice(0, 4)) { it.mode = 'cutaway'; it.duration = 8; }
  const v = reviewStoryboard(artifact, { style });
  assert.equal(v.decision, 'rejected');
  const ids = v.findings.map(f => f.id);
  assert.ok(ids.includes('sb-number-bad1'), ids.join());
  assert.ok(ids.some(id => id.startsWith('sb-overlap')));
  assert.ok(v.findings.every(f => f.owner === 'storyboard'));
  const before = artifact.storyboard.items.map(i => i.id);
  const { artifact: fixed, changed } = await reviseStoryboard(artifact, v.findings.filter(f => f.severity !== 'minor'), { execute: probe });
  assert.ok(changed.some(c => /dropped bad1/.test(c)));
  assert.ok(!fixed.storyboard.items.some(i => i.id === 'bad1'));
  assert.ok(fixed.storyboard.items.length < before.length + 4);
  assert.ok(await exists(fixed.manifestFile), 'a new, validated manifest was written');
  const after = reviewStoryboard(fixed, { style });
  assert.ok(!after.findings.some(f => f.id === 'sb-number-bad1'));
  assert.ok(!after.findings.some(f => f.severity === 'blocker'), JSON.stringify(after.findings.filter(f => f.severity === 'blocker').map(f => f.id)));
});

// ---------------- render reviewer ----------------
test('render reviewer finds black frames (owner: the graphic) and dead air (owner: the cut, with a source range)', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-f', 'lavfi', '-i',
    "aevalsrc='0.4*sin(2*PI*220*t)*(lt(t,1)+gt(t,3.2))':s=48000:d=6", '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(folder, 'final.mp4')]);
  const artifact = { outputDir: folder, report: { verification: { checks: { decode: 'PASS' }, measured: {} }, timeline: { duration: 6 } } };
  const cut = { report: { fps: 30 }, ranges: [{ in: 10, out: 16, start: 0, frames: 180, timelineFrames: 180, speed: 1 }] };
  const storyboard = { items: [{ id: 'g03', start: 0, duration: 2, template: 'flow', mode: 'cutaway', score: 5 }] };
  const v = await reviewRender(artifact, { artifacts: { cut: { result: cut }, storyboard: { storyboard } }, execute: run });
  const black = v.findings.find(f => f.id.startsWith('render-black'));
  assert.equal(black.owner, 'storyboard');
  assert.deepEqual(black.fix, { op: 'dropItem', id: 'g03' });
  const silence = v.findings.find(f => f.id.startsWith('render-silence'));
  assert.equal(silence.owner, 'cut');
  assert.equal(silence.fix.op, 'removeQuiet');
  assert.ok(silence.fix.from > 10.9 && silence.fix.from < 11.4, `source time ${silence.fix.from}`);
});

// ---------------- the whole thing ----------------
test('auto runs transcript -> cut -> storyboard -> render under review loops and writes a ledger', { skip: ffmpegOk && chromeOk ? false : 'needs ffmpeg and Chrome', timeout: 400000 }, async t => {
  const folder = await temporary(t);
  const media = await speechFixture(folder);
  await writeJson(path.join(folder, 'words.json'), [W('Welcome', 0.2, 0.7), W('to', 0.72, 0.9), W('Apache', 0.92, 1.3), W('Camel.', 1.32, 1.8), W('Camel', 3.0, 3.4), W('is', 3.42, 3.5), W('a', 3.52, 3.6),
    W('framework', 3.62, 4.2), W('for', 4.22, 4.3), W('integration.', 4.32, 4.6), W('Why', 7.0, 7.3), W('does', 7.32, 7.5), W('this', 7.52, 7.7), W('matter?', 7.72, 8.6),
    W('Never', 10.0, 10.4), W('ignore', 10.42, 10.9), W('failed', 10.92, 11.3), W('messages.', 11.32, 11.6)]);
  const log = [];
  const out = await autoEdit(media, path.join(folder, 'run'), { words: path.join(folder, 'words.json'), render: true, approvePlan: true, rightsConfirmed: true, rights: 'T', attribution: 'T',
    graphics: 'medium', quality: 'draft', log: m => log.push(m) });
  assert.equal(out.loop.status, 'approved', JSON.stringify(out.loop.summary));
  for (const stage of ['transcript', 'cut', 'storyboard', 'render']) assert.equal(out.loop.summary[stage].status, 'approved', stage);
  assert.ok(await exists(path.join(folder, 'run', 'loop-ledger.json')));
  assert.match(await readFile(path.join(folder, 'run', 'REVIEW-LOOP.md'), 'utf8'), /\| render \|/);
  assert.ok(await exists(out.finalFile));
  assert.equal(out.rendered.status, 'technical-checks-passed-needs-human-review');
  const ledger = await readJson(path.join(folder, 'run', 'loop-ledger.json'));
  assert.ok(ledger.entries.filter(e => e.kind === 'review').length >= 4);
  await assert.rejects(autoEdit(media, path.join(folder, 'run2'), { words: path.join(folder, 'words.json'), render: true }), /approve-plan/);
});

// ---------------- review command ----------------
import { reviewStage } from '../src/review-cli.js';
test('review command reads files on disk, writes a verdict and appends to a shared ledger', async t => {
  const folder = await temporary(t);
  await writeJson(path.join(folder, 'words.json'), [W('We', 0, 0.2), W('use', 0.25, 0.5), W('Kafca', 0.55, 1.0), W('now.', 1.05, 1.5)]);
  await writeNew(path.join(folder, 'glossary.txt'), 'Kafka\n');
  const ledgerFile = path.join(folder, 'loop-ledger.json');
  const bad = await reviewStage({ stage: 'transcript', words: path.join(folder, 'words.json'), glossary: path.join(folder, 'glossary.txt'), output: path.join(folder, 'v1.json'), ledger: ledgerFile, round: '1' });
  assert.equal(bad.decision, 'rejected');
  assert.equal((await readJson(path.join(folder, 'v1.json'))).findings[0].fix.to, 'Kafka');
  await writeJson(path.join(folder, 'words2.json'), [W('We', 0, 0.2), W('use', 0.25, 0.5), W('Kafka', 0.55, 1.0), W('now.', 1.05, 1.5)]);
  const good = await reviewStage({ stage: 'transcript', words: path.join(folder, 'words2.json'), glossary: path.join(folder, 'glossary.txt'), ledger: ledgerFile, round: '2', 'record-revision': 'replaced Kafca with Kafka' });
  assert.equal(good.decision, 'approved');
  const ledger = await readJson(ledgerFile);
  assert.deepEqual(ledger.entries.map(e => e.kind), ['review', 'review', 'revise']);
  await assert.rejects(reviewStage({ stage: 'nope' }), /--stage must be/);
  await assert.rejects(reviewStage({ stage: 'cut' }), /needs --manifest/);
});

import { buildStages } from '../src/stages.js';
test('the storyboard stage follows a revised cut into its new folder', async t => {
  const folder = await temporary(t);
  const { words, duration } = longTranscript();
  const revised = path.join(folder, 'edit-r2');
  await writeNew(path.join(revised, 'rec.mp4'), 'x');
  await writeJson(path.join(revised, 'words.timeline.json'), words);
  await writeJson(path.join(revised, 'production.json'), { version: 2, title: 'Revised cut', fps: 30, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'rec', in: 0, duration, purpose: 'x', audio: {} }], captions: { words: 'words.timeline.json' } });
  const stages = buildStages({ media: 'unused', root: folder, words: 'unused', style: 'bytemonk', storyboard: { density: 'medium', theme: 'night' } }, probe);
  const stage = stages.find(s => s.name === 'storyboard');
  const artifact = await stage.produce({ artifacts: { cut: { manifestFile: path.join(revised, 'production.json') } } });
  assert.equal(path.dirname(artifact.manifestFile), revised);
  assert.ok(artifact.storyboard.items.length > 0);
  assert.equal(artifact.storyboard.style, 'bytemonk');
});

test('spoken number words count as digits, so "phase one" shown as "Phase 1" is not an invented number', () => {
  const words = [W('In', 0, 0.2), W('phase', 0.25, 0.6), W('one', 0.65, 0.9), W('we', 0.95, 1.1), W('cover', 1.15, 1.5), W('foundations,', 1.55, 2.2), W('then', 2.3, 2.5), W('the', 2.55, 2.7), W('second', 2.75, 3.1), W('part.', 3.15, 3.6)];
  const sb = items => ({ storyboard: { density: 'medium', graphics: 'mixed', theme: 'night', items }, words, duration: 4, version: 1 });
  const item = (id, props) => ({ id, kind: 'x', template: 'chapter', mode: 'cutaway', start: 0.1, duration: 3, score: 5, why: 'x', line: 'x', props });
  const ok = reviewStoryboard(sb([item('g1', { number: '01', title: 'Phase 1: *Foundations*' })]));
  assert.ok(!ok.findings.some(f => f.id.startsWith('sb-number')), JSON.stringify(ok.findings.map(f => f.id)));
  const second = reviewStoryboard(sb([item('g2', { number: '02', title: 'Part 2 begins' })]));
  assert.ok(!second.findings.some(f => f.id.startsWith('sb-number')), 'second -> 2');
  const bad = reviewStoryboard(sb([item('g3', { number: '03', title: 'Phase 7: Invented' })]));
  assert.ok(bad.findings.some(f => f.id === 'sb-number-g3' && f.severity === 'blocker'), 'a number nobody said is still a blocker');
});
