// Motion studio routes for the web app: template previews, the standalone-video planner and the 3D/animation library vault.
// Same rules as the command line: nothing is downloaded without an explicit confirmation, nothing is built or approved here.
import path from 'node:path';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { exists } from '../core.js';
import { TEMPLATES, templateCatalog, validateProps } from '../motion/templates.js';
import { EFFECTS } from '../motion/effects.js';
import { EXAMPLES } from '../motion/examples.js';
import { TYPES, reviewBrief, motionVideo, libsNeeded } from '../motionvideo.js';
import { LIBS, NOT_SUPPORTED, addLib, listLibs, removeLib } from '../libs.js';

const STARTERS = new URL('../../assets/motion-starters/', import.meta.url).pathname;
const CATALOG = new URL('../../assets/hyperframes-catalog.json', import.meta.url).pathname;
let catalogCache = null;
const err = (message, status = 400) => Object.assign(new Error(message), { status });

async function starters() {
  const out = [];
  for (const file of (await readdir(STARTERS).catch(() => [])).filter(f => /^[\w-]+\.html$/.test(f)).sort()) {
    const text = await readFile(path.join(STARTERS, file), 'utf8');
    const note = /<!--\s*Starter:\s*([^\n]*?)(?:\.\s|\n|-->)/.exec(text)?.[1] || '';
    out.push({ name: file.replace(/\.html$/, ''), description: note.trim(), libs: [...text.matchAll(/<vm-lib\s+name="([\w@/.-]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i),
      untested: /NOT TESTED/.test(text), assets: [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<vm-asset\s+name="[\w.-]+"\s+src="([^"]+)"/g)].map(m => m[1]) });
  }
  return out;
}

const parseJson = (text, what) => { try { return JSON.parse(text); } catch { throw err(`${what} is not valid JSON`); } };

export function registerMotion(on, { previews, serveFile, HANDLED }) {
  const adding = new Set();

  on('GET', '/api/motion', async () => {
    const installed = await listLibs();
    const catalog = templateCatalog().map(t => ({ ...t, effect: Boolean(EFFECTS[t.name]), example: EXAMPLES[t.name] || null }));
    return {
      templates: catalog,
      types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, { beats: v.beats, seconds: v.seconds, hold: v.hold, hook: v.hook, about: v.about }])),
      starters: await starters(),
      libs: Object.entries(LIBS).map(([id, d]) => ({ id, license: d.license, use: d.use, kind: d.kind, installed: installed.filter(l => l.id === id).map(l => ({ version: l.version, addedAt: l.addedAt })) })),
      unsupported: NOT_SUPPORTED
    };
  });

  // A still of any built-in template at time `at`; props must validate exactly as they would in a manifest.
  on('GET', '/api/motion/preview', async ({ req, res, query }) => {
    const template = query.get('template');
    if (!TEMPLATES[template] || TEMPLATES[template].internal) throw err('Unknown template', 404);
    let props;
    try { props = validateProps(template, parseJson(query.get('props') || '{}', 'props')); } catch (error) { throw err(error.status ? error.message : String(error.message).replace(/^Motion: /, '')); }
    const at = Number(query.get('at') ?? 2.5);
    if (!Number.isFinite(at) || at < 0 || at > 30) throw err('at must be from 0 to 30 seconds');
    const theme = query.get('theme') === 'paper' ? 'paper' : 'night';
    const mode = TEMPLATES[template].fullFrame ? 'overlay' : 'cutaway';
    await serveFile(req, res, await previews.still({ template, props, theme, mode, duration: Math.max(6, at + 1), at }), { cache: true });
    return HANDLED;
  });

  // A still of one of the shipped starters (only by name from the list: no other path can be rendered).
  on('GET', '/api/motion/starter-preview', async ({ req, res, query }) => {
    const name = String(query.get('name') || '');
    const found = (await starters()).find(s => s.name === name);
    if (!found) throw err('Unknown starter', 404);
    const installed = await listLibs();
    const missing = found.libs.filter(id => !installed.some(l => l.id === id));
    if (missing.length) throw err(`Install ${missing.join(', ')} first (Libraries tab). It is downloaded once, then works offline.`, 409);
    const at = Number(query.get('at') ?? 2.5);
    if (!Number.isFinite(at) || at < 0 || at > 30) throw err('at must be from 0 to 30 seconds');
    const file = path.join(STARTERS, `${name}.html`);
    const stamp = `${(await stat(file)).mtimeMs}|${installed.map(l => `${l.id}@${l.version}`).sort().join(',')}`;
    try { await serveFile(req, res, await previews.still({ html: file, stamp, at, duration: Math.max(6, at + 1), width: 640, height: 360 }), { cache: true }); } catch (error) { if (error.status) throw error; throw err(`The preview failed: ${String(error.message).slice(0, 200)}`, 500); }
    return HANDLED;
  });

  // The captured HyperFrames catalog (read-only data; see references/hyperframes-catalog.md).
  on('GET', '/api/motion/catalog', async () => {
    catalogCache ||= JSON.parse(await readFile(CATALOG, 'utf8'));
    return catalogCache;
  });

  on('POST', '/api/motion/brief/check', async ({ body }) => {
    if (!body.brief || typeof body.brief !== 'object') throw err('Send the brief as an object');
    return { ...reviewBrief(body.brief), libs: await libsNeeded(body.brief) };
  });

  // Write the plan (production.json + brief) into a new folder. Builds nothing, approves nothing.
  on('POST', '/api/motion/video', async ({ body }) => {
    const brief = body.brief;
    if (!brief || typeof brief !== 'object') throw err('Send the brief as an object');
    if ((brief.beats || []).some(b => b && b.html !== undefined)) throw err('Custom HTML beats are set up from the command line; the studio plans beats from built-in templates and the shipped 3D starters');
    const output = String(body.output || '');
    if (!path.isAbsolute(output)) throw err('Choose a folder by its full path');
    const dir = path.resolve(output);
    if (await exists(path.join(dir, 'production.json'))) throw err('That folder already holds a plan; choose a new folder');
    if (!(await exists(path.dirname(dir)))) throw err('The parent folder does not exist');
    const sfx = ['off', 'subtle', 'full'].includes(body.sfx) ? body.sfx : 'subtle';
    const review = reviewBrief(brief);
    if (review.errors.length) throw err(`The brief needs changes: ${review.errors.join('; ')}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    let facts = null;
    if (body.facts !== undefined && body.facts !== null && body.facts !== '') {
      const parsed = typeof body.facts === 'string' ? parseJson(body.facts, 'The fact list') : body.facts;
      await writeFile(path.join(dir, 'facts.json'), `${JSON.stringify(parsed, null, 2)}\n`);
      facts = path.join(dir, 'facts.json');
    }
    let result;
    try { result = await motionVideo(path.join(dir, 'brief.json'), dir, { facts, sfx }); } catch (error) { throw err(String(error.message).replace(/^Motion video: /, '')); }
    const q = s => `'${s.replaceAll("'", "'\\''")}'`;
    return { ...result, dir, next: [
      `video-monk production-review --manifest ${q(result.output)} --output ${q(path.join(dir, 'review.json'))} --approve-plan`,
      `video-monk production-build --manifest ${q(result.output)} --review ${q(path.join(dir, 'review.json'))} --output ${q(path.join(dir, 'build'))} --allow-render --quality draft`] };
  });

  // The vault. Adding downloads once from registry.npmjs.org and needs confirm: true from the person who clicked.
  on('POST', '/api/libs/add', async ({ body }) => {
    const id = String(body.id || '');
    if (!LIBS[id]) throw err('Unknown library');
    if (body.confirm !== true) throw err('Confirm the download first');
    if (adding.has(id)) throw err('That library is already downloading', 409);
    adding.add(id);
    try {
      const lib = await addLib(id, { allowDownload: true, version: body.version || null, with: Array.isArray(body.with) ? body.with.map(String) : [] });
      return { id: lib.id, version: lib.version, license: lib.license, existed: Boolean(lib.existed) };
    } catch (error) { throw err(String(error.message).replace(/^Libs: /, '')); } finally { adding.delete(id); }
  });
  on('POST', '/api/libs/remove', async ({ body }) => {
    const id = String(body.id || '');
    if (!LIBS[id]) throw err('Unknown library');
    return { removed: await removeLib(id) };
  });
}
