// Automated rough cut for talking-head / screen recordings: measure silences, remove pauses and filler
// words, frame-align the kept ranges and emit a version-2 production manifest with remapped captions.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { exists, readJson, run, writeJson } from './core.js';
import { inspectMedia } from './production.js';
import { remapWords, validateWords } from './captions.js';

const fail = message => { throw new Error(`Autocut: ${message}`); };
const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const round = n => Math.round(n * 1000) / 1000 + 0;
export const FILLERS = ['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'ahh', 'hmm', 'mm', 'mhm'];

export async function detectSilence(media, { noiseDb = -35, minSilence = 0.35 } = {}, execute = run) {
  const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', path.resolve(media), '-vn',
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-'], { timeout: 6 * 3600_000 });
  const silences = [];
  let open = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    const s = line.match(/silence_start: (-?[0-9.]+)/);
    if (s) open = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end: ([0-9.]+)/);
    if (e && open !== null) { silences.push({ start: round(open), end: round(Number(e[1])) }); open = null; }
  }
  if (open !== null) silences.push({ start: round(open), end: Infinity });
  return silences;
}

// Clip word edges that bleed into measured silence (ASR word ends often extend over pauses).
export function refineWords(words, silences, duration = Infinity) {
  return words.map(w => {
    let { start, end } = w;
    for (const s of silences) {
      // A word wholly inside measured silence is an ASR timing error: snap it to the end of that silence.
      if (start >= s.start && end <= Math.min(s.end, duration)) { start = Math.min(s.end, duration); end = start + 0.04; continue; }
      const sEnd = Math.min(s.end, duration);
      if (start < s.start && end > s.start && end <= sEnd + 0.05) end = s.start;
      if (start >= s.start && start < sEnd && end > sEnd) start = sEnd;
    }
    if (end - start < 0.04) end = start + 0.04;
    return { text: w.text, start: round(start), end: round(end) };
  });
}

const normalizeWord = text => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function subtract(ranges, cut) {
  const out = [];
  for (const r of ranges) {
    if (cut.end <= r.in || cut.start >= r.out) { out.push(r); continue; }
    if (cut.start > r.in) out.push({ in: r.in, out: cut.start });
    if (cut.end < r.out) out.push({ in: cut.end, out: r.out });
  }
  return out;
}

// Pure planning step (unit-tested). Returns frame-aligned kept source ranges.
export function planCuts({ duration, fps, silences = [], words = null, removeFillers = true, fillers = FILLERS,
  padBefore = 0.08, padAfter = 0.14, minKeep = 0.3, mergeGap = 0.12 }) {
  let keep = [{ in: 0, out: duration }];
  for (const s of silences) keep = subtract(keep, { start: s.start, end: Math.min(s.end, duration) });
  const removed = [];
  if (words && removeFillers) {
    const set = new Set(fillers);
    for (const w of words) {
      if (set.has(normalizeWord(w.text))) { keep = subtract(keep, { start: w.start - 0.02, end: w.end + 0.02 }); removed.push(w); }
    }
  }
  // Pad, then merge ranges whose padded edges touch or nearly touch.
  const padded = keep.map(r => ({ in: Math.max(0, r.in - padBefore), out: Math.min(duration, r.out + padAfter) }))
    .sort((a, b) => a.in - b.in);
  const merged = [];
  for (const r of padded) {
    const last = merged.at(-1);
    if (last && r.in - last.out <= mergeGap) last.out = Math.max(last.out, r.out);
    else merged.push({ ...r });
  }
  // Never let padding re-include a removed filler.
  let result = merged;
  for (const w of removed) result = subtract(result, { start: w.start - 0.01, end: w.end + 0.01 });
  const hasWords = r => !words || words.some(w => w.end > r.in && w.start < r.out);
  return result
    .map(r => {
      const a = Math.ceil(r.in * fps - 1e-6) / fps;
      const frames = Math.floor((Math.min(r.out, duration) - a) * fps + 1e-6);
      return { in: round(a), out: round(a + frames / fps), frames };
    })
    .filter(r => r.frames >= 1 && (r.out - r.in >= minKeep || hasWords(r)) && hasWords(r));
}

const nearestRate = fps => [24, 25, 30, 50, 60].reduce((best, r) => (Math.abs(r - fps) < Math.abs(best - fps) ? r : best), 30);
export const FORMATS = { landscape: [1920, 1080], vertical: [1080, 1920], square: [1080, 1080], source: null };

