// Place a downloaded stock clip or image as B-roll over a stretch of the timeline. The edit is a series of speech cuts; B-roll covers the
// picture while the voice carries on, so one clip runs continuously across several cuts (the classic cutaway), with the voice audio untouched.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, readJson, writeJson } from './core.js';
import { loadTimeline } from './timeline.js';

const fail = message => { throw new Error(`B-roll: ${message}`); };
const round = n => Math.round(n * 1000) / 1000;

export async function addBroll(manifestFile, outputFile, options = {}) {
  const manifestPath = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(manifestPath)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const dir = path.resolve(options.assetDir || fail('--asset-dir (a stock-fetch output folder) is required'));
  const asset = await readJson(path.join(dir, 'asset.json')).catch(() => fail(`no asset.json in ${dir}`));
  const provenance = await readJson(path.join(dir, 'provenance.json')).catch(() => ({}));
  const m = await readJson(manifestPath);
  const fps = m.fps;
  const at = options.at, duration = options.duration;
  if (!(at >= 0)) fail('--at (timeline seconds) is required');
  const isVideo = asset.kind === 'video';
  const available = provenance.candidate?.duration;
  const inStart = options.inStart ?? 0;
  if (!(duration >= 0.5 && duration <= 60)) fail('--duration must be 0.5 to 60 seconds');
  if (isVideo && available && inStart + duration > available + 0.05) fail(`the clip is ${available}s long; ask for at most ${round(available - inStart)}s from ${inStart}s`);

  const manifestDir = path.dirname(manifestPath);
  const rel = path.relative(manifestDir, path.join(dir, asset.path)).split(path.sep).join('/');
  const out = JSON.parse(JSON.stringify(m));
  let id = asset.id;
  const existing = out.assets.find(a => a.id === id);
  if (existing && existing.path !== rel) id = `${id}-${out.assets.length}`;
  if (!existing || existing.path !== rel) out.assets.push({ id, path: rel, kind: asset.kind, approved: true, rights: asset.rights, attribution: asset.attribution, ...(asset.sourceUrl ? { sourceUrl: asset.sourceUrl } : {}) });

  const portrait = m.height > m.width;
  const fit = options.fit || (portrait ? 'blur' : 'cover');
  if (!['cover', 'contain', 'blur'].includes(fit)) fail('--fit must be cover, contain or blur');
  const motion = options.motion || (isVideo ? undefined : { type: 'zoom-in', amount: 0.06 });
  const warnings = [];
  const frames = s => Math.round(s * fps);
  let cursor = 0;
  const end = at + duration;
  let placed = 0;
  for (const scene of out.scenes) {
    const s0 = cursor / fps; cursor += frames(scene.duration);
    const s1 = cursor / fps;
    const a = Math.max(s0, at), b = Math.min(s1, end);
    if (b - a <= 0) continue;
    if (b - a < 0.25) { warnings.push(`a ${round(b - a)}s sliver at ${round(a)}s was skipped`); continue; }
    if (scene.kind === 'graphic') { warnings.push(`the B-roll overlaps the graphic scene at ${round(s0)}s; it was not placed over the graphic`); continue; }
    scene.broll = [...(Array.isArray(scene.broll) ? scene.broll : scene.broll ? [scene.broll] : []), {
      asset: id, ...(isVideo ? { in: round(inStart + (a - at)) } : {}), start: round(a - s0), duration: round(b - a), fit, ...(motion ? { motion } : {}) }];
    placed++;
  }
  if (!placed) fail(`no scene overlaps ${round(at)}s to ${round(end)}s`);
  const overlapping = (out.globalOverlays || []).filter(o => o.start < end && o.start + o.duration > at && o.background && o.background !== 'transparent');
  if (overlapping.length) warnings.push(`${overlapping.length} full-frame graphic(s) cover part of this window and will hide the B-roll there; move the B-roll or the graphic`);
  await writeJson(output, out);
  try { await loadTimeline(output); } catch (error) {
    await (await import('node:fs/promises')).rm(output, { force: true });
    fail(`the manifest with B-roll is invalid (${error.message}); nothing was written`);
  }
  return { output, scenes: placed, asset: id, window: { from: round(at), to: round(end) }, fit, warnings };
}
