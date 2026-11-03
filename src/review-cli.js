// `video-monk review`: run one stage's deterministic reviewer on files on disk (used by reviewer subagents and by hand).
// Writes a verdict in the shared finding schema and optionally appends it, or a revision note, to a loop ledger.
import path from 'node:path';
import { parseGlossary } from './script.js';
import { exists, readJson, run, writeJson } from './core.js';
import { Ledger } from './loop.js';
import { reviewTranscript, reviewCut, reviewStoryboard, reviewRender } from './stages.js';
import { chooseNoiseDb, levelProfile } from './autocut.js';
import { loadTimeline } from './timeline.js';
import { resolveStyle } from './style.js';
import { readFile } from 'node:fs/promises';

const STAGES = ['transcript', 'cut', 'storyboard', 'render'];
const fail = message => { throw new Error(`Review: ${message}`); };

export async function reviewStage(opts, execute = run) {
  const stage = opts.stage;
  if (!STAGES.includes(stage)) fail(`--stage must be one of ${STAGES.join(', ')}`);
  const style = resolveStyle(opts.style || 'bytemonk');
  let result;
  if (stage === 'transcript') {
    if (!opts.words) fail('transcript review needs --words');
    const glossary = opts.glossary ? parseGlossary(await readFile(opts.glossary, 'utf8')) : [];
    result = reviewTranscript({ words: await readJson(opts.words) }, { glossary });
  } else if (stage === 'cut') {
    if (!opts.manifest || !opts.media) fail('cut review needs --manifest (the autocut/revised production.json) and --media (the source recording)');
    const loaded = await loadTimeline(path.resolve(opts.manifest), execute);
    const fps = loaded.manifest.fps;
    const placed = loaded.timeline.filter(t => t.scene.kind === 'video').map(t => {
      const speed = t.scene.speed ?? 1;
      return { in: t.scene.in ?? 0, out: (t.scene.in ?? 0) + t.scene.duration * speed, start: t.start, frames: Math.round(t.scene.duration * speed * fps), timelineFrames: t.frames, speed };
    });
    const levels = await levelProfile(opts.media, execute);
    const noise = chooseNoiseDb(levels);
    const words = opts.words ? await readJson(opts.words) : null;
    const editedDuration = placed.reduce((n, r) => n + r.timelineFrames / fps, 0);
    result = reviewCut({ context: { levels, noiseDb: noise.noiseDb, paceName: opts.pace || 'tight', words, options: {} }, result: { ranges: placed, report: { editedDuration, fps } } });
  } else if (stage === 'storyboard') {
    if (!opts.manifest || !opts.storyboard) fail('storyboard review needs --manifest (the graphics manifest) and --storyboard (its storyboard.json)');
    const loaded = await loadTimeline(path.resolve(opts.manifest), execute);
    if (!loaded.words) fail('the manifest has no captions.words, so graphics cannot be checked against the transcript');
    result = reviewStoryboard({ storyboard: await readJson(opts.storyboard), words: loaded.words, duration: loaded.duration }, { style });
  } else {
    if (!opts['render-dir']) fail('render review needs --render-dir (the production-build output folder)');
    const dir = path.resolve(opts['render-dir']);
    const reportFile = path.join(dir, 'report.json');
    if (!(await exists(reportFile))) fail(`no report.json in ${dir}`);
    const artifacts = {};
    if (opts.storyboard) artifacts.storyboard = { storyboard: await readJson(opts.storyboard) };
    const manifest = await readJson(path.join(dir, 'production.json'));
    result = await reviewRender({ outputDir: dir, report: await readJson(reportFile), manifestCaptions: Boolean(manifest.captions) }, { artifacts, execute });
  }
  result.round = opts.round ? Number(opts.round) : 1;
  if (opts.ledger) {
    const ledger = await Ledger.open(path.resolve(opts.ledger));
    await ledger.record({ kind: 'review', stage, round: result.round, reviewer: opts.reviewer || result.reviewer, decision: result.decision, metrics: result.metrics, findings: result.findings });
    if (opts['record-revision']) await ledger.record({ kind: 'revise', stage, round: result.round, reviser: opts.reviser || 'producer', changed: String(opts['record-revision']).split(';').map(s => s.trim()).filter(Boolean), addressed: [] });
  }
  if (opts.output) await writeJson(path.resolve(opts.output), result);
  return result;
}
