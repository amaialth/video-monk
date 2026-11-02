// The four pipeline stages as producer / reviewer / reviser triples for the review loops.
//   transcript -> cut -> storyboard -> render
// Reviewers are deterministic (measured from the audio, the transcript, the storyboard and the rendered file) and may be joined by an
// optional Claude reviewer. Fixes are machine-applicable and target only the flagged segment, word or item.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { finding, verdict } from './loop.js';
import { autocut, alignRanges, materializeEdit, FILLERS, LEVEL_STEP } from './autocut.js';
import { transcribeWhisper } from './transcribe.js';
import { storyboardManifest } from './storyboard.js';
import { loadTimeline } from './timeline.js';
import { DENSITY, applyStoryboard, planStoryboard, storyboardMarkdown } from './explain.js';
import { STOP_WORDS, cleanWord } from './stress.js';
import { reviewProduction, buildProduction } from './production.js';
import { claudeReview } from './review-llm.js';
import { auditSrt } from './captions.js';
import { resolveStyle } from './style.js';

const round = n => Math.round(n * 1000) / 1000;
const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
// Spoken number words count as their digits ("phase one" on screen as "Phase 1" is the same number, not an invented one).
const NUMBER_WORDS = { zero: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7,
  eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, million: 1e6 };
const vocabulary = words => {
  const set = new Set();
  for (const w of words) {
    const token = cleanWord(w.text).toLowerCase();
    if (!token) continue;
    set.add(token);
    if (token in NUMBER_WORDS) set.add(String(NUMBER_WORDS[token]));
    const ordinal = token.match(/^(\d+)(?:st|nd|rd|th)$/);
    if (ordinal) set.add(ordinal[1]);
  }
  return set;
};
const merge = (ranges, gap = 0.12) => {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.in - b.in)) {
    const last = out.at(-1);
    if (last && r.in - last.out <= gap) last.out = Math.max(last.out, r.out); else out.push({ in: r.in, out: r.out });
  }
  return out;
};

