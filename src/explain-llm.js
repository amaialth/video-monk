// Optional planning engine that asks Claude (via the local `claude` CLI in headless mode) to design the graphics.
// Opt-in only: the transcript text is sent to Anthropic through your Claude Code login. The model returns graphic
// definitions; this module validates every one against the template schemas, aligns cue words to real word times and
// hands the result to the same scheduler as the offline rules (density budget, face time, hook protection).
import os from 'node:os';
import { run } from './core.js';
import { templateCatalog, validateProps, TEMPLATES } from './motion/templates.js';
import { cleanWord } from './stress.js';
import { DENSITY, MIN_DURATION, finalizeStoryboard, modeFor, sentences, ruleCandidates } from './explain.js';

const round = n => Math.round(n * 1000) / 1000;
// Templates the model may use. callout (needs pixel regions) and lower-third / progress-bar (not explanatory) are excluded.
export const LLM_TEMPLATES = ['title', 'chapter', 'kinetic-text', 'term', 'stat', 'comparison', 'flow', 'steps', 'bullets', 'bar-chart', 'line-chart', 'donut', 'table', 'quote', 'code'];

export const GRAPHIC_BRIEF = `You are the motion-graphics editor for an explainer video. You are given a timed transcript. Decide where a graphic
would help a viewer understand the idea being spoken, and define each graphic using the template catalog below.

<direction>
- Explain with pictures: wherever a spoken idea can be shown (a process, an architecture or data flow, a list, a definition, a comparison, a
  sequence, a number, a before/after, a hierarchy, code), define a graphic for it. Prefer diagrams and structure over decoration.
- One idea per graphic. Short labels (1-4 words). The transcript is the only source of facts: never invent numbers, names, quotes or results.
  Rephrase and shorten spoken words into clear labels, but do not add claims the speaker did not make.
- Stress: wrap the 1-2 words that carry the point in *asterisks* in headline-style text (title, kinetic-text, chapter, term definition,
  bullets, steps). They render in italic serif in the accent colour. Wrap whole whitespace-delimited tokens, punctuation inside: *caching.*
- Motion language: graphics reveal in step with speech. For bullets, steps, flow and bar-chart give "cues": the exact spoken word (verbatim from
  the transcript) on which each item, step, node or bar should appear, in order, one per item.
- Banned: filler graphics for greetings or small talk, repeating the same template for consecutive ideas without need, anything that
  restates the caption word for word, decorative effects, made-up data.
</direction>

<structure>
- Choose mode "cutaway" for a diagram or card that deserves the whole frame for 3-8 seconds, "overlay" for a short pull-text (kinetic-text only).
- A cutaway must start within the sentence it explains and end shortly after the explanation. Leave at least two seconds of speaker or screen
  between cutaways; no graphic in the first second of the video; at most one idea at a time.
- Long explanations (a multi-sentence process) may be one steps or flow graphic spanning up to 20 seconds; the tool will turn it into a side panel.
- Give each graphic a priority from 1 (nice to have) to 10 (the video is confusing without it).
</structure>`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' }, end: { type: 'number' },
          template: { type: 'string', enum: LLM_TEMPLATES },
          mode: { type: 'string', enum: ['cutaway', 'overlay'] },
          priority: { type: 'number' }, why: { type: 'string' },
          props: { type: 'object' }, cues: { type: 'array', items: { type: 'string' } }
        },
        required: ['start', 'end', 'template', 'mode', 'priority', 'why', 'props']
      }
    }
  },
  required: ['items']
};

export function compactCatalog() {
  return templateCatalog().filter(t => LLM_TEMPLATES.includes(t.name)).map(t => {
    const props = Object.entries(t.props).filter(([k]) => !/^(cues|at)\??$/.test(k)).map(([k, v]) => `${k}: ${v}`).join('; ');
    return `- ${t.name}: ${t.description}\n    props { ${props} }`;
  }).join('\n');
}

export function buildPrompt(words, { density, duration, theme, repair = null, style = null }) {
  const conf = DENSITY[density];
  const target = Math.max(3, Math.round(conf.perMinute * (duration / 60) * 1.35));
  const lines = sentences(words).map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  const parts = [GRAPHIC_BRIEF, ...(style?.brief ? [`<style>\n${style.brief}\n</style>`] : []),
    `<templates>\nUse only these templates and only the listed props. Do not output "cues" or "at" inside props (use the top-level cues list).\n${compactCatalog()}\n</templates>`,
    `<inputs>\nVideo length ${duration.toFixed(1)} s. Theme ${theme}. Aim for about ${target} graphics (the tool keeps the best by priority).\nTimed transcript (seconds from the start of the edited video):\n${lines}\n</inputs>`,
    '<output>\nReturn only the JSON object required by the schema: items with start/end in seconds taken from the transcript timestamps, template, mode, priority, why (one short sentence on what it teaches), props, and cues (spoken words) where the template uses them.\n</output>'];
  if (repair) parts.push(`<repair>\nThese items from your previous answer were rejected. Return only corrected versions of them (same start/end) in the same schema.\n${repair}\n</repair>`);
  return parts.join('\n\n');
}

