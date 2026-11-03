import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanBlock, convertBlock, inlineMounts, extractTemplate, unwrapRootTemplate, importBlock, listImported, findImported, removeImported, inlineGoogleFonts, catalogEntry, CATALOG_COMMIT } from '../src/catalog.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-cat-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

// our own fixture that follows the HyperFrames block contract (no third-party code)
const BLOCK = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=block" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body><div id="root" data-composition-id="lt-test" data-width="1920" data-height="1080" data-duration="4"
 data-composition-variables='[{"id":"name","type":"string","default":"Ada"}]'><div id="n"></div></div>
<script>window.__timelines = window.__timelines || {}; var v = window.__hyperframes.getVariables(); document.getElementById('n').textContent = v.name;
var tl = gsap.timeline({ paused: true }); tl.to('#n', { x: 100, duration: 1 }); window.__timelines['lt-test'] = tl;</script></body></html>`;

// a component page that mounts a composition from another file (the HyperFrames way), and the composition itself: a <template> with markup, a style and a script
const DEMO = `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head><body>
<div id="host" data-composition-id="demo" data-width="1920" data-height="1080" data-duration="3">
<div id="mount" class="clip" data-composition-id="confetti" data-composition-src="./confetti.html" data-variable-values='{"accent":"blue"}' data-start="0" data-duration="3"></div></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines['demo'] = gsap.timeline({ paused: true });</script></body></html>`;
const COMPONENT = `<!-- a catalog component -->
<template data-slot="unused"> slot </template>
<template>
  <div id="root" data-composition-id="confetti" data-duration="3">
    <style>.dot{width:10px;height:10px}</style><div class="dot" id="dot"></div>
    <script>window.__timelines = window.__timelines || {}; var v = window.__hyperframes.getVariables(); document.getElementById('dot').dataset.accent = v.accent;
    var tl = gsap.timeline({ paused: true }); tl.to('#dot', { x: 50, duration: 1 }); window.__timelines['confetti'] = tl;</script>
  </div>
