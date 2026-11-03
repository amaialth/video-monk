// Local web server for the Video Monk UI. Loopback only, protected by a per-run token (cookie) and Host/Origin checks, no dependencies.
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, rm } from 'node:fs/promises';
import { exists } from '../core.js';
import { Library } from '../library.js';
import { QUESTIONS, resolveBrief } from '../brief.js';
import { Store, validId } from './store.js';
import { dbPath } from '../db.js';
import { Runner, plannedSteps, normalizeOptions, STEPS } from './runner.js';
import { environment } from './env.js';
import { roots, list as listDir, probeMedia, thumbnail, MEDIA_EXT } from './fsbrowse.js';
import { discover, timelineOf } from './artifacts.js';
import { Previews } from './previews.js';
import { registerMotion } from './motion.js';
import { registerShorts } from './shorts.js';

const WEB = new URL('../../web/', import.meta.url).pathname;
const FONTS = new URL('../../assets/fonts/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt', '.ico': 'image/x-icon' };

const HANDLED = Symbol('handled'); // a route that streamed its own response
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, status, body, headers = {}) => { const text = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(text); };

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw err('Request too large', 413); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw err('Body must be JSON'); }
}

// Serve a file with Range support (video scrubbing) and sensible caching.
async function serveFile(req, res, file, { cache = false } = {}) {
  let info;
  try { info = await stat(file); } catch { throw err('Not found', 404); }
  if (!info.isFile()) throw err('Not found', 404);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    end = Math.min(end, info.size - 1);
    if (!(start >= 0) || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    return req.method === 'HEAD' ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// Only these settings are stored from the browser (a closed list, so nothing else can be written).
const pickSettings = body => Object.fromEntries(['theme', 'defaultOptions', 'lastFolder', 'dismissedTips'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
// A preset never carries the rights attestation or a one-off footage path: those are decided per project.
const stripPrivate = options => { const { rightsConfirmed, wordsFile, shortFrom, shortTo, ...rest } = options || {}; return rest; };
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

export async function startServer({ port = 4173, host = '127.0.0.1', store = null, runner = null, token = randomBytes(18).toString('hex'), previews = new Previews(), shortsDeps = {}, log = () => {} } = {}) {
  store ||= await Store.open();
  runner ||= new Runner(store);
  await runner.recover();
  const library = () => Library.open();
  let origin = '';

  const projectRoots = async id => {
    const p = await store.get(id);
    return { p, roots: [store.dir(id), ...(p.root ? [p.root] : [])] };
  };
  const resolveProjectFile = async (id, rel) => {
    const { p, roots: rs } = await projectRoots(id);
    for (const root of rs) { const full = path.resolve(root, rel); if (inside(root, full) && await exists(full)) return full; }
    if (p.media?.path && path.resolve(rel) === p.media.path) return p.media.path;
    throw err('File not found', 404);
  };

  const projectView = async p => {
    const found = await discover(p.root);
    return { ...p, active: runner.isActive(p.id), artifacts: Object.fromEntries(Object.entries(found).filter(([, v]) => v).map(([k, v]) => [k, typeof v === 'string' ? path.relative(p.root, v) : v?.dir ? { ...v, dir: path.relative(p.root, v.dir) } : v]).filter(([k]) => k !== 'root')) };
  };

  const dataFor = async (p, name) => {
    const dir = store.dir(p.id);
    const found = await discover(p.root);
    const readIf = async f => (f && await exists(f) ? JSON.parse(await readFile(f, 'utf8')) : null);
    const textIf = async f => (f && await exists(f) ? readFile(f, 'utf8') : null);
    const rel = f => (f ? path.relative(p.root, f) : null);
    switch (name) {
      case 'analysis': return await readIf(path.join(dir, 'analysis.json')) || await readIf(found.analysis);
      case 'words': { const f = await exists(path.join(dir, 'script', 'words.corrected.json')) ? path.join(dir, 'script', 'words.corrected.json') : found.words; return { words: await readIf(f) || [], corrected: f?.includes('words.corrected') || false }; }
      case 'script': return { ...(await readIf(path.join(dir, 'script', 'candidates.json')) || { candidates: [] }), fixes: await textIf(path.join(dir, 'script', 'words.corrected.fixes.md')) };
      case 'cut': return await readIf(found.cutReport);
      case 'timeline': return found.manifest ? await timelineOf(found.manifest) : null;
      case 'storyboard': {
        const sb = await readIf(found.storyboard);
        if (!sb) return null;
        return { ...sb, items: sb.items.map(i => ({ ...i, previewUrl: `/api/projects/${p.id}/preview?item=${encodeURIComponent(i.id)}` })), variantsDir: found.variantsDir ? rel(found.variantsDir) : null, brollPlanFile: rel(found.brollPlan) };
      }
      case 'broll-plan': return await readIf(found.brollPlan);
      case 'ledger': { const l = await readIf(found.ledger); return l; }
      case 'approvals': return { approvals: p.approvals };
      case 'variants': return { markdown: await textIf(found.variantsDir ? path.join(found.variantsDir, 'VARIANTS.md') : null) };
      case 'render': case 'short': {
        const r = found[name];
        if (!r) return null;
        const report = await readIf(path.join(r.dir, 'report.json'));
        const url = f => `/api/projects/${p.id}/file?p=${encodeURIComponent(path.relative(p.root, path.join(r.dir, f)))}`;
        return { report, review: await textIf(path.join(r.dir, 'REVIEW.txt')), youtube: await textIf(path.join(r.dir, 'YOUTUBE.md')), credits: await textIf(path.join(r.dir, 'CREDITS.txt')), chapters: await textIf(path.join(r.dir, 'chapters.txt')),
          files: { video: url('final.mp4'), thumbnail: url('thumbnail.png'), contactSheet: url('contact-sheet.png'), captionsSrt: await exists(path.join(r.dir, 'captions.srt')) ? url('captions.srt') : null, captionsVtt: await exists(path.join(r.dir, 'captions.vtt')) ? url('captions.vtt') : null } };
      }
      default: throw err('Unknown data set', 404);
    }
  };

  const importProject = async body => {
    const root = path.resolve(String(body.root || ''));
    if (!(await exists(root))) throw err('Folder not found', 404);
    const found = await discover(root);
    if (!found.render && !found.cutReport && !found.ledger) throw err('That folder does not look like a Video Monk output folder (no edit, render or review-loop files found)');
    const analysis = found.analysis ? JSON.parse(await readFile(found.analysis, 'utf8')) : null;
    const mediaPath = analysis?.source || null;
    const steps = {};
    const done = (k, cond, extra = {}) => { if (cond) steps[k] = { status: 'done', label: STEPS[k], ...extra }; };
    done('inspect', found.analysis); done('transcript', found.words); done('cut', found.cutReport); done('storyboard', found.storyboard); done('render', found.render); done('short', found.short);
    const name = body.name || (mediaPath ? path.basename(mediaPath, path.extname(mediaPath)) : path.basename(root));
    const project = await store.create({ name, imported: true, status: 'imported', root, media: { path: mediaPath, name: mediaPath ? path.basename(mediaPath) : name }, options: {}, steps });
    return project;
  };

  const routes = [];
  const on = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

  on('GET', '/api/session', async () => ({ version: JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version, user: os.userInfo().username, home: os.homedir(), platform: process.platform }));
  on('GET', '/api/env', async () => environment());
  on('GET', '/api/brief/questions', async () => QUESTIONS);
  on('POST', '/api/brief/resolve', async ({ body }) => resolveBrief(body));
  on('GET', '/api/fs/roots', async () => roots());
  on('GET', '/api/fs/list', async ({ query }) => listDir(query.get('path')));
  on('GET', '/api/fs/probe', async ({ query }) => probeMedia(query.get('path')));
  on('GET', '/api/fs/thumb', async ({ req, res, query }) => { const f = query.get('path'); if (!MEDIA_EXT.has(path.extname(String(f)).toLowerCase())) throw err('Not a video file'); await serveFile(req, res, await thumbnail(f, query.get('t') === null ? null : Number(query.get('t')), 480), { cache: true }); return HANDLED; });

  on('GET', '/api/projects', async () => Promise.all((await store.list()).map(async p => ({ ...p, active: runner.isActive(p.id), pending: p.pending ? { gate: p.pending.gate, step: p.pending.step } : null }))));
  on('POST', '/api/projects', async ({ body }) => {
    const media = await probeMedia(body.media);
    const options = body.options || {};
    const name = String(body.name || path.basename(media.name, path.extname(media.name))).slice(0, 120);
    normalizeOptions(options);
    store.db.touchMedia({ path: media.path, name: media.name, duration: media.duration });
    const project = await store.create({ name, media, options, steps: Object.fromEntries(plannedSteps({ ...options, gates: { final: true, ...(options.gates || {}) } }).map(s => [s, { status: 'pending', label: STEPS[s] }])) });
    if (body.start) await runner.start(project.id);
    return store.get(project.id);
  });
  on('POST', '/api/projects/import', async ({ body }) => importProject(body));
  on('GET', '/api/projects/:id', async ({ params }) => projectView(await store.get(params.id)));
  on('DELETE', '/api/projects/:id', async ({ params }) => { const p = await store.get(params.id); if (runner.isActive(p.id)) throw err('Cancel the run first', 409); await store.remove(p.id); return { ok: true }; });
  on('POST', '/api/projects/:id/start', async ({ params }) => runner.start(params.id));
  on('POST', '/api/projects/:id/resume', async ({ params }) => runner.resume(params.id));
  on('GET', '/api/projects/:id/runs', async ({ params }) => { await store.get(params.id); return { runs: store.runs(params.id), checkpoints: Object.fromEntries(Object.entries(store.checkpoints(params.id)).map(([k, v]) => [k, v.at])) }; });
  on('POST', '/api/projects/:id/cancel', async ({ params }) => { runner.cancel(params.id); return { ok: true }; });
  on('POST', '/api/projects/:id/duplicate', async ({ params }) => { const p = await store.get(params.id); return store.create({ name: `${p.name} (again)`, media: p.media, options: p.options, steps: {} }); });
  on('POST', '/api/projects/:id/gates/:gate', async ({ params, body }) => { await runner.resolveGate(params.id, params.gate, body); return { ok: true }; });
  on('POST', '/api/projects/:id/actions/broll-fetch', async ({ params, body }) => ({ placements: await runner.brollFetch(params.id, body) }));
  on('POST', '/api/projects/:id/actions/broll-apply', async ({ params, body }) => runner.brollApply(params.id, body));
  on('GET', '/api/projects/:id/data/:name', async ({ params }) => dataFor(await store.get(params.id), params.name));
  on('GET', '/api/projects/:id/file', async ({ req, res, params, query }) => { await serveFile(req, res, await resolveProjectFile(params.id, query.get('p') || ''), { cache: false }); return HANDLED; });
  on('GET', '/api/projects/:id/source', async ({ req, res, params }) => { const p = await store.get(params.id); if (!p.media?.path || !(await exists(p.media.path))) throw err('Source file not found', 404); await serveFile(req, res, p.media.path); return HANDLED; });
  on('GET', '/api/projects/:id/preview', async ({ req, res, params, query }) => {
    const p = await store.get(params.id);
    const found = await discover(p.root);
    // the storyboard being approved may be newer than any file on disk, so the live payload wins
    const live = p.pending?.payload?.items;
    const sb = live ? { items: live, theme: p.pending.payload.theme } : (found.storyboard ? JSON.parse(await readFile(found.storyboard, 'utf8')) : null);
    const item = sb?.items.find(i => i.id === query.get('item'));
    if (!item) throw err('Graphic not found', 404);
    const alt = query.get('alt') !== null && item.alternatives ? item.alternatives[Number(query.get('alt'))] : null;
    await serveFile(req, res, await previews.still({ template: alt?.template || item.template, props: alt?.props || item.props, theme: sb.theme || 'night', mode: item.mode, duration: item.duration }), { cache: true });
    return HANDLED;
  });
  on('GET', '/api/library', async ({ query }) => {
    const lib = await library();
    if (!lib) return { enabled: false, entries: [], stats: null };
    const entries = lib.search(query.get('q') || '', { kind: query.get('kind') || null, limit: 120 }).map(r => r.entry || r);
    return { enabled: true, root: lib.root, entries: entries.map(({ id, kind, name, description, tags, rights, attribution, uses, bytes, createdAt, meta }) => ({ id, kind, name, description, tags, rights, attribution, uses, bytes, createdAt, template: meta?.template, width: meta?.width, height: meta?.height })), stats: lib.stats() };
  });

  // ---- motion studio: template previews, standalone-video planner, library vault
  registerMotion(on, { previews, serveFile, HANDLED });
  registerShorts(on, { store, serveFile, HANDLED, err, deps: shortsDeps });

  // ---- things remembered between projects (all in the local database)
  on('GET', '/api/db', async () => ({ ...store.db.info(), file: store.db.file, usage: usageSummary(), schemaTarget: store.db.version }));
  on('GET', '/api/settings', async () => store.db.getKv('ui-settings', {}));
  on('POST', '/api/settings', async ({ body }) => { const next = { ...store.db.getKv('ui-settings', {}), ...pickSettings(body) }; store.db.setKv('ui-settings', next); return next; });
  on('GET', '/api/presets', async () => store.db.presets());
  on('POST', '/api/presets', async ({ body }) => { normalizeOptions({ ...body.options, rightsConfirmed: undefined }); try { return store.db.savePreset(body.name, stripPrivate(body.options)); } catch (error) { throw err(error.message, 400); } });
  on('DELETE', '/api/presets/:pid', async ({ params }) => ({ deleted: store.db.deletePreset(Number(params.pid)) }));
  on('GET', '/api/terms', async () => ({ terms: store.db.terms(), glossary: store.db.glossaryText() }));
  on('POST', '/api/terms/toggle', async ({ body }) => ({ changed: store.db.setTermEnabled(String(body.heard), String(body.term), body.enabled !== false) }));
  on('POST', '/api/terms/delete', async ({ body }) => ({ deleted: store.db.deleteTerm(String(body.heard), String(body.term)) }));
  on('GET', '/api/recent', async () => { const list = store.db.recentMedia(8); const live = []; for (const r of list) { if (await exists(r.path)) live.push(r); else store.db.forgetMedia(r.path); } return live; });
  on('GET', '/api/approvals', async () => store.approvalHistory(300));

  const usageSummary = () => {
    const now = Date.now();
    return { unsplashHour: store.db.usageSince('unsplash', now - 3600e3), pixabayMinute: store.db.usageSince('pixabay', now - 60e3), mireloCredits30d: store.db.usageSince('mirelo', now - 30 * 86400e3) };
  };

  const authorized = req => {
    const cookie = /(?:^|;\s*)vm_token=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1] || req.headers['x-vm-token'];
    if (!cookie || cookie.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(token));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const common = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" };
    for (const [k, v] of Object.entries(common)) res.setHeader(k, v);
    try {
      // DNS-rebinding guard: only our own host names
      const hostOk = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`, `[::1]:${server.address().port}`].includes(req.headers.host);
      if (!hostOk) throw err('Bad host', 403);
      if (url.pathname === '/' && url.searchParams.get('token')) {
        if (url.searchParams.get('token') !== token) throw err('Wrong token', 403);
        res.writeHead(302, { 'Set-Cookie': `vm_token=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
        return res.end();
      }
      if (!authorized(req)) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><meta charset="utf-8"><title>Video Monk</title><body style="font:16px system-ui;padding:48px;max-width:560px;margin:auto"><h2>Open Video Monk from the terminal link</h2><p>Run <code>video-monk ui</code> and open the address it prints. It includes a one-time token that keeps other websites out.</p>');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const o = req.headers.origin;
        if (o && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(o)) throw err('Bad origin', 403);
      }
      // SSE stream of project events
      const sse = /^\/api\/projects\/([^/]+)\/events$/.exec(url.pathname);
      if (sse && req.method === 'GET') {
        const id = sse[1];
        await store.get(id);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const after = Number(url.searchParams.get('after') || req.headers['last-event-id'] || 0);
        const write = e => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
        for (const e of await store.events(id, after)) write(e);
        const onEvent = (pid, e) => { if (pid === id) write(e); };
        store.on('event', onEvent);
        const beat = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clearInterval(beat); store.off('event', onEvent); });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
        if (!route) throw err('Not found', 404);
        const params = route.re.exec(url.pathname).groups || {};
        if (params.id && !validId(params.id)) throw err('Invalid project id');
        const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
        const result = await route.handler({ req, res, params, query: url.searchParams, body });
        if (result !== HANDLED) send(res, 200, result ?? null);
        return;
      }
      // static files
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      if (rel.startsWith('/fonts/')) { await serveFile(req, res, path.join(FONTS, path.basename(rel)), { cache: true }); return; }
      const file = path.join(WEB, rel);
      if (!inside(WEB, file)) throw err('Not found', 404);
      if (!(await exists(file))) { await serveFile(req, res, path.join(WEB, 'index.html')); return; } // single-page app fallback
      await serveFile(req, res, file, { cache: false });
    } catch (error) {
      if (res.headersSent) return res.end();
      send(res, error.status || 500, { error: error.status ? error.message : `Something went wrong: ${String(error.message).slice(0, 300)}` });
      if (!error.status) log(`500 ${req.method} ${url.pathname}: ${error.stack || error.message}`);
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  origin = `http://127.0.0.1:${actual}`;
  return {
    server, store, runner, token, port: actual, url: `${origin}/?token=${token}`, origin,
    async close() { for (const id of [...runner.active.keys()]) { try { runner.cancel(id); } catch { /* ignore */ } } await new Promise(r => server.close(r)); server.closeAllConnections?.(); await previews.close(); }
  };
}
