// One-shot automated pipeline: inspect -> transcribe -> autocut -> review -> render.
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { exists, run, writeJson, freshDir } from './core.js';
import { analyzeFootage, autocut } from './autocut.js';
import { transcribeWhisper, findWhisper, findModel } from './transcribe.js';
import { reviewProduction, buildProduction } from './production.js';
import { storyboardManifest } from './storyboard.js';
import { Ledger, runPipeline } from './loop.js';
import { buildStages } from './stages.js';
import { buildShort } from './deliverables.js';

async function legacyAutoEdit(media, output, options = {}, execute = run) {
  const log = options.log || (() => {});
  if (await exists(output)) throw new Error(`Auto: output already exists: ${output}`);
  await mkdir(output, { recursive: true });
  log('1/5 Inspecting footage...');
  const analysis = await analyzeFootage(media, execute);
  await writeJson(path.join(output, 'analysis.json'), analysis);

  let words = options.words ? path.resolve(options.words) : null;
  if (!words && options.transcribe) {
    log('2/5 Transcribing locally with whisper.cpp...');
    if (!(await findWhisper(execute)) || !(await findModel(options.model))) {
      throw new Error('Auto: --transcribe needs whisper.cpp and a model. Run `video-monk doctor` and `video-monk models --download base.en --allow-download`.');
    }
    await transcribeWhisper(media, path.join(output, 'transcript'), { allowTranscribe: true, model: options.model, language: options.language, prompt: options.asrPrompt }, execute);
    words = path.join(output, 'transcript', 'words.json');
  } else log(words ? '2/5 Using supplied word timestamps.' : '2/5 Skipping transcription (no captions; pass --transcribe for captions and filler removal).');

  log('3/5 Auto-cutting pauses and fillers...');
  const cut = await autocut(media, path.join(output, 'edit'), { ...options, words }, execute);
  log(`    ${cut.report.sourceDuration}s -> ${cut.report.editedDuration}s, ${cut.report.cuts} cuts, ${cut.report.fillersRemoved} fillers removed`);
  let manifest = path.join(output, 'edit', 'production.json');
  let storyboard = null;
  const density = options.graphics ?? 'medium';
  if (density !== 'off' && cut.words) {
    log(`    Planning explainer graphics (${density}, engine ${options.engine || 'rules'})...`);
    const planned = await storyboardManifest(manifest, path.join(output, 'edit', 'production.graphics.json'), {
      density: options.graphics === undefined ? undefined : density, variants: options.variants, broll: options.broll, brollDensity: options.brollDensity, content: options.content, allowSearch: options.allowSearch, allowDownload: options.allowDownload, rightsConfirmed: options.rightsConfirmed, sfx: options.sfx, sfxEngine: options.sfxEngine, allowMirelo: options.allowMirelo, mireloBudget: options.mireloBudget, log, graphicsMode: options.graphicsMode, theme: options.theme, style: options.style, engine: options.engine, allowLlm: options.allowLlm,
      presenter: options.presenter, role: options.role }, execute);
    manifest = planned.manifest;
    storyboard = planned.storyboard;
    log(`    ${storyboard.stats.graphics} graphics planned (${storyboard.stats.perMinute}/min); table: ${planned.table}`);
  } else if (density !== 'off') log('    Graphics need a transcript: pass --transcribe (or --words) to plan explainer graphics.');
  if (!options.render) {
    log('4/5 Skipped rendering (pass --allow-render --approve-plan to render).');
    return { analysis, cut, manifest, storyboard, rendered: null };
  }
  log('4/5 Reviewing plan...');
  const review = path.join(output, 'edit', 'review.json');
  await reviewProduction(manifest, review, options.approvePlan === true, execute);
  if (options.approvePlan !== true) throw new Error('Auto: rendering needs --approve-plan (you approve the automatic plan and asset rights).');
  log('5/5 Rendering...');
  const rendered = await buildProduction(manifest, review, path.join(output, 'render'), true, execute, undefined,
    { log, quality: options.quality, concurrency: options.concurrency });
  return { analysis, cut, manifest, storyboard, rendered };
}

