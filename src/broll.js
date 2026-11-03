// Place a downloaded stock clip or image as B-roll over a stretch of the timeline. The edit is a series of speech cuts; B-roll covers the
// picture while the voice carries on, so one clip runs continuously across several cuts (the classic cutaway), with the voice audio untouched.
import path from 'node:path';
import { exists, readJson, writeJson } from './core.js';
import { loadTimeline } from './timeline.js';

const fail = message => { throw new Error(`B-roll: ${message}`); };
const round = n => Math.round(n * 1000) / 1000;

// Pure placement: mutates `out` (a manifest object) and returns what was placed. `asset` is a stock-fetch asset.json, `provenance` its provenance.json.
export function placeBroll(out, manifestDir, dir, asset, provenance, { at, duration, inStart = 0, fit, motion } = {}) {
  if (!(at >= 0)) fail('--at (timeline seconds) is required');
  const fps = out.fps;
  const isVideo = asset.kind === 'video';
  const available = provenance.candidate?.duration;
  if (!(duration >= 0.5 && duration <= 60)) fail('--duration must be 0.5 to 60 seconds');
  if (isVideo && available && inStart + duration > available + 0.05) fail(`the clip is ${available}s long; ask for at most ${round(available - inStart)}s from ${inStart}s`);
  const rel = path.relative(manifestDir, path.join(dir, asset.path)).split(path.sep).join('/');
  let id = asset.id;
  const existing = out.assets.find(a => a.id === id);
  if (existing && existing.path !== rel) id = `${id}-${out.assets.length}`;
  const portrait = out.height > out.width;
  const useFit = fit || (portrait ? 'blur' : 'cover');
  if (!['cover', 'contain', 'blur'].includes(useFit)) fail('--fit must be cover, contain or blur');
  const useMotion = motion || (isVideo ? undefined : { type: 'zoom-in', amount: 0.06 });
  const warnings = [];
  const frames = s => Math.round(s * fps);
  let cursor = 0;
  const end = at + duration;
  const entries = [];
  for (const [index, scene] of out.scenes.entries()) {
    const s0 = cursor / fps; cursor += frames(scene.duration);
    const s1 = cursor / fps;
    const a = Math.max(s0, at), b = Math.min(s1, end);
    if (b - a <= 0) continue;
    if (b - a < 0.25) { warnings.push(`a ${round(b - a)}s sliver at ${round(a)}s was skipped`); continue; }
    if (scene.kind === 'graphic') { warnings.push(`the B-roll overlaps the graphic scene at ${round(s0)}s; it was not placed over the graphic`); continue; }
    entries.push({ index, entry: { asset: id, ...(isVideo ? { in: round(inStart + (a - at)) } : {}), start: round(a - s0), duration: round(b - a), fit: useFit, ...(useMotion ? { motion: useMotion } : {}) } });
  }
  if (!entries.length) fail(`no scene overlaps ${round(at)}s to ${round(end)}s`);
  if (!existing || existing.path !== rel) out.assets.push({ id, path: rel, kind: asset.kind, approved: true, rights: asset.rights, attribution: asset.attribution, ...(asset.sourceUrl ? { sourceUrl: asset.sourceUrl } : {}) });
  for (const { index, entry } of entries) { const sc = out.scenes[index]; sc.broll = [...(Array.isArray(sc.broll) ? sc.broll : sc.broll ? [sc.broll] : []), entry]; }
  const overlapping = (out.globalOverlays || []).filter(o => o.start < end && o.start + o.duration > at && o.background && o.background !== 'transparent');
  if (overlapping.length) warnings.push(`${overlapping.length} full-frame graphic(s) cover part of this window and will hide the B-roll there; move the B-roll or the graphic`);
  return { scenes: entries.length, asset: id, window: { from: round(at), to: round(end) }, fit: useFit, warnings };
}

async function validated(output, out) {
  await writeJson(output, out);
  try { await loadTimeline(output); } catch (error) {
    await (await import('node:fs/promises')).rm(output, { force: true });
    fail(`the manifest with B-roll is invalid (${error.message}); nothing was written`);
  }
}

export async function addBroll(manifestFile, outputFile, options = {}) {
  const manifestPath = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(manifestPath)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const dir = path.resolve(options.assetDir || fail('--asset-dir (a stock-fetch output folder) is required'));
  const asset = await readJson(path.join(dir, 'asset.json')).catch(() => fail(`no asset.json in ${dir}`));
  const provenance = await readJson(path.join(dir, 'provenance.json')).catch(() => ({}));
  const out = JSON.parse(JSON.stringify(await readJson(manifestPath)));
  const placed = placeBroll(out, path.dirname(manifestPath), dir, asset, provenance, options);
  await validated(output, out);
  return { output, ...placed };
}

// ---- executing a plan: search -> choose -> download -> preview -> placements.json, then apply ----
const words = text => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);

// minHits: how many of the query's words a candidate's tags must share (word stems, so "plugging" meets "plugged"); 0 keeps the old behaviour.
const stem = w => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
export function chooseCandidate(candidates, { needSeconds, targetWidth = 1920, query = '', minHits = 0 }) {
  const wanted = new Set(words(query).map(stem));
  let best = null;
  for (const c of candidates) {
    if (c.duration && c.duration < needSeconds + 0.5) continue;
    const files = (c.files || []).filter(f => f.width).sort((a, b) => a.width - b.width);
    if (!files.length) continue;
    const file = files.find(f => f.width >= targetWidth) || files.at(-1);
    const tagHits = new Set(words(c.tags || '').map(stem).filter(w => wanted.has(w))).size;
    if (tagHits < Math.min(minHits, wanted.size)) continue;
    const score = tagHits * 2 + Math.min(c.duration || needSeconds, needSeconds * 3) / needSeconds * 0.3 - (file.bytes || 0) / 1e8 - (file.width < targetWidth * 0.66 ? 2 : 0);
    if (!best || score > best.score) best = { candidate: c, file, score: round(score) };
  }
  return best;
}

