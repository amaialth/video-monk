import path from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { exists, readJson, writeJson } from './core.js';
import { tryDb } from './db.js';

const terms = 'https://www.pexels.com/license/';
const maxBytes = 250 * 1024 * 1024;
function videoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'videos.pexels.com' ||
      url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Stock download requires a direct HTTPS videos.pexels.com URL without credentials/query.');
  }
  return url.href;
}

export async function searchStock(query, output, allowSearch, fetcher = fetch, options = {}) {
  const provider = options.provider === undefined ? 'pexels' : pickProvider(options.provider, process.env, options.type);
  if (provider === 'pixabay') return searchPixabay(query, output, allowSearch, fetcher, options);
  if (provider === 'unsplash') return searchUnsplash(query, output, allowSearch, fetcher, options);
  if (!allowSearch) throw new Error('Stock search sends your query to Pexels; use --allow-search.');
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Stock query must contain 1-200 characters.');
  if (await exists(output)) throw new Error('Stock search output exists.');
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('Set PEXELS_API_KEY before searching stock.');
  const url = new URL('https://api.pexels.com/v1/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '8');
  const response = await fetcher(url, { headers: { Authorization: key }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Pexels search failed (HTTP ${response.status}); response body withheld.`);
  const data = await response.json();
  if (!Array.isArray(data.videos)) throw new Error('Pexels returned no video list.');
  const candidates = data.videos.map(video => ({
    id: String(video.id), sourceUrl: video.url, creator: video.user?.name, creatorUrl: video.user?.url,
    duration: video.duration, width: video.width, height: video.height, licenseUrl: terms,
    files: (video.video_files || []).filter(file => file.file_type === 'video/mp4').map(file => ({
      id: String(file.id), width: file.width, height: file.height, url: videoUrl(file.link)
    }))
  }));
  const result = {
    version: 1, provider: 'Pexels', providerUrl: 'https://www.pexels.com', query,
    retrievedAt: new Date().toISOString(), status: 'candidates-not-approved',
    warning: 'Availability is not proof of rights/releases or suitability. Review license, context and creator credit for each selected asset.',
    candidates
  };
  await writeJson(output, result);
  return result;
}

export async function downloadStock(catalog, id, fileId, output, { allowDownload, rightsConfirmed, library = null } = {}, fetcher = fetch) {
  const peek = await readJson(catalog);
  if (peek.provider === 'Pixabay') return downloadPixabay(catalog, id, fileId, output, { allowDownload, rightsConfirmed, library }, fetcher);
  if (peek.provider === 'Unsplash') return downloadUnsplash(catalog, id, fileId, output, { allowDownload, rightsConfirmed, library }, fetcher);
  if (!allowDownload || !rightsConfirmed) throw new Error('Stock download requires --allow-download and --rights-confirmed for this selected asset.');
  if (await exists(output)) throw new Error('Stock asset output directory exists.');
  const record = await readJson(catalog);
  if (record.version !== 1 || record.provider !== 'Pexels' || !Array.isArray(record.candidates)) throw new Error('Invalid Pexels candidate catalog.');
  const candidate = record.candidates.find(item => item.id === id);
  const selected = candidate?.files?.find(item => item.id === fileId);
  if (!selected || !candidate.creator || !/^https:\/\/www\.pexels\.com\/video\//.test(candidate.sourceUrl)) {
    throw new Error('Select an existing candidate/file with creator and Pexels source-page metadata.');
  }
  const url = videoUrl(selected.url);
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Stock download failed (HTTP ${response.status}).`);
  if (!/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Stock endpoint did not return MP4 media.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Stock file exceeds 250 MiB limit.');
  await mkdir(output, { recursive: false });
  const file = path.join(output, 'stock.mp4');
  const hash = createHash('sha256');
  let bytes = 0;
  const handle = await open(file, 'wx');
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Stock download exceeded 250 MiB limit.');
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (!bytes) throw new Error('Stock download was empty.');
  } catch (error) {
    await handle.close();
    await unlink(file);
    throw error;
  }
  await handle.close();
  const asset = {
    id: `pexels-${candidate.id}`, path: 'stock.mp4', kind: 'video', approved: true,
    rights: `User confirmed selected asset rights under ${terms}; verify releases/context for intended use.`,
    attribution: `Video by ${candidate.creator} on Pexels (${candidate.sourceUrl})`,
    sourceUrl: candidate.sourceUrl
  };
  await writeJson(path.join(output, 'asset.json'), asset);
  await writeJson(path.join(output, 'provenance.json'), {
    provider: 'Pexels', candidate, selected, bytes, sha256: hash.digest('hex'),
    licenseUrl: terms, licenseCheckedBy: 'user attestation', downloadedAt: new Date().toISOString(),
    note: 'asset.json path is relative to this directory; resolve it relative to the production manifest when adding it.'
  });
  return asset;
}


// ------------------------------------------------------------------ Pixabay
// Pixabay API (https://pixabay.com/api/docs/): key in the query string (never written to a catalog or log), 100 requests per 60 s,
// responses must be cached for 24 hours, and results may not be hotlinked: chosen files are downloaded into the project.
const PIXABAY_LICENSE = 'https://pixabay.com/service/license-summary/';
const PIXABAY_HOSTS = ['cdn.pixabay.com', 'pixabay.com'];
const CACHE_MS = 24 * 3600 * 1000;

// auto: videos come from Pixabay when its key is set (otherwise Pexels); photos from Unsplash when its key is set (otherwise Pixabay, then Pexels).
export function pickProvider(requested, env = process.env, type = 'video') {
  const p = requested || 'auto';
  if (!['auto', 'pexels', 'pixabay', 'unsplash'].includes(p)) throw new Error('Stock provider must be auto, pexels, pixabay or unsplash.');
  if (p !== 'auto') return p;
  // A .env file is consulted only for the real environment, so callers passing their own env get exactly that.
  const has = name => Boolean(env[name]) || (env === process.env && dotenvHas(name));
  if (type === 'image' && has('UNSPLASH_ACCESS_KEY')) return 'unsplash';
  if (env.PIXABAY_API_KEY || (!env.PEXELS_API_KEY && has('PIXABAY_API_KEY'))) return 'pixabay';
  return env.PEXELS_API_KEY ? 'pexels' : (type === 'image' && has('UNSPLASH_ACCESS_KEY') ? 'unsplash' : 'pexels');
}

function dotenvHas(name, cwd = process.cwd()) {
  try { return new RegExp(`^\\s*${name}\\s*=\\s*\\S+`, 'm').test(readFileSync(path.join(cwd, '.env'), 'utf8')); } catch { return false; }
}
// A key from the environment, a .env in the working folder, or ~/.video-monk/.env. Never printed or stored.
export async function envKey(name, env = process.env, cwd = process.cwd()) {
  if (env[name]) return env[name].trim();
  for (const file of [path.join(cwd, '.env'), path.join(os.homedir(), '.video-monk', '.env')]) {
    try {
      const m = (await readFile(file, 'utf8')).match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'));
      const value = m?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    } catch { /* not there */ }
  }
  return null;
}
export const pixabayKey = (env, cwd) => envKey('PIXABAY_API_KEY', env, cwd);

function pixabayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !PIXABAY_HOSTS.includes(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new Error('Pixabay download requires a direct HTTPS pixabay.com / cdn.pixabay.com URL without credentials.');
  }
  return url.href;
}

const cacheDir = () => process.env.VIDEO_MONK_CACHE || path.join(os.homedir(), '.video-monk', 'cache');

export async function searchPixabay(query, output, allowSearch, fetcher = fetch, options = {}) {
  if (!allowSearch) throw new Error('Stock search sends your query to Pixabay; use --allow-search.');
  if (typeof query !== 'string' || !query.trim() || query.length > 100) throw new Error('Pixabay query must contain 1-100 characters.');
  if (await exists(output)) throw new Error('Stock search output exists.');
  const type = options.type || 'video';
  if (!['video', 'image'].includes(type)) throw new Error('Stock type must be video or image.');
  const orientation = options.orientation || 'landscape';
  if (!['landscape', 'portrait', 'any'].includes(orientation)) throw new Error('Stock orientation must be landscape, portrait or any.');
  const key = options.key || await pixabayKey();
  if (!key) throw new Error('Set PIXABAY_API_KEY (environment or .env) before searching Pixabay.');
  const url = new URL(type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('per_page', '30');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('order', 'popular');
  if (type === 'image') { url.searchParams.set('image_type', 'photo'); if (orientation !== 'any') url.searchParams.set('orientation', orientation === 'landscape' ? 'horizontal' : 'vertical'); }
  if (options.minWidth) url.searchParams.set('min_width', String(options.minWidth));
  // 24-hour response cache (required by the API terms). The key is not part of the cache key.
  const cacheKey = createHash('sha256').update(url.href).digest('hex').slice(0, 24);
  const cacheFile = path.join(cacheDir(), `pixabay-${cacheKey}.json`);
  const now = options.now ? options.now() : Date.now();
  let data = null;
  let cached = false;
  let rateRemaining = null;
  try { const c = JSON.parse(await readFile(cacheFile, 'utf8')); if (now - c.at < CACHE_MS) { data = c.data; cached = true; } } catch { /* no cache */ }
  if (!data) {
    url.searchParams.set('key', key);
    const pdb = await tryDb();
    if (pdb && pdb.usageSince('pixabay', Date.now() - 60e3).calls >= 95) throw new Error('Pixabay allows 100 requests a minute and 95 were used in the last minute (counted across all projects); wait a minute.');
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    pdb?.addUsage('pixabay', 1, { note: 'search' });
    const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
    if (response.status === 429) throw new Error(`Pixabay rate limit reached (100 requests per minute); retry in ${response.headers?.get?.('x-ratelimit-reset') || 60} s.`);
    if (!response.ok) throw new Error(`Pixabay search failed (HTTP ${response.status}); response body withheld.`);
    data = await response.json();
    if (!Array.isArray(data.hits)) throw new Error('Pixabay returned no result list.');
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ at: now, data }));
    rateRemaining = Number.isFinite(remaining) ? remaining : null;
  }
  const includeAi = options.includeAi === true;
  const wide = hit => (type === 'video' ? (hit.videos?.medium?.width || hit.videos?.small?.width || 0) >= (hit.videos?.medium?.height || hit.videos?.small?.height || 0)
    : hit.imageWidth >= hit.imageHeight);
  const picked = data.hits.filter(h => (includeAi || h.isAiGenerated !== true) && h.isLowQuality !== true && (orientation === 'any' || (orientation === 'landscape') === wide(h)))
    .slice(0, options.limit || 12);
  const candidates = picked.map(hit => {
    const base = { id: String(hit.id), sourceUrl: hit.pageURL, creator: hit.user, creatorUrl: hit.userURL || `https://pixabay.com/users/${hit.user}-${hit.user_id}/`,
      tags: hit.tags, aiGenerated: hit.isAiGenerated === true, licenseUrl: PIXABAY_LICENSE };
    if (type === 'video') {
      const files = ['large', 'medium', 'small', 'tiny'].filter(k => hit.videos?.[k]?.url).map(k => ({ id: k, width: hit.videos[k].width, height: hit.videos[k].height, bytes: hit.videos[k].size, url: pixabayUrl(hit.videos[k].url) }));
      const ref = hit.videos.medium || hit.videos.small || {};
      return { ...base, duration: hit.duration, width: ref.width, height: ref.height, files };
    }
    return { ...base, width: hit.imageWidth, height: hit.imageHeight, files: [
      { id: 'large', note: 'up to 1280 px wide (originals need Pixabay full API access)', url: pixabayUrl(hit.largeImageURL) },
      { id: 'webformat', note: 'up to 640 px wide', url: pixabayUrl(hit.webformatURL) }] };
  });
  const result = {
    version: 1, provider: 'Pixabay', providerUrl: 'https://pixabay.com', type, query, orientation, retrievedAt: new Date().toISOString(), fromCache: cached, ...(rateRemaining !== null && rateRemaining <= 5 ? { rateLimitRemaining: rateRemaining } : {}),
    status: 'candidates-not-approved',
    warning: 'Pixabay Content License (https://pixabay.com/service/license-summary/): availability is not proof that a clip is suitable. Check identifiable people, brands and logos for your use. Search results must credit Pixabay; selected assets are downloaded, never hotlinked.',
    candidates
  };
  await writeJson(output, result);
  return result;
}