</template>`;
const FONT_CSS = `/* latin-ext */\n@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/ext.woff2) format('woff2'); }\n/* latin */\n@font-face { font-family: 'Inter'; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2'); }`;

function fakeFetcher(over = {}) {
  const calls = [];
  const fn = async url => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/registry/components/')) {
      if (u.pathname.endsWith('registry-item.json')) return Response.json({ name: 'confetti', title: 'Confetti', variables: [{ id: 'accent', type: 'string', default: 'red' }], files: [{ path: 'confetti.html' }] });
      if (u.pathname.endsWith('/demo.html')) return new Response(over.demo ?? DEMO);
      if (u.pathname.endsWith('/confetti.html')) return new Response(COMPONENT);
      return new Response('nope', { status: 404 });
    }
    if (u.hostname === 'raw.githubusercontent.com') {
      assert.ok(u.pathname.includes(CATALOG_COMMIT), 'fixed commit');
      if (u.pathname.endsWith('registry-item.json')) return Response.json({ name: 'lt-clean-bar', title: 'Lower Third', author: 'Someone', dimensions: { width: 1920, height: 1080 }, duration: 4.8,
        variables: [{ id: 'name', type: 'string', label: 'Name', default: 'Ada' }], files: [{ path: 'lt-clean-bar.html' }, { path: 'assets/dot.svg' }], ...over.meta });
      if (u.pathname.endsWith('lt-clean-bar.html')) return new Response(over.html ?? BLOCK);
      if (u.pathname.endsWith('dot.svg')) return new Response('<svg/>');
    }
    if (u.hostname === 'fonts.googleapis.com') return new Response(FONT_CSS);
    if (u.hostname === 'fonts.gstatic.com') return new Response(Buffer.from('woff2-bytes'));
    return new Response('nope', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

test('scanBlock reads what a block needs and what stops it working offline', () => {
  const ok = scanBlock(BLOCK);
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.usesGsap, true);
  assert.equal(ok.fontLinks.length, 1);
  const bad = scanBlock('<video src="a.mp4"></video><div data-composition-src="x.html"></div><script src="https://cdn.jsdelivr.net/npm/three/build/three.min.js"></script><script>fetch("/x")</script><img src="https://example.com/a.png">');
  assert.equal(bad.issues.length, 5);
  assert.match(bad.issues.join('|'), /video or audio/);
  assert.match(bad.issues.join('|'), /nested compositions/);
  assert.match(bad.issues.join('|'), /only GSAP is supported/);
  assert.match(bad.issues.join('|'), /run time/);
  assert.match(bad.issues.join('|'), /example\.com/);
  assert.deepEqual(scanBlock('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/CustomEase.min.js"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>').plugins, ['CustomEase']);
  assert.match(scanBlock('<script src="https://cdn.jsdelivr.net/npm/gsap/dist/ScrollTrigger.min.js"></script>').issues.join(), /ScrollTrigger/);
  assert.deepEqual(scanBlock('<!-- <video src=x> --><svg xmlns="http://www.w3.org/2000/svg"></svg>').issues, []);
});

test('convertBlock swaps GSAP for the vault, removes font links, bridges variables and seeking, and keeps the licence header', () => {
  const { html } = convertBlock(BLOCK, { vars: { name: 'Grace' }, defaults: { name: 'Ada' }, fontCss: '@font-face{}', header: 'Licence: Apache-2.0' });
  assert.match(html, /<vm-lib name="gsap"><\/vm-lib>/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic/);
  assert.match(html, /<!--\nLicence: Apache-2\.0\n-->/);
  assert.match(html, /window\.__vmVariables = \{"name":"Grace"\}/);
  assert.match(html, /window\.__seek = function/);
  assert.match(html, /@font-face\{\}/);
  assert.ok(html.indexOf('window.__hyperframes = ') < html.indexOf('var v = window.__hyperframes.getVariables()'), 'the variables API exists before the block runs');
  const tricky = convertBlock('<head></head><body>x</body>', { vars: { v: '</script><script>alert(1)</script>' }, header: 'x --> <script>' }).html;
  assert.doesNotMatch(tricky, /<\/script><script>alert/);
  assert.ok(!tricky.includes('x --> <script>'));
});

test('the bridge works in a DOM: defaults, declared defaults and overrides merge, and every timeline is seeked and clamped', async () => {
  const { html } = convertBlock(BLOCK, { vars: { name: 'Grace' }, defaults: { other: 1 } });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const attr = JSON.parse(/data-composition-variables='([^']*)'/.exec(html)[1]);
  const el = { getAttribute: () => JSON.stringify(attr) };
  const calls = [];
  const win = { __timelines: { a: { pause: () => calls.push('p'), time: v => calls.push(v), duration: () => 2 } }, addEventListener() {} };
  const doc = { querySelector: () => el, baseURI: 'file:///x/index.html', readyState: 'loading', fonts: { ready: Promise.resolve() } };
  new Function('window', 'document', 'URL', 'Promise', scripts[0] + scripts[scripts.length - 1])(win, doc, URL, Promise);
  assert.deepEqual(win.__hyperframes.getVariables(), { other: 1, name: 'Grace' });
  assert.equal(win.__hyperframes.assetUrl('a/b.png'), 'file:///x/a/b.png');
  win.__seek(5);
  assert.deepEqual(calls, ['p', 2]);
});

test('importing needs permission and refuses skipped items, bad variables and pages that cannot run offline', async t => {
  const root = await temporary(t);
  await assert.rejects(importBlock('lt-clean-bar', { root, fetcher: fakeFetcher() }), /--allow-download/);
  await assert.rejects(importBlock('slack-notification-ad', { allowDownload: true, root, fetcher: fakeFetcher() }), /skipped/);
  await assert.rejects(importBlock('not-a-thing', { allowDownload: true, root, fetcher: fakeFetcher() }), /not in the catalog inventory/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher(), vars: { nope: 'x' } }), /no variable "nope"/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher(), vars: { name: { a: 1 } } }), /text, a number or true\/false/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher({ html: '<video src="a.mp4"></video>' }) }), /cannot run offline.*video or audio/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher({ meta: { files: [{ path: '../evil.html' }] } }) }), /unsafe file path/);
  assert.deepEqual(await listImported(root), []);
});

test('WebGPU is a need, not a refusal: it is recorded so a machine without it is told', () => {
  const scan = scanBlock('<script>const a = await navigator.gpu.requestAdapter();</script>');
  assert.equal(scan.webgpu, true);
  assert.deepEqual(scan.issues, []);
  assert.equal(scanBlock('<p>no gpu</p>').webgpu, false);
});

