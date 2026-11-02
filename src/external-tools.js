import path from 'node:path';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { inspectMedia } from './production.js';

const rates = [24, 25, 30, 50, 60];
function requireValue(condition, message) {
  if (!condition) throw new Error(`External tool: ${message}`);
}

// Use an installed JS entry point on Windows; never execute a shell-built .cmd string.
export async function hyperframes(args, options, execute = run) {
  const entry = process.env.VIDEO_MONK_HYPERFRAMES;
  requireValue(entry && path.isAbsolute(entry) && /\.(?:c?js|mjs)$/i.test(entry),
    'set VIDEO_MONK_HYPERFRAMES to the absolute installed HyperFrames JS CLI entry point. No automatic npx install.');
  requireValue(await exists(entry), 'HyperFrames entry point does not exist');
  return execute(process.execPath, [entry, ...args], { timeout: 600_000, ...options });
}

async function localFile(file) {
  const resolved = await realpath(path.resolve(file));
  requireValue((await stat(resolved)).isFile(), `not a local file: ${resolved}`);
  return resolved;
}

async function containedFile(folder, file) {
  const base = await realpath(folder);
  const resolved = await localFile(path.resolve(folder, file));
  const relative = path.relative(base, resolved);
  requireValue(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'tool artifact escapes its project/output directory');
  return resolved;
}

async function newDirectory(output) {
  requireValue(!(await exists(output)), 'output already exists');
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
}

export async function transcribeParakeet(media, output, options, execute = run) {
  requireValue(options.allowTranscribe === true, 'transcription requires --allow-transcribe');
  requireValue(options.allowToolNetwork === true,
    'HyperFrames may download runtime/model assets or send telemetry; review its settings and use --allow-tool-network');
  const source = await localFile(media);
  requireValue(!(await exists(output)), 'output already exists');
  const metadata = await inspectMedia(source, execute);
  requireValue(metadata.audio && Number.isFinite(metadata.duration) && metadata.duration > 0, 'input needs finite-duration audio');
  await newDirectory(output);
  const { stdout } = await hyperframes(['transcribe', source, '--engine', 'parakeet', '--json', '--dir', path.resolve(output)],
    { cwd: output }, execute);
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('External tool: HyperFrames returned invalid JSON; inspect partial output.'); }
  requireValue(result.ok !== false && typeof result.transcriptPath === 'string', 'HyperFrames returned no transcriptPath');
  const transcriptPath = await containedFile(output, result.transcriptPath);
  const words = await readJson(transcriptPath);
  requireValue(Array.isArray(words) && words.length > 0 && words.length <= 200000, 'expected a nonempty word-timestamp array');
  let previousStart = 0;
  let previousEnd = 0;
  const normalized = words.map(word => {
    requireValue(word && typeof word.text === 'string' && word.text.trim() && !/[\r\n\x00-\x1f]/.test(word.text) &&
      Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= previousStart &&
      word.end >= previousEnd && word.start >= 0 && word.end > word.start && word.end <= metadata.duration + 0.1,
    'invalid, unordered or out-of-bounds word timestamp');
    previousStart = word.start;
    previousEnd = word.end;
    return { text: word.text, start: word.start, end: word.end };
  });
  await writeJson(path.join(output, 'words.json'), normalized);
  await writeNew(path.join(output, 'transcript.txt'), `${normalized.map(word => word.text).join(' ')}\n`);
  const report = {
    version: 1, engine: 'parakeet', status: 'draft-needs-speech-review', source,
    duration: metadata.duration, wordCount: normalized.length,
    checks: { timestampBounds: 'PASS', wordsAndAlignment: 'NOT VERIFIED', sourceToEditedTimelineMapping: 'NOT VERIFIED' },
    note: 'Source-relative word times are not edited-timeline captions. No speech verification is implied.'
  };
  await writeJson(path.join(output, 'transcription-report.json'), report);
  return report;
}

export async function renderHyperframes(project, composition, output, options, execute = run) {
  requireValue(options.allowRender === true && options.allowToolNetwork === true,
    'HTML execution/rendering requires --allow-render and --allow-tool-network; approved compositions may execute code and make network requests');
  requireValue(rates.includes(options.fps) && Number.isInteger(options.width) && Number.isInteger(options.height) &&
    options.width >= 180 && options.height >= 180 && options.width <= 3840 && options.height <= 2160 &&
    options.width % 2 === 0 && options.height % 2 === 0 &&
    (options.width * 9 === options.height * 16 || options.width * 16 === options.height * 9) &&
    Number.isFinite(options.seconds) && options.seconds > 0 && options.seconds <= 600,
  'specify integer FPS, even 16:9/9:16 dimensions and duration up to 600s');
  const directory = await realpath(path.resolve(project));
  requireValue(typeof composition === 'string' && /\.html$/i.test(composition), 'composition must be an HTML file within the project');
  const html = await containedFile(directory, composition);
  requireValue(!(await exists(output)), 'output already exists');
  const fingerprint = createHash('sha256').update(await readFile(html)).digest('hex');
  await newDirectory(output);
  const video = path.join(output, 'animation.mp4');
  await hyperframes(['render', directory, '--composition', path.relative(directory, html),
    '--output', path.resolve(video), '--fps', String(options.fps)],
  { cwd: directory }, execute);
  requireValue(await exists(video), 'HyperFrames did not produce animation.mp4');
  const measured = await inspectMedia(path.resolve(video), execute);
  const [numerator, denominator] = (measured.video?.avg_frame_rate || '0/1').split('/').map(Number);
  requireValue(measured.video?.width === options.width && measured.video?.height === options.height &&
    Math.abs(numerator / denominator - options.fps) < 0.00001 && Number.isFinite(measured.duration) &&
    Math.abs(measured.duration - options.seconds) <= 1 / options.fps + 0.03,
  'HyperFrames output dimensions/FPS/duration differ from the approved expectation');
  await execute(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg',
    ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', path.resolve(video), '-f', 'null', '-']);
  const report = {
    version: 1, engine: 'hyperframes', status: 'draft-needs-visual-review', project: directory,
    composition: html, compositionSha256: fingerprint,
    measured: { width: measured.video.width, height: measured.video.height, fps: numerator / denominator, duration: measured.duration },
    checks: { decode: 'PASS', dimensionsFpsDuration: 'PASS', factualAccuracy: 'NOT VERIFIED', readabilityAndMotion: 'NOT VERIFIED' },
    note: 'Source HTML hash is provenance only, not a dependency-tree approval. Review all scripts/assets. No sandbox or offline-network guarantee.'
  };
  await writeJson(path.join(output, 'animation-report.json'), report);
  return report;
}
