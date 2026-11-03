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
// The picture is sampled small (128x72, 5 per second) and compared with the one before. A moment is proposed where something NEW starts changing on screen:
// a part that has been still begins to move (a field fills, a number updates, a toast or panel appears, a row highlights), centred on what changed.
// To keep real recordings from drowning in noise: changes are pooled over three frames (typing arrives a few pixels at a time); parts of the screen that are
// always active (a ticking clock, a spinner) are learned and ignored; and a whole-screen change is ignored (a cut, a scroll, a slide change), except a modal
// that dims the screen, where the bright region on the darkened screen is the moment. These are proposals about screen activity, not real clicks.
export function findActivity(frames, { width = 128, height = 72, fps = 5, sensitivity = 1, minGap = 2, max = 12, from = 0, debug = null } = {}) {
  const px = width * height, count = Math.floor(frames.length / px);
  const sens = Math.max(0.2, sensitivity);
  const T = Math.max(3, Math.round(9 / sens));                                    // grey levels that count as a change
  const lo = 0.0012 / sens, hi = 0.22;                                             // smallest and largest local change, as a share of the picture
  const GW = 16, GH = 9, cw = width / GW, ch = height / GH, cellOf = (x, y) => Math.min(GH - 1, Math.floor(y / ch)) * GW + Math.min(GW - 1, Math.floor(x / cw));
  const heat = new Float32Array(GW * GH), lastBusy = new Int32Array(GW * GH).fill(-99), onsets = Array.from({ length: GW * GH }, () => []);
  const masks = [new Uint8Array(px), new Uint8Array(px), new Uint8Array(px)];     // changed pixels of the last three frame pairs
  const found = [];
  let active = false, calm = 0;
  for (let f = 1; f < count; f++) {
    const cur = masks[f % 3]; cur.fill(0);
    let pos = 0, neg = 0;
    for (let i = 0; i < px; i++) { const d = frames[f * px + i] - frames[(f - 1) * px + i]; if (d > T) { cur[i] = 1; pos++; } else if (d < -T) { cur[i] = 2; neg++; } }
    const curShare = (pos + neg) / px;
    let candidate = null;
    if (curShare > hi) {
      // whole-screen change: a dimmed backdrop (most pixels one way, a compact region the other) is a modal opening; anything else is a cut or a scroll
      const major = pos >= neg ? 1 : 2, minor = major === 1 ? 2 : 1, maj = Math.max(pos, neg) / px, mnr = Math.min(pos, neg) / px;
      if (maj > 0.5 && mnr >= lo && mnr <= 0.4) {
        const cnt = new Int32Array(GW * GH), csx = new Float64Array(GW * GH), csy = new Float64Array(GW * GH);
        for (let i = 0; i < px; i++) if (cur[i] === minor) { const x = i % width, y = Math.floor(i / width), c = cellOf(x, y); cnt[c]++; csx[c] += x; csy[c] += y; }
        // a modal is ONE dominant compact region; two comparable far-apart blobs (a flash that overwrote two things) are not
        const dense = []; let total = 0; for (let c = 0; c < cnt.length; c++) if (cnt[c] >= 3) { dense.push(c); total += cnt[c]; }
        const seen = new Set(); let best = null;
        for (const c of dense) { if (seen.has(c)) continue; const g = { n: 0, x: 0, y: 0 }, stack = [c]; seen.add(c); while (stack.length) { const a = stack.pop(); g.n += cnt[a]; g.x += csx[a]; g.y += csy[a]; for (const b of dense) if (!seen.has(b) && Math.abs((a % GW) - (b % GW)) <= 1 && Math.abs(Math.floor(a / GW) - Math.floor(b / GW)) <= 1) { seen.add(b); stack.push(b); } } if (!best || g.n > best.n) best = g; }
        if (best && best.n >= 0.6 * total) candidate = { f, x: (best.x / best.n + 0.5) / width, y: (best.y / best.n + 0.5) / height, strength: mnr };
      }
      active = true; calm = 0;
    } else {
      const m1 = masks[(f + 1) % 3], m2 = masks[(f + 2) % 3];                       // the other two of the last three
      const cells = new Int32Array(GW * GH); let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < px; i++) if (cur[i] || m1[i] || m2[i]) { n++; const x = i % width, y = Math.floor(i / width); sx += x; sy += y; cells[cellOf(x, y)]++; }
      const share = n / px;
      let cold = 0, all = 0;
      for (let c = 0; c < cells.length; c++) if (cells[c] >= 3) { all += cells[c]; if (heat[c] < 0.6) cold += cells[c]; }
      if (debug) debug({ f, t: f / fps, share, denseShare: all / px, coldShare: all ? cold / all : 0, active });
      if (share >= lo && share <= hi) {
        if (!active && all > 0 && cold / all >= 0.6) candidate = { f, x: (sx / n + 0.5) / width, y: (sy / n + 0.5) / height, strength: share };
        active = active || !!candidate; calm = 0;
      } else if (share < lo * 0.5) { if (++calm >= 2) active = false; }
      else calm = 0;
      // learn what is always active (a clock): such a cell gets hot and stops counting as new, and its regular beats are recorded to drop it later
      for (let c = 0; c < heat.length; c++) heat[c] *= 0.96;
      const single = new Int32Array(GW * GH);
      for (let i = 0; i < px; i++) if (cur[i]) single[cellOf(i % width, Math.floor(i / width))]++;
      for (let c = 0; c < heat.length; c++) if (single[c] >= 3) { heat[c] += 1; if (lastBusy[c] < f - 2) onsets[c].push(f); lastBusy[c] = f; }
    }
    if (candidate && f >= fps) found.push(candidate);               // the first second is ignored: a recording settles (and a cursor appears) at the start
  }
  // second detector, for small changes that STAY (typed text, a number that changes): a cursor is transient, so the typical look (median) of the
  // last second is compared with the typical look a second earlier. A cursor leaves two far-apart traces and is rejected; a change in one place is kept.
  const medianAt = (f, k, i) => { const v = []; for (let d = 0; d < 5; d++) v.push(frames[(f - k - d) * px + i]); v.sort((a, b) => a - b); return v[2]; };
  const persistent = [], pRuns = Array.from({ length: GW * GH }, () => []);          // per cell: stretches of frames where it differs from a second earlier
  let prevDense = 0;
  for (let f = 14; f < count; f++) {
    const cells = new Int32Array(GW * GH), sx = new Float64Array(GW * GH), sy = new Float64Array(GW * GH);
    for (let i = 0; i < px; i++) if (Math.abs(medianAt(f, 0, i) - medianAt(f, 10, i)) > T) { const x = i % width, y = Math.floor(i / width), c = cellOf(x, y); cells[c]++; sx[c] += x; sy[c] += y; }
    const hot = []; let denseN = 0;
    for (let c = 0; c < cells.length; c++) if (cells[c] >= 3) { hot.push(c); denseN += cells[c]; }
    const share = denseN / px, rising = prevDense < (0.0003 / sens) * 0.5; prevDense = share;
    if (hot.length && share >= 0.0003 / sens && share <= hi) {                          // a change over most of the screen is a cut or a scroll, not an event
      for (const c of hot) { const r = pRuns[c], last = r[r.length - 1]; if (last && f - last[1] <= 2) last[1] = f; else r.push([f, f]); }
      // connected groups of hot cells; more than one group far apart is a moving cursor's two traces
      const seen = new Set(), groups = [];
      for (const c of hot) { if (seen.has(c)) continue; const g = [], stack = [c]; seen.add(c); while (stack.length) { const a = stack.pop(); g.push(a); for (const b of hot) if (!seen.has(b) && Math.abs((a % GW) - (b % GW)) <= 1 && Math.abs(Math.floor(a / GW) - Math.floor(b / GW)) <= 1) { seen.add(b); stack.push(b); } } groups.push(g); }
      if (rising && groups.length === 1) {
        let x = 0, y = 0, n = 0; for (const c of hot) { x += sx[c]; y += sy[c]; n += cells[c]; }
        persistent.push({ f: f - 2, x: (x / n + 0.5) / width, y: (y / n + 0.5) / height, strength: share, persistent: true });   // the median lags the change by about two frames
      }
    }
  }
  if (debug) debug({ persistent: persistent.map(c => ({ t: c.f / fps, x: +c.x.toFixed(2), y: +c.y.toFixed(2), s: +(c.strength * 100).toFixed(2), runs: pRuns[cellOf(c.x * width, c.y * height)].map(r => [+(r[0] / fps).toFixed(1), +(r[1] / fps).toFixed(1)]) })) });
  // a part of the screen that differs from a second earlier for more than ~8 seconds on end is always active (a clock, a spinner, a video), not an event
  const pAmbient = c => pRuns[cellOf(c.x * width, c.y * height)].some(r => c.f >= r[0] - 3 && c.f <= r[1] && (r[1] - r[0]) / fps > 8);
  for (const c of persistent) if (!pAmbient(c) && !found.some(k => Math.abs(k.f - c.f) <= 3)) found.push(c);
  // an event that keeps starting again in the same place within a few seconds is ambient (a ticking clock, a spinner), not something that happened
  const ambient = c => { const cell = cellOf(c.x * width, c.y * height), w = 6 * fps; return onsets[cell].filter(o => o >= c.f - 1 && o <= c.f + w).length >= 3; };
  const real = found.filter(c => c.persistent || !ambient(c));
  // keep the strongest proposal in every min-gap window, then the strongest `max` overall, in time order
  const kept = [];
  for (const c of [...real].sort((a, b) => b.strength - a.strength)) if (kept.every(k => Math.abs(k.f - c.f) / fps >= minGap)) kept.push(c);
  return kept.sort((a, b) => b.strength - a.strength).slice(0, max).sort((a, b) => a.f - b.f)
    .map(c => ({ at: Math.round((from + c.f / fps) * 100) / 100, x: Math.round(c.x * 1000) / 1000, y: Math.round(c.y * 1000) / 1000, strength: Math.round(c.strength * 1000) / 1000 }));
}