test('a mounted composition is inlined from its <template>, and each mount keeps its own variables', async () => {
  assert.match(extractTemplate(COMPONENT), /id="root"/);
  assert.doesNotMatch(extractTemplate(COMPONENT), /slot/);
  assert.equal(extractTemplate('<p>no template</p>'), null);
  assert.equal(extractTemplate('<template><template data-x>inner</template>outer</template>'), '<template data-x>inner</template>outer');
  const out = await inlineMounts(DEMO, async rel => { assert.equal(rel, 'confetti.html'); return COMPONENT; });
  assert.doesNotMatch(out, /data-composition-src/);
  assert.match(out, /<div id="mount"[^>]*data-variable-values='\{"accent":"blue"\}'[^>]*>\s*<div id="root"/);
  assert.deepEqual(scanBlock(out).issues, []);
  const untouched = await inlineMounts('<div data-composition-src="../evil.html"></div>', async () => { throw new Error('must not fetch'); });
  assert.match(untouched, /data-composition-src/);
  assert.match(scanBlock(untouched).issues.join(), /nested compositions/);
  const none = await inlineMounts(DEMO, async () => '<p>no template here</p>');
  assert.match(none, /data-composition-src/);
});

test('inside a mount, getVariables reads that mount\'s values over the declared defaults, and a page-level override still wins', () => {
  const { html } = convertBlock('<head></head><body></body>', { vars: { size: 9 }, defaults: { d: 'x' } });
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const decl = { getAttribute: () => JSON.stringify([{ id: 'accent', default: 'red' }, { id: 'size', default: 1 }]) };
  const mount = { getAttribute: () => JSON.stringify({ accent: 'blue' }) };
  const current = { closest: sel => (sel === '[data-variable-values]' ? mount : sel === '[data-composition-variables]' ? decl : null) };
  const doc = { currentScript: current, querySelector: () => decl, baseURI: 'file:///x/' };
  const win = { addEventListener() {} };
  new Function('window', 'document', 'URL', script)(win, doc, URL);
  assert.deepEqual(win.__hyperframes.getVariables(), { d: 'x', accent: 'blue', size: 9 });
});

test('Google Fonts imported from CSS, and lottie-web, are handled like their link-tag and vault equivalents', () => {
  const css = scanBlock('<style>@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=block");</style>');
  assert.deepEqual(css.issues, []);
  assert.equal(css.fontLinks.length, 1);
  const lot = '<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js"></script><script>lottie.loadAnimation({})</script>';
  const converted = convertBlock(`<head>${lot}<style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style></head><body></body>`);
  assert.match(converted.html, /<vm-lib name="lottie-web"><\/vm-lib>/);
  assert.doesNotMatch(converted.html, /jsdelivr|fonts\.googleapis/);
  assert.deepEqual(converted.scan.issues, []);
});

test('a component is imported through its demo page, with its mounted composition inlined and the mount\'s variables kept', async t => {
  const root = await temporary(t);
  const item = await importBlock('confetti', { allowDownload: true, root, fetcher: fakeFetcher() });
  assert.equal(item.type, 'component');
  const html = await readFile(item.file, 'utf8');
  assert.doesNotMatch(html, /data-composition-src|jsdelivr/);
  assert.match(html, /<vm-lib name="gsap">/);
  assert.match(html, /data-variable-values='\{"accent":"blue"\}'/);
  assert.equal(item.width, 1920);
  assert.deepEqual(item.needs.libs, ['gsap']);
  assert.equal(item.needs.webgpu, false);
});

