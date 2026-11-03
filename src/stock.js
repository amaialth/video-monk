import path from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { exists, readJson, writeJson } from './core.js';

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
  const provider = options.provider === undefined ? 'pexels' : pickProvider(options.provider);
  if (provider === 'pixabay') return searchPixabay(query, output, allowSearch, fetcher, options);
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

// auto: Pixabay when its key is set, otherwise Pexels.
export function pickProvider(requested, env = process.env) {
  const p = requested || 'auto';
  if (!['auto', 'pexels', 'pixabay'].includes(p)) throw new Error('Stock provider must be auto, pexels or pixabay.');
  if (p !== 'auto') return p;
  return env.PIXABAY_API_KEY || (!env.PEXELS_API_KEY && pixabayKeyInDotenv()) ? 'pixabay' : 'pexels';
}

function pixabayKeyInDotenv(cwd = process.cwd()) {
  try { return /^\s*PIXABAY_API_KEY\s*=\s*\S+/m.test(readFileSync(path.join(cwd, '.env'), 'utf8')); } catch { return false; }
}
export async function pixabayKey(env = process.env, cwd = process.cwd()) {
  if (env.PIXABAY_API_KEY) return env.PIXABAY_API_KEY.trim();
  for (const file of [path.join(cwd, '.env'), path.join(os.homedir(), '.video-monk', '.env')]) {
    try {
      const m = (await readFile(file, 'utf8')).match(/^\s*PIXABAY_API_KEY\s*=\s*(.*)$/m);
      const value = m?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    } catch { /* not there */ }
  }
  return null;
}

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
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
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
