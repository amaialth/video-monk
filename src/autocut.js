// Automated rough cut for talking-head / screen recordings: measure silences, remove pauses and filler
// words, frame-align the kept ranges and emit a version-2 production manifest with remapped captions.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { exists, readJson, run, writeJson } from './core.js';
import { inspectMedia } from './production.js';
import { remapWords, validateWords } from './captions.js';
import { resolveStyle } from './style.js';

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

// Pace presets. `noiseDb: 'auto'` measures this recording's own noise floor and speech level (see chooseNoiseDb).
export const PACE = {
  // relaxed: interviews, vlogs and conversation, where breathing room is part of the voice. Only long dead air goes.
  relaxed: { noiseDb: 'auto', minSilence: 0.7, padBefore: 0.12, padAfter: 0.25, mergeGap: 0.25, trim: true, quiet: null },
  natural: { noiseDb: -35, minSilence: 0.35, padBefore: 0.08, padAfter: 0.14, mergeGap: 0.12, trim: false, quiet: null },
  tight: { noiseDb: 'auto', minSilence: 0.15, padBefore: 0.05, padAfter: 0.08, mergeGap: 0.06, trim: true, quiet: { aboveDb: 3, minLen: 0.3 } },
  extra: { noiseDb: 'auto+2', minSilence: 0.1, padBefore: 0.04, padAfter: 0.06, mergeGap: 0.04, trim: true, quiet: { aboveDb: 4, minLen: 0.25 } }
};
export const LEVEL_STEP = 0.02;
export const ZOOM_HOLD = 8; // seconds a zoom state is held before it may change

// RMS level (dB) of every 20 ms window. Used to measure the noise floor and to trim low-level breaths/hums at cut edges.
export async function levelProfile(media, execute = run) {
  const { stdout } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', path.resolve(media), '-vn', '-af',
    'aresample=48000,aformat=channel_layouts=mono,asetnsamples=n=960:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-'], { timeout: 6 * 3600_000, maxBuffer: 512 * 1024 * 1024 });
  const levels = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = line.match(/RMS_level=(-?[0-9.]+|-inf|inf)/);
    if (m) levels.push(Number.isFinite(Number(m[1])) ? Number(m[1]) : -90);
  }
  return levels;
}

// Otsu split between the room-noise mode and the speech mode of the level histogram, clamped to a sane range.
export function chooseNoiseDb(levels, { min = -48, max = -30 } = {}) {
  if (levels.length < 50) return { noiseDb: -35, floorDb: null, speechDb: null };
  const bins = new Array(81).fill(0);
  for (const v of levels) bins[Math.round(Math.max(-80, Math.min(0, v))) + 80]++;
  const total = levels.length;
  const sumAll = bins.reduce((n, c, i) => n + i * c, 0);
  let wb = 0, sb = 0, best = -1, threshold = 40;
  for (let i = 0; i < 81; i++) {
    wb += bins[i];
    if (!wb) continue;
    const wf = total - wb;
    if (!wf) break;
    sb += i * bins[i];
    const variance = wb * wf * (sb / wb - (sumAll - sb) / wf) ** 2;
    if (variance > best) { best = variance; threshold = i; }
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const otsu = threshold - 80;
  return { noiseDb: Math.max(min, Math.min(max, otsu)), otsuDb: otsu, floorDb: round(quantile(0.1)), speechDb: round(quantile(0.75)) };
}

// Stretches that stay below speech level for a while are not speech even when they are above the noise floor: breaths,
// "hm" hums, mouth noise. Natural speech dips between words last well under 0.2 s.
export function quietRuns(levels, thresholdDb, minLen) {
  const runs = [];
  let from = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] < thresholdDb;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      if ((i - from) * LEVEL_STEP >= minLen) runs.push({ start: round(from * LEVEL_STEP), end: round(i * LEVEL_STEP) });
      from = -1;
    }
  }
  return runs;
}
export function unionRanges(...lists) {
  const all = lists.flat().filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of all) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