// Staged pipeline with a review loop per stage: transcript -> cut -> storyboard -> render. Each stage's reviewer approves or sends
// findings back to the producer (or to the stage that owns the problem); every round is recorded in loop-ledger.json.
export async function autoEdit(media, output, options = {}, execute = run) {
  if (options.reviewLoop === false) return legacyAutoEdit(media, output, options, execute);
  const log = options.log || (() => {});
  // resume: { restored: { stage: artifact }, shortDone } continues in an existing output folder, skipping stages approved in an earlier run
  const resume = options.resume || null;
  if (!resume && await exists(output)) throw new Error(`Auto: output already exists: ${output}`);
  if (options.render && options.approvePlan !== true) throw new Error('Auto: rendering needs --approve-plan (you approve the automatic plan and asset rights).');
  await mkdir(output, { recursive: true });
  log('Inspecting footage...');
  const analysis = options.analysis || await analyzeFootage(media, execute);
  if (!(resume && await exists(path.join(output, 'analysis.json')))) await writeJson(path.join(output, 'analysis.json'), analysis);
  const density = options.graphics ?? undefined;
  const wantsGraphics = density !== 'off' && Boolean(options.words || options.transcribe);
  if (density !== 'off' && !wantsGraphics) log('Graphics need a transcript: pass --transcribe (or --words) to plan explainer graphics.');
  let stages = buildStages({
    media, root: output, words: options.words ? path.resolve(options.words) : null, transcribe: options.transcribe, model: options.model, language: options.language,
    asrPrompt: options.asrPrompt, cut: { ...options, words: undefined }, style: options.style, reviewAgent: options.reviewAgent, allowLlm: options.allowLlm,
    reviewModel: options.reviewModel, quality: options.quality, concurrency: options.concurrency, log, glossary: options.glossary,
    storyboard: { density, variants: options.variants, broll: options.broll, brollDensity: options.brollDensity, content: options.content, allowSearch: options.allowSearch, allowDownload: options.allowDownload, rightsConfirmed: options.rightsConfirmed, sfx: options.sfx, sfxEngine: options.sfxEngine, allowMirelo: options.allowMirelo, mireloBudget: options.mireloBudget, log, graphicsMode: options.graphicsMode, theme: options.theme, engine: options.engine, allowLlm: options.allowLlm, presenter: options.presenter, role: options.role }
  }, execute);
  if (!wantsGraphics) stages = stages.filter(s => s.name !== 'storyboard');
  if (!options.render) stages = stages.filter(s => s.name !== 'render');
  const ledger = await Ledger.open(path.join(output, 'loop-ledger.json'));
  if (options.onEvent) ledger.onRecord = entry => options.onEvent({ type: 'ledger', entry });
  const result = await runPipeline({ stages, ledger, maxRounds: options.maxRounds ?? 3, log, onEvent: options.onEvent, gate: options.gate, signal: options.signal, restored: resume?.restored || {}, ctx: { execute, root: output, agent: options.reviewAgent === 'claude' ? 'claude' : null } });
  await writeFile(path.join(output, 'REVIEW-LOOP.md'), ledger.markdown(`Review loop: ${path.basename(media)}`));
  const a = result.artifacts;
  const rendered = a.render?.report || null;
  const out = { analysis, loop: { status: result.status, stoppedAt: result.stoppedAt || null, summary: ledger.stageSummary() }, cut: a.cut?.result, manifest: (a.storyboard || a.cut)?.manifestFile,
    storyboard: a.storyboard?.storyboard || null, rendered, renderDir: a.render?.outputDir || null, finalFile: a.render ? path.join(a.render.outputDir, 'final.mp4') : null };
  // "Long-form plus a vertical short": the short is cut from the approved long edit, so it carries the same cuts, captions and graphics.
  if (options.deliverables === 'both' && out.manifest && result.status !== 'needs-human' && result.status !== 'cancelled' && rendered && rendered.status !== 'failed-technical-checks' && !resume?.shortDone) {
    log('Cutting the vertical short from the long edit...');
    out.short = await buildShort({ manifest: out.manifest, output: await freshDir(output, 'short'), options, execute, log });
  }
  return out;
}
