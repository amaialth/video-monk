import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { untar, rewriteImports, addLib, listLibs, removeLib, expandVm, LIBS, NOT_SUPPORTED } from '../src/libs.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-libs-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

function tar(files) {
  const blocks = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body);
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0);
    header.write(data.length.toString(8).padStart(11, '0'), 124);
    header.write('0', 156);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const packed = files => gzipSync(tar(files));
const integrity = buffer => `sha512-${createHash('sha512').update(buffer).digest('base64')}`;

function fakeRegistry(files, { version = '3.15.0', tamper = false, tarball = 'https://registry.npmjs.org/gsap/-/gsap-3.15.0.tgz' } = {}) {
  const tgz = packed(files);
  return async url => {
    if (String(url).endsWith('.tgz')) return new Response(tamper ? Buffer.concat([tgz, Buffer.from('x')]) : tgz);
    return Response.json({ version, license: 'Standard no charge', dist: { tarball, integrity: integrity(tgz) } });
  };
}

test('untar reads names, sizes and contents and drops the package/ prefix', () => {
  const files = untar(tar({ 'dist/a.js': 'AAA', 'LICENSE': 'MIT' }));
  assert.equal(files.get('dist/a.js').toString(), 'AAA');
  assert.equal(files.get('LICENSE').toString(), 'MIT');
});

test('rewriteImports swaps relative specifiers for bare names and reports the dependencies', () => {
  const { out, deps } = rewriteImports(`import * as T from './three.core.js';\nexport { A } from "../x/y.js";\nconst m = await import('./z.js');\nimport 'pkg';`, 'build/three.module.js', f => `n:${f}`);
  assert.match(out, /from 'n:build\/three\.core\.js'/);
  assert.match(out, /from "n:x\/y\.js"/);
  assert.match(out, /import\('n:build\/z\.js'\)/);
  assert.match(out, /import 'pkg'/);
  assert.deepEqual(deps.sort(), ['build/three.core.js', 'build/z.js', 'x/y.js']);
});

test('addLib refuses without --allow-download, for unknown and unsupported names, and for bad versions', async t => {
  const root = await temporary(t);
  await assert.rejects(addLib('gsap', { root }), /--allow-download/);
  await assert.rejects(addLib('nope', { allowDownload: true, root }), /unknown library/);
  await assert.rejects(addLib('react-three-fiber', { allowDownload: true, root }), /not in the vault/);
  await assert.rejects(addLib('gsap', { allowDownload: true, version: 'latest', root }), /exact version/);
  assert.ok(Object.keys(NOT_SUPPORTED).length >= 5);
});

test('addLib downloads, checks the integrity hash, stores the files with hashes and a licence record', async t => {
  const root = await temporary(t);
  const fetcher = fakeRegistry({ 'dist/gsap.min.js': 'window.gsap={};', 'LICENSE': 'terms' });
  const lib = await addLib('gsap', { allowDownload: true, fetcher, root });
  assert.equal(lib.version, '3.15.0');
  assert.equal(lib.license, 'Standard no charge');
  assert.match(lib.files['dist/gsap.min.js'], /^[0-9a-f]{64}$/);
  assert.equal(lib.licenseFile, 'LICENSE');
  assert.deepEqual((await listLibs(root)).map(l => l.id), ['gsap']);
  const again = await addLib('gsap', { allowDownload: true, fetcher, root });
  assert.equal(again.existed, true);
  assert.equal(await removeLib('gsap', root), 1);
  assert.deepEqual(await listLibs(root), []);
});

test('addLib stops on a hash mismatch, a tarball outside registry.npmjs.org and a missing bundle', async t => {
  const root = await temporary(t);
  await assert.rejects(addLib('gsap', { allowDownload: true, fetcher: fakeRegistry({ 'dist/gsap.min.js': 'x' }, { tamper: true }), root }), /integrity/);
  await assert.rejects(addLib('gsap', { allowDownload: true, fetcher: fakeRegistry({ 'dist/gsap.min.js': 'x' }, { tarball: 'https://evil.example/gsap.tgz' }), root }), /registry\.npmjs\.org/);
  await assert.rejects(addLib('gsap', { allowDownload: true, fetcher: fakeRegistry({ 'other.js': 'x' }), root }), /not in gsap/);
  assert.deepEqual(await listLibs(root), []);
});

test('expandVm inlines a library and an asset, reports what it used, and ignores tags inside comments', async t => {
  const root = await temporary(t);
  const base = await temporary(t);
  await addLib('gsap', { allowDownload: true, fetcher: fakeRegistry({ 'dist/gsap.min.js': 'window.gsap={ok:1};' }), root });
  await writeFile(path.join(base, 'm.json'), '{"a":1}');
  const html = '<html><head></head><body><!-- <vm-asset name="ghost" src="missing.json"></vm-asset> --><vm-lib name="gsap"></vm-lib><vm-asset name="m" src="m.json"></vm-asset></body></html>';
  const { html: out, used } = await expandVm(html, { baseDir: base, root });
  assert.deepEqual(used, ['gsap@3.15.0']);
  assert.match(out, /window\.gsap=\{ok:1\}/);
  assert.match(out, /__vmAssets/);
  assert.match(out, /data:application\/json;base64,/);
  assert.match(out, /<base href="file:\/\//);
  assert.doesNotMatch(out, /<vm-lib/);
});

test('expandVm says how to install a missing library and a missing asset file', async t => {
  const root = await temporary(t);
  await assert.rejects(expandVm('<vm-lib name="three"></vm-lib>', { root }), /libs --add three/);
  await assert.rejects(expandVm('<vm-asset name="a" src="nope.glb"></vm-asset>', { baseDir: root, root }), /not found/);
  const plain = await expandVm('<p>nothing</p>', { root });
  assert.deepEqual(plain, { html: '<p>nothing</p>', used: [] });
});

test('the registry lists every library the skill documents', () => {
  for (const id of ['three', 'gsap', 'animejs', 'lottie-web', 'motion', 'rive', 'babylonjs', 'playcanvas', 'aframe']) assert.ok(LIBS[id], id);
});