// Trim low-level sounds (breaths, hums, mouth noise) from the edges of kept ranges: advance the start until the level
// reaches `onsetDb`, retreat the end until it reaches `offsetDb`, keep a short lead/tail so soft consonants survive,
// and never cut into a transcribed word.
export function trimByLevel(ranges, levels, { onsetDb, offsetDb, lead = 0.05, tail = 0.07, maxTrim = 0.4, minRun = 0.12 } = {}) {
  const at = t => Math.min(levels.length - 1, Math.max(0, Math.floor(t / LEVEL_STEP)));
  const minFrames = Math.round(minRun / LEVEL_STEP);
  return ranges.map(r => {
    let a = r.in, b = r.out;
    const room = Math.min(maxTrim, (b - a) / 3);
    // Only trim a leading quiet stretch that lasts at least minRun (shorter dips are soft consonants, not noise).
    let i = at(a), count = 0;
    while (a + count * LEVEL_STEP < r.in + room && levels[i + count] < onsetDb) count++;
    if (count >= minFrames) a = Math.max(r.in, (i + count) * LEVEL_STEP - lead);
    let j = at(b), back = 0;
    while (b - back * LEVEL_STEP > r.out - room && levels[j - back] < offsetDb) back++;
    if (back >= minFrames) b = Math.min(r.out, (j - back + 1) * LEVEL_STEP + tail);
    return b - a > 0.05 ? { in: a, out: b } : r;
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
  padBefore = 0.08, padAfter = 0.14, minKeep = 0.3, mergeGap = 0.12, levels = null, trim = null }) {
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
  if (levels && trim) result = trimByLevel(result, levels, trim);
  const hasWords = r => !words || words.some(w => w.end > r.in && w.start < r.out);
  return result
    .map(r => {
      const a = Math.ceil(r.in * fps - 1e-6) / fps;
      const frames = Math.floor((Math.min(r.out, duration) - a) * fps + 1e-6);
      return { in: round(a), out: round(a + frames / fps), frames };
    })
    .filter(r => r.frames >= 1 && (r.out - r.in >= minKeep || hasWords(r)) && hasWords(r));
}

// Snap source ranges to the frame grid and drop anything shorter than a frame.
export function alignRanges(ranges, fps, duration) {
  return ranges.map(r => {
    const start = Math.ceil(r.in * fps - 1e-6) / fps;
    const frames = Math.floor((Math.min(r.out, duration) - start) * fps + 1e-6);
    return { in: round(start), out: round(start + frames / fps), frames };
  }).filter(r => r.frames >= 1);
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
  const style = resolveStyle(options.style || 'bytemonk');
  const paceName = options.pace || style.pace || 'tight';
  const pace = PACE[paceName];
  if (!pace) fail(`pace must be ${Object.keys(PACE).join(', ')}`);
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 1 || speed > 1.5) fail('speed must be 1 to 1.5 (1.1 is a gentle lift for slow speakers)');
  let levels = null;
  let noise = { noiseDb: pace.noiseDb };
  if (typeof pace.noiseDb !== 'number' || pace.trim) levels = await levelProfile(source, execute);
  if (typeof pace.noiseDb !== 'number') {
    noise = chooseNoiseDb(levels);
    noise.noiseDb = Math.min(-26, noise.noiseDb + (pace.noiseDb === 'auto+2' ? 2 : 0));
  }
  const noiseDb = options.noiseDb ?? noise.noiseDb;
  const minSilence = options.minSilence ?? pace.minSilence;
  let silences = await detectSilence(source, { noiseDb, minSilence }, execute);
  const quiet = pace.quiet && levels ? quietRuns(levels, noiseDb + pace.quiet.aboveDb, pace.quiet.minLen) : [];
  silences = unionRanges(silences.map(x => ({ start: x.start, end: Math.min(x.end, info.duration) })), quiet);
  const quietSeconds = round(quiet.reduce((n, r) => n + r.end - r.start, 0));
  const words = options.words ? validateWords(await readJson(options.words), info.duration + 1, 'words') : null;
  const ranges = planCuts({ duration: info.duration, fps, silences, words, removeFillers: options.removeFillers !== false,
    padBefore: options.padBefore ?? pace.padBefore, padAfter: options.padAfter ?? pace.padAfter, mergeGap: pace.mergeGap,
    levels, trim: pace.trim ? { onsetDb: noiseDb + 4, offsetDb: noiseDb + 3 } : null });
  if (!ranges.length) fail('no speech found; adjust --noise-db/--min-silence or check the audio');
  const context = { source, info, fps, width, height, format, options, speed, style, paceName, pace, noiseDb, minSilence, silences, quiet, quietSeconds, levels, noise, words };
  const result = await materializeEdit(context, ranges, output);
  return { ...result, context };
}

