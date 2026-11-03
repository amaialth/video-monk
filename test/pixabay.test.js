import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson, exists } from '../src/core.js';
import { searchStock, downloadStock, pickProvider } from '../src/stock.js';
import { addBroll } from '../src/broll.js';
import { Library } from '../src/library.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-pixabay-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const KEY = 'pix-secret-key-999';
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);

const video = (id, over = {}) => ({ id, pageURL: `https://pixabay.com/videos/id-${id}/`, tags: 'server, room, data', duration: 12, user: 'Maker', user_id: 7, userURL: 'https://pixabay.com/users/maker-7/',
  isAiGenerated: false, isLowQuality: false,
  videos: { large: { url: `https://cdn.pixabay.com/video/${id}-large.mp4`, width: 3840, height: 2160, size: 9e7 }, medium: { url: `https://cdn.pixabay.com/video/${id}-medium.mp4`, width: 1920, height: 1080, size: 3e7 },
    small: { url: `https://cdn.pixabay.com/video/${id}-small.mp4`, width: 1280, height: 720, size: 1e7 }, tiny: { url: '', width: 0, height: 0, size: 0 } }, ...over });
const body = bytes => ({ async *[Symbol.asyncIterator]() { yield Buffer.from(bytes); } });
function fakePixabay(hits, extra = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(String(url));
    calls.push(u);
    if (u.hostname === 'pixabay.com' && u.pathname.startsWith('/api')) {
      if (extra.status === 429) return { ok: false, status: 429, headers: { get: h => ({ 'x-ratelimit-reset': '42' })[h] ?? null } };
      return { ok: true, status: 200, headers: { get: h => ({ 'x-ratelimit-remaining': '98' })[h] ?? null }, json: async () => ({ total: hits.length, totalHits: hits.length, hits }) };
    }
    if (extra.redirectTo) return { ok: true, status: 200, url: extra.redirectTo, headers: { get: () => 'video/mp4' }, body: body('abc') };
    return { ok: true, status: 200, url: String(url), headers: { get: h => (h === 'content-type' ? (extra.type || 'video/mp4') : null) }, body: body(extra.bytes || 'fakevideobytes') };
  };
  return { fetcher, calls };
}

test('provider choice: Pixabay when its key is set; the library default stays Pexels', () => {
  assert.equal(pickProvider('auto', { PIXABAY_API_KEY: 'x' }), 'pixabay');
  assert.equal(pickProvider('auto', { PEXELS_API_KEY: 'x' }), 'pexels');
  assert.equal(pickProvider('pexels', { PIXABAY_API_KEY: 'x' }), 'pexels');
  assert.throws(() => pickProvider('shutterstock'), /provider must be/);
});