// The proposals as data (nothing is written): [{ at, x, y, strength }], plus how many seconds were looked at.
export async function detectClicks(media, options = {}) {
  const input = path.resolve(media);
  if (!(await exists(input))) fail(`recording not found: ${input}`);
  const width = 128, height = 72, fps = 5, from = options.from ?? 0;
  const args = ['-v', 'error', '-nostdin', ...(from ? ['-ss', String(from)] : []), ...(options.seconds ? ['-t', String(options.seconds)] : []), '-i', input, '-an', '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', '-'];
  const { stdout } = await run('ffmpeg', args, { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3600_000 });
  const clicks = findActivity(stdout, { width, height, fps, from, sensitivity: options.sensitivity ?? 1, minGap: options.minGap ?? 2, max: options.max ?? 12 });
  return { clicks, seconds: Math.floor(stdout.length / (width * height)) / fps, recording: path.basename(input) };
}

export async function detectActivity(media, outputFile, options = {}) {
  const output = path.resolve(outputFile);
  if (await exists(output)) fail(`output already exists: ${output}`);
  const found = await detectClicks(media, options);
  await writeJson(output, { note: 'Proposed from screen activity in the recording (not recorded clicks). Review each one, delete what does not matter, then run: video-monk focus --manifest ... --clicks this-file --output ...', recording: found.recording, clicks: found.clicks });
  return { output, clicks: found.clicks.length, seconds: found.seconds };
}
