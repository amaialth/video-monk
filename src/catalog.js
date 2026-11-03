// Catalog import: turn a HyperFrames catalog block into a self-contained, offline scene our renderer can play.
// A block is an HTML composition that registers paused GSAP timelines on window.__timelines, loads GSAP (and sometimes fonts) from the network and
// reads its settings through window.__hyperframes.getVariables(). Our renderer is offline and drives window.__seek(t), so the importer
//   - swaps the GSAP CDN script for the library vault (<vm-lib name="gsap">),
//   - inlines Google Fonts (latin subset) as data URLs,
//   - adds a small bridge: __hyperframes.getVariables()/assetUrl() and a __seek(t) that seeks every registered timeline,
//   - and REFUSES blocks it cannot make offline (video/audio, nested compositions, runtime fetches, other libraries, remote images).
// Nothing is bundled: files are downloaded once, on explicit permission, from a fixed commit of github.com/heygen-com/hyperframes (Apache-2.0)
// and cached under ~/.video-monk/catalog/. The licence and author are kept in a header comment and in item.json. Items are third-party code: they run
// only inside the offline renderer, and the person importing one is asked to read what they import.
import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { exists, run } from './core.js';
import { LIBS } from './libs.js';

const fail = message => { throw new Error(`Catalog: ${message}`); };
export const CATALOG_COMMIT = '47dddedd6cd1dea646c5ae53d40bb5821f45590f';
const RAW_ROOT = `https://raw.githubusercontent.com/heygen-com/hyperframes/${CATALOG_COMMIT}/registry/`;
export const catalogRoot = () => path.join(process.env.VIDEO_MONK_HOME || path.join(os.homedir(), '.video-monk'), 'catalog');
const DATA = new URL('../assets/hyperframes-catalog.json', import.meta.url).pathname;
const MAX_FILE = 12 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const pick = (text, re) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
const SAFE_FILE = /^[\w][\w./-]*$/;
const GSAP_PLUGINS = Object.fromEntries(Object.entries(LIBS.gsap.optional || {}).map(([k, f]) => [f.split('/').pop().replace('.min.js', ''), k]));

let dataCache = null;
export async function catalogData() { dataCache ||= JSON.parse(await readFile(DATA, 'utf8')); return dataCache; }
export async function catalogEntry(name) {
  const entry = (await catalogData()).items.find(i => i.name === name);
  if (!entry) fail(`"${name}" is not in the catalog inventory (see: video-monk motion-catalog --list)`);
  return entry;
}