export async function fetchPlan(plan, { dir, manifest, search, download, library = null, execute, fetcher = fetch, provider = 'pixabay', imageProvider = null, type = 'video', max = 8, log = () => {}, only = null, minHits = 0 } = {}) {
  const { searchStock, downloadStock, pickProvider } = await import('./stock.js');
  if (!['video', 'image', 'any'].includes(type)) fail('--type must be video, image or any');
  // Sources tried in order for each query: videos first when asked for any, then photos (Unsplash when its key is set).
  const photoProvider = imageProvider || (provider === 'unsplash' ? 'unsplash' : pickProvider('auto', process.env, 'image'));
  const sources = type === 'video' ? [{ provider, type: 'video' }] : type === 'image' ? [{ provider: photoProvider, type: 'image' }] : [{ provider, type: 'video' }, { provider: photoProvider, type: 'image' }];
  const { run } = await import('./core.js');
  const exec = execute || run;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const portrait = manifest.height > manifest.width;
  const placements = [];
  for (const m of plan.moments.filter(x => !only || only.includes(x.id)).slice(0, max)) {
    const entry = { id: m.id, at: m.at, duration: m.duration, query: m.query, drop: false };
    let chosen = null;
    outer: for (const q of [m.query, ...(m.alternatives || [])].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 3)) {
      for (const source of sources) {
        const catalogFile = path.join(dir, `${m.id}-${source.type}-${q.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}.json`);
        if (await exists(catalogFile)) await (await import('node:fs/promises')).rm(catalogFile);
        try {
          const found = await searchStock(q, catalogFile, search, fetcher, { provider: source.provider, type: source.type, orientation: portrait ? 'portrait' : 'landscape' });
          const pick = chooseCandidate(found.candidates, { needSeconds: m.duration, targetWidth: Math.max(manifest.width, manifest.height) >= 1920 ? 1920 : 1280, query: q, minHits });
          if (pick) { chosen = { ...pick, catalogFile, query: q, source }; break outer; }
        } catch (error) { entry.error = error.message; break outer; }
      }
    }
    if (!chosen) { entry.status = entry.error ? 'error' : 'no-result'; entry.drop = true; placements.push(entry); log(`  ${m.id}: ${entry.status}${entry.error ? ` (${entry.error})` : ''}`); continue; }
    const out = path.join(dir, m.id);
    if (await exists(out)) await (await import('node:fs/promises')).rm(out, { recursive: true, force: true });
    await downloadStock(chosen.catalogFile, chosen.candidate.id, chosen.file.id, out, download, fetcher);
    const preview = path.join(dir, `${m.id}.png`);
    try { await exec(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...(chosen.source.type === 'video' ? ['-ss', '1'] : []), '-i', path.join(out, chosen.source.type === 'video' ? 'stock.mp4' : 'stock.jpg'), '-frames:v', '1', '-vf', 'scale=640:-2', preview]); entry.preview = path.relative(dir, preview); } catch { /* preview is optional */ }
    Object.assign(entry, { status: 'downloaded', query: chosen.query, source: `${chosen.source.provider} ${chosen.source.type}`, assetDir: path.relative(dir, out), creator: chosen.candidate.creator, sourceUrl: chosen.candidate.sourceUrl,
      size: `${chosen.file.width}x${chosen.file.height}`, ...(chosen.candidate.duration ? { clipSeconds: chosen.candidate.duration } : {}) });
    placements.push(entry);
    log(`  ${m.id}: ${chosen.query} -> ${entry.source} ${chosen.candidate.id} (${entry.size}${entry.clipSeconds ? `, ${entry.clipSeconds}s` : ''})`);
  }
  const file = path.join(dir, 'placements.json');
  await writeJson(file, { version: 1, note: 'Look at each preview PNG. Set "drop": true to skip a placement, or change "at" / "duration", then run broll-apply.', placements });
  return { file, placements };
}

// Place every non-dropped placement of a placements.json into the manifest object; a placement that cannot be placed is reported, not fatal.
export async function placeAll(out, manifestDir, record, base, fit) {
  const results = [];
  for (const p of record.placements.filter(x => !x.drop && x.assetDir)) {
    const dir = path.resolve(base, p.assetDir);
    try {
      const asset = await readJson(path.join(dir, 'asset.json'));
      const provenance = await readJson(path.join(dir, 'provenance.json')).catch(() => ({}));
      results.push({ id: p.id, ...placeBroll(out, manifestDir, dir, asset, provenance, { at: p.at, duration: p.duration, fit }) });
    } catch (error) { results.push({ id: p.id, skipped: error.message }); }
  }
  return results;
}

export async function applyPlacements(manifestFile, outputFile, placementsFile, options = {}) {
  const manifestPath = path.resolve(manifestFile);
  const output = path.resolve(outputFile);
  if (path.dirname(output) !== path.dirname(manifestPath)) fail('--output must be in the same folder as the manifest so relative asset paths keep working');
  if (await exists(output)) fail(`output already exists: ${output}`);
  const out = JSON.parse(JSON.stringify(await readJson(manifestPath)));
  const results = await placeAll(out, path.dirname(manifestPath), await readJson(path.resolve(placementsFile)), path.dirname(path.resolve(placementsFile)), options.fit);
  if (!results.some(r => !r.skipped)) fail('no placement could be applied');
  await validated(output, out);
  return { output, results, placed: results.filter(r => !r.skipped).length, warnings: results.flatMap(r => r.warnings || []) };
}
