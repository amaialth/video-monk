// One-shot automated pipeline: inspect -> transcribe -> autocut -> review -> render.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { exists, run, writeJson } from './core.js';
import { analyzeFootage, autocut } from './autocut.js';
import { transcribeWhisper, findWhisper, findModel } from './transcribe.js';
import { reviewProduction, buildProduction } from './production.js';
import { storyboardManifest } from './storyboard.js';

export async function autoEdit(media, output, options = {}, execute = run) {
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
      density, graphicsMode: options.graphicsMode, theme: options.theme || 'auto', engine: options.engine, allowLlm: options.allowLlm,
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
