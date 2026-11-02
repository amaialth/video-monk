import path from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

export async function searchStock(query, output, allowSearch, fetcher = fetch) {
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

export async function downloadStock(catalog, id, fileId, output, { allowDownload, rightsConfirmed } = {}, fetcher = fetch) {
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