// ---- pure: look at a block's HTML and say what it needs and what stops it working offline
export function scanBlock(html) {
  const issues = [], plugins = new Set(), fontLinks = [], lottieSeen = [];
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<(video|audio)\b/i.test(noComments)) issues.push('it plays video or audio, which the offline importer does not support');
  if (/data-composition-src/i.test(noComments)) issues.push('it mounts nested compositions through HyperFrames\' own runtime');
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(noComments)) issues.push('it loads data at run time');
  const webgpu = /navigator\.gpu|data-requires-webgpu/.test(noComments);
  if (/(?:from|import\s*\()\s*['"]https?:/.test(noComments)) issues.push('it imports a module from the network');
  const gsapSeen = [];
  for (const m of noComments.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi)) {
    const url = new URL(m[1]);
    const gsap = url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/gsap(@[\w.-]+)?\/dist\/([A-Za-z]+)\.min\.js$/.exec(url.pathname);
    const lottie = url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/lottie-web(@[\w.-]+)?\/build\/player\/lottie(_light|_svg|_canvas)?(\.min)?\.js$/.test(url.pathname);
    if (lottie) { lottieSeen.push(m[0]); continue; }
    if (gsap) {
      const file = gsap[2];
      if (file === 'gsap') gsapSeen.push(m[0]);
      else if (GSAP_PLUGINS[file]) { plugins.add(GSAP_PLUGINS[file]); gsapSeen.push(m[0]); }
      else issues.push(`it needs the GSAP plugin ${file}, which is not in the vault`);
    } else issues.push(`it loads a script from ${url.hostname} (${url.pathname.split('/').slice(-1)[0]}); only GSAP is supported offline`);
  }
  for (const m of noComments.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0], href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/^https?:/i.test(href)) continue;
    const host = new URL(href).hostname;
    if (/rel=["']preconnect["']/i.test(tag) && FONT_HOSTS.has(host)) continue;
    if (host === 'fonts.googleapis.com') fontLinks.push(href); else issues.push(`it loads a stylesheet or font from ${host}`);
  }
  for (const m of noComments.matchAll(/@import\s+(?:url\()?\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s;]+)["']?\)?\s*;?/gi)) fontLinks.push(m[1]);
  for (const m of noComments.matchAll(/(?:<(?:img|source|image)\b[^>]*\b(?:src|href|xlink:href)=|url\()\s*["']?(https?:\/\/[^"')\s>]+)/gi)) { const h = new URL(m[1]).hostname; if (!FONT_HOSTS.has(h)) issues.push(`it loads an image or file from ${h}`); }
  return { issues: [...new Set(issues)], plugins: [...plugins].sort(), fontLinks: [...new Set(fontLinks)], usesGsap: gsapSeen.length > 0 || /\bgsap\./.test(noComments), gsapTags: gsapSeen, lottieTags: lottieSeen, webgpu };
}

const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// ---- mounts: a page can mount a composition from another file with data-composition-src; HyperFrames' own runtime fetches it and clones its <template> into place.
// The same is done once, at import time: the template's content (markup, styles, scripts) goes inside the mount element, and the attribute is removed.
export function extractTemplate(fragment) {
  const text = fragment.replace(/<!--[\s\S]*?-->/g, '');
  const open = /<template>/i.exec(text);                                              // the composition's own template (slot templates carry attributes)
  if (!open) return null;
  let depth = 1, i = open.index + open[0].length;
  const tag = /<(\/?)template\b[^>]*>/gi; tag.lastIndex = i;
  for (let m; (m = tag.exec(text));) { depth += m[1] ? -1 : 1; if (depth === 0) return text.slice(i, m.index); }
  return null;
}
export async function inlineMounts(html, fetchFragment) {
  const re = /<(div|section)\b([^>]*?)\sdata-composition-src=["'](\.\/[\w.-]+\.html)["']([^>]*)>\s*<\/\1>/gi;
  const matches = [...html.matchAll(re)];
  let out = html, shift = 0;
  for (const m of matches) {
    const inner = extractTemplate(await fetchFragment(m[3].slice(2)));
    if (inner === null) continue;                                                      // left alone: the scan will say it cannot be imported
    const replacement = `<${m[1]}${m[2]}${m[4]}>${inner}</${m[1]}>`;
    out = out.slice(0, m.index + shift) + replacement + out.slice(m.index + shift + m[0].length);
    shift += replacement.length - m[0].length;
  }
  return out;
}

// A page whose whole composition sits in a top-level <template> is meant to be mounted by HyperFrames' runtime, which unwraps it. Nothing mounts it here, so it is unwrapped.
export function unwrapRootTemplate(html) {
  const masked = html.replace(/<!--[\s\S]*?-->/g, c => ' '.repeat(c.length));      // a comment may mention <template>; indexes stay aligned with the original
  const tagRe = /<(\/?)template\b([^>]*)>/gi;
  let start = null, depth = 0;
  for (let m; (m = tagRe.exec(masked));) {
    if (start === null) { if (!m[1] && !/data-slot/i.test(m[2])) { start = m; depth = 1; } continue; }
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const inner = html.slice(start.index + start[0].length, m.index);
      const outside = html.slice(0, start.index) + html.slice(m.index + m[0].length);
      const stripped = outside.replace(/<!--[\s\S]*?-->/g, '');
      void masked;
      if (!/data-composition-id/i.test(inner) || /data-composition-id/i.test(stripped)) return html;       // not a root wrapper: something else already hosts a composition
      return html.slice(0, start.index) + inner + html.slice(m.index + m[0].length);
    }
  }
  return html;
}

// ---- pure: the bridge
function headBridge(vars, defaults) {
  return `<script>/* video-monk catalog bridge: the HyperFrames runtime API a block expects */
window.__vmErrors = [];
window.__timelines = window.__timelines || {};              // HyperFrames' runtime creates this before a composition runs
window.addEventListener('error', function (e) { window.__vmErrors.push(String(e.message || e)); });
window.addEventListener('unhandledrejection', function (e) { window.__vmErrors.push('unhandled: ' + String((e.reason && (e.reason.message || e.reason)) || e)); });
window.__vmVariables = ${jsonForScript(vars)};
window.__vmVariableDefaults = ${jsonForScript(defaults)};
window.__hyperframes = Object.assign(window.__hyperframes || {}, {
  getVariables: function () {
    var out = {}, k, d = window.__vmVariableDefaults || {};
    for (k in d) out[k] = d[k];
    // a composition mounted inside a page has its own declared defaults and its own values: the script that is running tells which mount it belongs to
    var cs = document.currentScript, scope = cs && cs.closest ? cs : null;
    var decl = (scope && scope.closest('[data-composition-variables]')) || document.querySelector('[data-composition-variables]');
    if (decl) { try { JSON.parse(decl.getAttribute('data-composition-variables')).forEach(function (v) { if (v && v.id !== undefined && v['default'] !== undefined) out[v.id] = v['default']; }); } catch (e) {} }
    var mount = scope && scope.closest('[data-variable-values]');
    if (mount) { try { var mv = JSON.parse(mount.getAttribute('data-variable-values')); for (k in mv) out[k] = mv[k]; } catch (e) {} }
    var o = window.__vmVariables || {};
    for (k in o) out[k] = o[k];
    return out;
  },
  assetUrl: function (p) { try { return new URL(p, document.baseURI).href; } catch (e) { return p; } }
});
</script>`;
}
const SEEK_BRIDGE = `<script>/* video-monk catalog bridge: seek every timeline the block registered (hold the last frame after its end), and speak HyperFrames' hf-seek protocol for pages that draw themselves */
window.__seek = function (t) {
  var all = window.__timelines || {};
  for (var id in all) { var tl = all[id]; if (tl && typeof tl.time === 'function') { tl.pause(); tl.time(Math.max(0, Math.min(t, tl.duration()))); } }
  try { window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: t } })); } catch (e) {}
  // shader-style pages render asynchronously and say what they are ready with: wait for that, then two frames, so the picture is the one for this moment
  var pending = [], br = window.__hf && window.__hf.buildReady;
  if (br) for (var k in br) if (br[k] && br[k].then) pending.push(br[k]);
  if (!pending.length) return undefined;
  // a page that can never get ready (WebGPU missing, say) must not hang the render: wait at most a few seconds, then draw what there is
  var cap = new Promise(function (r) { setTimeout(r, window.__vmSeekWaitMs || 4000); });
  return Promise.race([Promise.all(pending), cap]).then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
};
(function ready() {
  var done = function () { Promise.resolve(window.__seek(0)).then(function () { window.__vmReady = true; }, function () { window.__vmReady = true; }); };
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  var go = function () { fonts.then(done, done); };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
</script>`;

// ---- pure: convert one block's HTML (fontCss is the inlined @font-face text, or '')
export function convertBlock(html, { vars = {}, defaults = {}, fontCss = '', header = '', transparent = false } = {}) {
  html = unwrapRootTemplate(html);
  const scan = scanBlock(html);
  let out = html;
  let first = true;
  for (const tag of scan.gsapTags) {
    out = out.replace(tag, first ? `<vm-lib name="gsap"></vm-lib>` : '');
    first = false;
  }
  if (!scan.gsapTags.length && scan.usesGsap) out = out.replace(/<\/head>/i, `<vm-lib name="gsap"></vm-lib></head>`);
  out = out.replace(/<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi, '');
  out = out.replace(/@import\s+(?:url\()?\s*["']?https:\/\/fonts\.googleapis\.com\/[^"')\s;]+["']?\)?\s*;?/gi, '');
  let lottieFirst = true;
  for (const tag of scan.lottieTags) { out = out.replace(tag, lottieFirst ? '<vm-lib name="lottie-web"></vm-lib>' : ''); lottieFirst = false; }
  const headInject = `${header ? `<!--\n${header.replace(/-->/g, '--&gt;')}\n-->\n` : ''}${headBridge(vars, defaults)}${fontCss ? `<style>/* fonts inlined by video-monk (latin) */\n${fontCss}</style>` : ''}${transparent ? '<style>/* overlay: let the picture show through */html,body{background:transparent!important}</style>' : ''}`;
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head([^>]*)>/i, `<head$1>${headInject}`) : `${headInject}${out}`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${SEEK_BRIDGE}</body>`) : `${out}${SEEK_BRIDGE}`;
  return { html: out, scan };
}

// ---- network: a fixed commit on raw.githubusercontent.com, plus Google Fonts for the latin subset
async function getBuffer(url, fetcher, { hosts, limit = MAX_FILE }) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.has(u.hostname)) fail(`refusing to fetch from ${u.hostname}`);
  const res = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } });
  if (!res.ok) fail(`${u.hostname}${u.pathname.slice(0, 80)} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) fail(`${u.pathname.split('/').pop()} is larger than ${Math.round(limit / 1048576)} MB`);
  return buf;
}

export async function inlineGoogleFonts(links, fetcher) {
  const css = [], warnings = [];
  for (const link of links) {
    try {
      const text = (await getBuffer(link, fetcher, { hosts: FONT_HOSTS, limit: 1048576 })).toString('utf8');
      // keep the latin subset of every face (the file marks each block with a /* latin */ comment); without comments keep all
      const blocks = [...text.matchAll(/(\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{[^}]*\}/g)];
      const keep = blocks.some(b => b[2]) ? blocks.filter(b => b[2] === 'latin') : blocks;
      for (const b of keep) {
        let face = b[0].replace(/^\/\*[^*]*\*\/\s*/, '');
        for (const m of [...face.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]) {
          const data = await getBuffer(m[1], fetcher, { hosts: FONT_HOSTS, limit: 2 * 1048576 });
          face = face.replace(m[1], `data:font/woff2;base64,${data.toString('base64')}`);
        }
        css.push(face);
      }
    } catch (error) { warnings.push(`font not embedded (${String(error.message).replace(/^Catalog: /, '')}); the system font is used instead`); }
  }
  return { css: css.join('\n'), warnings };
}

export async function importBlock(name, { allowDownload, vars = {}, transparent, placeholders = true, fetcher = fetch, root = catalogRoot() } = {}) {
  const entry = await catalogEntry(name);
  if (entry.status === 'skip') fail(`${name} is skipped: ${entry.note}`);
  if (!allowDownload) fail(`${name} is downloaded once from github.com/heygen-com/hyperframes (commit ${CATALOG_COMMIT.slice(0, 7)}, Apache-2.0); pass --allow-download to confirm. It is third-party code: read it before you use it.`);
  if (!/^[\w-]+$/.test(name)) fail('invalid name');
  const host = new Set(['raw.githubusercontent.com']);
  const component = entry.type === 'component';
  const base = `${RAW_ROOT}${component ? 'components' : 'blocks'}/${name}/`;      // a component is imported through its standalone demo page
  const meta = JSON.parse((await getBuffer(`${base}registry-item.json`, fetcher, { hosts: host, limit: 1048576 })).toString('utf8'));
  if (meta.name !== name) fail('the registry item does not match the requested name');
  // Sample images and similar files that the registry hosts on its own CDN (not in the repository) are demo content: they are not downloaded, and the
  // paths the page expects are recorded so you can put your own files there.
  const external = component ? [] : (meta.files || []).filter(f => typeof f.path === 'string' && f.url).map(f => f.path);
  const files = component ? ['demo.html'] : (meta.files || []).filter(f => typeof f.path === 'string' && !f.url).map(f => f.path);
  for (const f of files) if (!SAFE_FILE.test(f) || f.split('/').includes('..')) fail(`unsafe file path in the registry item: ${f}`);
  const mainName = files.find(f => /\.html$/.test(f) && !f.includes('/')) || files.find(f => /\.html$/.test(f));
  if (!mainName) fail(`${name} has no HTML composition`);
  const declared = new Set(); // variables a block declares: values for anything else are rejected
  for (const v of meta.variables || []) declared.add(v.id);
  for (const k of Object.keys(vars)) {
    if (!declared.has(k)) fail(`${name} has no variable "${k}"${declared.size ? ` (it has: ${[...declared].join(', ')})` : ''}`);
    if (!['string', 'number', 'boolean'].includes(typeof vars[k])) fail(`variable ${k} must be text, a number or true/false`);
  }
  const defaults = Object.fromEntries((meta.variables || []).filter(v => v.default !== undefined).map(v => [v.id, v.default]));
  let total = 0;
  const bodies = new Map();
  for (const f of files) { const b = await getBuffer(base + f, fetcher, { hosts: host }); total += b.length; if (total > MAX_TOTAL) fail('the item is larger than 40 MB'); bodies.set(f, b); }
  // compositions mounted from other files are inlined first (only plain ./name.html files next to the page)
  const fragments = new Map();
  const source = await inlineMounts(bodies.get(mainName).toString('utf8'), async rel => {
    if (!fragments.has(rel)) { const b = await getBuffer(base + rel, fetcher, { hosts: host }); total += b.length; if (total > MAX_TOTAL) fail('the item is larger than 40 MB'); fragments.set(rel, b.toString('utf8')); }
    return fragments.get(rel);
  });
  const scan = scanBlock(source);
  if (scan.issues.length) fail(`${name} cannot run offline in Video Monk because ${scan.issues.join('; and ')}`);
  const fonts = scan.fontLinks.length ? await inlineGoogleFonts(scan.fontLinks, fetcher) : { css: '', warnings: [] };
  const license = meta.license || 'Apache-2.0';
  const header = [`Imported by Video Monk from the HyperFrames catalog: ${meta.title || name}`, `Source: https://github.com/heygen-com/hyperframes (commit ${CATALOG_COMMIT.slice(0, 7)}), registry/${component ? 'components' : 'blocks'}/${name}`,
    `Licence: ${license}${meta.author ? `; author: ${meta.author}` : ''}; Copyright 2026 HeyGen, Inc. and contributors. Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).`,
    'Changed by Video Monk: libraries loaded from the local library vault, fonts inlined, mounted compositions inlined, a seek bridge added.'].join('\n');
  // overlays (lower thirds, bugs, effects over footage) get a transparent page; a full-screen scene keeps its own background
  const clear = transparent ?? (entry.tags || []).some(t => ['overlay', 'lower-third'].includes(t));
  const converted = convertBlock(source, { vars, defaults, fontCss: fonts.css, header, transparent: clear });
  const dir = path.join(root, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [f, buf] of bodies) {
    if (f === mainName) continue;
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await writeFile(path.join(dir, f), buf);
  }
  await writeFile(path.join(dir, 'index.html'), converted.html);
  // pages built around sample photos (carousels) do not start without their images: plain labelled-by-colour placeholders let the layout run; replace them with your own
  let made = 0;
  if (placeholders && external.length) {
    const PALETTE = ['3b82f6', 'ef4444', '10b981', 'f59e0b', '8b5cf6', 'ec4899', '14b8a6', 'f97316', '6366f1', '84cc16', '06b6d4', 'e11d48'];
    for (const [i, rel] of external.filter(f => /\.(jpe?g|png|webp)$/i.test(f)).slice(0, 60).entries()) {
      const target = path.join(dir, rel);
      try { await mkdir(path.dirname(target), { recursive: true }); await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=0x${PALETTE[i % PALETTE.length]}:s=800x800,format=yuv420p`, '-frames:v', '1', target]); made++; } catch { break; }   // ffmpeg missing: the warning says what to supply
    }
  }
  const libs = [...(scan.usesGsap ? ['gsap'] : []), ...(scan.lottieTags.length ? ['lottie-web'] : [])];
  const item = { name, type: entry.type, sampleAssetsNotIncluded: external.slice(0, 40), sampleAssetCount: external.length, placeholdersMade: made, title: meta.title || name, license, author: meta.author || null, commit: CATALOG_COMMIT, source: `https://github.com/heygen-com/hyperframes/tree/${CATALOG_COMMIT}/registry/${component ? 'components' : 'blocks'}/${name}`,
    width: meta.dimensions?.width || pick(source, /data-width="(\d+)"/) || pick(source, /name="viewport"[^>]*width=(\d+)/), height: meta.dimensions?.height || pick(source, /data-height="(\d+)"/) || pick(source, /name="viewport"[^>]*height=(\d+)/), duration: meta.duration || pick(source, /data-duration="([\d.]+)"/),
    variables: (meta.variables || []).map(v => ({ id: v.id, type: v.type, label: v.label, default: v.default })),
    vars, transparent: clear, needs: { gsap: scan.usesGsap, libs, plugins: scan.plugins, webgpu: scan.webgpu }, warnings: [...fonts.warnings, ...(external.length ? [`${external.length} sample image(s) are not included (they are demo content hosted by HeyGen); ${made ? `${made} plain colour placeholders stand in for them` : 'none were created'}: put your own files at the same paths in the imported folder`] : []), ...(scan.webgpu ? ['needs WebGPU: it renders only on a computer whose Chrome supports it'] : [])], importedAt: new Date().toISOString() };
  await writeFile(path.join(dir, 'item.json'), `${JSON.stringify(item, null, 2)}\n`);
  return { dir, file: path.join(dir, 'index.html'), ...item };
}

export async function listImported(root = catalogRoot()) {
  let names = [];
  try { names = await readdir(root); } catch { return []; }
  const out = [];
  for (const n of names.sort()) { try { out.push({ dir: path.join(root, n), ...JSON.parse(await readFile(path.join(root, n, 'item.json'), 'utf8')) }); } catch { /* not an item */ } }
  return out;
}
export async function findImported(name, root = catalogRoot()) {
  const item = (await listImported(root)).find(i => i.name === name);
  if (!item) fail(`${name} is not imported: run  video-monk motion-catalog --import ${name} --allow-download`);
  return item;
}
export async function removeImported(name, root = catalogRoot()) {
  if (!/^[\w-]+$/.test(name)) fail('invalid name');
  const dir = path.join(root, name);
  if (!(await exists(path.join(dir, 'item.json')))) return 0;
  await rm(dir, { recursive: true, force: true });
  return 1;
}
// Copy an imported item (html, assets, licence record) into a plan's scenes/ folder.
export async function copyImported(name, target, root = catalogRoot()) {
  const item = await findImported(name, root);
  await cp(item.dir, target, { recursive: true });
  return item;
}

// Import many items, one after another with limited concurrency, and report what happened to each. Nothing is rendered here.
export async function importAll(names, options = {}) {
  const { concurrency = 4, onResult = () => {} } = options;
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      try { const r = await importBlock(name, options); const res = { name, ok: true, type: r.type, width: r.width, height: r.height, duration: r.duration, needs: r.needs, warnings: r.warnings }; results.push(res); onResult(res); }
      catch (error) { const res = { name, ok: false, error: String(error.message).replace(/^Catalog: /, '') }; results.push(res); onResult(res); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
