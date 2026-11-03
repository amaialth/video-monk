import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson, exists } from '../src/core.js';
import { searchStock, downloadStock, pickProvider } from '../src/stock.js';
import { fetchPlan, applyPlacements } from '../src/broll.js';
import { Library } from '../src/library.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-unsplash-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const KEY = 'unsplash-access-secret-777';
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

const photo = (id, over = {}) => ({ id, width: 6000, height: 4000, alt_description: 'rows of servers in a data center', description: null,
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc123&ixlib=rb-4.0`, regular: `https://images.unsplash.com/photo-${id}?ixid=abc123&w=1080&q=80`, small: 'https://images.unsplash.com/s' },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc123` },
  user: { name: 'Ada Lens', username: 'adalens', links: { html: 'https://unsplash.com/@adalens' } }, ...over });
const body = bytes => ({ async *[Symbol.asyncIterator]() { yield Buffer.from(bytes); } });
function fakeUnsplash(results, extra = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u, auth: init.headers?.Authorization });
    if (u.hostname === 'api.unsplash.com' && u.pathname === '/search/photos') {
      if (extra.search) return extra.search;
      return { ok: true, status: 200, headers: { get: h => ({ 'x-ratelimit-remaining': extra.remaining ?? '48' })[h] ?? null }, json: async () => ({ total: results.length, total_pages: 1, results }) };
    }
    if (u.hostname === 'api.unsplash.com' && u.pathname.endsWith('/download')) return extra.notify || { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ url: 'x' }) };
    if (u.hostname === 'images.unsplash.com') return { ok: true, status: 200, url: String(url), headers: { get: h => (h === 'content-type' ? (extra.type || 'image/jpeg') : null) }, body: body(extra.bytes || 'fakejpegbytes') };
    throw new Error(`unexpected ${u.href}`);
  };
  return { fetcher, calls };
}

test('provider choice by type: photos prefer Unsplash when its key is set, videos never do', () => {
  assert.equal(pickProvider('auto', { UNSPLASH_ACCESS_KEY: 'x', PIXABAY_API_KEY: 'y' }, 'image'), 'unsplash');
  assert.equal(pickProvider('auto', { UNSPLASH_ACCESS_KEY: 'x', PIXABAY_API_KEY: 'y' }, 'video'), 'pixabay');
  assert.equal(pickProvider('auto', { PIXABAY_API_KEY: 'y' }, 'image'), 'pixabay');
  assert.equal(pickProvider('unsplash', {}), 'unsplash');
});

test('Unsplash search: photos only, Client-ID auth, safe content filter, orientation, credit links with utm, key never saved, 24-hour cache', async t => {
  const folder = await temporary(t);
  const fake = fakeUnsplash([photo('p1'), photo('p2')]);
  await assert.rejects(searchStock('data center', path.join(folder, 'a.json'), false, fake.fetcher, { provider: 'unsplash', key: KEY }), /--allow-search/);
  await assert.rejects(searchStock('data center', path.join(folder, 'a.json'), true, fake.fetcher, { provider: 'unsplash', key: KEY, type: 'video' }), /photos only/);
  const r = await searchStock('data center', path.join(folder, 'a.json'), true, fake.fetcher, { provider: 'unsplash', key: KEY, orientation: 'landscape' });
  const sent = fake.calls[0];
  assert.equal(sent.auth, `Client-ID ${KEY}`);
  assert.equal(sent.url.searchParams.get('content_filter'), 'high'); assert.equal(sent.url.searchParams.get('orientation'), 'landscape');
  assert.ok(!sent.url.searchParams.has('client_id'), 'the key goes in the header, not the URL');
  const c = r.candidates[0];
  assert.equal(c.creator, 'Ada Lens');
  assert.match(c.creatorUrl, /^https:\/\/unsplash\.com\/@adalens\?utm_source=video-monk&utm_medium=referral$/);
  assert.match(c.sourceUrl, /utm_medium=referral/);
  assert.deepEqual(c.files.map(f => f.id), ['w2560', 'w1920', 'regular']);
  assert.ok(c.files[1].url.includes('ixid=abc123') && c.files[1].url.includes('w=1920'), 'resized URLs keep ixid');
  assert.ok(!(await readFile(path.join(folder, 'a.json'), 'utf8')).includes(KEY));
  const again = await searchStock('data center', path.join(folder, 'b.json'), true, fake.fetcher, { provider: 'unsplash', key: KEY, orientation: 'landscape' });
  assert.equal(again.fromCache, true); assert.equal(fake.calls.length, 1);
  const limited = fakeUnsplash([], { search: { ok: false, status: 403, headers: { get: h => (h === 'x-ratelimit-remaining' ? '0' : null) } } });
  await assert.rejects(searchStock('another one', path.join(folder, 'c.json'), true, limited.fetcher, { provider: 'unsplash', key: KEY }), /hourly request limit/);
  const warn = fakeUnsplash([photo('p9')], { remaining: '3' });
  const low = await searchStock('low quota', path.join(folder, 'd.json'), true, warn.fetcher, { provider: 'unsplash', key: KEY });
  assert.equal(low.rateLimitRemaining, 3);
});