const clean = w => cleanWord(String(w)).toLowerCase();
const tokensOf = text => String(text).replace(/\*/g, ' ').trim().split(/\s+/).filter(Boolean);

// Move punctuation inside stress markers so tokens stay whole words: *word*. -> *word.*
function normalizeMarkup(text) {
  return String(text).replace(/([^\s*])\*([.,;:!?]+)/g, '$1$2*');
}

// Greedy in-order alignment of cue words to the transcript words inside [from, to]. Returns absolute start times.
function alignWords(cueWords, windowWords) {
  const times = [];
  let ptr = 0;
  for (const cue of cueWords) {
    const target = clean(cue);
    let found = -1;
    for (let i = ptr; i < windowWords.length; i++) {
      const w = clean(windowWords[i].text);
      if (w === target || (target.length >= 4 && (w.startsWith(target) || target.startsWith(w) && w.length >= 4))) { found = i; break; }
    }
    if (found >= 0) { times.push(windowWords[found].start); ptr = found + 1; } else times.push(null);
  }
  // Fill unmatched cues by interpolating between neighbours (or spreading across the window).
  const first = windowWords[0]?.start ?? 0, last = windowWords.at(-1)?.start ?? first + 1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] !== null) continue;
    let lo = i - 1; while (lo >= 0 && times[lo] === null) lo--;
    let hi = i + 1; while (hi < times.length && times[hi] === null) hi++;
    const a = lo >= 0 ? times[lo] : first, b = hi < times.length ? times[hi] : last;
    const slots = (hi < times.length ? hi : times.length) - (lo >= 0 ? lo : -1);
    times[i] = a + (b - a) * ((i - (lo >= 0 ? lo : -1)) / Math.max(1, slots));
  }
  return times;
}

function applyCues(template, props, cueTimes, tokenTimes, start) {
  const rel = t => round(Math.max(0.3, t - start));
  const p = JSON.parse(JSON.stringify(props));
  if (template === 'bullets' && cueTimes && cueTimes.length === p.items?.length) p.cues = cueTimes.map(rel);
  if (template === 'steps' && cueTimes) p.steps?.forEach((st, i) => { if (cueTimes[i] !== undefined) st.at = rel(cueTimes[i]); });
  if (template === 'flow' && cueTimes) p.nodes?.forEach((n, i) => { if (cueTimes[i] !== undefined) n.at = rel(cueTimes[i]); });
  if (template === 'bar-chart' && cueTimes) p.bars?.forEach((b, i) => { if (cueTimes[i] !== undefined) b.at = rel(cueTimes[i]); });
  if (template === 'kinetic-text' && tokenTimes?.length === tokensOf(p.text).length) p.cues = tokenTimes.map(t => round(Math.max(0.1, t - start)));
  if (template === 'term' && tokenTimes?.length === tokensOf(p.definition).length) p.cues = tokenTimes.map(t => round(Math.max(0.5, t - start)));
  return p;
}