const PIXABAY_TYPES = { video: { mime: /^video\/mp4(?:;|$)/i, ext: 'mp4', kind: 'video' }, image: { mime: /^image\/(jpeg|png|webp)(?:;|$)/i, ext: 'jpg', kind: 'image' } };

export async function downloadPixabay(catalog, id, fileId, output, { allowDownload, rightsConfirmed, library = null } = {}, fetcher = fetch) {
  if (!allowDownload || !rightsConfirmed) throw new Error('Stock download requires --allow-download and --rights-confirmed for this selected asset.');
  if (await exists(output)) throw new Error('Stock asset output directory exists.');
  const record = await readJson(catalog);
  const spec = PIXABAY_TYPES[record.type];
  if (record.version !== 1 || record.provider !== 'Pixabay' || !spec || !Array.isArray(record.candidates)) throw new Error('Invalid Pixabay candidate catalog.');
  const candidate = record.candidates.find(item => item.id === id);
  const selected = candidate?.files?.find(item => item.id === fileId);
  if (!selected || !candidate.creator || !/^https:\/\/pixabay\.com\//.test(candidate.sourceUrl)) throw new Error('Select an existing candidate/file with creator and Pixabay source-page metadata.');
  const url = pixabayUrl(selected.url);
  const libId = `pixabay-${record.type}-${candidate.id}-${selected.id}`;
  const fileName = `stock.${spec.ext}`;
  const file = path.join(output, fileName);
  let bytes = 0, sha = null, reused = false;
  if (library?.get(libId)) {
    await mkdir(output, { recursive: false });
    await library.checkout(libId, file);
    reused = true;
  } else {
    const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`Stock download failed (HTTP ${response.status}).`);
    if (response.url) pixabayUrl(response.url); // a redirect must still end on Pixabay
    if (!spec.mime.test(response.headers.get('content-type') || '')) throw new Error(`Stock endpoint did not return ${record.type === 'video' ? 'MP4' : 'image'} media.`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Stock file exceeds 250 MiB limit.');
    await mkdir(output, { recursive: false });
    const hash = createHash('sha256');
    const handle = await open(file, 'wx');
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('Stock download exceeded 250 MiB limit.');
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      if (!bytes) throw new Error('Stock download was empty.');
    } catch (error) { await handle.close(); await unlink(file); throw error; }
    await handle.close();
    sha = hash.digest('hex');
  }
  const attribution = `${spec.kind === 'video' ? 'Video' : 'Image'} by ${candidate.creator} on Pixabay (${candidate.sourceUrl})`;
  const rights = `Pixabay Content License (${PIXABAY_LICENSE}); user confirmed this selected asset; check people, brands and logos for the intended use.`;
  const asset = { id: `pixabay-${candidate.id}`, path: fileName, kind: spec.kind, approved: true, rights, attribution, sourceUrl: candidate.sourceUrl };
  await writeJson(path.join(output, 'asset.json'), asset);
  await writeJson(path.join(output, 'provenance.json'), {
    provider: 'Pixabay', type: record.type, candidate, selected, bytes, sha256: sha, reusedFromLibrary: reused, licenseUrl: PIXABAY_LICENSE, licenseCheckedBy: 'user attestation',
    downloadedAt: new Date().toISOString(), note: 'asset.json path is relative to this directory; resolve it relative to the production manifest when adding it.'
  });
  if (library && !reused) {
    await library.add({ id: libId, kind: spec.kind, source: file, name: `Pixabay ${record.type}: ${(candidate.tags || record.query).toString().slice(0, 60)}`, description: `${record.query} (${candidate.width}x${candidate.height}${candidate.duration ? `, ${candidate.duration}s` : ''})`,
      tags: ['stock', 'pixabay', record.type, ...String(candidate.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 6)], rights, attribution, sourceUrl: candidate.sourceUrl, approved: true, createdBy: 'stock',
      meta: { provider: 'Pixabay', pixabayId: candidate.id, file: selected.id, width: candidate.width, height: candidate.height, duration: candidate.duration } });
  }
  return asset;
}


