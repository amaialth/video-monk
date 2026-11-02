import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { run, integer, youtubeChannel, writeJson, exists } from './core.js';

export async function catalog(channel, limit = 0, tab = 'videos', execute = run) {
  channel = youtubeChannel(channel);
  integer(limit, 'limit', 0, 100000);
  if (!['videos', 'shorts', 'streams'].includes(tab)) throw new Error('Invalid channel tab.');
  const args = ['--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings'];
  if (limit) args.push('--playlist-end', String(limit));
  args.push('--', `${channel}/${tab}`);
  const { stdout } = await execute('yt-dlp', args);
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.entries) || !result.entries.length) throw new Error('No accessible videos returned.');
  const videos = result.entries.map(entry => {
    if (!/^[\w-]{11}$/.test(entry.id)) throw new Error('Catalog returned an invalid video ID.');
    return {
      id: entry.id, title: entry.title, duration: entry.duration ?? null,
      url: `https://www.youtube.com/watch?v=${entry.id}`
    };
  });
  return {
    version: 1, channel, tab, fetchedAt: new Date().toISOString(), limit,
    coverage: limit ? 'limited catalog; not all channel videos' : 'all entries returned for this tab; unavailable videos may be omitted',
    evidence: 'Public metadata only. No audiovisual style conclusions are supported.',
    videos
  };
}

export async function downloadVideo(root, id, entries, allowed, execute = run) {
  if (!allowed) throw new Error('Downloading requires --allow-download: confirm rights/permission and applicable platform terms.');
  if (!/^[\w-]{11}$/.test(id) || !entries.some(entry => entry.id === id)) {
    throw new Error('Video ID must appear in this project catalog.');
  }
  const directory = path.join(root, 'references', id);
  if (await exists(directory)) throw new Error(`Reference directory already exists: ${directory}`);
  await mkdir(directory, { recursive: true });
  const { stdout } = await execute('yt-dlp', [
    '--no-playlist', '--no-overwrites', '--restrict-filenames',
    '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '--merge-output-format', 'mp4', '--max-filesize', '2G',
    '--print', 'after_move:filepath', '-o', path.join(directory, 'reference.%(ext)s'),
    '--', `https://www.youtube.com/watch?v=${id}`
  ]);
  const file = stdout.trim().split(/\r?\n/).at(-1);
  if (!file || !(await exists(file))) throw new Error('Download did not produce an accessible media file. Check size and format availability.');
  return path.resolve(file);
}

export async function probe(file, execute = run) {
  const { stdout } = await execute('ffprobe', [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.resolve(file)
  ]);
  const metadata = JSON.parse(stdout);
  const video = metadata.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(metadata.format?.duration);
  const [numerator, denominator] = (video?.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = numerator / denominator;
  if (!video || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Cannot determine video duration/frame rate: ${file}`);
  }
  return {
    path: path.resolve(file), duration, fps, width: video.width, height: video.height,
    hasAudio: metadata.streams.some(stream => stream.codec_type === 'audio')
  };
}

export async function analyze(file, output, { seconds = 180, frames = 8, sourceUrl = null } = {}, execute = run) {
  integer(seconds, 'seconds', 1, 86400);
  integer(frames, 'frames', 1, 24);
  if (await exists(output)) throw new Error(`Analysis output already exists: ${output}`);
  const media = await probe(file, execute);
  const window = Math.min(seconds, media.duration);
  await mkdir(output, { recursive: true });
  const { stderr } = await execute('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', media.path, '-t', String(window),
    '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'
  ]);
  const candidates = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1]));
  const intervals = candidates.slice(1).map((time, index) => time - candidates[index]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const samples = [];
  for (let index = 0; index < frames; index++) {
    const time = window * (index + 0.5) / frames;
    const image = path.join(output, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
    await execute('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', String(time),
      '-i', media.path, '-frames:v', '1', '-vf', 'scale=640:-2', image
    ]);
    if (!(await exists(image))) throw new Error(`No frame extracted at ${time}s.`);
    samples.push({ time, file: path.basename(image) });
  }
  const evidence = {
    version: 1, sourceUrl, media, analyzedSeconds: window, sceneThreshold: 0.3,
    candidateCuts: candidates,
    medianCandidateInterval: sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
      : null,
    frames: samples,
    limitations: [
      'Scene-change candidates are heuristics, not verified edit boundaries.',
      'Uniform still frames cannot establish animation, transitions, or exact caption timing.',
      'Audio content, loudness, speech, and music have not been analyzed.',
      `Only the first ${window} seconds were analyzed; do not generalize to the whole channel.`
    ]
  };
  await writeJson(path.join(output, 'evidence.json'), evidence);
  return evidence;
}
