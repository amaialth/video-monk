// Standalone motion videos from a brief: launch, explainer, chart, milestone, opener and promo pieces made only of graphic scenes
// (no recording underneath). The brief lists beats (what is said, which template shows it, its props, how long); this module checks the
// piece against its type's rules, writes a version-2 manifest of graphic scenes with transitions, music and subtle sound effects, and runs the
// facts-first check. It builds nothing and approves nothing: review the plan, then production-review and production-build as usual.
// Formats follow the launch / explainer / chart / milestone / opener / promo patterns of charlie947/motion-graphics-skills (MIT), rewritten here.
import { readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { writeJson } from './core.js';
import { TEMPLATES, validateProps } from './motion/templates.js';
import { TRANSITIONS } from './timeline.js';
import { ASPECTS } from './cutdown.js';
import { checkFacts, readFacts, graphicTexts, numbersIn } from './facts.js';
import { applySfx } from './sfx.js';
import { listLibs } from './libs.js';
import { listImported, copyImported } from './catalog.js';
import { exists } from './core.js';

// beats: [min, max]; seconds: the length the format is meant to have (outside it is a warning); hold: minimum seconds on the last beat.
export const TYPES = {
  launch: { beats: [4, 8], seconds: [30, 45], hold: 3, hook: 'the first beat states the promise in one line', about: 'a product or feature announcement: promise, proof, how it works, one number, name and call to action' },
  explainer: { beats: [6, 14], seconds: [30, 60], hold: 3, hook: 'the first beat is the question itself', about: 'a "why" explainer: one question, each beat answering the one before, a takeaway in five words or fewer last' },
  chart: { beats: [1, 3], seconds: [6, 12], hold: 3, hook: 'the chart is the first beat', about: 'one dataset that changes, with the headline value labelled and held' },
  milestone: { beats: [2, 4], seconds: [8, 15], hold: 3, hook: 'the first beat moves toward the number', about: 'a milestone: points pull into the real number, the label settles, hold' },
  opener: { beats: [1, 3], seconds: [8, 15], hold: 3, hook: 'the title lands in the last third', about: 'a short title opener: one world, one move, the title last' },
  promo: { beats: [3, 5], seconds: [12, 20], hold: 3, hook: 'the first beat is the single promise', about: 'a newsletter or episode promo: one promise, one proof, one ask' }
};
// Scenes that use 3D and animation libraries (three.js, GSAP, anime.js, Lottie, Motion, Babylon.js, PlayCanvas, Rive) ship as starters.
// A starter beat is copied into the plan folder (scenes/), where it can be edited, and its libraries are checked and recorded in the plan.
export const STARTER_DIR = new URL('../assets/motion-starters/', import.meta.url).pathname;
export const starterNames = () => { try { return readdirSync(STARTER_DIR).filter(f => /^[\w-]+\.html$/.test(f)).map(f => f.replace(/\.html$/, '')).sort(); } catch { return []; } };
const libsIn = html => [...new Set([...String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<vm-lib\s+name="([\w@/.-]+)"/g)].map(m => m[1]))];
const assetsIn = html => [...String(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<vm-asset\s+name="[\w.-]+"\s+src="([^"]+)"/g)].map(m => m[1]);
const NOT_BEATS = new Set(Object.entries(TEMPLATES).filter(([, d]) => d.internal || d.fullFrame).map(([n]) => n));
// One dominant direction of travel for the whole piece (the "current"): ordinary seams all slide the same way so the eye keeps its momentum.
// Another direction is reserved for a reason (a chapter change, an arrival); alternating left and right between beats reads as an error.
export const CURRENTS = ['left', 'right', 'up', 'down'];
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };
const directionOf = type => /(left|right|up|down)$/.exec(String(type))?.[1] || null;
const pingPong = (a, b) => { const x = directionOf(a), y = directionOf(b); return Boolean(x && y && OPPOSITE[x] === y); };
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
    if (b.catalog !== undefined) {
      if (b.show || b.html || b.starter) { errors.push(`${where}: use catalog, starter, show or html, not more than one`); return; }
      if (typeof b.catalog !== 'string' || !/^[\w-]+$/.test(b.catalog)) { errors.push(`${where}: catalog must be the name of an imported catalog block`); return; }
      if (b.vars !== undefined && (typeof b.vars !== 'object' || Array.isArray(b.vars) || Object.values(b.vars).some(v => !['string', 'number', 'boolean'].includes(typeof v)))) errors.push(`${where}: vars must be an object of text, numbers or true/false`);
      templates.push(`catalog:${b.catalog}`);
      return;
    }
    if (b.starter !== undefined) {
      if (b.show || b.html) { errors.push(`${where}: use starter, show or html, not more than one`); return; }
      if (!starterNames().includes(b.starter)) { errors.push(`${where}: starter must be one of ${starterNames().join(', ')}`); return; }
      templates.push(`starter:${b.starter}`);
      return;
    }
    if (!b.show && !b.html) { errors.push(`${where}: show (a template name), starter (a 3D or library scene) or html (a seekable page) is required`); return; }
    if (b.html) { templates.push('html'); return; }
    if (!TEMPLATES[b.show] || NOT_BEATS.has(b.show)) { errors.push(`${where}: "${b.show}" is not a template a beat can use (see video-monk templates)`); return; }
    templates.push(b.show);
    try { validateProps(b.show, b.props || {}, `${where}.props`); } catch (error) { errors.push(String(error.message).replace(/^.*?: /, '')); }
    if (b.say !== undefined && (typeof b.say !== 'string' || b.say.length > 200)) errors.push(`${where}: say must be text of at most 200 characters`);
  });
  const last = beats[beats.length - 1];
  if (last && last.seconds < type.hold) errors.push(`the last beat must hold at least ${type.hold} s so the closing line can be read; it has ${last.seconds} s`);
  if (!errors.length && total < type.seconds[0]) warnings.push(`a ${brief.type} runs ${type.seconds[0]}-${type.seconds[1]} s; this one is ${Math.round(total * 10) / 10} s`);
  if (total > type.seconds[1]) warnings.push(`a ${brief.type} runs ${type.seconds[0]}-${type.seconds[1]} s; this one is ${Math.round(total * 10) / 10} s`);
  for (let i = 1; i < templates.length; i++) if (templates[i] === templates[i - 1] && templates[i] !== 'html') warnings.push(`beats ${i} and ${i + 1} use the same template (${templates[i]}); vary the layouts`);
  if (!beats[0]?.say && !beats[0]?.props?.title && !beats[0]?.props?.text) warnings.push(`${type.hook}: beat 1 has no say or title`);
  if (brief.current !== undefined && !CURRENTS.includes(brief.current)) errors.push(`current must be one of ${CURRENTS.join(', ')}`);
  for (let i = 1; i < beats.length - 1; i++) if (pingPong(beats[i - 1].transition, beats[i].transition)) warnings.push(`beats ${i} and ${i + 1} end with opposite transitions (${beats[i - 1].transition}, then ${beats[i].transition}); keep one direction of travel unless something causes the change`);
  if (brief.aspect !== undefined && !ASPECTS[brief.aspect]) errors.push(`aspect must be one of ${Object.keys(ASPECTS).join(', ')}`);
  if (brief.music !== undefined && !(brief.music.file && brief.music.rights && brief.music.attribution)) errors.push('music needs file, rights and attribution (licensed audio only)');
  return { errors, warnings, total };
}