// ------------------------------------------------------------------ Unsplash (photos only)
// Unsplash API (https://unsplash.com/documentation): public auth `Authorization: Client-ID <access key>` (the secret key is never needed or read),
// demo apps get 50 requests an hour (production 1000), only api.unsplash.com calls count. Terms we follow: use the photo's own image URLs
// (images.unsplash.com, keeping the ixid parameter), notify Unsplash through links.download_location when a photo is chosen, and credit the
// photographer and Unsplash with utm links. There is no video endpoint.
const UNSPLASH_LICENSE = 'https://unsplash.com/license';
const UNSPLASH_API = 'https://api.unsplash.com';
const utmSource = () => process.env.UNSPLASH_APP_NAME || 'video-monk';
const withUtm = link => { const u = new URL(link); u.searchParams.set('utm_source', utmSource()); u.searchParams.set('utm_medium', 'referral'); return u.href; };

function unsplashImageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'images.unsplash.com' || url.username || url.password || url.port || url.hash) {
    throw new Error('Unsplash download requires a direct HTTPS images.unsplash.com URL without credentials.');
  }
  return url.href;
}
function unsplashTrackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.unsplash.com' || !/^\/photos\/[\w-]+\/download$/.test(url.pathname) || url.username || url.password || url.port) {
    throw new Error('Unsplash download notification must be an api.unsplash.com /photos/<id>/download URL.');
  }
  return url.href;
}
// Resized copy of the original: the raw URL keeps its ixid parameter, which Unsplash uses to count views.
const sized = (raw, width) => { const u = new URL(raw); u.searchParams.set('w', String(width)); u.searchParams.set('fit', 'max'); u.searchParams.set('q', '85'); u.searchParams.set('fm', 'jpg'); return u.href; };

