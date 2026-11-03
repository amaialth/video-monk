// Finds a project's artifacts in a pipeline output folder (the layout `video-monk auto` writes), and builds the timeline lanes the UI draws.
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { exists } from '../core.js';
import { graphicsOf } from '../sfx.js';

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const mtime = async file => (await stat(file)).mtimeMs;
async function dirs(root) { try { return (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } }
async function files(root) { try { return (await readdir(root)).filter(f => !f.startsWith('.')); } catch { return []; } }
async function newest(list) { let best = null, t = -1; for (const f of list) { const m = await mtime(f).catch(() => -1); if (m > t) { t = m; best = f; } } return best; }

export async function discover(root) {
  const out = { root };
  if (!root || !(await exists(root))) return out;
  const at = (...p) => path.join(root, ...p);
  if (await exists(at('analysis.json'))) out.analysis = at('analysis.json');
  if (await exists(at('transcript', 'words.json'))) out.words = at('transcript', 'words.json');
  if (await exists(at('loop-ledger.json'))) out.ledger = at('loop-ledger.json');
  if (await exists(at('REVIEW-LOOP.md'))) out.reviewLoop = at('REVIEW-LOOP.md');
  // the latest edit folder (edit, edit-r2, ...)
  const edits = (await dirs(root)).filter(d => /^edit(-r\d+|-x\d+)?$/.test(d)).map(d => at(d));
  const edit = await newest(edits);
  if (edit) {
    out.editDir = edit;
    if (await exists(path.join(edit, 'autocut-report.json'))) out.cutReport = path.join(edit, 'autocut-report.json');
    if (await exists(path.join(edit, 'words.timeline.json'))) out.timelineWords = path.join(edit, 'words.timeline.json');
    const list = await files(edit);
    // graphics/B-roll manifests, not their storyboards, plans, shorts, word files or reviews
    const graphics = list.filter(f => /^production\.(graphics|broll)(\.[A-Za-z0-9]+)*\.json$/.test(f) && !/\.(storyboard|short|words|review|sfx)\.json$/.test(f)).map(f => path.join(edit, f));
    out.manifest = (await newest(graphics)) || (await exists(path.join(edit, 'production.json')) ? path.join(edit, 'production.json') : null);
    const sbs = list.filter(f => /\.storyboard\.json$/.test(f)).map(f => path.join(edit, f));
    out.storyboard = await newest(sbs);
    const plans = list.filter(f => /\.BROLL-PLAN\.json$/.test(f)).map(f => path.join(edit, f));
    out.brollPlan = await newest(plans);
    const variants = (await dirs(edit)).filter(d => /\.variants$/.test(d));
    if (variants.length) out.variantsDir = path.join(edit, variants[0]);
  }
  // rendered outputs: any folder with a report.json + final.mp4; vertical ones are the short
  const renders = [];
  for (const d of await dirs(root)) {
    const dir = at(d);
    if (await exists(path.join(dir, 'final.mp4')) && await exists(path.join(dir, 'report.json'))) {
      try { const report = await readJson(path.join(dir, 'report.json')); const m = report.verification?.measured || {}; renders.push({ dir, name: d, report, vertical: m.height > m.width, at: await mtime(path.join(dir, 'final.mp4')) }); } catch { /* skip */ }
    }
  }
  renders.sort((a, b) => b.at - a.at);
  const long = renders.find(r => !r.vertical), short = renders.find(r => r.vertical);
  if (long) out.render = { dir: long.dir, name: long.name };
  if (short) out.short = { dir: short.dir, name: short.name };
  return out;
}

// Lanes for the timeline view: cuts, graphics (cutaway/panel/overlay), B-roll, sound effects, music.
export async function timelineOf(manifestFile) {
  const m = await readJson(manifestFile);
  const fps = m.fps || 30;
  const cuts = [], broll = [];
  let at = 0;
  for (const s of m.scenes) {
    cuts.push({ start: at, duration: s.duration, kind: s.kind, chapter: s.chapter || null });
    for (const b of Array.isArray(s.broll) ? s.broll : s.broll ? [s.broll] : []) broll.push({ start: at + b.start, duration: b.duration, asset: b.asset });
    at += s.duration;
  }
  const kindOf = id => String(id || '').replace(/^sfx-/, '');
  return {
    duration: Math.round(at * 1000) / 1000, fps, width: m.width, height: m.height, title: m.title, cuts, broll,
    graphics: graphicsOf(m).map(g => ({ start: g.start, duration: g.duration, template: g.template, mode: g.mode })),
    sfx: (m.audio?.sfx || []).map(x => ({ at: x.at, kind: kindOf(x.asset), gainDb: x.gainDb })),
    music: (m.audio?.music || []).map(x => ({ start: x.start ?? 0, end: x.end ?? at })),
    chapters: m.scenes.reduce((list, s, i) => { if (s.chapter) list.push({ at: cuts[i].start, title: s.chapter }); return list; }, [])
  };
}