test('an import is pinned to one commit and host, inlines the latin font, keeps assets and the licence record, and can be found, listed and removed', async t => {
  const root = await temporary(t);
  const fetcher = fakeFetcher();
  const item = await importBlock('lt-clean-bar', { allowDownload: true, root, fetcher, vars: { name: 'Grace' } });
  assert.deepEqual([...new Set(fetcher.calls.map(u => new URL(u).hostname))].sort(), ['fonts.gstatic.com', 'fonts.googleapis.com', 'raw.githubusercontent.com'].sort());
  const html = await readFile(item.file, 'utf8');
  assert.match(html, /data:font\/woff2;base64,/);
  assert.doesNotMatch(html, /ext\.woff2|latin-ext/);
  assert.match(html, /Apache License, Version 2\.0/);
  assert.equal(await readFile(path.join(item.dir, 'assets', 'dot.svg'), 'utf8'), '<svg/>');
  assert.equal(item.width, 1920);
  assert.equal(item.license, 'Apache-2.0');
  assert.deepEqual(item.vars, { name: 'Grace' });
  assert.equal((await findImported('lt-clean-bar', root)).title, 'Lower Third');
  assert.equal((await listImported(root)).length, 1);
  assert.equal(await removeImported('lt-clean-bar', root), 1);
  await assert.rejects(findImported('lt-clean-bar', root), /not imported/);
});

test('overlay blocks get a transparent page by default; a scene keeps its own background; either can be forced', async t => {
  const root = await temporary(t);
  assert.match(convertBlock('<head></head><body></body>', { transparent: true }).html, /html,body\{background:transparent!important\}/);
  assert.doesNotMatch(convertBlock('<head></head><body></body>').html, /transparent!important/);
  const lt = await importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher() });   // tagged lower-third in the inventory
  assert.equal(lt.transparent, true);
  assert.match(await readFile(lt.file, 'utf8'), /background:transparent!important/);
  const forced = await importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher(), transparent: false });
  assert.equal(forced.transparent, false);
  assert.doesNotMatch(await readFile(forced.file, 'utf8'), /transparent!important/);
});

test('a font that cannot be fetched is a warning, not a failure, and only fonts hosts are ever contacted for fonts', async () => {
  const f = async () => new Response('x', { status: 500 });
  const r = await inlineGoogleFonts(['https://fonts.googleapis.com/css2?family=X'], f);
  assert.equal(r.css, '');
  assert.match(r.warnings[0], /system font/);
  const evil = await inlineGoogleFonts(['https://evil.example/css'], async () => { throw new Error('must not fetch'); });
  assert.match(evil.warnings[0], /refusing to fetch from evil\.example/);
});

test('the inventory knows block and component items', async () => {
  assert.equal((await catalogEntry('lt-clean-bar')).type, 'block');
  assert.equal((await catalogEntry('confetti')).type, 'component');
});

