// Multiple motion graphics per moment: for the key moments of a storyboard, Claude drafts several alternative designs from different
// directions (structure, typography, points), each is rendered as a still, checked (layout/contrast audit and the same grounding rules as the
// storyboard reviewer) and the best passing one is chosen. All alternatives are kept in the storyboard, with their stills, so a person can pick
// another by editing `chosen`. Opt-in: the transcript lines are sent to Anthropic through the Claude Code login (--engine claude --allow-llm).
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { writeNew, run } from './core.js';
import { callClaude, itemsToCandidates, compactCatalog, GRAPHIC_BRIEF } from './explain-llm.js';
import { MotionRenderer, pool } from './motion/render.js';
import { reviewStoryboard } from './stages.js';
import { MIN_DURATION } from './explain.js';

const round = n => Math.round(n * 1000) / 1000;

// The directions are original wording of the craft lessons in the graphic-briefs reference (inputs, direction, structure, gotchas).
export const APPROACHES = [
  { id: 'structure', templates: ['flow', 'steps', 'comparison', 'table'],
    brief: 'Show the structure. Draw how the parts connect or what the sequence is: a flow, numbered steps, a side-by-side comparison or a small table. Nodes and labels are the speaker\'s own words, 1-4 words each, with cues on the spoken word.' },
  { id: 'typographic', templates: ['term', 'kinetic-text', 'quote', 'stat', 'title'],
    brief: 'Say it with type. One strong idea set as large, calm typography: a definition (term), a single pull-line, a quote or one number the speaker states. Stress the one or two words that carry the point.' },
  { id: 'points', templates: ['bullets', 'bar-chart', 'donut', 'line-chart', 'code'],
    brief: 'Break it into parallel points. Two to four short items revealed in step with speech (bullets with cues), or bars only if the speaker states relative sizes. If the line shows code or a command, a code block.' }
];

const HERO_TEMPLATES = new Set(['flow', 'steps', 'comparison', 'table', 'term', 'stat', 'bullets', 'bar-chart', 'donut', 'line-chart', 'quote', 'code', 'kinetic-text']);

export function variantPrompt(item, words, { count, theme, approaches }) {
  const lineWords = words.filter(w => w.end > item.start - 0.2 && w.start < item.start + item.duration + 0.2);
  const line = lineWords.map(w => w.text).join(' ');
  return [GRAPHIC_BRIEF,
    `<templates>\nUse only these templates and only the listed props. Do not output "cues" or "at" inside props (use the top-level cues list).\n${compactCatalog()}\n</templates>`,
    `<moment>\nOne moment of the video, ${item.start.toFixed(1)}-${(item.start + item.duration).toFixed(1)} s, theme ${theme}. The speaker says:\n"${line}"\nThe current design is ${item.template} with props ${JSON.stringify(item.props).slice(0, 500)}.\n</moment>`,
    `<task>\nDesign ${approaches.length} ALTERNATIVE graphics for this same moment, one per direction below, each a clearly different way to teach the same idea. Use the same start and end for all of them` +
    ` (start ${item.start.toFixed(1)}, end ${(item.start + item.duration).toFixed(1)}), mode "cutaway", and the priority you honestly believe it deserves. Every label comes from the speaker's words; never invent numbers or names.\n` +
    approaches.map((a, i) => `${i + 1}. ${a.id.toUpperCase()}: ${a.brief} Prefer: ${a.templates.join(', ')}.`).join('\n') + `\nReturn only the JSON object required by the schema, one item per direction, in order. (${count - 1} alternatives requested.)\n</task>`].join('\n\n');
}

// Which hero items get alternatives: explanatory graphics (not chapter/title/lower-third), strongest first.
export function heroItems(storyboard, max = 6) {
  return [...storyboard.items].filter(i => HERO_TEMPLATES.has(i.template) && i.mode !== 'overlay' && !i.alternatives).sort((a, b) => b.score - a.score).slice(0, max);
}

