// Standalone motion videos from a brief: launch, explainer, chart, milestone, opener and promo pieces made only of graphic scenes
// (no recording underneath). The brief lists beats (what is said, which template shows it, its props, how long); this module checks the
// piece against its type's rules, writes a version-2 manifest of graphic scenes with transitions, music and subtle sound effects, and runs the
// facts-first check. It builds nothing and approves nothing: review the plan, then production-review and production-build as usual.
// Formats follow the launch / explainer / chart / milestone / opener / promo patterns of charlie947/motion-graphics-skills (MIT), rewritten here.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './core.js';
import { TEMPLATES, validateProps } from './motion/templates.js';
import { TRANSITIONS } from './timeline.js';
import { ASPECTS } from './cutdown.js';
import { checkFacts, readFacts, graphicTexts, numbersIn } from './facts.js';
import { applySfx } from './sfx.js';

// beats: [min, max]; seconds: the length the format is meant to have (outside it is a warning); hold: minimum seconds on the last beat.
export const TYPES = {
  launch: { beats: [4, 8], seconds: [30, 45], hold: 3, hook: 'the first beat states the promise in one line', about: 'a product or feature announcement: promise, proof, how it works, one number, name and call to action' },
  explainer: { beats: [6, 14], seconds: [30, 60], hold: 3, hook: 'the first beat is the question itself', about: 'a "why" explainer: one question, each beat answering the one before, a takeaway in five words or fewer last' },
  chart: { beats: [1, 3], seconds: [6, 12], hold: 3, hook: 'the chart is the first beat', about: 'one dataset that changes, with the headline value labelled and held' },
  milestone: { beats: [2, 4], seconds: [8, 15], hold: 3, hook: 'the first beat moves toward the number', about: 'a milestone: points pull into the real number, the label settles, hold' },
  opener: { beats: [1, 3], seconds: [8, 15], hold: 3, hook: 'the title lands in the last third', about: 'a short title opener: one world, one move, the title last' },
  promo: { beats: [3, 5], seconds: [12, 20], hold: 3, hook: 'the first beat is the single promise', about: 'a newsletter or episode promo: one promise, one proof, one ask' }
};
const NOT_BEATS = new Set(Object.entries(TEMPLATES).filter(([, d]) => d.internal || d.fullFrame).map(([n]) => n));
const CYCLE = ['fade', 'slideleft', 'fade', 'slideup'];
const fail = message => { throw new Error(`Motion video: ${message}`); };

export async function readBrief(file) {
  let brief;
  try { brief = JSON.parse(await readFile(path.resolve(file), 'utf8')); } catch (error) { fail(`cannot read the brief (${error.message})`); }
  return brief;
}

// Check a brief and return { errors, warnings, total }. Errors stop the build of the plan; warnings are shown and kept.
export function reviewBrief(brief) {
  const errors = [], warnings = [];
  const type = TYPES[brief?.type];
  if (!type) return { errors: [`type must be one of ${Object.keys(TYPES).join(', ')}`], warnings, total: 0 };
  if (!brief.title || typeof brief.title !== 'string') errors.push('title is required');
  const beats = Array.isArray(brief.beats) ? brief.beats : [];
  if (beats.length < type.beats[0] || beats.length > type.beats[1]) errors.push(`a ${brief.type} needs ${type.beats[0]}-${type.beats[1]} beats; the brief has ${beats.length}`);
  let total = 0;
  const templates = [];
  beats.forEach((b, i) => {
    const where = `beat ${i + 1}`;
    if (!(b.seconds >= 1.5 && b.seconds <= 20)) errors.push(`${where}: seconds must be from 1.5 to 20`);
    else total += b.seconds;
    if (!b.show && !b.html) { errors.push(`${where}: show (a template name) or html (a seekable page) is required`); return; }
    if (b.html) { templates.push('html'); return; }
    if (!TEMPLATES[b.show] || NOT_BEATS.has(b.show)) { errors.push(`${where}: "${b.show}" is not a template a beat can use (see video-monk templates)`); return; }
    templates.push(b.show);
    try { validateProps(b.show, b.props || {}, `${where}.props`); } catch (error) { errors.push(String(error.message).replace(/^.*?: /, '')); }
    if (b.say !== undefined && (typeof b.say !== 'string' || b.say.length > 200)) errors.push(`${where}: say must be text of at most 200 characters`);
  });
  const last = beats[beats.length - 1];
  if (last && last.seconds < type.hold) errors.push(`the last beat must hold at least ${type.hold} s so the closing line can be read; it has ${last.seconds} s`);
  if (!errors.length && total < type.seconds[0]) warnings.push(`a ${brief.type} runs ${type.seconds[0]}-${type.seconds[1]} s; this one is ${total} s`);
  if (total > type.seconds[1]) warnings.push(`a ${brief.type} runs ${type.seconds[0]}-${type.seconds[1]} s; this one is ${total} s`);
  for (let i = 1; i < templates.length; i++) if (templates[i] === templates[i - 1] && templates[i] !== 'html') warnings.push(`beats ${i} and ${i + 1} use the same template (${templates[i]}); vary the layouts`);
  if (!beats[0]?.say && !beats[0]?.props?.title && !beats[0]?.props?.text) warnings.push(`${type.hook}: beat 1 has no say or title`);
  if (brief.aspect !== undefined && !ASPECTS[brief.aspect]) errors.push(`aspect must be one of ${Object.keys(ASPECTS).join(', ')}`);
  if (brief.music !== undefined && !(brief.music.file && brief.music.rights && brief.music.attribution)) errors.push('music needs file, rights and attribution (licensed audio only)');
  return { errors, warnings, total };
}