test('Pixabay video search: opt-in, filters AI/low-quality/vertical, key never in the catalog, 24-hour cache, rate limit message', async t => {
  const folder = await temporary(t);
  const hits = [video(1), video(2, { isAiGenerated: true }), video(3, { isLowQuality: true }),
    video(4, { videos: { medium: { url: 'https://cdn.pixabay.com/video/4-medium.mp4', width: 1080, height: 1920, size: 1 }, small: { url: 'https://cdn.pixabay.com/video/4-small.mp4', width: 720, height: 1280, size: 1 } } })];
  const fake = fakePixabay(hits);
  await assert.rejects(searchStock('server room', path.join(folder, 'a.json'), false, fake.fetcher, { provider: 'pixabay', key: KEY }), /--allow-search/);
  await assert.rejects(searchStock('x'.repeat(101), path.join(folder, 'a.json'), true, fake.fetcher, { provider: 'pixabay', key: KEY }), /1-100 characters/);
  const result = await searchStock('server room', path.join(folder, 'a.json'), true, fake.fetcher, { provider: 'pixabay', key: KEY, orientation: 'landscape' });
  assert.deepEqual(result.candidates.map(c => c.id), ['1'], 'AI, low-quality and vertical clips are left out');
  assert.deepEqual(result.candidates[0].files.map(f => f.id), ['large', 'medium', 'small'], 'empty sizes are dropped');
  assert.equal(result.candidates[0].creator, 'Maker');
  const sent = fake.calls[0];
  assert.equal(sent.searchParams.get('key'), KEY); assert.equal(sent.searchParams.get('safesearch'), 'true'); assert.equal(sent.pathname, '/api/videos/');
  assert.ok(!(await readFile(path.join(folder, 'a.json'), 'utf8')).includes(KEY), 'the key is never written to the catalog');
  const again = await searchStock('server room', path.join(folder, 'b.json'), true, fake.fetcher, { provider: 'pixabay', key: KEY });
  assert.equal(again.fromCache, true); assert.equal(fake.calls.length, 1, 'second identical search made no request');
  const later = await searchStock('server room', path.join(folder, 'c.json'), true, fake.fetcher, { provider: 'pixabay', key: KEY, now: () => Date.now() + 25 * 3600 * 1000 });
  assert.equal(later.fromCache, false); assert.equal(fake.calls.length, 2, 'after 24 hours it asks again');
  const limited = fakePixabay([], { status: 429 });
  await assert.rejects(searchStock('other words', path.join(folder, 'd.json'), true, limited.fetcher, { provider: 'pixabay', key: KEY }), /rate limit.*42 s/);
});

test('Pixabay image search uses the photo/orientation parameters and offers the sizes it really has', async t => {
  const folder = await temporary(t);
  const hit = { id: 9, pageURL: 'https://pixabay.com/photos/x-9/', tags: 'office', user: 'Snap', user_id: 3, imageWidth: 4000, imageHeight: 2500, largeImageURL: 'https://pixabay.com/get/g9_1280.jpg', webformatURL: 'https://pixabay.com/get/g9_640.jpg', isAiGenerated: false };
  const fake = fakePixabay([hit]);
  const r = await searchStock('office', path.join(folder, 'i.json'), true, fake.fetcher, { provider: 'pixabay', key: KEY, type: 'image' });
  assert.equal(fake.calls[0].pathname, '/api/'); assert.equal(fake.calls[0].searchParams.get('image_type'), 'photo'); assert.equal(fake.calls[0].searchParams.get('orientation'), 'horizontal');
  assert.deepEqual(r.candidates[0].files.map(f => f.id), ['large', 'webformat']);
  assert.match(r.candidates[0].files[0].note, /1280/);
});

test('Pixabay download: needs both flags, stays on Pixabay hosts, records attribution and provenance, and reuses the library copy', async t => {
  const folder = await temporary(t);
  const catalog = path.join(folder, 'c.json');
  const fake = fakePixabay([video(1)]);
  await searchStock('server room', catalog, true, fake.fetcher, { provider: 'pixabay', key: KEY });
  await assert.rejects(downloadStock(catalog, '1', 'medium', path.join(folder, 'x'), { allowDownload: true }, fake.fetcher), /--rights-confirmed/);
  const evil = fakePixabay([], { redirectTo: 'https://evil.example/v.mp4' });
  await assert.rejects(downloadStock(catalog, '1', 'medium', path.join(folder, 'y'), { allowDownload: true, rightsConfirmed: true }, evil.fetcher), /pixabay\.com/);
  const wrongType = fakePixabay([], { type: 'text/html' });
  await assert.rejects(downloadStock(catalog, '1', 'medium', path.join(folder, 'z'), { allowDownload: true, rightsConfirmed: true }, wrongType.fetcher), /did not return MP4/);
  const library = await Library.open();
  const out = path.join(folder, 'got');
  const asset = await downloadStock(catalog, '1', 'medium', out, { allowDownload: true, rightsConfirmed: true, library }, fake.fetcher);
  assert.equal(asset.id, 'pixabay-1'); assert.equal(asset.kind, 'video');
  assert.match(asset.attribution, /Video by Maker on Pixabay \(https:\/\/pixabay\.com\/videos\/id-1\/\)/);
  assert.match(asset.rights, /Pixabay Content License/);
  assert.equal((await readFile(path.join(out, 'stock.mp4'), 'utf8')), 'fakevideobytes');
  const prov = await readJson(path.join(out, 'provenance.json'));
  assert.equal(prov.provider, 'Pixabay'); assert.ok(prov.sha256);
  assert.ok(library.get('pixabay-video-1-medium'), 'indexed in the asset library');
  const before = fake.calls.length;
  const out2 = path.join(folder, 'got2');
  await downloadStock(catalog, '1', 'medium', out2, { allowDownload: true, rightsConfirmed: true, library }, fake.fetcher);
  assert.equal(fake.calls.length, before, 'second download came from the library, no request');
  assert.equal(await exists(path.join(out2, 'stock.mp4')), true);
});