// Turn kept source ranges into the version-2 manifest, remapped caption words and reports. Called by autocut and, with revised
// ranges, by the review loop (into a new output folder each time).
export async function materializeEdit(context, ranges, output, execute = run) {
  const { source, info, fps, width, height, format, options, speed, style, paceName, pace, noiseDb, minSilence, silences, quiet, quietSeconds, levels, noise, words } = context;
  void execute;
  // With speed > 1 each segment lasts duration/speed on the timeline while consuming `duration` seconds of source.
  let cursor = 0;
  const placed = ranges.map(r => {
    const timelineFrames = speed === 1 ? r.frames : Math.max(1, Math.round(r.frames / speed));
    const p = { ...r, start: round(cursor), timelineFrames, speed };
    cursor += timelineFrames / fps;
    return p;
  });
  await mkdir(output, { recursive: true });
  const rel = p => path.relative(output, p).split(path.sep).join('/');
  // Zoom changes at most once per ZOOM_HOLD seconds and then persists across many cuts, so framing never flickers.
  const zoomOn = options.jumpZoom ?? style.jumpZoom;
  const zoomPlan = [];
  let zoomState = false;
  let lastFlip = 0;
  placed.forEach(r => {
    if (zoomOn && r.start - lastFlip >= ZOOM_HOLD) { zoomState = !zoomState; lastFlip = r.start; }
    zoomPlan.push(zoomOn && zoomState);
  });
  const manifest = {
    version: 2, title: options.title || path.basename(source, path.extname(source)), fps, width, height,
    assets: [{ id: 'recording', path: rel(source), kind: 'video', approved: options.rightsConfirmed === true,
      rights: options.rights || 'Original recording by the creator (confirm before approval)', attribution: options.attribution || 'Creator' }],
    scenes: placed.map((r, i) => ({
      id: `cut-${String(i + 1).padStart(3, '0')}`, kind: 'video', asset: 'recording', in: r.in, duration: round(r.timelineFrames / fps),
      ...(speed !== 1 ? { speed } : {}), fit: options.fit || 'cover', audio: {}, purpose: `Speech segment ${i + 1} (auto-cut ${r.in.toFixed(2)}–${r.out.toFixed(2)}s)`,
      ...(zoomPlan[i] ? { motion: { type: 'punch-in', amount: 0.06 } } : {})
    })),
    audio: { ducking: { enabled: true, amountDb: style.audio.duckingDb }, voice: { enhance: options.voice || 'auto' } },
    notes: `style: ${style.name}`,
    delivery: { targetLufs: options.targetLufs ?? -14, truePeak: -1, ...(options.target ? { target: options.target } : {}) }
  };
  // Brand kit: theme tokens and a logo bug from a --brand JSON ({ theme, logo: { path, position, size, opacity }, rights, attribution }).
  if (options.brand) {
    const b = options.brand;
    if (b.theme) manifest.theme = { ...b.theme };
    if (b.logo?.path) {
      manifest.assets.push({ id: 'brand-logo', path: rel(path.resolve(b.dir, b.logo.path)), kind: 'image', approved: options.rightsConfirmed === true,
        rights: b.rights || 'Brand asset supplied by the creator (confirm before approval)', attribution: b.attribution || 'Creator' });
      manifest.watermark = { asset: 'brand-logo', position: b.logo.position || 'top-right', size: b.logo.size ?? 0.1, opacity: b.logo.opacity ?? 0.85 };
    }
  }
  let timelineWords = null;
  if (words) {
    timelineWords = remapWords(words, placed);
    await writeJson(path.join(output, 'words.timeline.json'), timelineWords);
    manifest.captions = { words: 'words.timeline.json', style: options.captions === 'plain' ? 'plain' : options.captionStyle || 'kinetic', position: 'bottom', ...(options.captions === 'off' ? { burnIn: false } : {}) };
  }
  await writeJson(path.join(output, 'production.json'), manifest);
  const kept = placed.reduce((n, r) => n + r.timelineFrames / fps, 0);
  const keptSource = placed.reduce((n, r) => n + r.frames / fps, 0);
  const report = {
    version: 1, source, sourceDuration: round(info.duration), editedDuration: round(kept), removedSeconds: round(info.duration - kept),
    cuts: placed.length, silencesDetected: silences.length, fillersRemoved: words ? words.filter(w => FILLERS.includes(normalizeWord(w.text))).length : 0,
    captionWords: timelineWords?.length ?? 0, fps, width, height, format,
    removedAsPausesSeconds: round(info.duration - keptSource), speed, quietStretches: quiet.length, quietSeconds,
    settings: { pace: paceName, noiseDb, minSilence, padBefore: options.padBefore ?? pace.padBefore, padAfter: options.padAfter ?? pace.padAfter,
      trimEdges: pace.trim, removeFillers: options.removeFillers !== false, measured: levels ? { floorDb: noise.floorDb ?? null, speechDb: noise.speechDb ?? null, otsuDb: noise.otsuDb ?? null } : null },
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