// Pick one alternative: hard layout defects or ungrounded content eliminate it; fewer advisories, not repeating a neighbour's template and
// staying with the proven baseline on a tie rank the rest.
export function chooseVariant(alternatives, { neighbours = [] } = {}) {
  let best = -1, bestScore = -Infinity;
  alternatives.forEach((a, i) => {
    if (a.rejected) return;
    const score = 10 - (a.audit?.soft ?? 0) * 0.5 - (neighbours.includes(a.template) ? 1 : 0) + (i === 0 ? 0.5 : 0) - i * 0.01;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best < 0 ? 0 : best;
}

// Set each item's template/props/duration from its chosen alternative (alternatives[0] is always the original design).
export function applyVariantChoices(storyboard) {
  const items = storyboard.items.map((it, index, all) => {
    if (!it.alternatives?.length) return it;
    const k = Number.isInteger(it.chosen) && it.alternatives[it.chosen] ? it.chosen : 0;
    const alt = it.alternatives[k];
    const next = all[index + 1];
    const room = next ? next.start - it.start - 0.15 : Infinity;
    const duration = round(Math.max(MIN_DURATION[alt.template] ?? 2.5, Math.min(alt.duration ?? it.duration, room)));
    return { ...it, chosen: k, template: alt.template, props: alt.props, duration: k === 0 ? it.duration : duration, why: k === 0 ? it.why : `${alt.why || it.why} (variant: ${alt.approach})` };
  });
  const byTemplate = {};
  for (const it of items) byTemplate[it.template] = (byTemplate[it.template] || 0) + 1;
  return { ...storyboard, items, stats: { ...storyboard.stats, byTemplate } };
}

export async function generateVariants(storyboard, words, { count = 3, dir, execute = run, allowLlm, model, duration, concurrency = 3, max = 6, log = () => {} } = {}) {
  if (allowLlm !== true) throw new Error('Variants: this sends transcript lines to Anthropic through your Claude Code login. Pass --allow-llm to confirm.');
  if (!(count >= 2 && count <= 4)) throw new Error('Variants: --variants must be 2 to 4 (the current design plus 1-3 alternatives)');
  const heroes = heroItems(storyboard, max);
  await mkdir(dir, { recursive: true });
  let cost = 0;
  // 1. ask for alternatives, in parallel
  const drafted = await pool(heroes, concurrency, async item => {
    const baseFamily = APPROACHES.find(a => a.templates.includes(item.template))?.id;
    const approaches = APPROACHES.filter(a => a.id !== baseFamily).concat(APPROACHES.filter(a => a.id === baseFamily)).slice(0, count - 1);
    try {
      const reply = await callClaude(variantPrompt(item, words, { count, theme: storyboard.theme, approaches }), { model }, execute);
      cost += reply.costUsd ?? 0;
      const { built } = itemsToCandidates(reply.items.map(x => ({ ...x, start: item.start, end: item.start + item.duration, mode: 'cutaway' })), words, { duration: duration ?? storyboard.duration, graphics: 'cutaway' });
      return { item, approaches, built };
    } catch (error) { log(`  ${item.id}: no alternatives (${error.message.slice(0, 120)})`); return { item, approaches, built: [] }; }
  });
  // 2. render each as a still and audit it
  const cache = await mkdtemp(path.join(os.tmpdir(), 'video-monk-variants-'));
  const renderer = new MotionRenderer();
  const W = 960, H = 540;
  const still = async (spec, mode, file) => {
    const job = { template: spec.template, props: spec.props, width: W, height: H, fps: 10, duration: Math.max(2.5, spec.duration), theme: { preset: storyboard.theme },
      placement: mode === 'panel' ? 'right' : undefined, background: 'grid', exit: false, audit: true };
    const r = await renderer.render(job, cache);
    await copyFile(path.join(r.dir, `frame-${String(Math.max(1, Math.round(r.frames * 0.85))).padStart(6, '0')}.png`), file);
    const hard = (r.audit || []).filter(i => i.kind === 'offcanvas' || i.kind === 'clipped');
    return { issues: r.audit || [], hard: hard.length, soft: (r.audit || []).length - hard.length };
  };
  const updated = new Map();
  const failures = [];
  try {
    await renderer.start();
    for (const { item, approaches, built } of drafted) {
      const specs = [{ approach: 'baseline', template: item.template, props: item.props, duration: item.duration, why: item.why },
        ...built.slice(0, count - 1).map((b, i) => ({ approach: approaches[i]?.id || `alt${i + 1}`, template: b.template, props: b.props, duration: b.duration, why: b.why }))];
      const alternatives = [];
      for (const [k, spec] of specs.entries()) {
        const file = path.join(dir, `${item.id}-v${k}.png`);
        try {
          const result = await still(spec, item.mode, file);
          // grounding: the same numbers/words-in-the-transcript rules the storyboard reviewer uses
          const verdict = reviewStoryboard({ storyboard: { ...storyboard, items: [{ ...item, ...spec, id: item.id }] }, words, duration: duration ?? storyboard.duration });
          const ungrounded = verdict.findings.find(f => f.severity === 'blocker' || (f.severity === 'major' && /^sb-grounding|^sb-number/.test(f.id)));
          alternatives.push({ ...spec, still: path.basename(file), audit: { hard: result.hard, soft: result.soft, issues: result.issues.slice(0, 4) },
            ...(result.hard > 0 ? { rejected: 'text off the frame or clipped' } : ungrounded ? { rejected: ungrounded.message.slice(0, 120) } : {}) });
        } catch (error) { alternatives.push({ ...spec, rejected: `could not be rendered: ${error.message.slice(0, 100)}` }); failures.push(`${item.id} v${k}`); }
      }
      updated.set(item.id, alternatives);
    }
  } finally { await renderer.close(); await rm(cache, { recursive: true, force: true }); }

  // 3. choose, keep the rest, build contact sheets
  const items = storyboard.items.map((it, i, all) => {
    const alternatives = updated.get(it.id);
    if (!alternatives) return it;
    const neighbours = [all[i - 1]?.template, all[i + 1]?.template].filter(Boolean);
    return { ...it, alternatives, chosen: chooseVariant(alternatives, { neighbours }) };
  });
  let planned = { ...storyboard, items };
  for (const it of planned.items.filter(x => updated.has(x.id))) {
    const stills = it.alternatives.filter(a => a.still).map(a => path.join(dir, a.still));
    if (stills.length > 1) {
      try { await run(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...stills.flatMap(f => ['-i', f]), '-filter_complex', `${stills.map((_, i) => `[${i}:v]scale=480:-2[s${i}]`).join(';')};${stills.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${stills.length}`, path.join(dir, `${it.id}-compare.png`)]); } catch { /* the individual stills remain */ }
    }
  }
  planned = applyVariantChoices(planned);
  const switched = planned.items.filter(i => i.alternatives && i.chosen > 0).length;
  planned.stats = { ...planned.stats, variants: { items: updated.size, alternatives: [...updated.values()].reduce((n, a) => n + a.length - 1, 0), switched, costUsd: cost ? round(cost) : null } };
  planned.notes = [...planned.notes, `Alternative designs were drafted for ${updated.size} moment(s); ${switched} switched from the original. Compare them in ${path.basename(dir)}/ and change "chosen" in the storyboard to pick another.`];
  await writeNew(path.join(dir, 'VARIANTS.md'), variantsMarkdown(planned));
  return { storyboard: planned, costUsd: cost, failures };
}

export function variantsMarkdown(storyboard) {
  const heroes = storyboard.items.filter(i => i.alternatives?.length);
  const rows = heroes.map(it => `## ${it.id}: "${(it.line || '').slice(0, 90)}"\n\nSide by side: \`${it.id}-compare.png\`. Chosen: **${it.chosen}** (${it.alternatives[it.chosen].approach}).\n\n| # | Direction | Template | Result | Image |\n|---|---|---|---|---|\n` +
    it.alternatives.map((a, k) => `| ${k} | ${a.approach} | \`${a.template}\` | ${a.rejected ? `rejected: ${a.rejected}` : `ok${a.audit?.soft ? `, ${a.audit.soft} advisory` : ''}`} | ${a.still || ''} |`).join('\n'));
  return `# Motion graphic alternatives\n\nFor each key moment the original design (0) and up to three alternatives were rendered and checked. Rejected means text off the frame or clipped, or content the speaker did not say. To use a different one, set \`"chosen"\` on the item in the \`.storyboard.json\` and re-apply it with \`video-monk storyboard --from-storyboard\`.\n\n${rows.join('\n\n') || 'No moment qualified.'}\n`;
}