test('broll-add lays one clip across several speech cuts, continuous, with fit and motion defaults, and refuses what cannot work', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 200000 }, async t => {
  const folder = await temporary(t);
  const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=12:r=24', '-f', 'lavfi', '-i', 'sine=f=220:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(folder, 'rec.mp4')]);
  const stock = path.join(folder, 'stock');
  await ff(['-f', 'lavfi', '-i', 'color=c=0x2244aa:s=320x180:d=8:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'tmp.mp4')]);
  await (await import('node:fs/promises')).mkdir(stock);
  await (await import('node:fs/promises')).rename(path.join(folder, 'tmp.mp4'), path.join(stock, 'stock.mp4'));
  await writeJson(path.join(stock, 'asset.json'), { id: 'pixabay-1', path: 'stock.mp4', kind: 'video', approved: true, rights: 'Pixabay Content License', attribution: 'Video by Maker on Pixabay', sourceUrl: 'https://pixabay.com/videos/id-1/' });
  await writeJson(path.join(stock, 'provenance.json'), { candidate: { duration: 8 } });
  const manifest = { version: 2, title: 'B', fps: 24, width: 320, height: 180, assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [0, 4, 8].map(i => ({ kind: 'video', asset: 'rec', in: i, duration: 4, audio: {}, purpose: `s${i}` })) };
  await writeJson(path.join(folder, 'm.json'), manifest);
  const r = await addBroll(path.join(folder, 'm.json'), path.join(folder, 'm.broll.json'), { assetDir: stock, at: 3, duration: 6 });
  assert.equal(r.scenes, 3); assert.equal(r.fit, 'cover');
  const out = await readJson(path.join(folder, 'm.broll.json'));
  assert.deepEqual(out.scenes.map(s => s.broll.map(b => [b.start, b.duration, b.in])), [[[3, 1, 0]], [[0, 4, 1]], [[0, 1, 5]]], 'one clip, continuous across the cuts');
  assert.equal(out.assets.at(-1).path, 'stock/stock.mp4');
  await assert.rejects(addBroll(path.join(folder, 'm.json'), path.join(folder, 'm2.json'), { assetDir: stock, at: 3, duration: 9 }), /clip is 8s long/);
  await assert.rejects(addBroll(path.join(folder, 'm.json'), path.join(folder, 'm3.json'), { assetDir: stock, at: 50, duration: 3 }), /no scene overlaps/);
  await assert.rejects(addBroll(path.join(folder, 'm.json'), path.join(folder, 'm.broll.json'), { assetDir: stock, at: 3, duration: 2 }), /already exists/);
  // vertical timelines default to the blurred fit
  const vertical = { ...manifest, width: 180, height: 320 };
  await writeJson(path.join(folder, 'v.json'), vertical);
  const v = await addBroll(path.join(folder, 'v.json'), path.join(folder, 'v.broll.json'), { assetDir: stock, at: 1, duration: 2 });
  assert.equal(v.fit, 'blur');
});