// Numbers shown on screen that are not marked as samples need a fact list.
function needsFacts(manifest, beats) {
  const real = manifest.scenes.filter((s, i) => !beats[i].props?.illustrative);
  return graphicTexts({ ...manifest, scenes: real, globalOverlays: [] }).some(t => numbersIn(t.text).length);
}

export async function motionVideo(briefFile, outputDir, { facts = null, sfx = 'subtle', log = () => {}, execute } = {}) {
  const brief = await readBrief(briefFile);
  const review = reviewBrief(brief);
  if (review.errors.length) fail(`the brief needs changes:\n${review.errors.map(e => `  - ${e}`).join('\n')}`);
  const [width, height] = brief.aspect ? ASPECTS[brief.aspect] : [brief.width || 1920, brief.height || 1080];
  const type = TYPES[brief.type];
  const dir = path.resolve(outputDir);
  const briefDir = path.dirname(path.resolve(briefFile));
  const beats = brief.beats;
  let at = 0;
  const scenes = beats.map((b, i) => {
    const scene = { id: `beat-${i + 1}`, kind: 'graphic', duration: b.seconds, purpose: b.say || `${brief.type} beat ${i + 1}`, chapter: b.label,
      graphic: b.html ? { html: path.resolve(briefDir, b.html) } : { template: b.show, props: b.props || {} } };
    if (!scene.chapter) delete scene.chapter;
    if (i < beats.length - 1) {
      const type = brief.transitions === 'cut' ? null : TRANSITIONS.includes(b.transition) ? b.transition : CYCLE[i % CYCLE.length];
      if (type) scene.transition = { type, duration: Math.min(0.5, b.seconds / 3) };
    }
    at += b.seconds;
    return scene;
  });
  let manifest = { version: 2, title: brief.title, fps: brief.fps || 30, width, height, assets: [], scenes,
    delivery: { targetLufs: -14, truePeak: -1 }, notes: `Standalone ${brief.type} made by motion-video from ${path.basename(briefFile)}. ${type.about}.` };
  if (brief.theme) manifest.theme = brief.theme;
  if (brief.music) {
    manifest.assets.push({ id: 'music', path: brief.music.file, kind: 'audio', approved: true, rights: brief.music.rights, attribution: brief.music.attribution });
    manifest.audio = { music: [{ asset: 'music', gainDb: brief.music.gainDb ?? -18, fadeIn: 1, fadeOut: Math.min(2, beats[beats.length - 1].seconds) }], ducking: { enabled: true, amountDb: 12 } };
  }
  const warnings = [...review.warnings];
  // facts first: real numbers need approved, sourced facts
  const factsFile = facts || brief.facts;
  let factsReport = null;
  if (factsFile) {
    factsReport = checkFacts(manifest, await readFacts(path.resolve(briefDir, factsFile)));
    if (!factsReport.ok) fail(`facts-check failed:\n${[...factsReport.unsourced.map(u => `  - fact ${u.index + 1} has no source: "${u.text}"`), ...factsReport.unlisted.map(u => `  - ${u.where}: ${u.number} is not in the fact list ("${u.text}")`)].join('\n')}`);
  } else if (needsFacts(manifest, beats)) {
    fail('numbers appear on screen but no fact list was given. Pass --facts facts.json (every fact with a source), or, for sample data, use chart-morph with "illustrative": true (it prints an "Illustrative" label on every frame).');
  }
  await mkdir(dir, { recursive: true });
  if (sfx !== 'off') {
    const placed = await applySfx(manifest, { mode: sfx, dir: path.join(dir, 'sfx'), relTo: dir, execute, log });
    manifest = placed.manifest; warnings.push(...placed.warnings);
  }
  const output = path.join(dir, 'production.json');
  await writeJson(output, manifest);
  return { output, scenes: scenes.length, seconds: review.total, width, height, warnings, facts: factsReport, sfx: manifest.audio?.sfx?.length || 0 };
}