test('Unsplash download: notifies Unsplash first, credits the photographer, stays on images.unsplash.com, reuses the library copy', async t => {
  const folder = await temporary(t);
  const catalog = path.join(folder, 'c.json');
  const fake = fakeUnsplash([photo('p1')]);
  await searchStock('data center', catalog, true, fake.fetcher, { provider: 'unsplash', key: KEY });
  await assert.rejects(downloadStock(catalog, 'p1', 'w1920', path.join(folder, 'x'), { allowDownload: true }, fake.fetcher), /--rights-confirmed/);
  const failing = fakeUnsplash([], { notify: { ok: false, status: 500, headers: { get: () => null } } });
  process.env.UNSPLASH_ACCESS_KEY = KEY; t.after(() => { delete process.env.UNSPLASH_ACCESS_KEY; });
  await assert.rejects(downloadStock(catalog, 'p1', 'w1920', path.join(folder, 'y'), { allowDownload: true, rightsConfirmed: true }, failing.fetcher), /notification failed/);
  assert.equal(await exists(path.join(folder, 'y')), false, 'nothing is saved when Unsplash could not be notified');
  const wrongType = fakeUnsplash([], { type: 'text/html' });
  await assert.rejects(downloadStock(catalog, 'p1', 'w1920', path.join(folder, 'z'), { allowDownload: true, rightsConfirmed: true }, wrongType.fetcher), /did not return image/);
  const library = await Library.open();
  const out = path.join(folder, 'got');
  const asset = await downloadStock(catalog, 'p1', 'w1920', out, { allowDownload: true, rightsConfirmed: true, library }, fake.fetcher);
  assert.equal(asset.id, 'unsplash-p1'); assert.equal(asset.kind, 'image');
  assert.match(asset.attribution, /Photo by Ada Lens on Unsplash \(https:\/\/unsplash\.com\/@adalens\?utm_source=video-monk&utm_medium=referral; https:\/\/unsplash\.com\/\?utm_source=video-monk&utm_medium=referral\)/);
  assert.match(asset.rights, /Unsplash License/);
  const order = fake.calls.map(c => c.url.hostname + c.url.pathname.split('/').pop());
  assert.ok(order.indexOf('api.unsplash.comdownload') < order.indexOf('images.unsplash.comphoto-p1'), 'the download is reported before the file is fetched');
  assert.equal(fake.calls.find(c => c.url.pathname.endsWith('/download')).auth, `Client-ID ${KEY}`);
  assert.equal(await readFile(path.join(out, 'stock.jpg'), 'utf8'), 'fakejpegbytes');
  const prov = await readJson(path.join(out, 'provenance.json'));
  assert.equal(prov.downloadNotified, true);
  assert.ok(library.get('unsplash-image-p1-w1920'));
  const before = fake.calls.length;
  await downloadStock(catalog, 'p1', 'w1920', path.join(folder, 'got2'), { allowDownload: true, rightsConfirmed: true, library }, fake.fetcher);
  assert.equal(fake.calls.length, before, 'second use came from the library: no request, no second download count');
});

test('B-roll "any" tries video first and falls back to an Unsplash photo, which is previewed and placed with a slow zoom', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 200000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'color=c=0x2244aa:s=640x360:d=1', '-frames:v', '1', path.join(folder, 'pic.jpg')]);
  const jpg = await readFile(path.join(folder, 'pic.jpg'));
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=30:r=24', '-f', 'lavfi', '-i', 'sine=f=220:d=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(folder, 'rec.mp4')]);
  process.env.UNSPLASH_ACCESS_KEY = KEY; process.env.PIXABAY_API_KEY = 'pix'; t.after(() => { delete process.env.UNSPLASH_ACCESS_KEY; delete process.env.PIXABAY_API_KEY; });
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'pixabay.com') return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ hits: [] }) }; // no videos found
    if (u.pathname === '/search/photos') return { ok: true, status: 200, headers: { get: () => '40' }, json: async () => ({ results: [photo('pp')] }) };
    if (u.pathname.endsWith('/download')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, url: String(url), headers: { get: h => (h === 'content-type' ? 'image/jpeg' : null) }, body: { async *[Symbol.asyncIterator]() { yield jpg; } } };
  };
  const plan = { moments: [{ id: 'b01', at: 5, duration: 4, query: 'rare subject', alternatives: [] }] };
  const m = { version: 2, title: 'U', fps: 24, width: 320, height: 180, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [0, 10, 20].map(i => ({ kind: 'video', asset: 'rec', in: i, duration: 10, audio: {}, purpose: `s${i}` })) };
  await writeJson(path.join(folder, 'm.json'), m);
  const got = await fetchPlan(plan, { dir: path.join(folder, 'broll'), manifest: m, search: true, download: { allowDownload: true, rightsConfirmed: true }, fetcher, type: 'any' });
  assert.equal(got.placements[0].status, 'downloaded'); assert.equal(got.placements[0].source, 'unsplash image');
  assert.ok(got.placements[0].preview);
  const applied = await applyPlacements(path.join(folder, 'm.json'), path.join(folder, 'm.broll.json'), got.file);
  assert.equal(applied.placed, 1);
  const out = await readJson(path.join(folder, 'm.broll.json'));
  assert.equal(out.scenes[0].broll[0].motion.type, 'zoom-in');
  assert.equal(out.assets.at(-1).kind, 'image');
  assert.match(out.assets.at(-1).attribution, /Photo by Ada Lens on Unsplash/);
});