export async function autocut(media, output, options = {}, execute = run) {
  const source = path.resolve(media);
  if (await exists(output)) fail(`output already exists: ${output}`);
  const info = await inspectMedia(source, execute);
  if (!info.video || !info.audio) fail('autocut needs a recording with both video and audio');
  const [num, den] = (info.video.avg_frame_rate || '30/1').split('/').map(Number);
  const fps = options.fps || nearestRate(num / den);
  const format = options.format || 'source';
  if (!Object.hasOwn(FORMATS, format)) fail(`format must be ${Object.keys(FORMATS).join(', ')}`);
  let [width, height] = FORMATS[format] || [info.video.width, info.video.height];
  width = Math.min(3840, width - (width % 2)); height = Math.min(3840, height - (height % 2));
  const silences = await detectSilence(source, { noiseDb: options.noiseDb ?? -35, minSilence: options.minSilence ?? 0.35 }, execute);
  const words = options.words ? validateWords(await readJson(options.words), info.duration + 1, 'words') : null;
  const ranges = planCuts({ duration: info.duration, fps, silences, words, removeFillers: options.removeFillers !== false,
    padBefore: options.padBefore, padAfter: options.padAfter });
  if (!ranges.length) fail('no speech found; adjust --noise-db/--min-silence or check the audio');
  let cursor = 0;
  const placed = ranges.map(r => { const p = { ...r, start: round(cursor) }; cursor += r.frames / fps; return p; });
  await mkdir(output, { recursive: true });
  const rel = p => path.relative(output, p).split(path.sep).join('/');
  const manifest = {
    version: 2, title: options.title || path.basename(source, path.extname(source)), fps, width, height,
    assets: [{ id: 'recording', path: rel(source), kind: 'video', approved: options.rightsConfirmed === true,
      rights: options.rights || 'Original recording by the creator (confirm before approval)', attribution: options.attribution || 'Creator' }],
    scenes: placed.map((r, i) => ({
      id: `cut-${String(i + 1).padStart(3, '0')}`, kind: 'video', asset: 'recording', in: r.in, duration: round(r.frames / fps),
      fit: 'cover', audio: {}, purpose: `Speech segment ${i + 1} (auto-cut ${r.in.toFixed(2)}–${r.out.toFixed(2)}s)`,
      ...(options.jumpZoom !== false && i % 2 === 1 ? { motion: { type: 'punch-in', amount: 0.08 } } : {})
    })),
    delivery: { targetLufs: options.targetLufs ?? -14, truePeak: -1 }
  };
  let timelineWords = null;
  if (words) {
    timelineWords = remapWords(words, placed);
    await writeJson(path.join(output, 'words.timeline.json'), timelineWords);
    manifest.captions = { words: 'words.timeline.json', style: options.captionStyle || 'kinetic', position: 'bottom' };
  }
  await writeJson(path.join(output, 'production.json'), manifest);
  const kept = placed.reduce((n, r) => n + r.frames / fps, 0);
  const report = {
    version: 1, source, sourceDuration: round(info.duration), editedDuration: round(kept), removedSeconds: round(info.duration - kept),
    cuts: placed.length, silencesDetected: silences.length, fillersRemoved: words ? words.filter(w => FILLERS.includes(normalizeWord(w.text))).length : 0,
    captionWords: timelineWords?.length ?? 0, fps, width, height, format,
    settings: { noiseDb: options.noiseDb ?? -35, minSilence: options.minSilence ?? 0.35, removeFillers: options.removeFillers !== false },
    next: [
      'Watch the auto-cut (production-build with --quality draft) and adjust scene in/duration where a cut feels abrupt.',
      'Add motion graphics: scene.overlays (lower-third, bar-chart, flow, callout...) or insert graphic scenes. Run `video-monk templates`.',
      'Add music via audio.music (ducked under speech automatically) and SFX via audio.sfx.',
      manifest.assets[0].approved ? 'Run production-review --approve-plan after reviewing.' : 'Set assets[0].approved=true once you confirm the recording rights.'
    ]
  };
  await writeJson(path.join(output, 'autocut-report.json'), report);
  return { manifest, report, ranges: placed, words: timelineWords };
}

// Measure your own footage: technical metadata, loudness, speech/silence ratio and scene-change density.
export async function analyzeFootage(media, execute = run) {
  const source = path.resolve(media);
  const info = await inspectMedia(source, execute);
  const result = { source, duration: info.duration, video: null, audio: null };
  if (info.video) {
    const [num, den] = (info.video.avg_frame_rate || '0/1').split('/').map(Number);
    const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', source, '-an',
      '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { timeout: 6 * 3600_000 });
    const cuts = [...String(stderr).matchAll(/pts_time:([0-9.]+)/g)].map(m => round(Number(m[1])));
    result.video = { width: info.video.width, height: info.video.height, fps: round(num / den), codec: info.video.codec_name,
      sceneChanges: cuts, sceneChangesPerMinute: round(cuts.length / (info.duration / 60)) };
  }
  if (info.audio) {
    const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', source, '-vn',
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { timeout: 6 * 3600_000 });
    const loud = JSON.parse(String(stderr).match(/\{\s*"input_i"[\s\S]*?\}/)?.[0] || '{}');
    const silences = await detectSilence(source, {}, execute);
    const silent = silences.reduce((n, s) => n + Math.min(s.end, info.duration) - s.start, 0);
    result.audio = { codec: info.audio.codec_name, sampleRate: Number(info.audio.sample_rate), channels: info.audio.channels,
      integratedLufs: Number(loud.input_i), truePeakDb: Number(loud.input_tp), loudnessRange: Number(loud.input_lra),
      silenceSeconds: round(silent), speechRatio: round(1 - silent / info.duration), pauses: silences.length };
  }
  result.suggestions = [];
  if (result.audio && result.audio.speechRatio < 0.85) result.suggestions.push(`~${round(result.audio.silenceSeconds)}s of pauses: run autocut to tighten pacing.`);
  if (result.audio && result.audio.integratedLufs < -24) result.suggestions.push('Quiet recording: mastering will raise it, but check for noise.');
  if (result.audio && result.audio.truePeakDb > -0.5) result.suggestions.push('Source audio peaks near 0 dBFS: check for clipping.');
  if (result.video && result.video.sceneChangesPerMinute < 2 && info.duration > 60) result.suggestions.push('Few visual changes: add B-roll, punch-ins or motion graphics every 5-15s.');
  return result;
}
