// Storyboard command logic: plan graphics for a version-2 manifest and write a new manifest plus a reviewable table.
import path from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { loadTimeline } from './timeline.js';
import { planStoryboard, applyStoryboard, storyboardMarkdown, pickTheme, DENSITY, GRAPHIC_MODES } from './explain.js';
import { planWithClaude } from './explain-llm.js';
import { Library, textPreview } from './library.js';
import { resolveStyle } from './style.js';
import { createHash } from 'node:crypto';
import { applySfx, mireloSession } from './sfx.js';
import { planBroll, brollPlanMarkdown } from './broll-plan.js';
import { generateVariants, applyVariantChoices } from './variants.js';
import { fetchPlan, placeAll } from './broll.js';

const fail = message => { throw new Error(`Storyboard: ${message}`); };

export async function storyboardManifest(manifestFile, outputFile, options = {}, execute = run) {
  const manifestPath = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(manifestPath)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const stem = output.replace(/\.json$/i, '');
  for (const extra of [`${stem}.storyboard.json`, `${stem}.STORYBOARD.md`]) if (await exists(extra)) fail(`output already exists: ${extra}`);
  const style = resolveStyle(options.style || 'bytemonk');
  const density = options.density || style.density;
  const graphics = options.graphicsMode || style.graphicsMode;
  if (!DENSITY[density]) fail(`density must be ${Object.keys(DENSITY).join(', ')}`);
  if (!GRAPHIC_MODES.includes(graphics)) fail(`graphics mode must be ${GRAPHIC_MODES.join(', ')}`);
  const engine = options.engine || 'rules';
  if (!['rules', 'claude'].includes(engine)) fail('engine must be rules or claude');

  const library = await Library.open();
  let cacheNote = null;
  let claudeKey = null;
  const loaded = await loadTimeline(manifestPath, execute);
  if (!loaded.words) fail('the manifest needs captions.words (a timeline-relative word file); run transcribe + autocut first');
  const base = await readJson(manifestPath);
  const captionsOn = Boolean(base.captions) && base.captions.burnIn !== false;
  let theme = options.theme || base.theme?.preset || style.theme?.preset || 'auto';
  if (theme === 'auto') {
    const video = [...loaded.assets.values()].find(a => a.kind === 'video');
    theme = video ? await pickTheme(video.path, execute) : 'night';
  }

  let storyboard;
  if (options.fromStoryboard) {
    storyboard = await readJson(path.resolve(options.fromStoryboard));
    if (options.theme) storyboard.theme = theme;
  } else if (engine === 'claude') {
    // A paid model call is reused when the same transcript, settings and model come back.
    const key = createHash('sha256').update(JSON.stringify([loaded.words, density, graphics, theme, captionsOn, options.cta || '', options.model || '', options.presenter || '', options.role || '', style.name])).digest('hex').slice(0, 16);
    const cached = library?.get(`storyboard-claude-${key}`);
    if (cached) {
      storyboard = JSON.parse(await readFile(library.absolute(cached), 'utf8'));
      await library.touch(cached.id);
      cacheNote = `reused from the asset library (${cached.id})`;
    } else {
      storyboard = await planWithClaude(loaded.words, { duration: loaded.duration, density, graphics, theme, presenter: options.presenter, role: options.role, captionsOn, cta: options.cta,
        model: options.model, allowLlm: options.allowLlm, style }, execute);
      claudeKey = key;
    }
  } else {
    storyboard = planStoryboard(loaded.words, { duration: loaded.duration, density, graphics, theme, presenter: options.presenter, role: options.role, style, captionsOn, cta: options.cta });
  }
  // Multiple motion graphics: alternative designs per key moment, rendered, audited and chosen; a person can switch with "chosen".
  const variantCount = options.variants ? Number(options.variants) : 0;
  let variantStats = null;
  if (variantCount && !options.fromStoryboard) {
    if (engine !== 'claude') fail('--variants needs --engine claude --allow-llm (the alternatives are drafted by Claude)');
    const made = await generateVariants(storyboard, loaded.words, { count: variantCount, dir: `${stem}.variants`, execute, allowLlm: options.allowLlm, model: options.model, duration: loaded.duration, log: options.log });
    storyboard = made.storyboard;
    variantStats = storyboard.stats.variants;
  }
  storyboard = applyVariantChoices(storyboard);
  let applied = applyStoryboard(base, storyboard, style);
  let sfxEvents = [];
  let sfxWarnings = [];
  const sfxMode = options.sfx || 'off';
  if (!['off', 'subtle', 'full'].includes(sfxMode)) fail('sfx must be off, subtle or full');
  if (sfxMode !== 'off') {
    const engine = options.sfxEngine || 'synth';
    if (!['synth', 'mirelo'].includes(engine)) fail('sfx engine must be synth or mirelo');
    const session = engine === 'mirelo' ? await mireloSession({ allow: options.allowMirelo, budget: options.mireloBudget }) : null;
    const placed = await applySfx(applied, { engine, session, log: options.log, mode: sfxMode, dir: path.join(path.dirname(output), 'sfx'), relTo: path.dirname(output), library, execute, project: base.title });
    applied = placed.manifest; sfxEvents = placed.events; sfxWarnings = placed.warnings;
  }
  // B-roll: plan where it is needed (offline, always unless off); with fetch, also search, download and place it.
  const brollMode = options.broll ?? 'plan';
  if (!['off', 'plan', 'fetch'].includes(brollMode)) fail('broll must be off, plan or fetch');
  let broll = null;
  const brollWarnings = [];
  if (brollMode !== 'off') {
    const plan = planBroll(applied, loaded.words, { density: options.brollDensity, content: options.content });
    await writeJson(`${stem}.BROLL-PLAN.json`, plan);
    await writeNew(`${stem}.BROLL-PLAN.md`, brollPlanMarkdown(plan, `B-roll plan: ${base.title}`));
    broll = { ...plan.stats, density: plan.density, planFile: `${stem}.BROLL-PLAN.json`, placed: 0 };
    if (brollMode === 'fetch' && plan.moments.length) {
      try {
        if (!options.allowSearch || !options.allowDownload || !options.rightsConfirmed) throw new Error('fetching B-roll needs --allow-search, --allow-download and --rights-confirmed');
        const dir = path.join(path.dirname(output), 'broll');
        const fetched = await fetchPlan(plan, { dir, manifest: applied, search: true, download: { allowDownload: true, rightsConfirmed: true, library }, library, execute, provider: options.stockProvider || 'pixabay', type: options.brollType || 'any', max: options.brollMax ?? 6, log: options.log });
        const results = await placeAll(applied, path.dirname(output), JSON.parse(await readFile(fetched.file, 'utf8')), dir);
        broll.placed = results.filter(r => !r.skipped).length;
        brollWarnings.push(...results.filter(r => r.skipped).map(r => `B-roll ${r.id} skipped: ${r.skipped}`), ...results.flatMap(r => r.warnings || []));
      } catch (error) { brollWarnings.push(`B-roll was planned but not fetched: ${error.message}`); }
    }
  }
  await writeJson(output, applied);
  try {
    await loadTimeline(output, execute);
  } catch (error) {
    await rm(output, { force: true });
    throw new Error(`Storyboard produced an invalid manifest (${error.message}); nothing was written`);
  }
  await writeJson(`${stem}.storyboard.json`, storyboard);
  await writeNew(`${stem}.STORYBOARD.md`, storyboardMarkdown(storyboard, `Storyboard: ${base.title}`));
  if (library) {
    const id = claudeKey ? `storyboard-claude-${claudeKey}` : undefined;
    await library.add({ id, kind: 'storyboard', source: `${stem}.storyboard.json`, name: `${base.title} (${storyboard.engine})`, tags: ['storyboard', storyboard.engine, storyboard.theme, density],
      description: `${storyboard.items.length} graphics: ${Object.keys(storyboard.stats.byTemplate || {}).join(', ')}`,
      meta: { engine: storyboard.engine, text: storyboard.items.slice(0, 12).map(i => textPreview(i.props, 60)).join(' | '), items: storyboard.items.length, density }, createdBy: 'storyboard', project: base.title });
  }
  return { storyboard, manifest: output, storyboardFile: `${stem}.storyboard.json`, table: `${stem}.STORYBOARD.md`, cacheNote, sfx: sfxEvents, sfxWarnings, broll, brollWarnings, variants: variantStats };
}