export async function searchUnsplash(query, output, allowSearch, fetcher = fetch, options = {}) {
  if (!allowSearch) throw new Error('Stock search sends your query to Unsplash; use --allow-search.');
  if ((options.type || 'image') !== 'image') throw new Error('Unsplash offers photos only; use --type image (videos come from Pixabay or Pexels).');
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Unsplash query must contain 1-200 characters.');
  if (await exists(output)) throw new Error('Stock search output exists.');
  const orientation = options.orientation || 'landscape';
  if (!['landscape', 'portrait', 'any'].includes(orientation)) throw new Error('Stock orientation must be landscape, portrait or any.');
  const key = options.key || await envKey('UNSPLASH_ACCESS_KEY');
  if (!key) throw new Error('Set UNSPLASH_ACCESS_KEY (environment or .env) before searching Unsplash.');
  const url = new URL(`${UNSPLASH_API}/search/photos`);
  url.searchParams.set('query', query.trim());
  url.searchParams.set('per_page', '20');
  url.searchParams.set('content_filter', 'high');
  url.searchParams.set('order_by', 'relevant');
  if (orientation !== 'any') url.searchParams.set('orientation', orientation);
  const cacheFile = path.join(cacheDir(), `unsplash-${createHash('sha256').update(url.href).digest('hex').slice(0, 24)}.json`);
  const now = options.now ? options.now() : Date.now();
  let data = null, cached = false, rateRemaining = null;
  try { const c = JSON.parse(await readFile(cacheFile, 'utf8')); if (now - c.at < CACHE_MS) { data = c.data; cached = true; } } catch { /* no cache */ }
  if (!data) {
    // Demo keys allow 50 requests an hour. The count is kept in the local database, so it holds across projects and restarts.
    const db = await tryDb();
    const limit = Number(process.env.UNSPLASH_HOURLY_LIMIT) || 50;
    const used = db ? db.usageSince('unsplash', now - 3600e3).calls : 0;
    if (used >= limit - 2) throw new Error(`Unsplash allows ${limit} requests an hour on a demo key and ${used} were used in the last hour (counted across all projects); try again later.`);
    const response = await fetcher(url, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    db?.addUsage('unsplash', 1, { note: 'search' });
    const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
    rateRemaining = Number.isFinite(remaining) ? remaining : null;
    if (response.status === 401) throw new Error('Unsplash rejected the access key (HTTP 401); check UNSPLASH_ACCESS_KEY.');
    // The docs do not name the status for an exhausted quota: an empty remaining count with a refusal means the hourly limit.
    if (response.status === 429 || (response.status === 403 && rateRemaining === 0)) throw new Error('Unsplash hourly request limit reached (demo apps get 50 an hour); try again later or apply for production access.');
    if (!response.ok) throw new Error(`Unsplash search failed (HTTP ${response.status}); response body withheld.`);
    data = await response.json();
    if (!Array.isArray(data.results)) throw new Error('Unsplash returned no result list.');
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ at: now, data }));
  }
  const candidates = data.results.slice(0, options.limit || 12).map(photo => {
    const base = { id: photo.id, width: photo.width, height: photo.height, aspect: photo.width >= photo.height ? 'landscape' : 'portrait' };
    return { id: String(photo.id), sourceUrl: withUtm(photo.links.html), creator: photo.user?.name || photo.user?.username, creatorUrl: withUtm(photo.user.links.html), username: photo.user?.username,
      tags: [photo.alt_description, photo.description].filter(Boolean).join(', '), aiGenerated: false, licenseUrl: UNSPLASH_LICENSE, downloadLocation: unsplashTrackUrl(photo.links.download_location),
      width: base.width, height: base.height,
      files: [
        { id: 'w2560', width: Math.min(2560, photo.width), height: Math.round(Math.min(2560, photo.width) * photo.height / photo.width), note: 'resized original, sharp at 1440p', url: unsplashImageUrl(sized(photo.urls.raw, Math.min(2560, photo.width))) },
        { id: 'w1920', width: Math.min(1920, photo.width), height: Math.round(Math.min(1920, photo.width) * photo.height / photo.width), note: 'resized original, sharp at 1080p', url: unsplashImageUrl(sized(photo.urls.raw, Math.min(1920, photo.width))) },
        { id: 'regular', width: Math.min(1080, photo.width), height: Math.round(Math.min(1080, photo.width) * photo.height / photo.width), note: '1080 px wide preset', url: unsplashImageUrl(photo.urls.regular) }] };
  });
  const result = {
    version: 1, provider: 'Unsplash', providerUrl: withUtm('https://unsplash.com'), type: 'image', query, orientation, retrievedAt: new Date().toISOString(), fromCache: cached,
    ...(rateRemaining !== null && rateRemaining <= 5 ? { rateLimitRemaining: rateRemaining } : {}), status: 'candidates-not-approved',
    warning: 'Unsplash License (https://unsplash.com/license) and API terms: credit the photographer and Unsplash, which the catalog and the downloaded asset do. Check identifiable people, brands and logos for your use. Photos only; no video.',
    candidates
  };
  await writeJson(output, result);
  return result;
}