// ---------------------------------------------------------------- transcript
export function reviewTranscript(artifact, { glossary = [] } = {}) {
  const { words } = artifact;
  const findings = [];
  let ordered = true;
  for (let i = 1; i < words.length; i++) if (words[i].start < words[i - 1].start - 0.001) { ordered = false; findings.push(finding({ id: `transcript-order-${i}`, severity: 'blocker', owner: 'transcript', target: { word: i }, message: `word ${i} starts before the previous word`, suggestion: 'drop or retime the word', fix: { op: 'dropWord', index: i } })); break; }
  const span = Math.max(1, words.at(-1).end - words[0].start);
  const rate = words.length / span * 60;
  if (rate < 40 || rate > 280) findings.push(finding({ id: 'transcript-rate', severity: 'major', owner: 'transcript', message: `${Math.round(rate)} words per minute is implausible for speech`, suggestion: 'check the audio language/model; re-transcribe with a larger model' }));
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (next && cleanWord(w.text).toLowerCase() === cleanWord(next.text).toLowerCase() && cleanWord(w.text).length > 1 && next.start - w.end < 0.35) {
      findings.push(finding({ id: `transcript-stutter-${i}`, severity: 'minor', owner: 'transcript', target: { word: i }, message: `repeated word "${w.text}"`, suggestion: 'drop the repeat', fix: { op: 'dropWord', index: i } }));
    }
    for (const term of glossary) {
      const a = cleanWord(w.text).toLowerCase(), b = term.toLowerCase();
      if (a && a !== b && a.length >= 3 && Math.abs(a.length - b.length) <= 1 && editDistance(a, b) <= 1) {
        findings.push(finding({ id: `transcript-glossary-${i}`, severity: 'major', owner: 'transcript', target: { word: i }, message: `"${w.text}" looks like the glossary term "${term}"`, suggestion: `replace with ${term}`, fix: { op: 'replaceWord', index: i, to: w.text.replace(/[\p{L}\p{N}']+/u, term) } }));
      }
    }
  });
  return verdict({ stage: 'transcript', round: 0, reviewer: 'transcript-reviewer (code)', findings, metrics: { words: words.length, wordsPerMinute: Math.round(rate), ordered } });
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function reviseTranscript(artifact, findings) {
  const words = artifact.words.map(w => ({ ...w }));
  const drop = new Set();
  const changed = [];
  for (const f of findings) {
    const fx = f.fix;
    if (!fx || fx.index === undefined || !words[fx.index]) continue;
    if (fx.op === 'replaceWord') { changed.push(`word ${fx.index}: "${words[fx.index].text}" → "${fx.to}"`); words[fx.index].text = fx.to; }
    if (fx.op === 'dropWord') { drop.add(fx.index); changed.push(`dropped word ${fx.index} ("${words[fx.index].text}")`); }
  }
  return { artifact: { ...artifact, words: words.filter((_, i) => !drop.has(i)), version: (artifact.version || 1) + 1, dirty: true }, changed };
}

// ---------------------------------------------------------------- cut
const MAX_QUIET_GAP = { natural: 0.6, tight: 0.25, extra: 0.18 };

export function reviewCut(artifact) {
  const { context, result } = artifact;
  const { levels, noiseDb, paceName, words } = context;
  const step = LEVEL_STEP;
  const findings = [];
  const ranges = result.ranges;
  const quietDb = noiseDb + 3;
  const maxGap = MAX_QUIET_GAP[paceName] ?? 0.25;
  let quietTotal = 0, editedTotal = 0;
  ranges.forEach((r, idx) => {
    editedTotal += r.out - r.in;
    const a = Math.floor(r.in / step), b = Math.floor(r.out / step);
    let run = -1;
    for (let i = a; i <= b; i++) {
      const quiet = i < b && levels[i] < quietDb;
      if (quiet && run < 0) run = i;
      if (!quiet && run >= 0) {
        const len = (i - run) * step;
        if (len >= 0.16) {
          quietTotal += len;
          if (len >= maxGap) findings.push(finding({ id: `cut-quiet-${idx + 1}-${(run * step).toFixed(2)}`, severity: 'major', owner: 'cut', target: { scene: idx + 1, source: [round(run * step), round(i * step)] },
            message: `scene ${idx + 1} keeps a ${len.toFixed(2)} s quiet stretch (limit ${maxGap} s for pace "${paceName}")`, suggestion: 'cut the quiet stretch and keep a short natural pause', fix: { op: 'removeQuiet', range: idx, from: round(run * step), to: round(i * step) } }));
        }
        run = -1;
      }
    }
  });
  // Clearly voiced audio must survive (filler words are removed on purpose and are not counted).
  const fillerSpans = (words || []).filter(w => context.options.removeFillers !== false && FILLERS.includes(cleanWord(w.text).toLowerCase())).map(w => [w.start - 0.03, w.end + 0.03]);
  const kept = new Uint8Array(levels.length);
  for (const r of ranges) for (let i = Math.floor(r.in / step); i < Math.floor(r.out / step); i++) kept[i] = 1;
  const voicedDb = noiseDb + 5;
  let voiced = 0, lost = 0;
  const missing = [];
  let run = -1;
  for (let i = 0; i <= levels.length; i++) {
    const t = i * step;
    const isVoiced = i < levels.length && levels[i] >= voicedDb && !fillerSpans.some(([s, e]) => t >= s && t <= e);
    if (isVoiced) { voiced++; if (!kept[i]) { lost++; if (run < 0) run = i; } }
    if ((!isVoiced || kept[i]) && run >= 0) { if ((i - run) * step >= 0.08) missing.push([round(run * step), round(i * step)]); run = -1; }
  }
  const keptPct = voiced ? 100 * (voiced - lost) / voiced : 100;
  if (keptPct < 99.5 || missing.length) {
    for (const [from, to] of missing.slice(0, 12)) findings.push(finding({ id: `cut-lost-${from.toFixed(2)}`, severity: keptPct < 99 ? 'blocker' : 'major', owner: 'cut', target: { source: [from, to] },
      message: `${(to - from).toFixed(2)} s of clearly voiced audio at ${from.toFixed(2)} s was cut`, suggestion: 'restore the range', fix: { op: 'restore', from, to } }));
  }
  const durations = ranges.map(r => r.out - r.in).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] || 0;
  if (ranges.length > 8 && median < 0.6) {
    ranges.map((r, idx) => ({ idx, d: r.out - r.in })).sort((a, b) => a.d - b.d).slice(0, 15).forEach(({ idx, d }) => {
      if (idx < ranges.length - 1 && ranges[idx + 1].in - ranges[idx].out <= 0.5) findings.push(finding({ id: `cut-choppy-${idx + 1}`, severity: 'major', owner: 'cut', target: { scene: idx + 1 }, message: `scene ${idx + 1} is only ${d.toFixed(2)} s; the edit is choppy (median ${median.toFixed(2)} s)`, suggestion: 'merge with the next segment', fix: { op: 'mergeNeighbors', range: idx } }));
    });
  }
  // Camera zoom that flips on and off between cuts reads as flicker (and crops the slide being explained).
  const scenes = result.manifest?.scenes || [];
  let flips = 0;
  for (let i = 1; i < scenes.length; i++) if (Boolean(scenes[i].motion) !== Boolean(scenes[i - 1].motion)) flips++;
  const flipsPerMinute = flips / Math.max(1 / 60, result.report.editedDuration / 60);
  if (flipsPerMinute > 12) findings.push(finding({ id: 'cut-zoom-flicker', severity: 'major', owner: 'cut', message: `the picture zooms in or out ${flips} times (${Math.round(flipsPerMinute)} per minute)`,
    suggestion: 'remove the per-cut zoom; hold any framing for several seconds', fix: { op: 'calmZoom' } }));
  const timelineSeconds = result.report.editedDuration;
  const wpm = words?.length ? words.length / Math.max(1, timelineSeconds) * 60 : null;
  if (wpm && wpm < 115) findings.push(finding({ id: 'cut-pace-slow', severity: 'minor', owner: 'cut', message: `speech pace is ${Math.round(wpm)} words per minute`, suggestion: 'consider --speed 1.1' }));
  return verdict({ stage: 'cut', round: 0, reviewer: 'cut-reviewer (code)', findings, metrics: { segments: ranges.length, zoomFlipsPerMinute: round(flipsPerMinute), editedSeconds: round(timelineSeconds), quietPercent: round(100 * quietTotal / Math.max(1, editedTotal)), voicedKeptPercent: round(keptPct), medianSegment: round(median), wordsPerMinute: wpm ? Math.round(wpm) : null } });
}

export async function reviseCut(artifact, findings, ctx) {
  let { context, result } = artifact;
  const pad = 0.06;
  let list = result.ranges.map((r, i) => ({ in: r.in, out: r.out, uid: i }));
  let nextUid = list.length;
  const changed = [];
  const byUid = uid => list.find(r => r.uid === uid);
  const fixes = findings.map(f => f.fix).filter(Boolean);
  for (const fx of fixes.filter(x => x.op === 'mergeNeighbors')) {
    const a = byUid(fx.range), b = a && list.find(r => r.uid !== a.uid && r.in >= a.out - 1e-6 && r.in - a.out <= 0.5);
    if (a && b) { a.out = b.out; list = list.filter(r => r !== b); changed.push(`merged segment ${fx.range + 1} with the next`); }
  }
  const EDGE = 0.04; // quiet runs are measured on a 20 ms grid, so "touches the edge" needs a tolerance
  for (const fx of fixes.filter(x => x.op === 'removeQuiet').sort((x, y) => y.from - x.from)) {
    const r = byUid(fx.range);
    if (!r) continue;
    const atStart = fx.from <= r.in + EDGE, atEnd = fx.to >= r.out - EDGE;
    if (atStart && !atEnd) { r.in = Math.min(r.out - 0.05, Math.max(r.in, fx.to - pad)); changed.push(`trimmed ${(fx.to - fx.from).toFixed(2)} s of quiet from the start of segment ${fx.range + 1}`); continue; }
    if (atEnd && !atStart) { r.out = Math.max(r.in + 0.05, Math.min(r.out, fx.from + pad)); changed.push(`trimmed ${(fx.to - fx.from).toFixed(2)} s of quiet from the end of segment ${fx.range + 1}`); continue; }
    if (atStart && atEnd) continue; // the whole segment is quiet; nothing sensible to keep
    const left = { in: r.in, out: fx.from + pad, uid: r.uid };
    const right = { in: fx.to - pad, out: r.out, uid: nextUid++ };
    list = list.filter(x => x !== r);
    if (left.out - left.in > 0.05) list.push(left);
    if (right.out - right.in > 0.05) list.push(right);
    changed.push(`split segment ${fx.range + 1}: removed ${(fx.to - fx.from).toFixed(2)} s of quiet at ${fx.from.toFixed(2)} s`);
  }
  for (const fx of fixes.filter(x => x.op === 'restore')) { list.push({ in: Math.max(0, fx.from - 0.04), out: fx.to + 0.04, uid: nextUid++ }); changed.push(`restored ${fx.from.toFixed(2)}–${fx.to.toFixed(2)} s`); }
  if (fixes.some(x => x.op === 'calmZoom')) { context = { ...context, options: { ...context.options, jumpZoom: false } }; changed.push('removed the per-cut zoom'); }
  const aligned = alignRanges(merge(list.map(r => ({ in: r.in, out: r.out })), 0.06), context.fps, context.info.duration);
  const version = (artifact.version || 1) + 1;
  const outputDir = path.join(ctx.root, `edit-r${version}`);
  const next = await materializeEdit(context, aligned, outputDir);
  return { artifact: { ...artifact, context, result: next, outputDir, manifestFile: path.join(outputDir, 'production.json'), version }, changed };
}

// ---------------------------------------------------------------- storyboard
const GENERIC_LABELS = new Set(['welcome', 'concept', 'definition', 'conceptual', 'schematic', 'what', "we'll", 'cover', 'coming', 'up', 'in', 'this', 'course']);
const textFields = props => [props.title, props.text, props.term, props.definition, props.label, props.kicker, props.subtitle, props.note, ...(props.items || []), ...(props.steps || []).map(s => s.title),
  ...(props.nodes || []).map(n => n.label), ...(props.bars || []).map(b => b.label), ...(props.columns || []).flatMap(c => [c.heading, ...(c.items || [])])].filter(Boolean);

export function reviewStoryboard(artifact, { style = null } = {}) {
  const { storyboard, words, duration } = artifact;
  const conf = DENSITY[storyboard.density];
  const vocab = vocabulary(words);
  const items = [...storyboard.items].sort((a, b) => a.start - b.start);
  const findings = [];
  for (const it of items) {
    const tokens = textFields(it.props).join(' ').replace(/\*/g, '').toLowerCase().match(/[\p{L}\p{N}'.]+/gu) || [];
    const numbers = tokens.filter(t => /^\d/.test(t) && !vocab.has(t.replace(/[.,]$/, '')));
    const content = tokens.filter(t => !STOP_WORDS.has(t) && !GENERIC_LABELS.has(t) && t.length > 2 && !/^\d/.test(t));
    const unknown = content.filter(t => !vocab.has(t));
    if (numbers.length) findings.push(finding({ id: `sb-number-${it.id}`, severity: 'blocker', owner: 'storyboard', target: { item: it.id }, message: `${it.id} shows a number (${numbers.join(', ')}) the speaker never said`, suggestion: 'remove the graphic or use a number from the transcript', fix: { op: 'dropItem', id: it.id } }));
    else if (content.length >= 3 && unknown.length / content.length > 0.5) findings.push(finding({ id: `sb-grounding-${it.id}`, severity: 'major', owner: 'storyboard', target: { item: it.id }, message: `${it.id} uses words that are mostly not in the transcript (${unknown.slice(0, 4).join(', ')})`, suggestion: 'rephrase with the speaker\'s words or drop it', fix: { op: 'dropItem', id: it.id } }));
    if (it.start + it.duration > duration + 0.05 || it.start < 0) findings.push(finding({ id: `sb-bounds-${it.id}`, severity: 'blocker', owner: 'storyboard', target: { item: it.id }, message: `${it.id} runs outside the video`, fix: { op: 'dropItem', id: it.id } }));
    const longText = textFields(it.props).find(t => t.length > (it.template === 'title' ? 70 : 90));
    if (longText) findings.push(finding({ id: `sb-length-${it.id}`, severity: 'minor', owner: 'storyboard', target: { item: it.id }, message: `${it.id} has long text that may be hard to read ("${longText.slice(0, 40)}…")` }));
  }
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1], cur = items[i];
    if (cur.start < prev.start + prev.duration - 0.01) {
      const drop = prev.score <= cur.score ? prev : cur;
      findings.push(finding({ id: `sb-overlap-${prev.id}-${cur.id}`, severity: 'blocker', owner: 'storyboard', target: { item: drop.id }, message: `${prev.id} and ${cur.id} overlap`, suggestion: `drop the lower-scoring one (${drop.id})`, fix: { op: 'dropItem', id: drop.id } }));
    }
  }
  const cutaways = items.filter(i => i.mode === 'cutaway');
  const cutawaySeconds = cutaways.reduce((n, i) => n + i.duration, 0);
  const share = cutawaySeconds / Math.max(1, duration);
  if (share > 0.22) {
    let excess = cutawaySeconds - 0.22 * duration;
    for (const it of [...cutaways].filter(i => i.template !== 'title').sort((a, b) => b.duration - a.duration)) {
      if (excess <= 0) break;
      findings.push(finding({ id: `sb-cutaway-${it.id}`, severity: 'major', owner: 'storyboard', target: { item: it.id }, message: `full-frame cutaways cover ${(share * 100).toFixed(0)}% of the video (limit 22%); ${it.id} hides the picture for ${it.duration.toFixed(1)} s`, suggestion: 'show it as a side panel instead', fix: { op: 'toPanel', id: it.id } }));
      excess -= it.duration;
    }
  }
  // Long stretches without any graphic, only flagged when the transcript has something to show there.
  const limit = conf.fillGap * 1.6;
  const edges = [0, ...items.flatMap(i => [i.start, i.start + i.duration]), duration];
  for (let k = 0; k < edges.length; k += 2) {
    const from = edges[k], to = edges[k + 1];
    if (to - from <= limit) continue;
    const window = words.filter(w => w.start >= from && w.end <= to);
    const fill = window.length > 12 ? planStoryboard(window, { duration, density: 'heavy', graphics: storyboard.graphics, theme: storyboard.theme, style }).items.filter(i => i.start >= from && i.start + i.duration <= to) : [];
    findings.push(finding({ id: `sb-gap-${from.toFixed(0)}`, severity: fill.length ? 'major' : 'minor', owner: 'storyboard', target: { window: [round(from), round(to)] },
      message: `${(to - from).toFixed(0)} s without a graphic (${from.toFixed(0)}–${to.toFixed(0)} s)${fill.length ? '' : '; nothing suitable found there'}`, suggestion: 'add a graphic for the idea in this window', fix: fill.length ? { op: 'fillWindow', from: round(from), to: round(to) } : null }));
  }
  if (style?.maxShare) for (const [template, cap] of Object.entries(style.maxShare)) {
    const same = items.filter(i => i.template === template);
    if (same.length > Math.max(1, Math.ceil(cap * items.length * 1.5))) {
      for (const it of [...same].sort((a, b) => a.score - b.score).slice(0, same.length - Math.ceil(cap * items.length))) findings.push(finding({ id: `sb-share-${it.id}`, severity: 'minor', owner: 'storyboard', target: { item: it.id }, message: `${template} is over the style share (${same.length} of ${items.length})`, suggestion: 'drop the weakest ones', fix: { op: 'dropItem', id: it.id } }));
    }
  }
  return verdict({ stage: 'storyboard', round: 0, reviewer: 'storyboard-reviewer (code)', findings, metrics: { graphics: items.length, perMinute: round(items.length / (duration / 60)), cutawayPercent: round(share * 100) } });
}

export async function reviseStoryboard(artifact, findings, ctx) {
  const storyboard = JSON.parse(JSON.stringify(artifact.storyboard));
  const style = resolveStyle(storyboard.style && storyboard.style !== 'plain' ? storyboard.style : (artifact.styleName || 'plain'));
  const changed = [];
  for (const f of findings) {
    const fx = f.fix;
    if (!fx) continue;
    if (fx.op === 'dropItem') { const n = storyboard.items.length; storyboard.items = storyboard.items.filter(i => i.id !== fx.id); if (storyboard.items.length < n) changed.push(`dropped ${fx.id}`); }
    if (fx.op === 'toPanel') { const it = storyboard.items.find(i => i.id === fx.id); if (it) { it.mode = 'panel'; it.duration = Math.min(it.duration + 2, 26); changed.push(`${fx.id}: cutaway → side panel`); } }
    if (fx.op === 'setProps') { const it = storyboard.items.find(i => i.id === fx.id); if (it && fx.props) { it.props = fx.props; changed.push(`${fx.id}: props rewritten`); } }
    if (fx.op === 'fillWindow') {
      const window = artifact.words.filter(w => w.start >= fx.from && w.end <= fx.to);
      const planned = planStoryboard(window, { duration: artifact.duration, density: 'heavy', graphics: storyboard.graphics, theme: storyboard.theme, style });
      for (const it of planned.items.filter(i => i.start >= fx.from && i.start + i.duration <= fx.to)) {
        if (storyboard.items.some(o => it.start < o.start + o.duration + 0.3 && o.start < it.start + it.duration + 0.3)) continue;
        storyboard.items.push({ ...it, id: `f${storyboard.items.length + 1}` });
        changed.push(`added ${it.template} at ${it.start.toFixed(1)} s for the empty window ${fx.from}–${fx.to} s`);
        if (changed.filter(c => c.includes(`window ${fx.from}`)).length >= 3) break;
      }
    }
  }
  storyboard.items.sort((a, b) => a.start - b.start);
  const byTemplate = {};
  for (const it of storyboard.items) byTemplate[it.template] = (byTemplate[it.template] || 0) + 1;
  storyboard.stats = { ...storyboard.stats, graphics: storyboard.items.length, perMinute: round(storyboard.items.length / (artifact.duration / 60)),
    cutawaySeconds: round(storyboard.items.filter(i => i.mode === 'cutaway').reduce((n, i) => n + i.duration, 0)), byTemplate };
  const version = (artifact.version || 1) + 1;
  const base = await readJson(artifact.baseManifestFile);
  const applied = applyStoryboard(base, storyboard, style);
  const stem = path.join(path.dirname(artifact.baseManifestFile), `production.graphics.r${version}`);
  await writeJson(`${stem}.json`, applied);
  await loadTimeline(`${stem}.json`, ctx.execute);
  await writeJson(`${stem}.storyboard.json`, storyboard);
  await writeNew(`${stem}.STORYBOARD.md`, storyboardMarkdown(storyboard, `Storyboard (revision ${version})`));
  return { artifact: { ...artifact, storyboard, manifestFile: `${stem}.json`, storyboardFile: `${stem}.storyboard.json`, version }, changed };
}

// ---------------------------------------------------------------- render
async function detect(file, filter, execute, stream = 'v') {
  const flags = stream === 'v' ? ['-an'] : ['-vn'];
  const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', file, ...flags, ...(stream === 'v' ? ['-vf', filter] : ['-af', filter]), '-f', 'null', '-'], { timeout: 3600_000 });
  return String(stderr);
}

export async function reviewRender(artifact, ctx) {
  const { outputDir, report } = artifact;
  const execute = ctx.execute || run;
  const findings = [];
  const final = path.join(outputDir, 'final.mp4');
  for (const [name, result] of Object.entries(report.verification?.checks || {})) {
    if (result === 'FAIL') findings.push(finding({ id: `render-check-${name}`, severity: 'blocker', owner: 'render', message: `technical check "${name}" failed`, suggestion: name === 'truePeak' || name === 'loudness' ? 'rebuild with more audio headroom' : 'rebuild' }));
  }
  const storyboard = ctx.artifacts?.storyboard?.storyboard;
  const cut = ctx.artifacts?.cut?.result;
  const black = [...(await detect(final, 'blackdetect=d=0.5:pix_th=0.1', execute)).matchAll(/black_start:([0-9.]+)\s+black_end:([0-9.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  for (const [from, to] of black) {
    const item = storyboard?.items.find(i => from >= i.start - 0.3 && from < i.start + i.duration + 0.3);
    findings.push(finding({ id: `render-black-${from.toFixed(1)}`, severity: 'major', owner: item ? 'storyboard' : 'render', target: { time: [from, to], ...(item ? { item: item.id } : {}) },
      message: `black frames for ${(to - from).toFixed(1)} s at ${from.toFixed(1)} s${item ? ` (during ${item.id})` : ''}`, ...(item ? { suggestion: 'drop the graphic that renders black', fix: { op: 'dropItem', id: item.id } } : {}) }));
  }
  // Frozen picture: expected for screen recordings and held slides, so always advisory.
  const frozen = [...(await detect(final, 'freezedetect=n=-60dB:d=4', execute)).matchAll(/freeze_start: ([0-9.]+)[\s\S]*?freeze_end: ([0-9.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  for (const [from, to] of frozen) {
    findings.push(finding({ id: `render-freeze-${from.toFixed(1)}`, severity: 'minor', owner: 'render', target: { time: [from, to] },
      message: `the picture is frozen for ${(to - from).toFixed(1)} s at ${from.toFixed(1)} s`, suggestion: 'add a graphic, B-roll or a zoom here, or cut the stretch if it is dead time' }));
  }
  const silences = [...(await detect(final, 'silencedetect=noise=-45dB:d=0.8', execute, 'a')).matchAll(/silence_start: ([0-9.]+)[\s\S]*?silence_end: ([0-9.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  for (const [from, to] of silences) {
    const mapped = cut ? mapTimeline(cut, from) : null;
    findings.push(finding({ id: `render-silence-${from.toFixed(1)}`, severity: 'major', owner: mapped ? 'cut' : 'render', target: { time: [from, to] }, message: `${(to - from).toFixed(1)} s of silence at ${from.toFixed(1)} s in the final video`,
      ...(mapped ? { suggestion: 'cut the dead air', fix: { op: 'removeQuiet', range: mapped.index, from: round(mapped.source), to: round(Math.min(mapped.rangeEnd, mapped.source + (to - from))) } } : {}) }));
  }
  // Readability audit of the rendered graphics: off-canvas or clipped text is a defect; tiny text and low contrast are advisories.
  for (const g of report.graphicAudit || []) {
    const item = storyboard?.items.find(i => g.start >= i.start - 0.3 && g.start < i.start + i.duration + 0.3);
    for (const issue of g.issues) {
      const hard = issue.kind === 'offcanvas' || issue.kind === 'clipped';
      const word = { offcanvas: 'runs off the edge of the frame', clipped: 'is clipped by its box', small: 'is too small to read on a phone', contrast: 'has low contrast' }[issue.kind];
      findings.push(finding({ id: `render-layout-${g.key}-${issue.kind}`, severity: hard ? 'major' : 'minor', owner: item ? 'storyboard' : 'render', target: { time: [g.start, g.start + g.duration], ...(item ? { item: item.id } : {}) },
        message: `${g.template} text "${issue.text}" ${word} (${issue.detail})`,
        ...(item && hard ? { suggestion: 'shorten the text or drop the graphic', fix: { op: 'dropItem', id: item.id } } : { suggestion: 'shorten the text or pick a roomier template' }) }));
    }
  }
  // Caption quality: overlaps are defects; speed, length, flicker and lone words are advisories unless widespread.
  const srtFile = path.join(outputDir, 'captions.srt');
  if (await exists(srtFile)) {
    for (const issue of auditSrt(await readFile(srtFile, 'utf8'))) {
      const share = issue.count / Math.max(1, issue.total);
      const word = { overlap: 'overlap the next caption', fast: 'are read too fast', long: 'are too long for one screen', flicker: 'flash by too quickly', lone: 'show a lone short word' }[issue.kind];
      findings.push(finding({ id: `render-captions-${issue.kind}`, severity: issue.kind === 'overlap' || share > 0.25 ? 'major' : 'minor', owner: 'render', target: { time: [issue.examples[0].at, issue.examples[0].at + 2] },
        message: `${issue.count} caption page(s) ${word} (limit ${issue.limit}); first at ${issue.examples[0].at}s: "${issue.examples[0].text}"`,
        suggestion: 'adjust captions.maxWords / maxChars or add captions.fixes' }));
    }
  }
  if (artifact.manifestCaptions && !(await exists(path.join(outputDir, 'captions.srt')))) findings.push(finding({ id: 'render-captions', severity: 'major', owner: 'render', message: 'captions were requested but captions.srt was not produced' }));
  let costUsd = null;
  if (ctx.agent === 'claude') {
    const images = ['contact-sheet.png', 'thumbnail.png'].map(f => path.join(outputDir, f));
    const sample = await sampleFrames(final, report.timeline.duration, execute, outputDir);
    const material = `Final video ${report.verification.measured.width}x${report.verification.measured.height}, ${report.timeline.duration} s.\nGraphics on the timeline (id, start, duration, template, mode):\n${(storyboard?.items || []).map(i => `${i.id} ${i.start}s +${i.duration}s ${i.template} ${i.mode}`).join('\n')}`;
    const reviewed = await claudeReview({ stage: 'render', material, images: [...images, ...sample].filter(Boolean), cwd: outputDir, allowLlm: ctx.allowLlm, model: ctx.reviewModel, style: ctx.style }, execute);
    findings.push(...reviewed.findings);
    costUsd = reviewed.costUsd;
  }
  return verdict({ stage: 'render', round: 0, reviewer: ctx.agent === 'claude' ? 'render-reviewer (code + Claude)' : 'render-reviewer (code)', findings, metrics: { blackSegments: black.length, frozenSegments: frozen.length, silentSegments: silences.length, loudness: report.verification?.measured?.integratedLufs, truePeak: report.verification?.measured?.truePeakDb, ...(costUsd ? { reviewCostUsd: costUsd } : {}) } });
}

async function sampleFrames(file, duration, execute, dir) {
  const out = [];
  for (const fraction of [0.12, 0.3, 0.5, 0.7, 0.9]) {
    const target = path.join(dir, `review-frame-${Math.round(fraction * 100)}.png`);
    try { await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(duration * fraction), '-i', file, '-frames:v', '1', '-vf', 'scale=1280:-2', target]); out.push(target); } catch { /* skip */ }
  }
  return out;
}

function mapTimeline(cut, t) {
  const fps = cut.report.fps;
  for (let i = 0; i < cut.ranges.length; i++) {
    const r = cut.ranges[i];
    const length = (r.timelineFrames ?? r.frames) / fps;
    if (t >= r.start && t < r.start + length) return { index: i, source: r.in + (t - r.start) * (r.speed || 1), rangeEnd: r.out };
  }
  return null;
}

// ---------------------------------------------------------------- stage factories
export function buildStages(options, execute = run) {
  const root = options.root;
  const log = options.log || (() => {});
  const style = resolveStyle(options.style || 'bytemonk');
  const stages = [];
  const agent = options.reviewAgent === 'claude' ? 'claude' : null;
  const common = { execute, root, agent, allowLlm: options.allowLlm, style, reviewModel: options.reviewModel };

  if (options.words || options.transcribe) {
    stages.push({
      name: 'transcript',
      async produce() {
        if (options.words) { const words = await readJson(options.words); return { words, file: path.resolve(options.words), version: 1 }; }
        const out = await transcribeWhisper(options.media, path.join(root, 'transcript'), { allowTranscribe: true, model: options.model, language: options.language, prompt: options.asrPrompt }, execute);
        return { words: out.words, file: path.join(root, 'transcript', 'words.json'), version: 1, cached: out.report.cached === true };
      },
      async review(artifact, ctx) {
        const v = reviewTranscript(artifact, { glossary: options.glossary || [] });
        let findings = v.findings;
        if (agent) {
          const text = artifact.words.map((w, i) => `${i}:${w.text}`).join(' ').slice(0, 20000);
          findings = findings.concat((await claudeReview({ stage: 'transcript', material: text, allowLlm: options.allowLlm, model: options.reviewModel }, execute)).findings);
        }
        return verdict({ stage: 'transcript', round: ctx.round, reviewer: agent ? 'transcript-reviewer (code + Claude)' : v.reviewer, findings, metrics: v.metrics });
      },
      async revise(artifact, findings) {
        const out = reviseTranscript(artifact, findings);
        if (out.artifact.dirty) {
          const file = path.join(root, `words.r${out.artifact.version}.json`);
          await writeJson(file, out.artifact.words);
          out.artifact.file = file;
          out.artifact.dirty = false;
        }
        return out;
      }
    });
  }

  stages.push({
    name: 'cut',
    async produce(ctx) {
      const words = ctx.artifacts.transcript?.file;
      const dir = path.join(root, 'edit');
      const result = await autocut(options.media, dir, { ...options.cut, words, style: style.name }, execute);
      return { result, context: result.context, outputDir: dir, manifestFile: path.join(dir, 'production.json'), version: 1 };
    },
    async review(artifact, ctx) { const v = reviewCut(artifact); return { ...v, round: ctx.round }; },
    async revise(artifact, findings, ctx) { return reviseCut(artifact, findings, { ...ctx, root }); }
  });

  if (options.words || options.transcribe) {
    stages.push({
      name: 'storyboard',
      async produce(ctx) {
        const cut = ctx.artifacts.cut;
        // The cut may have been revised into edit-rN; the graphics manifest must sit beside whichever manifest it extends.
        const out = path.join(path.dirname(cut.manifestFile), `production.graphics.${Date.now().toString(36)}.json`);
        const planned = await storyboardManifest(cut.manifestFile, out, { ...options.storyboard, style: style.name }, execute);
        const loaded = await loadTimeline(planned.manifest, execute);
        return { storyboard: planned.storyboard, manifestFile: planned.manifest, storyboardFile: planned.storyboardFile, baseManifestFile: cut.manifestFile, words: loaded.words, duration: loaded.duration, version: 1, styleName: style.name };
      },
      async review(artifact, ctx) {
        const v = reviewStoryboard(artifact, { style });
        let findings = v.findings;
        if (agent) {
          const lines = artifact.storyboard.items.map(i => `${i.id} [${i.start}s +${i.duration}s] ${i.template}/${i.mode}: "${i.line}" props=${JSON.stringify(i.props).slice(0, 400)}`).join('\n');
          findings = findings.concat((await claudeReview({ stage: 'storyboard', material: lines, allowLlm: options.allowLlm, model: options.reviewModel, style }, execute)).findings);
        }
        return verdict({ stage: 'storyboard', round: ctx.round, reviewer: agent ? 'storyboard-reviewer (code + Claude)' : v.reviewer, findings, metrics: v.metrics });
      },
      async revise(artifact, findings, ctx) { return reviseStoryboard(artifact, findings, { ...ctx, execute }); }
    });
  }

  stages.push({
    name: 'render',
    async produce(ctx) {
      const prior = ctx.artifacts.storyboard || ctx.artifacts.cut;
      const manifest = prior.manifestFile;
      const version = (ctx.renderVersion = (ctx.renderVersion || 0) + 1);
      const review = path.join(path.dirname(manifest), `review.${version}.${Date.now().toString(36)}.json`);
      await reviewProduction(manifest, review, true, execute);
      const outputDir = path.join(root, version === 1 ? 'render' : `render-r${version}`);
      const report = await buildProduction(manifest, review, outputDir, true, execute, undefined, { log, quality: options.quality, concurrency: options.concurrency });
      return { outputDir, report, manifestFile: manifest, version, manifestCaptions: Boolean(JSON.parse(await readFile(manifest, 'utf8')).captions) };
    },
    async review(artifact, ctx) { const v = await reviewRender(artifact, { ...ctx, ...common }); return { ...v, round: ctx.round }; },
    async revise(artifact, findings, ctx) {
      // Render-owned findings (technical, captions): rebuild into a fresh folder. Upstream-owned ones are routed by the lead loop.
      const next = await stages.find(s => s.name === 'render').produce({ ...ctx, artifacts: ctx.artifacts });
      return { artifact: next, changed: [`rebuilt into ${path.basename(next.outputDir)} to address ${findings.map(f => f.id).join(', ')}`] };
    }
  });
  return stages;
}

