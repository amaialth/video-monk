// Auto-zoom on a screen recording: given the moments that matter (clicks, typed fields, a number appearing) as source times and screen positions,
// add a `focus` motion to each video scene so the picture eases in on that spot, holds, and eases out. Output is a NEW manifest; nothing is rendered.
// Positions are fractions of the picture as the viewer sees it (x 0 = left, y 0 = top), not of the source file.
import path from 'node:path';
import { exists, readJson, writeJson } from './core.js';
import { FOCUS_POINTS_MAX } from './timeline.js';

const fail = message => { throw new Error(`Focus: ${message}`); };
const round = n => Math.round(n * 1000) / 1000;

// clicks: [{ at: seconds in the source, x: 0-1, y: 0-1, amount?, hold?, label? }]
export function focusScenes(manifest, clicks, { amount = 0.5, hold = 1.4, ramp = 0.5, asset = null, replace = false } = {}) {
  if (manifest.version !== 2) fail('needs a version-2 manifest');
  if (!(amount >= 0.1 && amount <= 1)) fail('--amount must be from 0.1 to 1 (1 is a 2x zoom)');
  if (!(hold >= 0 && hold <= 10) || !(ramp >= 0.15 && ramp <= 2)) fail('--hold must be 0-10 s and --ramp 0.15-2 s');
  if (!Array.isArray(clicks) || !clicks.length) fail('the clicks file needs a nonempty "clicks" list: [{ "at": 12.4, "x": 0.31, "y": 0.62 }]');
  clicks.forEach((c, i) => { if (!(Number.isFinite(c.at) && c.at >= 0 && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)) fail(`click ${i + 1} needs at (seconds), x and y (0-1)`); });
  const sorted = [...clicks].sort((a, b) => a.at - b.at);
  const report = { scenes: 0, points: 0, dropped: 0, skipped: [] };
  const scenes = manifest.scenes.map((scene, index) => {
    if (scene.kind !== 'video' || (asset && scene.asset !== asset)) return scene;
    const speed = scene.speed || 1, from = scene.in || 0, to = from + scene.duration * speed;
    const inside = sorted.filter(c => c.at >= from && c.at < to && (!c.asset || c.asset === scene.asset));
    if (!inside.length) return scene;
    if (scene.motion && scene.motion.type !== 'none' && !replace) { report.skipped.push(`scene ${index + 1} already has ${scene.motion.type} motion (use --replace)`); return scene; }
    const points = [];
    for (const c of inside) {
      const local = (c.at - from) / speed, r = ramp, h = c.hold ?? hold;
      const at = round(Math.max(r, local));                       // the zoom is fully in at the click (or at the earliest it can be)
      const last = points[points.length - 1];
      if (last && at < last.at + (last.hold ?? hold) + r) { report.dropped++; continue; }   // too close to the previous one: it would never ease back out
      if (points.length >= FOCUS_POINTS_MAX) { report.dropped++; continue; }
      points.push({ at, x: round(c.x), y: round(c.y), amount: c.amount ?? amount, hold: h, ramp: r });
    }
    report.scenes++; report.points += points.length;
    return { ...scene, motion: { type: 'focus', points } };
  });
  return { manifest: { ...manifest, scenes }, report };
}

export async function focusManifest(manifestFile, clicksFile, outputFile, options = {}) {
  const source = path.resolve(manifestFile), output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(source)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const data = await readJson(path.resolve(clicksFile));
  const result = focusScenes(await readJson(source), Array.isArray(data) ? data : data.clicks, options);
  if (!result.report.points) fail('no click falls inside a video scene (times are seconds in the source recording)');
  await writeJson(output, result.manifest);
  return { output, ...result.report };
}
