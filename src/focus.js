// Auto-zoom on a screen recording: given the moments that matter (clicks, typed fields, a number appearing) as source times and screen positions,
// add a `focus` motion to each video scene so the picture eases in on that spot, holds, and eases out. Output is a NEW manifest; nothing is rendered.
// Positions are fractions of the picture as the viewer sees it (x 0 = left, y 0 = top), not of the source file.
import path from 'node:path';
import { exists, readJson, writeJson, run } from './core.js';
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

// ---- finding the moments: no input is recorded; the recording itself is looked at.
// The picture is sampled small (64x36, 5 per second) and compared with the one before. A moment is proposed where a SMALL part of the screen starts to change
// after a quiet stretch (a menu opens, a field fills, a number updates, a button reacts), centred on what changed. Whole-screen changes (a cut, a scroll, a
// slide change) are ignored. These are proposals about screen activity, not real clicks: review them before using them.
export function findActivity(frames, { width = 64, height = 36, fps = 5, sensitivity = 1, minGap = 3, max = 12, from = 0 } = {}) {
  const px = width * height, count = Math.floor(frames.length / px);
  const lo = 0.002 / sensitivity, hi = 0.22, quiet = lo * 0.4, threshold = Math.round(22 / Math.max(0.25, sensitivity));
  const found = [];
  let prevChange = 0;
  for (let f = 1; f < count; f++) {
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < px; i++) {
      if (Math.abs(frames[f * px + i] - frames[(f - 1) * px + i]) > threshold) { n++; sx += i % width; sy += Math.floor(i / width); }
    }
    const share = n / px;
    if (share >= lo && share <= hi && prevChange < quiet) found.push({ at: from + f / fps, x: (sx / n + 0.5) / width, y: (sy / n + 0.5) / height, strength: share });
    prevChange = share > hi ? 1 : share;                                   // a whole-screen change counts as busy: the quiet stretch starts after it
  }
  // keep the strongest proposal in every min-gap window, then the strongest `max` overall, in time order
  const kept = [];
  for (const c of [...found].sort((a, b) => b.strength - a.strength)) if (kept.every(k => Math.abs(k.at - c.at) >= minGap)) kept.push(c);
  return kept.sort((a, b) => b.strength - a.strength).slice(0, max).sort((a, b) => a.at - b.at)
    .map(c => ({ at: Math.round(c.at * 100) / 100, x: Math.round(c.x * 1000) / 1000, y: Math.round(c.y * 1000) / 1000, strength: Math.round(c.strength * 1000) / 1000 }));
}

export async function detectActivity(media, outputFile, options = {}) {
  const input = path.resolve(media), output = path.resolve(outputFile);
  if (!(await exists(input))) fail(`recording not found: ${input}`);
  if (await exists(output)) fail(`output already exists: ${output}`);
  const width = 64, height = 36, fps = 5, from = options.from ?? 0;
  const args = ['-v', 'error', '-nostdin', ...(from ? ['-ss', String(from)] : []), ...(options.seconds ? ['-t', String(options.seconds)] : []), '-i', input, '-an', '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', '-'];
  const { stdout } = await run('ffmpeg', args, { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3600_000 });
  const clicks = findActivity(stdout, { width, height, fps, from, sensitivity: options.sensitivity ?? 1, minGap: options.minGap ?? 3, max: options.max ?? 12 });
  await writeJson(output, { note: 'Proposed from screen activity in the recording (not recorded clicks). Review each one, delete what does not matter, then run: video-monk focus --manifest ... --clicks this-file --output ...', recording: path.basename(input), clicks });
  return { output, clicks: clicks.length, seconds: Math.floor(stdout.length / (width * height)) / fps };
}
