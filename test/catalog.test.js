import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanBlock, convertBlock, importBlock, listImported, findImported, removeImported, inlineGoogleFonts, catalogEntry, CATALOG_COMMIT } from '../src/catalog.js';

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

const FONT_CSS = `/* latin-ext */\n@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/ext.woff2) format('woff2'); }\n/* latin */\n@font-face { font-family: 'Inter'; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2'); }`;

function fakeFetcher(over = {}) {
  const calls = [];
  const fn = async url => {
    calls.push(String(url));
    const u = new URL(url);
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
  assert.ok(html.indexOf('window.__hyperframes') < html.indexOf('window.__timelines'), 'the variables API exists before the block runs');
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

test('importing needs permission, refuses components, skipped and WebGPU items, bad variables and blocks that cannot run offline', async t => {
  const root = await temporary(t);
  await assert.rejects(importBlock('lt-clean-bar', { root, fetcher: fakeFetcher() }), /--allow-download/);
  await assert.rejects(importBlock('confetti', { allowDownload: true, root, fetcher: fakeFetcher() }), /component/);
  await assert.rejects(importBlock('slack-notification-ad', { allowDownload: true, root, fetcher: fakeFetcher() }), /skipped/);
  await assert.rejects(importBlock('aurora', { allowDownload: true, root, fetcher: fakeFetcher() }), /WebGPU/);
  await assert.rejects(importBlock('not-a-thing', { allowDownload: true, root, fetcher: fakeFetcher() }), /not in the catalog inventory/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher(), vars: { nope: 'x' } }), /no variable "nope"/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher(), vars: { name: { a: 1 } } }), /text, a number or true\/false/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher({ html: '<video src="a.mp4"></video>' }) }), /cannot run offline.*video or audio/);
  await assert.rejects(importBlock('lt-clean-bar', { allowDownload: true, root, fetcher: fakeFetcher({ meta: { files: [{ path: '../evil.html' }] } }) }), /unsafe file path/);
  assert.deepEqual(await listImported(root), []);
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

test('the inventory knows which items are importable blocks', async () => {
  assert.equal((await catalogEntry('lt-clean-bar')).type, 'block');
  assert.equal((await catalogEntry('confetti')).type, 'component');
});