test('the channel "catalog" command still takes its own options and the block importer is a separate command, motion-catalog', async () => {
  const { run } = await import('../src/core.js');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cli = path.join(root, 'bin', 'video-monk.js');
  const old = await run(process.execPath, [cli, 'catalog', '--project', path.join(tmpdir(), 'video-monk-no-such-project'), '--help']);
  assert.match(old.stdout, /catalog\s+--project <folder>/);
  await assert.rejects(run(process.execPath, [cli, 'catalog', '--project', path.join(tmpdir(), 'video-monk-no-such-project')]), error => !/Unknown option/.test(String(error.message)));
  const list = await run(process.execPath, [cli, 'motion-catalog', '--search', 'lt-clean-bar']);
  assert.match(list.stdout, /lt-clean-bar\s+block/);
  const help = (await run(process.execPath, [cli, 'motion-catalog', '--help'])).stdout;
  assert.match(help, /motion-catalog \[--list/);
});

test('sample images hosted on the registry CDN are not downloaded; their paths are recorded and a warning says so', async t => {
  const root = await temporary(t);
  const meta = { files: [{ path: 'lt-clean-bar.html' }, { path: 'assets/photos/one.jpg', type: 'hyperframes:asset', url: 'https://static.heygen.ai/x/one.jpg' }, { path: 'assets/dot.svg' }] };
  const fetcher = fakeFetcher({ meta });
  const item = await importBlock('lt-clean-bar', { allowDownload: true, root, fetcher });
  assert.deepEqual(item.sampleAssetsNotIncluded, ['assets/photos/one.jpg']);
  assert.equal(item.sampleAssetCount, 1);
  assert.match(item.warnings.join(), /1 sample image\(s\) are not included/);
  assert.ok(!fetcher.calls.some(u => /one\.jpg|static\.heygen\.ai/.test(u)), 'nothing is fetched from the CDN');
  assert.equal(await readFile(path.join(item.dir, 'assets', 'dot.svg'), 'utf8'), '<svg/>', 'files that are in the repository are still kept');
});

test('seeking also speaks hf-seek (the protocol shader pages use) and waits for pages that say they are still building', async () => {
  const { html } = convertBlock('<head></head><body></body>');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const events = [];
  let resolveBuild;
  class CE { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  const win = { __timelines: {}, __hf: { buildReady: { shaders: new Promise(r => { resolveBuild = r; }) } }, addEventListener() {}, dispatchEvent: e => events.push([e.type, e.detail.time]) };
  const doc = { readyState: 'loading', fonts: null, querySelector: () => null, baseURI: 'file:///x/' };
  const raf = cb => setTimeout(cb, 0);
  new Function('window', 'document', 'URL', 'CustomEvent', 'Promise', 'requestAnimationFrame', scripts[0] + scripts[scripts.length - 1])(win, doc, URL, CE, Promise, raf);
  const pending = win.__seek(1.5);
  assert.deepEqual(events, [['hf-seek', 1.5]]);
  assert.ok(pending && typeof pending.then === 'function', 'a page with a build promise gets a promise back');
  let done = false; pending.then(() => { done = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(done, false, 'it waits for the page');
  resolveBuild();
  await pending;
  assert.equal(done, true);
  win.__hf.buildReady = {};
  assert.equal(win.__seek(2), undefined, 'a page with nothing to wait for returns at once');
});

test('a page that never becomes ready cannot hang a seek: the wait is capped', async () => {
  const { html } = convertBlock('<head></head><body></body>');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  class CE { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  const win = { __vmSeekWaitMs: 30, __timelines: {}, __hf: { buildReady: { gpu: new Promise(() => {}) } }, addEventListener() {}, dispatchEvent() {} };
  const doc = { readyState: 'loading', fonts: null, querySelector: () => null, baseURI: 'file:///x/' };
  new Function('window', 'document', 'URL', 'CustomEvent', 'Promise', 'requestAnimationFrame', 'setTimeout', scripts[0] + scripts[scripts.length - 1])(win, doc, URL, CE, Promise, cb => setTimeout(cb, 0), setTimeout);
  const started = Date.now();
  await win.__seek(1);
  assert.ok(Date.now() - started < 1000, 'returned after the cap, not never');
});

test('a page whose composition sits in a top-level <template> is unwrapped; a template that is not the root is left alone', () => {
  const wrapped = '<body><template id="x"><div id="root" data-composition-id="x"><script>window.__timelines["x"]=1</script></div></template></body>';
  const un = unwrapRootTemplate(wrapped);
  assert.doesNotMatch(un, /<\/?template/);
  assert.match(un, /<div id="root" data-composition-id="x">/);
  assert.equal(unwrapRootTemplate('<template data-slot="s"><p>slot</p></template><div data-composition-id="a"></div>'), '<template data-slot="s"><p>slot</p></template><div data-composition-id="a"></div>');
  const hosted = '<div data-composition-id="host"></div><template><div data-composition-id="child"></div></template>';
  assert.equal(unwrapRootTemplate(hosted), hosted, 'a page that already has its own composition root keeps the template');
  assert.equal(unwrapRootTemplate('<p>nothing</p>'), '<p>nothing</p>');
  const commented = '<!-- everything lives inside <template>, scripts included -->\n<body><template><div data-composition-id="c"></div></template></body>';
  assert.doesNotMatch(unwrapRootTemplate(commented), /<template>\s*<div/);
  assert.match(unwrapRootTemplate(commented), /<!-- everything lives inside <template>, scripts included -->/);
  assert.match(convertBlock(wrapped).html, /data-composition-id="x"/);
  assert.doesNotMatch(convertBlock(wrapped).html, /<template/);
});

test('the bridge makes window.__timelines exist, and reports unhandled rejections as errors', () => {
  const { html } = convertBlock('<head></head><body></body>');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const listeners = {};
  const win = { addEventListener: (t, f) => { listeners[t] = f; } };
  new Function('window', 'document', 'URL', script)(win, { querySelector: () => null, baseURI: 'file:///x/' }, URL);
  assert.deepEqual(win.__timelines, {});
  listeners.unhandledrejection({ reason: new Error('boom') });
  assert.deepEqual(win.__vmErrors, ['unhandled: boom']);
});
