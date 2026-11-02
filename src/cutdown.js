// Cutdown: turn a finished version-2 manifest into another format (9:16, 1:1, 4:5, 16:9) and, optionally, a time window of it.
// This is how one long-form edit also yields a Short / Reel / TikTok without redoing the cut: scenes, captions, graphics and music are
// sliced to the window and the picture is reframed (blurred-background fit by default, so nothing on screen is cropped away).
import path from 'node:path';
import { exists, readJson, writeJson } from './core.js';

const fail = message => { throw new Error(`Cutdown: ${message}`); };
export const ASPECTS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };
export const SHORTS_LIMIT_SECONDS = 180;
const round = n => Math.round(n * 1000) / 1000;

// End the clip on the last sentence end at or before `limit` seconds after `from` (falls back to the limit).
export function snapToSentence(words, from, limit) {
  let best = null;
  for (const w of words || []) {
    if (w.start < from) continue;
    if (w.end > from + limit) break;
    if (/[.!?]["')\]]?$/.test(w.text) && w.end - from >= limit * 0.5) best = w.end;
  }
  return best ?? from + limit;
}

// Propose the strongest window of at most `maxSeconds`: starts at a sentence start, ends on a sentence end, and scores graphics (the
// explained moments), numbers, questions and an early-hook bonus. A proposal for the human to approve, not a judgement of quality.
export function pickHighlight(words, graphicStarts, maxSeconds, total) {
  if (!words?.length) return { from: 0, to: Math.min(total, maxSeconds), score: 0 };
  const starts = words.filter((w, i) => i === 0 || /[.!?]["')\]]?$/.test(words[i - 1].text)).map(w => w.start);
  let best = null;
  for (const from of starts) {
    const to = Math.min(total, snapToSentence(words, from, maxSeconds));
    if (to - from < Math.min(maxSeconds, 8) * 0.8) continue;
    const inside = words.filter(w => w.start >= from && w.end <= to);
    const score = graphicStarts.filter(t => t >= from && t < to).length * 3 + inside.filter(w => /\d/.test(w.text)).length +
      inside.filter(w => /\?$/.test(w.text)).length * 2 + (from < total * 0.2 ? 1 : 0) + (to - from) / maxSeconds;
    if (!best || score > best.score) best = { from: round(from), to: round(to), score: round(score) };
  }
  return best || { from: 0, to: Math.min(total, maxSeconds), score: 0 };
}

export async function cutdownManifest(manifestFile, outputFile, options = {}) {
  const source = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(source)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const aspect = options.aspect || '9:16';
  if (!ASPECTS[aspect]) fail(`aspect must be ${Object.keys(ASPECTS).join(', ')}`);
  const fit = options.fit || 'blur';
  if (!['blur', 'cover', 'contain'].includes(fit)) fail('fit must be blur, cover or contain');
  const m = await readJson(source);
  if (m.version !== 2) fail('needs a version-2 manifest');
  const fps = m.fps;
  const frame = 1 / fps;
  const [defaultW, defaultH] = ASPECTS[aspect];
  const scale = options.width ? options.width / defaultW : 1;
  const width = Math.round(defaultW * scale / 2) * 2, height = Math.round(defaultH * scale / 2) * 2;
  const warnings = [];

  // Timeline starts, frame-exact.
  const starts = [];
  let at = 0;
  for (const s of m.scenes) { starts.push(at); at += Math.round(s.duration * fps); }
  const totalFrames = at;
  const total = totalFrames / fps;

  const wordsFile = m.captions?.words ? path.resolve(path.dirname(source), m.captions.words) : null;
  const words = wordsFile && await exists(wordsFile) ? await readJson(wordsFile) : null;
  let fromS = round(Math.round((options.from ?? 0) * fps) / fps);
  let fromPick = fromS;
  let toS = options.to ?? (options.maxSeconds ? snapToSentence(words, fromS, options.maxSeconds) : total);
  if (options.highlight && options.maxSeconds && options.from === undefined && options.to === undefined) {
    const picked = pickHighlight(words, (m.globalOverlays || []).map(o => o.start), options.maxSeconds, total);
    fromPick = picked.from; toS = picked.to;
    warnings.push(`highlight proposed: ${picked.from}s to ${picked.to}s (score ${picked.score}); review it before publishing`);
  }
  fromS = round(Math.round(fromPick * fps) / fps);
  toS = Math.min(total, round(Math.round(toS * fps) / fps));
  if (!(toS - fromS >= 1)) fail(`the window ${fromS}s to ${toS}s is shorter than 1 second (timeline is ${round(total)}s)`);
  const sliced = fromS > 0 || toS < total - 1e-6;
  if (sliced && m.audio?.narration) fail('a window cannot be cut from a manifest with separate narration; cut the whole timeline or remove audio.narration');
  const from = Math.round(fromS * fps), to = Math.round(toS * fps);

  const portraitOrSquare = height >= width;
  const scenes = [];
  m.scenes.forEach((scene, i) => {
    const s0 = starts[i], s1 = s0 + Math.round(scene.duration * fps);
    const a = Math.max(s0, from), b = Math.min(s1, to);
    if (b <= a) return;
    const whole = a === s0 && b === s1;
    if (scene.kind === 'graphic' && !whole) { warnings.push(`graphic scene ${scene.id || i} straddles the window edge and was dropped`); return; }
    const out = JSON.parse(JSON.stringify(scene));
    const offset = (a - s0) / fps;
    out.duration = round((b - a) / fps);
    if (!whole) {
      if (out.kind === 'video') out.in = round((out.in ?? 0) + offset * (out.speed ?? 1));
      out.broll = (out.broll || []).map(br => {
        const bs = br.start - offset, be = bs + br.duration;
        const ns = Math.max(0, bs), ne = Math.min(out.duration, be);
        if (ne - ns < 0.2) return null;
        return { ...br, start: round(ns), duration: round(ne - ns), ...(br.in !== undefined || ns > bs ? { in: round((br.in ?? 0) + (ns - bs)) } : {}) };
      }).filter(Boolean);
      out.overlays = (out.overlays || []).map(o => {
        const os = o.start - offset;
        return os >= -1e-6 && os + o.duration <= out.duration + 1e-6 ? { ...o, start: round(Math.max(0, os)) } : null;
      }).filter(Boolean);
      if (b < s1) delete out.transition;
    }
    if (!out.broll?.length) delete out.broll;
    if (!out.overlays?.length) delete out.overlays;
    if (out.kind === 'video' || out.kind === 'image') out.fit = fit;
    if (out.motion?.type && out.motion.type !== 'none' && fit === 'blur') out.motion = { type: 'none' };
    for (const o of out.overlays || []) if (portraitOrSquare) delete o.layout;
    scenes.push(out);
  });
  if (!scenes.length) fail('no scene falls inside the window');
  delete scenes.at(-1).transition;

  const next = { ...m, title: `${m.title} (${aspect}${sliced ? ' cutdown' : ''})`, width, height, scenes };
  next.globalOverlays = (m.globalOverlays || []).filter(o => o.start * fps >= from - 1e-6 && (o.start + o.duration) * fps <= to + 1e-6)
    .map(o => { const c = { ...o, start: round(o.start - fromS) }; if (portraitOrSquare) delete c.layout; return c; });
  if (!next.globalOverlays.length) delete next.globalOverlays;
  const dropped = (m.globalOverlays || []).length - (next.globalOverlays?.length ?? 0);
  if (sliced && dropped) warnings.push(`${dropped} graphic(s) outside or across the window edge were left out`);

  if (m.audio) {
    next.audio = { ...m.audio };
    if (sliced) {
      next.audio.music = (m.audio.music || []).map(bed => {
        const bs = bed.start ?? 0, be = bed.end ?? total;
        const ns = Math.max(bs, fromS), ne = Math.min(be, toS);
        return ne - ns < 1 ? null : { ...bed, start: round(ns - fromS), end: round(ne - fromS), in: round((bed.in ?? 0) + Math.max(0, fromS - bs)) };
      }).filter(Boolean);
      next.audio.sfx = (m.audio.sfx || []).filter(x => x.at >= fromS && x.at < toS).map(x => ({ ...x, at: round(x.at - fromS) }));
      if (!next.audio.music.length) delete next.audio.music;
      if (!next.audio.sfx.length) delete next.audio.sfx;
    }
  }

  if (m.captions && words) {
    const kept = words.filter(w => w.start >= fromS - 1e-6 && w.end <= toS + 1e-6).map(w => ({ ...w, start: round(w.start - fromS), end: round(w.end - fromS) }));
    const stem = path.basename(output, '.json');
    const file = `${stem}.words.json`;
    await writeJson(path.join(path.dirname(output), file), kept);
    next.captions = { ...m.captions, words: file };
    delete next.captions.maxWords; delete next.captions.maxChars;
  }
  const dur = round((to - from) / fps);
  if ((aspect === '9:16') && dur > SHORTS_LIMIT_SECONDS) warnings.push(`${dur}s is longer than the ${SHORTS_LIMIT_SECONDS}s YouTube Shorts limit; pass --max-seconds or --to to shorten it`);
  if (aspect === '9:16' && dur > 60) warnings.push(`${dur}s: Shorts, Reels and TikTok perform best under 60 s; pass --max-seconds 55 for a tighter cut`);
  next.notes = `${m.notes ? `${m.notes}; ` : ''}cutdown ${aspect} from ${path.basename(source)}${sliced ? ` window ${fromS}-${toS}s` : ''}, fit ${fit}`;
  await writeJson(output, next);
  return { manifest: next, output, aspect, width, height, window: { from: fromS, to: toS, duration: dur }, scenes: scenes.length, warnings };
}
