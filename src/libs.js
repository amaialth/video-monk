// Library vault: the 3D and animation libraries a custom motion graphic may use (three.js, GSAP, anime.js, Lottie, Rive, Babylon.js,
// PlayCanvas, A-Frame, Motion). The renderer is offline (no network, no CDN), so a library is downloaded ONCE on explicit permission
// from the npm registry, verified against the registry's sha512 integrity hash, and stored under ~/.video-monk/libs/<id>@<version>/.
// A custom graphic then says <vm-lib name="three"></vm-lib> and the renderer inlines it. Nothing is bundled with the toolkit: each library
// keeps its own licence, recorded in lib.json next to its files.
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { exists } from './core.js';

const fail = message => { throw new Error(`Libs: ${message}`); };
const REGISTRY = 'https://registry.npmjs.org';
export const libsRoot = () => path.join(process.env.VIDEO_MONK_HOME || path.join(os.homedir(), '.video-monk'), 'libs');

// kind 'umd': one script defines a global. kind 'esm': ES modules, exposed through an import map built from inlined data URLs.
export const LIBS = {
  three: { npm: 'three', kind: 'esm', license: 'MIT', entry: { three: 'build/three.module.js', 'three/core': 'build/three.core.js' }, global: null,
    addons: ['loaders/GLTFLoader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'postprocessing/ShaderPass.js', 'environments/RoomEnvironment.js', 'geometries/RoundedBoxGeometry.js'],
    use: '3D scenes, product turntables, title sequences, particle fields. glTF models, bloom, PBR lighting' },
  gsap: { npm: 'gsap', kind: 'umd', license: "GSAP Standard 'no charge' licence (https://gsap.com/standard-license): free to use; not OSI open source", files: ['dist/gsap.min.js'], global: 'gsap',
    optional: { CustomEase: 'dist/CustomEase.min.js', MotionPathPlugin: 'dist/MotionPathPlugin.min.js', Flip: 'dist/Flip.min.js', MorphSVGPlugin: 'dist/MorphSVGPlugin.min.js', SplitText: 'dist/SplitText.min.js', DrawSVGPlugin: 'dist/DrawSVGPlugin.min.js' },
    use: 'timelines you can seek exactly: gsap.timeline({ paused: true }).seek(t). DOM, SVG and canvas' },
  animejs: { npm: 'animejs', kind: 'umd', license: 'MIT', files: ['dist/bundles/anime.umd.min.js'], global: 'anime', use: 'timelines and springs for DOM, SVG and canvas: timeline.seek(ms)' },
  'lottie-web': { npm: 'lottie-web', kind: 'umd', license: 'MIT', files: ['build/player/lottie.min.js'], global: 'lottie', use: 'play After Effects animations exported as Lottie JSON, frame exact: goToAndStop(frame, true)' },
  motion: { npm: 'motion', kind: 'umd', license: 'MIT', files: ['dist/motion.js'], global: 'Motion', use: 'springs and keyframes for DOM and SVG (the library formerly called Framer Motion, vanilla build)' },
  rive: { npm: '@rive-app/canvas', kind: 'umd', license: 'MIT', files: ['rive.js'], extras: { 'rive.wasm': 'rive.wasm' }, global: 'rive', use: 'interactive vector animations authored in Rive (.riv files, state machines)' },
  babylonjs: { npm: 'babylonjs', kind: 'umd', license: 'Apache-2.0', files: ['babylon.js'], global: 'BABYLON', use: '3D scenes with a full engine (large: about 8 MB)' },
  playcanvas: { npm: 'playcanvas', kind: 'umd', license: 'MIT', files: ['build/playcanvas.min.js'], global: 'pc', use: '3D scenes with the PlayCanvas engine' },
  aframe: { npm: 'aframe', kind: 'umd', license: 'MIT', files: [], filesMatch: /^dist\/aframe-v[\d.]+\.min\.js$/, global: 'AFRAME', use: 'declarative 3D (it wraps three.js; for video, use three.js directly)' }
};

// Libraries that were researched and are NOT in the vault, with the reason and the supported route.
export const NOT_SUPPORTED = {
  'react-three-fiber': 'needs React and a JSX build step, which the offline renderer does not have. Write the same scene with three.js directly',
  'react-spring': 'a React hook library. Use Motion or anime.js springs, or the built-in spring easing',
  'spline-interactive': 'scenes load from Spline\'s hosted service and its runtime licence is not stated. Export a glTF or a video from Spline instead',
  'blender-web-pipeline': 'an authoring tool, not a library: export glTF/GLB from Blender and load it with three.js (<vm-asset> inlines the file)',
  'substance-3d-texturing': 'an authoring tool: export the PBR texture maps (base colour, normal, roughness, metallic, AO) and apply them to a three.js MeshStandardMaterial',
  'aframe-webxr': 'WebXR is for headsets; for video use A-Frame only if you need its components, otherwise three.js directly'
};

// ---- tar (npm tarballs are gzip + ustar)
export function untar(buffer) {
  const out = new Map();
  let offset = 0, longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const str = (a, b) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    offset += 512;
    const body = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (longName) { name = longName; longName = null; }
    if (type === '0' || type === '\0') out.set(name.replace(/^package\//, ''), Buffer.from(body));
  }
  return out;
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
const versionOk = v => /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(v);
const tarballOk = url => { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'registry.npmjs.org' && /\.tgz$/.test(u.pathname); };

// Rewrite ES module imports so a data-URL module can find its siblings: relative specifiers become bare names the import map defines.
export function rewriteImports(source, fromFile, nameOf) {
  const deps = new Set();
  const swap = (m, pre, spec, post) => {
    if (!spec.startsWith('.')) return m;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    deps.add(resolved);
    return `${pre}${nameOf(resolved)}${post}`;
  };
  const out = source.replace(/(\bfrom\s+['"])([^'"]+)(['"])/g, swap).replace(/(\bimport\s+['"])([^'"]+)(['"])/g, swap).replace(/(\bimport\(\s*['"])([^'"]+)(['"]\s*\))/g, swap);
  return { out, deps: [...deps] };
}

export async function addLib(id, { allowDownload, version = null, with: withList = [], fetcher = fetch, root = libsRoot() } = {}) {
  const def = LIBS[id];
  if (!def) fail(NOT_SUPPORTED[id] ? `${id} is not in the vault: ${NOT_SUPPORTED[id]}` : `unknown library ${id}; choose from ${Object.keys(LIBS).join(', ')}`);
  if (!allowDownload) fail(`${id} is downloaded from the npm registry (registry.npmjs.org) once; pass --allow-download to confirm`);
  if (version && !versionOk(version)) fail('--version must be an exact version like 0.187.0');
  const meta = await (await fetcher(`${REGISTRY}/${def.npm.replace('/', '%2F')}/${version || 'latest'}`, { redirect: 'error', signal: AbortSignal.timeout(30000) })).json();
  if (!meta?.version || !meta.dist?.tarball || !meta.dist?.integrity?.startsWith('sha512-')) fail(`the registry returned no usable metadata for ${def.npm}`);
  if (!tarballOk(meta.dist.tarball)) fail('the tarball is not on registry.npmjs.org');
  const dir = path.join(root, `${id}@${meta.version}`);
  if (await exists(path.join(dir, 'lib.json'))) return { id, version: meta.version, dir, existed: true, ...JSON.parse(await readFile(path.join(dir, 'lib.json'), 'utf8')) };
  const response = await fetcher(meta.dist.tarball, { redirect: 'error', signal: AbortSignal.timeout(300000) });
  if (!response.ok) fail(`download failed (HTTP ${response.status})`);
  const packed = Buffer.from(await response.arrayBuffer());
  if (packed.length > 200 * 1024 * 1024) fail('the package is larger than 200 MB');
  const got = `sha512-${createHash('sha512').update(packed).digest('base64')}`;
  if (got !== meta.dist.integrity) fail('the download does not match the registry integrity hash; nothing was saved');
  const files = untar(gunzipSync(packed));
  const pick = name => { const f = files.get(name); if (!f) fail(`${name} is not in ${def.npm}@${meta.version}`); return f; };
  const stored = {};
  await mkdir(dir, { recursive: true });
  const save = async (name, buffer) => { const target = path.join(dir, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, buffer); stored[name] = sha256(buffer); };
  const manifest = { id, npm: def.npm, version: meta.version, license: meta.license || def.license, vaultLicence: def.license, kind: def.kind, global: def.global, integrity: meta.dist.integrity, source: 'registry.npmjs.org', addedAt: new Date().toISOString(), use: def.use };
  if (def.kind === 'umd') {
    const names = [...def.files, ...(def.filesMatch ? [...files.keys()].filter(f => def.filesMatch.test(f)) : [])];
    if (!names.length) fail(`${def.npm}@${meta.version} has no browser bundle I recognise`);
    manifest.scripts = [];
    for (const n of names) { await save(n, pick(n)); manifest.scripts.push(n); }
    for (const opt of withList) { const n = def.optional?.[opt]; if (!n) fail(`${id} has no optional file ${opt} (${Object.keys(def.optional || {}).join(', ') || 'none'})`); await save(n, pick(n)); manifest.scripts.push(n); }
    manifest.extras = {};
    for (const [k, n] of Object.entries(def.extras || {})) { await save(n, pick(n)); manifest.extras[k] = n; }
  } else {
    // ES modules: store rewritten copies and an import map {specifier: file}
    const importMap = {};
    const specOf = file => (file === def.entry.three ? 'three' : file === def.entry['three/core'] ? 'three/core' : `three/addons/${file.replace(/^examples\/jsm\//, '')}`);
    const queue = [...Object.values(def.entry), ...def.addons.map(a => `examples/jsm/${a}`), ...withList.map(a => `examples/jsm/${a}`)];
    const seen = new Set();
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const { out, deps } = rewriteImports(pick(file).toString('utf8'), file, specOf);
      await save(file, Buffer.from(out));
      importMap[specOf(file)] = file;
      for (const d of deps) if (!seen.has(d)) queue.push(d);
    }
    manifest.importMap = importMap;
  }
  for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.txt']) if (files.has(n)) { await save(n, files.get(n)); manifest.licenseFile = n; break; }
  manifest.files = stored;
  await writeFile(path.join(dir, 'lib.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, ...manifest };
}

export async function listLibs(root = libsRoot()) {
  let names = [];
  try { names = await readdir(root); } catch { return []; }
  const out = [];
  for (const n of names.sort()) { try { out.push({ dir: path.join(root, n), ...JSON.parse(await readFile(path.join(root, n, 'lib.json'), 'utf8')) }); } catch { /* not a lib */ } }
  return out;
}

export async function removeLib(id, root = libsRoot()) {
  const found = (await listLibs(root)).filter(l => l.id === id);
  if (!found.length) fail(`${id} is not installed`);
  for (const l of found) await rm(l.dir, { recursive: true, force: true });
  return found.length;
}

export async function findLib(id, version = null, root = libsRoot()) {
  const all = (await listLibs(root)).filter(l => l.id === id && (!version || l.version === version));
  if (!all.length) fail(`"${id}" is not installed: run  video-monk libs --add ${id} --allow-download`);
  return all.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
}

const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.riv': 'application/octet-stream', '.lottie': 'application/zip', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
const dataUrl = (buffer, mime) => `data:${mime};base64,${buffer.toString('base64')}`;
const scriptSafe = text => text.replace(/<\/(script)/gi, '<\\/$1');

// Expand <vm-lib name="three"></vm-lib> and <vm-asset name="model" src="model.glb"></vm-asset> in a custom graphic's HTML so it needs nothing from the network.
export async function expandVm(html, { baseDir, root = libsRoot() } = {}) {
  if (!/<vm-(lib|asset)\b/.test(html)) {
    // nothing to inline, but a page loaded from another place still needs its base so relative files (scripts, images, fonts) resolve
    if (baseDir && !/<base\s/i.test(html)) { const tag = `<base href="${new URL(`file://${path.resolve(baseDir)}/`).href}">`; return { html: /<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${tag}`) : `${tag}${html}`, used: [] }; }
    return { html, used: [] };
  }
  const used = [];
  const libTag = /<vm-lib\s+name="([\w@/.-]+)"(?:\s+version="([^"]+)")?(?:\s+with="([^"]*)")?\s*(?:\/>|><\/vm-lib>)/g;
  const assetTag = /<vm-asset\s+name="([\w.-]+)"\s+src="([^"]+)"\s*(?:\/>|><\/vm-asset>)/g;
  const importMap = {};
  let importMapAt = null;
  const parts = [];
  let last = 0;
  const tags = [];
  const comments = [...html.matchAll(/<!--[\s\S]*?-->/g)].map(m => [m.index, m.index + m[0].length]);
  const live = m => !comments.some(([a, b]) => m.index >= a && m.index < b);   // a tag inside an HTML comment is documentation, not a request
  for (const m of html.matchAll(libTag)) if (live(m)) tags.push({ kind: 'lib', index: m.index, length: m[0].length, name: m[1], version: m[2] });
  for (const m of html.matchAll(assetTag)) if (live(m)) tags.push({ kind: 'asset', index: m.index, length: m[0].length, name: m[1], src: m[2] });
  tags.sort((a, b) => a.index - b.index);
  for (const t of tags) {
    parts.push(html.slice(last, t.index));
    last = t.index + t.length;
    if (t.kind === 'asset') {
      const file = path.resolve(baseDir || '.', t.src);
      if (!(await exists(file))) fail(`<vm-asset> file not found: ${t.src}`);
      const buffer = await readFile(file);
      if (buffer.length > 60 * 1024 * 1024) fail(`${t.src} is larger than 60 MB`);
      parts.push(`<script>(window.__vmAssets = window.__vmAssets || {})[${JSON.stringify(t.name)}] = ${JSON.stringify(dataUrl(buffer, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'))};</script>`);
      continue;
    }
    const lib = await findLib(t.name, t.version, root);
    used.push(`${lib.id}@${lib.version}`);
    if (lib.kind === 'umd') {
      const code = [];
      for (const s of lib.scripts) code.push(`/* ${lib.id}@${lib.version} ${s} */\n${await readFile(path.join(lib.dir, s), 'utf8')}`);
      const extras = Object.fromEntries(await Promise.all(Object.entries(lib.extras || {}).map(async ([k, f]) => [k, dataUrl(await readFile(path.join(lib.dir, f)), 'application/wasm')])));
      parts.push(`<script>${scriptSafe(code.join('\n'))}</script>${Object.keys(extras).length ? `<script>window.__vmLibFiles = Object.assign(window.__vmLibFiles || {}, ${JSON.stringify(extras)});</script>` : ''}`);
    } else {
      for (const [spec, f] of Object.entries(lib.importMap)) importMap[spec] = dataUrl(await readFile(path.join(lib.dir, f)), 'text/javascript');
      if (importMapAt === null) { importMapAt = parts.length; parts.push(''); }
    }
  }
  parts.push(html.slice(last));
  if (importMapAt !== null) parts[importMapAt] = `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`;
  let out = parts.join('');
  // relative files (images, fonts) next to the graphic keep working although the page is rendered from a cache folder
  if (baseDir && !/<base\s/i.test(out)) { const tag = `<base href="${new URL(`file://${path.resolve(baseDir)}/`).href}">`; out = /<head[\s>]/i.test(out) ? out.replace(/<head([^>]*)>/i, `<head$1>${tag}`) : `${tag}${out}`; }   // a page without a <head> still needs its base
  return { html: out, used };
}