export async function downloadUnsplash(catalog, id, fileId, output, { allowDownload, rightsConfirmed, library = null, key = null } = {}, fetcher = fetch) {
  if (!allowDownload || !rightsConfirmed) throw new Error('Stock download requires --allow-download and --rights-confirmed for this selected asset.');
  if (await exists(output)) throw new Error('Stock asset output directory exists.');
  const record = await readJson(catalog);
  if (record.version !== 1 || record.provider !== 'Unsplash' || !Array.isArray(record.candidates)) throw new Error('Invalid Unsplash candidate catalog.');
  const candidate = record.candidates.find(item => item.id === id);
  const selected = candidate?.files?.find(item => item.id === fileId);
  if (!selected || !candidate.creator || !/^https:\/\/unsplash\.com\/photos\//.test(candidate.sourceUrl)) throw new Error('Select an existing candidate/file with creator and Unsplash source-page metadata.');
  const url = unsplashImageUrl(selected.url);
  const libId = `unsplash-image-${candidate.id}-${selected.id}`;
  const file = path.join(output, 'stock.jpg');
  let bytes = 0, sha = null, reused = false, tracked = false;
  if (library?.get(libId)) {
    await mkdir(output, { recursive: false });
    await library.checkout(libId, file);
    reused = true;
  } else {
    // The API terms require telling Unsplash when a photo is chosen. If that fails the photo is not used.
    const apiKey = key || await envKey('UNSPLASH_ACCESS_KEY');
    if (!apiKey) throw new Error('Set UNSPLASH_ACCESS_KEY (environment or .env): Unsplash must be notified of each download.');
    const notify = await fetcher(unsplashTrackUrl(candidate.downloadLocation), { headers: { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    (await tryDb())?.addUsage('unsplash', 1, { note: 'download notification' });
    if (!notify.ok) throw new Error(`Unsplash download notification failed (HTTP ${notify.status}); the photo was not saved.`);
    tracked = true;
    const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`Stock download failed (HTTP ${response.status}).`);
    if (response.url) unsplashImageUrl(response.url);
    if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Stock endpoint did not return image media.');
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Stock file exceeds 250 MiB limit.');
    await mkdir(output, { recursive: false });
    const hash = createHash('sha256');
    const handle = await open(file, 'wx');
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('Stock download exceeded 250 MiB limit.');
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      if (!bytes) throw new Error('Stock download was empty.');
    } catch (error) { await handle.close(); await unlink(file); throw error; }
    await handle.close();
    sha = hash.digest('hex');
  }
  const attribution = `Photo by ${candidate.creator} on Unsplash (${candidate.creatorUrl}; ${withUtm('https://unsplash.com')})`;
  const rights = `Unsplash License (${UNSPLASH_LICENSE}); credit required by the Unsplash API terms; user confirmed this selected asset; check people, brands and logos for the intended use.`;
  const asset = { id: `unsplash-${candidate.id}`, path: 'stock.jpg', kind: 'image', approved: true, rights, attribution, sourceUrl: candidate.sourceUrl };
  await writeJson(path.join(output, 'asset.json'), asset);
  await writeJson(path.join(output, 'provenance.json'), {
    provider: 'Unsplash', type: 'image', candidate, selected, bytes, sha256: sha, reusedFromLibrary: reused, downloadNotified: tracked || reused, licenseUrl: UNSPLASH_LICENSE, licenseCheckedBy: 'user attestation',
    downloadedAt: new Date().toISOString(), note: 'asset.json path is relative to this directory; resolve it relative to the production manifest when adding it.'
  });
  if (library && !reused) {
    await library.add({ id: libId, kind: 'image', source: file, name: `Unsplash photo: ${(candidate.tags || record.query).toString().slice(0, 60)}`, description: `${record.query} (${candidate.width}x${candidate.height})`,
      tags: ['stock', 'unsplash', 'image', ...String(record.query).split(/\s+/).slice(0, 4)], rights, attribution, sourceUrl: candidate.sourceUrl, approved: true, createdBy: 'stock',
      meta: { provider: 'Unsplash', unsplashId: candidate.id, file: selected.id, width: candidate.width, height: candidate.height, photographer: candidate.creator } });
  }
  return asset;
}
