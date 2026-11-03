// Version 2 production manifest: a full automated-edit timeline with transitions, camera motion,
// B-roll layers, motion-graphics overlays, source audio, music ducking, SFX, captions and delivery targets.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exists, run } from './core.js';
import { inspectMedia, digest } from './production.js';
import { TEMPLATES, validateProps } from './motion/templates.js';
import { PLACEMENTS } from './motion/render.js';
import { validateWords, cleanCaptionWords } from './captions.js';
import { resolveDelivery } from './delivery.js';

export const RATES = [24, 25, 30, 50, 60];
export const TRANSITIONS = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin', 'distance', 'hblur', 'squeezeh', 'squeezev'];
export const MOTIONS = ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'punch-in', 'focus'];
export const FOCUS_POINTS_MAX = 40;

const fail = message => { throw new Error(`Timeline: ${message}`); };
const check = (condition, message) => { if (!condition) fail(message); };
function keys(value, allowed, location) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${location} must be an object`);
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  check(!extra.length, `unsupported field(s) in ${location}: ${extra.join(', ')}`);
}
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\r\n\x00-\x1f]/.test(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const opt = (value, test) => value === undefined || test(value);

export async function loadTimeline(file, execute = run) {
  const raw = await readFile(file);
  const m = JSON.parse(raw);
  keys(m, ['version', 'title', 'fps', 'width', 'height', 'theme', 'assets', 'scenes', 'audio', 'captions',
    'globalOverlays', 'delivery', 'watermark', 'notes'], 'manifest');
  check(m.version === 2 && text(m.title, 120), 'version 2 and a title (1-120 chars) are required');
  check(RATES.includes(m.fps), `fps must be one of ${RATES.join(', ')}`);
  check(Number.isInteger(m.width) && Number.isInteger(m.height) && m.width % 2 === 0 && m.height % 2 === 0 &&
    m.width >= 180 && m.height >= 180 && m.width <= 3840 && m.height <= 3840, 'use even dimensions from 180 to 3840');
  const base = path.dirname(path.resolve(file));
  const local = p => path.resolve(base, p);
  const frames = seconds => Math.round(seconds * m.fps);
  // Millisecond-rounded values are accepted (|error| <= 0.5ms worth of frames).
  const aligned = (seconds, label) => check(Math.abs(seconds * m.fps - Math.round(seconds * m.fps)) <= m.fps * 0.0005 + 1e-6,
    `${label} must align to timeline frames (multiples of 1/${m.fps}s)`);
  const fingerprint = createHash('sha256').update(raw);
  const extraFiles = [];

  // Theme
  let font = null;
  if (m.theme !== undefined) {
    keys(m.theme, ['preset', 'background', 'surface', 'text', 'muted', 'accent', 'grid', 'palette', 'font', 'calm', 'onTwos'], 'theme');
    check(opt(m.theme.onTwos, v => typeof v === 'boolean'), 'theme.onTwos must be boolean (hold each pose for two frames)');
    check(opt(m.theme.calm, v => typeof v === 'boolean'), 'theme.calm must be boolean (restrained easing: no overshoot)');
    check(opt(m.theme.preset, v => ['night', 'paper'].includes(v)), 'theme.preset must be night or paper');
    for (const k of ['background', 'surface', 'text', 'muted', 'accent']) check(opt(m.theme[k], v => /^#[0-9a-fA-F]{6}$/.test(v)), `theme.${k} must be #RRGGBB`);
    check(opt(m.theme.palette, v => Array.isArray(v) && v.length >= 2 && v.length <= 10 && v.every(c => /^#[0-9a-fA-F]{6}$/.test(c))), 'theme.palette needs 2-10 #RRGGBB colors');
    if (m.theme.font !== undefined) {
      check(typeof m.theme.font === 'string' && /\.(ttf|otf|woff2?)$/i.test(m.theme.font), 'theme.font must be a .ttf/.otf/.woff/.woff2 path');
      font = local(m.theme.font);
      check(await exists(font), `theme font not found: ${font}`);
      extraFiles.push(font);
    }
  }

  // Assets
  check(Array.isArray(m.assets) && m.assets.length <= 2000, 'assets must be an array (max 2000)');
  const assets = new Map();
  for (const asset of m.assets) {
    keys(asset, ['id', 'path', 'kind', 'rights', 'attribution', 'sourceUrl', 'approved'], 'asset');
    check(typeof asset.id === 'string' && /^[\w-]{1,64}$/.test(asset.id) && !assets.has(asset.id), `asset IDs must be unique [A-Za-z0-9_-]: ${asset.id}`);
    check(['video', 'image', 'audio'].includes(asset.kind), `unsupported asset kind: ${asset.id}`);
    check(asset.approved === true && text(asset.rights, 1000) && text(asset.attribution, 1000),
      `asset ${asset.id} needs approved: true, rights and attribution`);
    check(typeof asset.path === 'string' && asset.path, `missing path: ${asset.id}`);
    const resolved = local(asset.path);
    check(await exists(resolved), `missing asset file: ${resolved}`);
    const metadata = await inspectMedia(resolved, execute);
    check(asset.kind === 'audio' ? metadata.audio : metadata.video, `asset ${asset.id} has no ${asset.kind === 'audio' ? 'audio' : 'video'} stream`);
    if (asset.kind !== 'image') check(Number.isFinite(metadata.duration) && metadata.duration > 0, `unknown duration: ${asset.id}`);
    const sha256 = await digest(resolved);
    fingerprint.update(asset.id).update(sha256);
    assets.set(asset.id, { ...asset, path: resolved, metadata, sha256 });
  }

  const motion = (value, label) => {
    if (value === undefined) return;
    keys(value, ['type', 'amount', 'points'], label);
    check(MOTIONS.includes(value.type), `${label}.type must be one of ${MOTIONS.join(', ')}`);
    if (value.type === 'focus') {
      // Auto-zoom to a spot (a click, a field, a number) and back: each point eases in, holds, eases out. Times are seconds from the start of the scene.
      check(value.amount === undefined, `${label}: focus takes points, not amount`);
      check(Array.isArray(value.points) && value.points.length >= 1 && value.points.length <= FOCUS_POINTS_MAX, `${label}.points needs 1-${FOCUS_POINTS_MAX} focus points`);
      value.points.forEach((p, i) => {
        keys(p, ['at', 'x', 'y', 'amount', 'hold', 'ramp'], `${label}.points[${i}]`);
        check(finite(p.at, 0, 86400) && finite(p.x, 0, 1) && finite(p.y, 0, 1), `${label}.points[${i}] needs at (seconds), x and y (0-1 of the frame)`);
        check(opt(p.amount, v => finite(v, 0.1, 1)) && opt(p.hold, v => finite(v, 0, 10)) && opt(p.ramp, v => finite(v, 0.15, 2)), `${label}.points[${i}]: amount 0.1-1 (1 = 2x zoom), hold 0-10 s, ramp 0.15-2 s`);
      });
      return;
    }
    check(value.points === undefined, `${label}: points only belong to a focus motion`);
    check(opt(value.amount, v => finite(v, 0.01, 0.5)), `${label}.amount must be 0.01-0.5`);
  };
  const motionJob = async (value, label, { overlay }) => {
    if (overlay) keys(value, ['id', 'note', 'template', 'html', 'props', 'start', 'duration', 'placement', 'panel', 'background', 'layout'], label);
    else keys(value, ['template', 'html', 'props', 'background'], label);
    check(Boolean(value.template) !== Boolean(value.html), `${label} needs exactly one of template or html`);
    if (value.template) {
      check(TEMPLATES[value.template] && !TEMPLATES[value.template].internal, `${label}: unknown template ${value.template}`);
      validateProps(value.template, value.props ?? {}, `${label}.props`);
    } else {
      check(typeof value.html === 'string' && /\.html?$/i.test(value.html), `${label}.html must be an .html file`);
      const html = local(value.html);
      check(await exists(html), `${label} html not found: ${html}`);
      check(value.props === undefined, `${label}: custom html takes no props`);
      fingerprint.update(await readFile(html));
    }
    if (overlay) {
      check(opt(value.placement, v => PLACEMENTS.includes(v)), `${label}.placement must be one of ${PLACEMENTS.join(', ')}`);
      check(opt(value.panel, v => typeof v === 'boolean'), `${label}.panel must be boolean`);
      check(opt(value.background, v => ['grid', 'gradient', 'plain', 'transparent', 'mesh', 'aurora', 'dots'].includes(v)), `${label}.background must be grid, gradient, plain, transparent, mesh, aurora or dots (opaque backgrounds make a full-frame cutaway)`);
      check(opt(value.id, v => text(v, 64)) && opt(value.note, v => text(v, 300)), `${label}.id/note must be short text`);
      check(opt(value.layout, v => ['overlay', 'split'].includes(v)), `${label}.layout must be overlay (covers the picture) or split (the picture scales down beside the panel)`);
      check(value.layout !== 'split' || ['left', 'right'].includes(value.placement), `${label}: layout split needs placement left or right`);
    } else {
      check(opt(value.background, v => ['grid', 'gradient', 'plain', 'transparent', 'mesh', 'aurora', 'dots'].includes(v)), `${label}.background must be grid, gradient, plain, transparent, mesh, aurora or dots`);
    }
  };

  // Scenes
  check(Array.isArray(m.scenes) && m.scenes.length > 0 && m.scenes.length <= 2000, 'provide 1-2000 scenes');
  const timeline = [];
  // Count in whole frames: summing millisecond-rounded seconds and converting once can disagree with the per-scene frame counts.
  let cursor = 0;
  let cursorFrames = 0;
  for (const [index, scene] of m.scenes.entries()) {
    const label = `scene ${index}${scene.id ? ` (${scene.id})` : ''}`;
    keys(scene, ['id', 'kind', 'purpose', 'chapter', 'asset', 'in', 'duration', 'speed', 'fit', 'color', 'graphic', 'motion',
      'audio', 'broll', 'overlays', 'transition'], label);
    check(['video', 'image', 'graphic', 'color'].includes(scene.kind), `${label}: kind must be video, image, graphic or color`);
    check(text(scene.purpose, 500), `${label} needs a purpose`);
    check(opt(scene.chapter, v => text(v, 80)), `${label}.chapter must be short text`);
    check(finite(scene.duration, 1 / m.fps, 3600), `${label}.duration must be 1 frame to 3600s`);
    aligned(scene.duration, `${label}.duration`);
    check(opt(scene.fit, v => ['cover', 'contain', 'blur'].includes(v)), `${label}.fit must be cover, contain or blur`);
    motion(scene.motion, `${label}.motion`);
    check(scene.kind === 'video' || scene.speed === undefined, `${label}: only video scenes can have a speed`);
    if (scene.kind === 'video' || scene.kind === 'image') {
      const asset = assets.get(scene.asset);
      check(asset?.kind === scene.kind, `${label}: asset must reference a ${scene.kind} asset`);
      check(scene.graphic === undefined && scene.color === undefined, `${label}: ${scene.kind} scenes take no graphic/color`);
      if (scene.kind === 'video') {
        check(finite(scene.in ?? 0, 0, 1e7), `${label}.in must be nonnegative`);
        check(opt(scene.speed, v => finite(v, 0.5, 2)), `${label}.speed must be 0.5-2 (pitch-preserved)`);
        check((scene.in ?? 0) + scene.duration * (scene.speed ?? 1) <= asset.metadata.duration + 0.05, `${label} exceeds source duration (${asset.metadata.duration.toFixed(3)}s)`);
      } else check(scene.in === undefined || scene.in === 0, `${label}: image scenes take no in point`);
    } else {
      check(scene.asset === undefined && scene.in === undefined, `${label}: ${scene.kind} scenes take no asset/in`);
      if (scene.kind === 'graphic') { check(scene.graphic, `${label} needs a graphic`); await motionJob(scene.graphic, `${label}.graphic`, { overlay: false }); }
      else check(/^#[0-9a-fA-F]{6}$/.test(scene.color || ''), `${label}.color must be #RRGGBB`);
    }
    if (scene.audio !== undefined) {
      keys(scene.audio, ['gainDb', 'fadeIn', 'fadeOut'], `${label}.audio`);
      check(scene.kind === 'video' && assets.get(scene.asset).metadata.audio, `${label}.audio needs a video scene whose source has audio`);
      check(finite(scene.audio.gainDb ?? 0, -60, 18), `${label}.audio.gainDb must be -60..18`);
      for (const k of ['fadeIn', 'fadeOut']) check(opt(scene.audio[k], v => finite(v, 0, scene.duration / 2)), `${label}.audio.${k} out of range`);
    }
    const broll = scene.broll === undefined ? [] : Array.isArray(scene.broll) ? scene.broll : [scene.broll];
    check(broll.length <= 20, `${label}: max 20 B-roll layers`);
    for (const [bi, b] of broll.entries()) {
      const bl = `${label}.broll[${bi}]`;
      keys(b, ['asset', 'in', 'start', 'duration', 'fit', 'motion'], bl);
      const asset = assets.get(b.asset);
      check(asset && asset.kind !== 'audio', `${bl} must reference a video or image asset`);
      check(finite(b.start, 0, scene.duration) && finite(b.duration, 1 / m.fps, scene.duration) && b.start + b.duration <= scene.duration + 1e-6,
        `${bl} must fit inside the scene`);
      aligned(b.start, `${bl}.start`); aligned(b.duration, `${bl}.duration`);
      if (asset.kind === 'video') check(finite(b.in ?? 0, 0, 1e7) && (b.in ?? 0) + b.duration <= asset.metadata.duration + 0.05, `${bl} exceeds source duration`);
      check(opt(b.fit, v => ['cover', 'contain', 'blur'].includes(v)), `${bl}.fit must be cover, contain or blur`);
      motion(b.motion, `${bl}.motion`);
    }
    const overlays = scene.overlays || [];
    check(Array.isArray(overlays) && overlays.length <= 20, `${label}.overlays must be an array (max 20)`);
    for (const [oi, o] of overlays.entries()) {
      const ol = `${label}.overlays[${oi}]`;
      await motionJob(o, ol, { overlay: true });
      check(finite(o.start, 0, scene.duration) && finite(o.duration, 0.2, scene.duration) && o.start + o.duration <= scene.duration + 1e-6, `${ol} must fit inside the scene`);
      aligned(o.start, `${ol}.start`); aligned(o.duration, `${ol}.duration`);
    }
    let transition = null;
    if (scene.transition !== undefined) {
      keys(scene.transition, ['type', 'duration'], `${label}.transition`);
      check(index < m.scenes.length - 1, `${label}: the last scene cannot transition (it has no next scene)`);
      check(TRANSITIONS.includes(scene.transition.type), `${label}.transition.type must be one of ${TRANSITIONS.join(', ')}`);
      const next = m.scenes[index + 1];
      check(finite(scene.transition.duration, 1 / m.fps, 3) && scene.transition.duration < scene.duration &&
        scene.transition.duration < (next?.duration ?? 0), `${label}.transition.duration must be shorter than both scenes (max 3s)`);
      aligned(scene.transition.duration, `${label}.transition.duration`);
      transition = scene.transition;
    }
    const sceneFrames = frames(scene.duration);
    timeline.push({ index, scene, broll, overlays, start: cursorFrames / m.fps, startFrame: cursorFrames, frames: sceneFrames, transition });
    cursorFrames += sceneFrames - (transition ? frames(transition.duration) : 0);
    cursor = cursorFrames / m.fps;
  }
  const duration = cursor;
  const totalFrames = cursorFrames;
  check(duration <= 4 * 3600, 'maximum duration is four hours');

  // Audio
  const audio = m.audio || {};
  keys(audio, ['narration', 'music', 'sfx', 'ducking', 'voice'], 'audio');
  if (audio.voice !== undefined) {
    keys(audio.voice, ['enhance'], 'audio.voice');
    check(['auto', 'on', 'off'].includes(audio.voice.enhance), 'audio.voice.enhance must be auto (measure, treat only what is needed), on (always EQ) or off');
  }
  const audioAsset = (id, label) => { const a = assets.get(id); check(a?.kind === 'audio', `${label} must reference an audio asset`); return a; };
  if (audio.narration) {
    keys(audio.narration, ['asset', 'gainDb', 'start'], 'audio.narration');
    const a = audioAsset(audio.narration.asset, 'audio.narration');
    check(finite(audio.narration.gainDb ?? 0, -30, 12) && finite(audio.narration.start ?? 0, 0, duration), 'audio.narration gainDb/start out of range');
    check((audio.narration.start ?? 0) + a.metadata.duration <= duration + 1 / m.fps + 0.05,
      `narration (${a.metadata.duration.toFixed(2)}s) runs past the timeline (${duration.toFixed(2)}s); lengthen scenes rather than truncating speech`);
  }
  for (const [i, bed] of (audio.music || []).entries()) {
    keys(bed, ['asset', 'start', 'end', 'in', 'gainDb', 'fadeIn', 'fadeOut', 'loop'], `audio.music[${i}]`);
    audioAsset(bed.asset, `audio.music[${i}]`);
    const start = bed.start ?? 0, end = bed.end ?? duration;
    check(finite(start, 0, duration) && finite(end, start + 0.1, duration + 1e-6), `audio.music[${i}] start/end must lie in the timeline`);
    check(finite(bed.gainDb ?? -18, -60, 6) && opt(bed.in, v => finite(v, 0, 1e7)), `audio.music[${i}] gainDb/in out of range`);
    for (const k of ['fadeIn', 'fadeOut']) check(opt(bed[k], v => finite(v, 0, 30)), `audio.music[${i}].${k} out of range`);
    check(opt(bed.loop, v => typeof v === 'boolean'), `audio.music[${i}].loop must be boolean`);
  }
  check(opt(audio.music, v => Array.isArray(v) && v.length <= 20), 'audio.music must be an array (max 20)');
  check(opt(audio.sfx, v => Array.isArray(v) && v.length <= 500), 'audio.sfx must be an array (max 500)');
  for (const [i, s] of (audio.sfx || []).entries()) {
    keys(s, ['asset', 'at', 'gainDb'], `audio.sfx[${i}]`);
    audioAsset(s.asset, `audio.sfx[${i}]`);
    check(finite(s.at, 0, duration) && finite(s.gainDb ?? -6, -60, 12), `audio.sfx[${i}] at/gainDb out of range`);
  }
  if (audio.ducking !== undefined) {
    keys(audio.ducking, ['enabled', 'amountDb'], 'audio.ducking');
    check(typeof audio.ducking.enabled === 'boolean' && opt(audio.ducking.amountDb, v => finite(v, 3, 30)), 'audio.ducking needs enabled and amountDb 3-30');
  }

  // Captions
  let words = null;
  if (m.captions !== undefined) {
    keys(m.captions, ['words', 'style', 'position', 'maxWords', 'maxChars', 'burnIn', 'fixes'], 'captions');
    check(typeof m.captions.words === 'string', 'captions.words must be a path to a timeline-relative words.json');
    const wordsFile = local(m.captions.words);
    check(await exists(wordsFile), `captions words file not found: ${wordsFile}`);
    const wordsRaw = await readFile(wordsFile);
    fingerprint.update(wordsRaw);
    words = validateWords(JSON.parse(wordsRaw), duration, 'captions.words');
    const fixes = m.captions.fixes;
    check(fixes === undefined || (fixes && typeof fixes === 'object' && !Array.isArray(fixes) && (fixes.drop === undefined || Array.isArray(fixes.drop)) && (fixes.replace === undefined || (fixes.replace && typeof fixes.replace === 'object'))), 'captions.fixes must be { replace: {from: to}, drop: [phrases] }');
    words = cleanCaptionWords(words, fixes || {});
    check(words.length > 0, 'captions have no words left after cleaning');
    check(opt(m.captions.style, v => ['kinetic', 'karaoke', 'phrase', 'plain', 'highlight', 'pill', 'slam', 'wipe', 'weight'].includes(v)), 'captions.style must be kinetic, karaoke, phrase, plain, highlight, pill, slam, wipe or weight');
    check(opt(m.captions.position, v => ['bottom', 'lower', 'center', 'top'].includes(v)), 'captions.position must be bottom, lower, center or top');
    check(opt(m.captions.maxWords, v => Number.isInteger(v) && v >= 1 && v <= 16), 'captions.maxWords must be 1-16');
    check(opt(m.captions.maxChars, v => Number.isInteger(v) && v >= 8 && v <= 80), 'captions.maxChars must be 8-80');
    check(opt(m.captions.burnIn, v => typeof v === 'boolean'), 'captions.burnIn must be boolean');
  }

  const globals = m.globalOverlays || [];
  check(Array.isArray(globals) && globals.length <= 500, 'globalOverlays must be an array (max 500)');
  for (const [i, o] of globals.entries()) {
    await motionJob(o, `globalOverlays[${i}]`, { overlay: true });
    check(finite(o.start, 0, duration) && finite(o.duration, 0.2, duration) && o.start + o.duration <= duration + 1e-6, `globalOverlays[${i}] must fit in the timeline`);
  }

  if (m.watermark !== undefined) {
    const w = m.watermark;
    keys(w, ['asset', 'position', 'size', 'opacity', 'margin', 'start', 'end'], 'watermark');
    check(assets.get(w.asset)?.kind === 'image', 'watermark.asset must be the id of an image asset (a logo PNG with transparency works best)');
    check(opt(w.position, v => ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(v)), 'watermark.position must be top-left, top-right, bottom-left or bottom-right');
    check(opt(w.size, v => finite(v, 0.03, 0.5)), 'watermark.size must be 0.03-0.5 (fraction of the frame width)');
    check(opt(w.opacity, v => finite(v, 0.1, 1)), 'watermark.opacity must be 0.1-1');
    check(opt(w.margin, v => finite(v, 0, 0.2)), 'watermark.margin must be 0-0.2 (fraction of the frame width)');
    check(opt(w.start, v => finite(v, 0, duration)) && opt(w.end, v => finite(v, 0, duration)), 'watermark.start/end must be inside the timeline');
  }

  const delivery = m.delivery || {};
  keys(delivery, ['target', 'targetLufs', 'truePeak', 'crf', 'preset', 'thumbnail', 'audioBitrate', 'maxrateMbps'], 'delivery');
  check(opt(delivery.target, v => ['youtube', 'master', 'web'].includes(v)), 'delivery.target must be youtube, master or web');
  check(opt(delivery.maxrateMbps, v => finite(v, 1, 200)), 'delivery.maxrateMbps must be 1-200');
  check(opt(delivery.targetLufs, v => finite(v, -30, -5)) && opt(delivery.truePeak, v => finite(v, -9, 0)), 'delivery LUFS (-30..-5) / truePeak (-9..0) out of range');
  check(opt(delivery.crf, v => Number.isInteger(v) && v >= 0 && v <= 35), 'delivery.crf must be 0-35');
  check(opt(delivery.preset, v => ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'].includes(v)), 'delivery.preset invalid');
  check(opt(delivery.audioBitrate, v => [128, 160, 192, 256, 320].includes(v)), 'delivery.audioBitrate must be 128/160/192/256/320');
  const resolved = resolveDelivery(delivery);
  if (delivery.thumbnail !== undefined) {
    keys(delivery.thumbnail, ['time', 'template', 'props'], 'delivery.thumbnail');
    if (delivery.thumbnail.template) validateProps(delivery.thumbnail.template, delivery.thumbnail.props ?? {}, 'delivery.thumbnail.props');
    else check(finite(delivery.thumbnail.time, 0, duration), 'delivery.thumbnail needs time (seconds) or template');
  }

  for (const f of extraFiles) fingerprint.update(await digest(f));
  return {
    manifest: m, base, assets, timeline, duration, totalFrames, font, words,
    delivery: { target: resolved.target, targetLufs: resolved.lufs, truePeak: resolved.truePeak, crf: resolved.crf, preset: resolved.preset, audioBitrate: resolved.audioKbps,
      maxrateMbps: delivery.maxrateMbps, thumbnail: delivery.thumbnail },
    fingerprint: fingerprint.digest('hex')
  };
}

// YouTube-style chapter list from scenes with a `chapter` label. YouTube requires the first at 0:00.
export function chapters(loaded) {
  const list = loaded.timeline.filter(t => t.scene.chapter).map(t => ({ time: t.start, title: t.scene.chapter }));
  if (!list.length) return [];
  if (list[0].time > 0) list.unshift({ time: 0, title: 'Intro' });
  const fmt = s => { const v = Math.floor(s); const h = Math.floor(v / 3600); const mm = Math.floor(v / 60) % 60; const ss = String(v % 60).padStart(2, '0');
    return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
  return list.map(c => ({ ...c, label: `${fmt(c.time)} ${c.title}` }));
}