// Convert model output to scheduler candidates. Returns { built, rejected: [{index, reason}] }.
export function itemsToCandidates(rawItems, words, { duration, graphics }) {
  const built = [];
  const rejected = [];
  rawItems.forEach((item, index) => {
    try {
      if (!LLM_TEMPLATES.includes(item.template)) throw new Error(`template ${item.template} not allowed`);
      let { start, end } = item;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('bad start/end');
      start = Math.max(0, start); end = Math.min(duration, end);
      const windowWords = words.filter(w => w.end > start - 0.2 && w.start < end + 0.2);
      if (!windowWords.length) throw new Error('no transcript words in the time window');
      const props = JSON.parse(JSON.stringify(item.props || {}));
      for (const key of ['text', 'title', 'definition', 'term', 'label', 'subtitle', 'quote']) if (typeof props[key] === 'string') props[key] = normalizeMarkup(props[key]);
      if (Array.isArray(props.items)) props.items = props.items.map(normalizeMarkup);
      for (const k of ['cues', 'at']) delete props[k];
      const cueTimes = Array.isArray(item.cues) && item.cues.length ? alignWords(item.cues, windowWords) : null;
      const tokenTimes = item.template === 'kinetic-text' ? alignWords(tokensOf(props.text || ''), windowWords)
        : item.template === 'term' ? alignWords(tokensOf(props.definition || ''), windowWords) : null;
      // mixed: pull-text stays an overlay strip; other graphics are cutaways, or side panels when the model asked for an overlay.
      const forced = modeFor({ template: item.template }, graphics);
      const mode = graphics !== 'mixed' ? forced : item.template === 'kinetic-text' ? 'overlay' : item.mode === 'overlay' ? 'panel' : 'cutaway';
      const first = windowWords[0].start;
      const startAt = Math.max(0, Math.min(start, first) - 0.1);
      const final = applyCues(item.template, props, cueTimes, tokenTimes, startAt);
      validateProps(item.template, final, `items[${index}].props`);
      const lastCue = Math.max(0, ...(cueTimes || []), ...(tokenTimes || []));
      const span = Math.max(end, lastCue) - startAt;
      const min = MIN_DURATION[item.template] ?? 2.5;
      built.push({ kind: 'llm', mode, start: round(startAt), duration: round(Math.max(min, span + (mode === 'cutaway' ? 0.7 : 0.5))),
        score: clamp(Number(item.priority) || 5, 1, 10), template: item.template, props: final, why: String(item.why || '').slice(0, 160),
        line: windowWords.map(w => w.text).join(' ').slice(0, 140)});
    } catch (error) {
      rejected.push({ index, reason: error.message.slice(0, 200), item });
    }
  });
  return { built, rejected };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function callClaude(prompt, { model, timeout = 600_000 } = {}, execute = run) {
  const args = ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(OUTPUT_SCHEMA), '--tools', '', '--no-session-persistence', '--disable-slash-commands'];
  if (model) args.push('--model', model);
  const { stdout } = await execute('claude', args, { cwd: os.tmpdir(), timeout });
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error('Explain: claude returned non-JSON output'); }
  if (data.is_error) throw new Error(`Explain: claude reported an error: ${String(data.result || '').slice(0, 300)}`);
  const out = data.structured_output ?? (() => { try { return JSON.parse(data.result); } catch { return null; } })();
  if (!out || !Array.isArray(out.items)) throw new Error('Explain: claude did not return the expected {items: [...]} structure');
  return { items: out.items, costUsd: data.total_cost_usd ?? null };
}

export async function planWithClaude(words, options = {}, execute = run) {
  const { duration = words.at(-1).end, density = 'medium', graphics = 'mixed', theme = 'night', presenter = null, role = null, model, allowLlm, style = null } = options;
  if (allowLlm !== true) throw new Error('Explain: --engine claude sends the transcript to Anthropic through your Claude Code login. Pass --allow-llm to confirm.');
  if (!DENSITY[density]) throw new Error(`Explain: density must be ${Object.keys(DENSITY).join(', ')}`);
  const first = await callClaude(buildPrompt(words, { density, duration, theme, style }), { model }, execute);
  let { built, rejected } = itemsToCandidates(first.items, words, { duration, graphics });
  let cost = first.costUsd ?? 0;
  if (rejected.length && rejected.length <= 12) {
    const note = rejected.map(r => `- start ${r.item.start}, template ${r.item.template}: ${r.reason}\n  item: ${JSON.stringify(r.item).slice(0, 600)}`).join('\n');
    try {
      const second = await callClaude(buildPrompt(words, { density, duration, theme, repair: note, style }), { model }, execute);
      const retry = itemsToCandidates(second.items, words, { duration, graphics });
      built = built.concat(retry.built);
      rejected = retry.rejected;
      cost += second.costUsd ?? 0;
    } catch { /* keep the first batch */ }
  }
  if (!built.length) throw new Error('Explain: claude returned no usable graphics');
  // Hybrid: Claude's explanatory graphics rank first; offline rules add pull-text and number cards in the gaps.
  const llmCount = built.length;
  built = built.map(it => ({ ...it, score: 5 + it.score * 0.6 }));
  if (options.fill !== false) {
    const rules = ruleCandidates(words, { duration, graphics, density });
    built = built.concat(rules.built.filter(r => ['kinetic-text', 'stat', 'title'].includes(r.template)));
  }
  const storyboard = finalizeStoryboard(built, { words, duration, density, graphics, presenter, role, theme, candidates: first.items.length, skipped: rejected.length, engine: options.fill === false ? 'claude' : 'claude+rules', style, captionsOn: options.captionsOn === true, cta: options.cta || null });
  storyboard.stats.claudeGraphics = storyboard.items.filter(i => i.kind === 'llm').length;
  void llmCount;
  storyboard.stats.llmCostUsd = cost ? round(cost) : null;
  storyboard.notes.push('Planned by Claude from the transcript; cue words were aligned to the real word timings. Review the table and every label.');
  return storyboard;
}

export { TEMPLATES };
