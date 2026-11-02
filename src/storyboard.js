// Storyboard command logic: plan graphics for a version-2 manifest and write a new manifest plus a reviewable table.
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { loadTimeline } from './timeline.js';
import { planStoryboard, applyStoryboard, storyboardMarkdown, pickTheme, DENSITY, GRAPHIC_MODES } from './explain.js';
import { planWithClaude } from './explain-llm.js';

const fail = message => { throw new Error(`Storyboard: ${message}`); };

export async function storyboardManifest(manifestFile, outputFile, options = {}, execute = run) {
  const manifestPath = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(manifestPath)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const stem = output.replace(/\.json$/i, '');
  for (const extra of [`${stem}.storyboard.json`, `${stem}.STORYBOARD.md`]) if (await exists(extra)) fail(`output already exists: ${extra}`);
  const density = options.density || 'medium';
  const graphics = options.graphicsMode || 'mixed';
  if (!DENSITY[density]) fail(`density must be ${Object.keys(DENSITY).join(', ')}`);
  if (!GRAPHIC_MODES.includes(graphics)) fail(`graphics mode must be ${GRAPHIC_MODES.join(', ')}`);
  const engine = options.engine || 'rules';
  if (!['rules', 'claude'].includes(engine)) fail('engine must be rules or claude');

  const loaded = await loadTimeline(manifestPath, execute);
  if (!loaded.words) fail('the manifest needs captions.words (a timeline-relative word file); run transcribe + autocut first');
  const base = await readJson(manifestPath);
  let theme = options.theme || base.theme?.preset || 'auto';
  if (theme === 'auto') {
    const video = [...loaded.assets.values()].find(a => a.kind === 'video');
    theme = video ? await pickTheme(video.path, execute) : 'night';
  }

  let storyboard;
  if (options.fromStoryboard) {
    storyboard = await readJson(path.resolve(options.fromStoryboard));
    if (options.theme) storyboard.theme = theme;
  } else if (engine === 'claude') {
    storyboard = await planWithClaude(loaded.words, { duration: loaded.duration, density, graphics, theme, presenter: options.presenter, role: options.role,
      model: options.model, allowLlm: options.allowLlm }, execute);
  } else {
    storyboard = planStoryboard(loaded.words, { duration: loaded.duration, density, graphics, theme, presenter: options.presenter, role: options.role });
  }
  const applied = applyStoryboard(base, storyboard);
  await writeJson(output, applied);
  try {
    await loadTimeline(output, execute);
  } catch (error) {
    await rm(output, { force: true });
    throw new Error(`Storyboard produced an invalid manifest (${error.message}); nothing was written`);
  }
  await writeJson(`${stem}.storyboard.json`, storyboard);
  await writeNew(`${stem}.STORYBOARD.md`, storyboardMarkdown(storyboard, `Storyboard: ${base.title}`));
  return { storyboard, manifest: output, storyboardFile: `${stem}.storyboard.json`, table: `${stem}.STORYBOARD.md` };
}