// Numbers shown on screen that are not marked as samples need a fact list.
function needsFacts(manifest, beats) {
  const real = manifest.scenes.filter((s, i) => !beats[i].props?.illustrative);
  return graphicTexts({ ...manifest, scenes: real, globalOverlays: [] }).some(t => numbersIn(t.text).length);
}

// Which libraries a brief's 3D / library scenes need, and whether each is installed (nothing is downloaded here).
export async function libsNeeded(brief, briefDir = '.') {
  const installed = await listLibs();
  const ids = new Set();
  for (const b of brief?.beats || []) {
    if (b?.catalog) ids.add('gsap');
    const file = b?.starter && starterNames().includes(b.starter) ? path.join(STARTER_DIR, `${b.starter}.html`) : b?.html ? path.resolve(briefDir, b.html) : null;
    if (file) { try { for (const id of libsIn(await readFile(file, 'utf8'))) ids.add(id); } catch { /* reported when planning */ } }
  }
  return [...ids].sort().map(id => ({ id, installed: installed.some(l => l.id === id), version: installed.filter(l => l.id === id).map(l => l.version).at(-1) || null }));
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
  // 3D / library scenes: copy each starter into the plan folder, check its libraries are installed and its files are present
  const installed = await listLibs();
  const libsUsed = new Map();
  const sceneFiles = new Map();
  const problems = [];
  const warnings = [...review.warnings];
  const imported = await listImported();
  const catalogUsed = [];
  for (const [i, b] of beats.entries()) {
    if (b.catalog === undefined) continue;
    const item = imported.find(x => x.name === b.catalog);
    if (!item) { problems.push(`beat ${i + 1}: ${b.catalog} is not imported: run  video-monk motion-catalog --import ${b.catalog} --allow-download  (a one-time download), then plan again`); continue; }
    const declared = new Set((item.variables || []).map(v => v.id));
    for (const k of Object.keys(b.vars || {})) if (!declared.has(k)) problems.push(`beat ${i + 1}: ${b.catalog} has no variable "${k}"${declared.size ? ` (it has: ${[...declared].join(', ')})` : ''}`);
    const lib = installed.filter(l => l.id === 'gsap').sort((a, c) => String(c.addedAt).localeCompare(String(a.addedAt)))[0];
    if (!lib) problems.push(`beat ${i + 1} needs gsap: run  video-monk libs --add gsap --allow-download${item.needs?.plugins?.length ? ` --with ${item.needs.plugins.join(',')}` : ''}  (a one-time download), then plan again`);
    else {
      libsUsed.set('gsap', lib.version);
      const missing = (item.needs?.plugins || []).filter(pl => !(lib.scripts || []).some(f => f.includes(pl)));
      if (missing.length) problems.push(`beat ${i + 1} needs the GSAP plugin ${missing.join(', ')}: run  video-monk libs --remove gsap  then  video-monk libs --add gsap --allow-download --with ${missing.join(',')}`);
    }
    if (item.duration && b.seconds > item.duration + 0.5) warnings.push(`beat ${i + 1}: ${b.catalog} lasts ${item.duration} s; after that it holds its last frame for the remaining ${(b.seconds - item.duration).toFixed(1)} s`);
    if (item.width && item.height && Math.abs(item.width / item.height - width / height) > 0.05) warnings.push(`beat ${i + 1}: ${b.catalog} is ${item.width}x${item.height} but the video is ${width}x${height}; it is laid out for its own size`);
    catalogUsed.push([i, item]);
    sceneFiles.set(i, { file: path.join(dir, 'scenes', b.catalog, 'index.html'), catalog: b.catalog, item });
  }
  for (const [i, b] of beats.entries()) {
    if (b.catalog !== undefined) continue;
    let html = null, from = null;
    if (b.starter !== undefined) {
      const n = [...sceneFiles.values()].filter(f => f.starter === b.starter).length;
      const target = path.join(dir, 'scenes', `${b.starter}${n ? `-${n + 1}` : ''}.html`);
      sceneFiles.set(i, { file: target, starter: b.starter, source: path.join(STARTER_DIR, `${b.starter}.html`) });
      from = sceneFiles.get(i).source;
    } else if (b.html) from = path.resolve(briefDir, b.html);
    if (!from) continue;
    html = await readFile(from, 'utf8');
    for (const id of libsIn(html)) {
      const lib = installed.filter(l => l.id === id).sort((a, c) => String(c.addedAt).localeCompare(String(a.addedAt)))[0];
      if (!lib) problems.push(`beat ${i + 1} needs ${id}: run  video-monk libs --add ${id} --allow-download  (a one-time download), then plan again`);
      else libsUsed.set(id, lib.version);
    }
    const home = sceneFiles.has(i) ? path.dirname(sceneFiles.get(i).file) : path.dirname(from);
    const given = b.assets && typeof b.assets === 'object' ? b.assets : {};
    for (const [name, file] of Object.entries(given)) if (!/^[\w.-]+$/.test(name) || typeof file !== 'string' || !(await exists(path.resolve(briefDir, file)))) problems.push(`beat ${i + 1}: assets.${name} must name an existing file`);
    for (const src of assetsIn(html)) if (!given[src] && !(await exists(path.resolve(home, src)))) problems.push(`beat ${i + 1} needs the file ${src}: add  "assets": { "${src}": "/path/to/your/file" }  to the beat`);
  }
  if (problems.length) fail(`the 3D / library scenes are not ready:\n${problems.map(e => `  - ${e}`).join('\n')}`);
  const scenes = beats.map((b, i) => {
    const scene = { id: `beat-${i + 1}`, kind: 'graphic', duration: b.seconds, purpose: b.say || `${brief.type} beat ${i + 1}`, chapter: b.label,
      graphic: sceneFiles.has(i) ? { html: sceneFiles.get(i).file } : b.html ? { html: path.resolve(briefDir, b.html) } : { template: b.show, props: b.props || {} } };
    if (!scene.chapter) delete scene.chapter;
    if (i < beats.length - 1) {
      const type = brief.transitions === 'cut' ? null : TRANSITIONS.includes(b.transition) ? b.transition : `slide${brief.current || 'left'}`;
      if (type) scene.transition = { type, duration: Math.min(0.5, b.seconds / 3) };
    }
    at += b.seconds;
    return scene;
  });
  let manifest = { version: 2, title: brief.title, fps: brief.fps || 30, width, height, assets: [], scenes,
    delivery: { targetLufs: -14, truePeak: -1 }, notes: `Standalone ${brief.type} made by motion-video from ${path.basename(briefFile)}. ${type.about}.${libsUsed.size ? ` Libraries: ${[...libsUsed].map(([k, v]) => `${k}@${v}`).join(', ')}.` : ''}` };
  if (brief.theme) manifest.theme = brief.theme;
  if (brief.music) {
    manifest.assets.push({ id: 'music', path: brief.music.file, kind: 'audio', approved: true, rights: brief.music.rights, attribution: brief.music.attribution });
    manifest.audio = { music: [{ asset: 'music', gainDb: brief.music.gainDb ?? -18, fadeIn: 1, fadeOut: Math.min(2, beats[beats.length - 1].seconds) }], ducking: { enabled: true, amountDb: 12 } };
  }
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
  for (const f of sceneFiles.values()) if (f.catalog) {
    await mkdir(path.dirname(f.file), { recursive: true });
    await copyImported(f.catalog, path.dirname(f.file));
    await rm(path.join(path.dirname(f.file), 'item.json'), { force: true });
  }
  for (const [i, f] of sceneFiles) if (f.catalog && beats[i].vars && Object.keys(beats[i].vars).length) {
    const html = await readFile(f.file, 'utf8');
    const swapped = html.replace(/window\.__vmVariables = \{[^\n]*\};/, () => `window.__vmVariables = ${JSON.stringify({ ...f.item.vars, ...beats[i].vars }).replace(/</g, '\\u003c')};`);
    await writeFile(f.file, swapped);
  }
  if (sceneFiles.size) { await mkdir(path.join(dir, 'scenes'), { recursive: true }); for (const f of sceneFiles.values()) if (!f.catalog) await copyFile(f.source, f.file); for (const [i, f] of sceneFiles) if (!f.catalog) for (const [name, file] of Object.entries(beats[i].assets || {})) await copyFile(path.resolve(briefDir, file), path.join(path.dirname(f.file), name)); }
  if (sfx !== 'off') {
    const placed = await applySfx(manifest, { mode: sfx, dir: path.join(dir, 'sfx'), relTo: dir, execute, log });
    manifest = placed.manifest; warnings.push(...placed.warnings);
  }
  const output = path.join(dir, 'production.json');
  await writeJson(output, manifest);
  const libs = [...libsUsed].map(([id, version]) => ({ id, version }));
  const custom = beats.some((b, i) => sceneFiles.has(i) || b.html);
  const catalogNote = catalogUsed.length;
  const plan = [`# ${brief.title}`, '', `${brief.type}, ${review.total} s, ${width}x${height}. ${type.about}.`, '', '## Beats', '',
    ...beats.map((b, i) => `${i + 1}. ${b.seconds} s  ${b.catalog ? `catalog block "${b.catalog}" (scenes/${b.catalog}/index.html; HyperFrames, ${sceneFiles.get(i).item.license}, ${sceneFiles.get(i).item.author || 'HeyGen'})` : b.starter ? `3D/library scene "${b.starter}" (scenes/${path.basename(sceneFiles.get(i).file)})` : b.html ? `custom page ${b.html}` : b.show}${b.say ? `: ${b.say}` : ''}`), '',
    '## Libraries', '', libs.length ? libs.map(l => `- ${l.id} ${l.version} (downloaded on request, kept on this computer with its own licence)`).join('\n') : 'None: built-in templates only.', '',
    ...(catalogNote ? ['## Catalog items', '', ...catalogUsed.map(([i, it]) => `- ${it.name}: from the HyperFrames catalog (${it.license}${it.author ? `, ${it.author}` : ''}), copyright HeyGen, Inc. and contributors, Apache License 2.0; the licence header is kept at the top of scenes/${it.name}/index.html. Third-party code: read it before you publish.`), ''] : []), '## Facts', '', factsReport ? `facts-check passed (${factsReport.checked} numbers on screen, each from a sourced fact).` : 'No numbers on screen, so no fact list was needed.',
    ...(custom ? ['', 'Text inside a 3D / library scene or custom page is NOT covered by facts-check: read it yourself, and edit the page in scenes/ if it needs your own words.'] : []), '',
    '## Next', '', '1. Read this plan and edit anything (scenes/*.html, production.json).', '2. `video-monk production-review --manifest production.json --output review.json --approve-plan` (your approval).',
    '3. `video-monk production-build --manifest production.json --review review.json --output build --allow-render --quality draft`, read the contact sheet, then build final.', ''].join('\n');
  await writeFile(path.join(dir, 'PLAN.md'), plan);
  return { output, scenes: scenes.length, seconds: review.total, width, height, warnings, facts: factsReport, sfx: manifest.audio?.sfx?.length || 0, libs, plan: path.join(dir, 'PLAN.md') };
}
