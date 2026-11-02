import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { resolveXml } from './plan.js';

const rates = [24, 25, 30, 50, 60];
const fail = message => { throw new Error(`Production: ${message}`); };
const check = (condition, message) => { if (!condition) fail(message); };
function keys(value, allowed, location) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${location} must be an object`);
  check(Object.keys(value).every(key => allowed.includes(key)), `unsupported field in ${location}`);
}
const positive = value => Number.isFinite(value) && value > 0;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\r\n\x00-\x1f]/.test(value);
const mediaTool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;

export async function inspectMedia(file, execute = run) {
  const { stdout } = await execute(mediaTool('ffprobe'), [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', file
  ]);
  const data = JSON.parse(stdout);
  check(Array.isArray(data.streams), `no streams: ${file}`);
  return {
    duration: Number(data.format?.duration), video: data.streams.find(stream => stream.codec_type === 'video'),
    audio: data.streams.find(stream => stream.codec_type === 'audio')
  };
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function loadProduction(file, execute = run) {
  const raw = await readFile(file);
  const manifest = JSON.parse(raw);
  keys(manifest, ['version', 'title', 'fps', 'width', 'height', 'font', 'assets', 'narration', 'music', 'scenes'], 'manifest');
  const m = manifest;
  check(m.version === 1 && text(m.title, 120), 'version 1 and a title (1-120 chars) are required');
  check(rates.includes(m.fps), 'unsupported frame rate');
  check(Number.isInteger(m.width) && Number.isInteger(m.height) && m.width % 2 === 0 && m.height % 2 === 0 &&
    m.width >= 180 && m.height >= 180 && m.width <= 3840 && m.height <= 2160 &&
    (m.width * 9 === m.height * 16 || m.width * 16 === m.height * 9), 'use even 16:9 or 9:16 dimensions within 3840x2160');
  check(Array.isArray(m.assets) && m.assets.length > 0 && m.assets.length <= 500, 'provide 1-500 assets');
  const base = path.dirname(path.resolve(file));
  const assets = new Map();
  for (const asset of m.assets) {
    keys(asset, ['id', 'path', 'kind', 'rights', 'attribution', 'sourceUrl', 'approved'], 'asset');
    check(typeof asset.id === 'string' && /^[\w-]{1,64}$/.test(asset.id) && !assets.has(asset.id), 'asset IDs must be unique');
    check(['video', 'image', 'audio'].includes(asset.kind), 'unsupported asset kind');
    check(asset.approved === true && text(asset.rights, 1000) && text(asset.attribution, 1000),
      `asset ${asset.id} needs explicit approval, rights and attribution`);
    check(typeof asset.path === 'string' && asset.path, `missing path: ${asset.id}`);
    const local = path.resolve(base, asset.path);
    check(await exists(local), `missing asset: ${local}`);
    const metadata = await inspectMedia(local, execute);
    check(asset.kind === 'audio' ? metadata.audio : metadata.video, `wrong media kind: ${asset.id}`);
    if (asset.kind === 'image') check(['png', 'mjpeg', 'webp', 'bmp', 'tiff'].includes(metadata.video.codec_name),
      `image must be PNG, JPEG, WebP, BMP or TIFF: ${asset.id}`);
    if (asset.kind !== 'image') check(positive(metadata.duration), `unknown duration: ${asset.id}`);
    assets.set(asset.id, { ...asset, path: local, metadata, sha256: await digest(local) });
  }
  const audio = (value, label, min, max) => {
    keys(value, ['asset', 'gainDb'], label);
    const asset = assets.get(value.asset);
    check(asset?.kind === 'audio', `${label} must reference an audio asset`);
    check(Number.isFinite(value.gainDb) && value.gainDb >= min && value.gainDb <= max, `invalid ${label} gainDb`);
    return asset;
  };
  const narration = audio(m.narration, 'narration', -30, 6);
  if (m.music) audio(m.music, 'music', -60, 0);
  check(Array.isArray(m.scenes) && m.scenes.length > 0 && m.scenes.length <= 500, 'provide 1-500 scenes');
  let totalFrames = 0;
  for (const [index, scene] of m.scenes.entries()) {
    keys(scene, ['kind', 'asset', 'in', 'duration', 'fit', 'graphic', 'broll', 'purpose'], `scene ${index}`);
    check(['video', 'image', 'graphic'].includes(scene.kind), 'unsupported scene kind');
    check(text(scene.purpose, 500), 'each scene needs a teaching purpose');
    check(positive(scene.duration) && scene.duration <= 600 &&
      Math.abs(scene.duration * m.fps - Math.round(scene.duration * m.fps)) < 0.00001,
    'scene duration must be 1 frame to 600 seconds, aligned to timeline frames');
    check(Math.round(scene.duration * m.fps) >= 1, 'subframe scene');
    totalFrames += Math.round(scene.duration * m.fps);
    check(['contain', 'cover'].includes(scene.fit), 'scene fit must be contain or cover');
    if (scene.kind === 'graphic') {
      check(scene.asset === undefined && scene.in === undefined, 'graphic scene cannot have source bounds');
      keys(scene.graphic, ['title', 'rows', 'citation'], 'graphic');
      check(text(scene.graphic.title, 32) && text(scene.graphic.citation, 90), 'graphic needs short title (max 32 chars) and citation');
      check(Array.isArray(scene.graphic.rows) && scene.graphic.rows.length >= 1 && scene.graphic.rows.length <= 5, 'graphic needs 1-5 rows');
      for (const row of scene.graphic.rows) {
        keys(row, ['label', 'value'], 'graphic row');
        check(text(row.label, 36) && Number.isFinite(row.value) && row.value >= 0 && row.value <= 1,
          'row needs short label and normalized value 0-1; labels must include units/actual values');
      }
    } else {
      check(scene.graphic === undefined, 'non-graphic scene cannot include graphic');
      const asset = assets.get(scene.asset);
      check(asset?.kind === scene.kind, 'scene source kind mismatch');
      check(Number.isFinite(scene.in) && scene.in >= 0, 'source in must be nonnegative seconds');
      check(scene.kind === 'image' ? scene.in === 0 : scene.in + scene.duration <= asset.metadata.duration + 0.00001,
        'scene exceeds source duration');
    }
    if (scene.broll) {
      keys(scene.broll, ['asset', 'in', 'start', 'duration'], 'broll');
      const b = scene.broll;
      const asset = assets.get(b.asset);
      check(asset?.kind === 'video', 'broll must reference video');
      check(Number.isFinite(b.in) && b.in >= 0 && Number.isFinite(b.start) && b.start >= 0 &&
        positive(b.duration) && b.start + b.duration <= scene.duration &&
        b.in + b.duration <= asset.metadata.duration + 0.00001, 'invalid broll timing');
      for (const time of [b.start, b.duration]) check(Math.abs(time * m.fps - Math.round(time * m.fps)) < 0.00001,
        'broll timing must align to timeline frames');
    }
  }
  const duration = totalFrames / m.fps;
  check(duration <= 7200, 'maximum production duration is two hours');
  check(Math.abs(narration.metadata.duration - duration) <= 1 / m.fps,
    'scene duration must match narration within one frame; no silent narration truncation/padding');
  check(typeof m.font === 'string' && m.font, 'provide an approved local font file');
  const font = path.resolve(base, m.font);
  check(await exists(font), 'font file does not exist');
  const fingerprint = createHash('sha256').update(raw).update(await digest(font));
  for (const asset of assets.values()) fingerprint.update(asset.id).update(asset.sha256);
  return { manifest: m, assets, duration, totalFrames, font, fingerprint: fingerprint.digest('hex') };
}

export async function reviewProduction(file, output, approve = false, execute = run) {
  check(!(await exists(output)), 'review output exists');
  const loaded = await loadProduction(file, execute);
  const report = {
    version: 1, fingerprint: loaded.fingerprint, decision: approve ? 'approved' : 'pending',
    scope: 'Plan and asset selection only; not final-video approval',
    checks: { structure: 'PASS', sourceBounds: 'PASS', narrationDuration: 'PASS',
      rights: 'USER ATTESTED; verify license and releases', facts: 'NOT VERIFIED',
      readability: 'NOT VERIFIED', audioMix: 'NOT VERIFIED', finalPlayback: 'NOT VERIFIED' },
    duration: loaded.duration, scenes: loaded.manifest.scenes.length,
    assets: [...loaded.assets.values()].map(({ id, rights, attribution, sourceUrl, sha256 }) =>
      ({ id, rights, attribution, sourceUrl, sha256 })),
    next: approve ? 'Build draft with production-build --allow-render, review contact sheets and listen in Resolve.' :
      'Review facts, visual plan, source rights and narration; explicitly approve a fresh report.'
  };
  await writeJson(output, report);
  return report;
}

const scale = (m, fit) => fit === 'cover'
  ? `scale=${m.width}:${m.height}:force_original_aspect_ratio=increase,crop=${m.width}:${m.height}`
  : `scale=${m.width}:${m.height}:force_original_aspect_ratio=decrease,pad=${m.width}:${m.height}:(ow-iw)/2:(oh-ih)/2:color=0x080c14`;

export async function buildProduction(file, approval, output, allowRender, execute = run, finishing = 'resolve') {
  check(['resolve', 'ffmpeg'].includes(finishing), 'finishing must be resolve or ffmpeg');
  check(allowRender === true, 'draft rendering requires --allow-render');
  check(!(await exists(output)), 'production output already exists');
  const loaded = await loadProduction(file, execute);
  const reviewed = await readJson(approval);
  check(reviewed.version === 1 && reviewed.decision === 'approved' && reviewed.fingerprint === loaded.fingerprint,
    'missing approval or changed manifest/media/font; review again');
  const { manifest: m, assets, duration } = loaded;
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const ffmpeg = args => execute(mediaTool('ffmpeg'),
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
      ...args.flatMap(arg => arg === '-i' ? ['-protocol_whitelist', 'file,pipe', '-i'] : [arg])], { cwd: output });
  await copyFile(loaded.font, path.join(output, 'font.ttf'));
  const segments = [];
  for (const [index, scene] of m.scenes.entries()) {
    const name = `scene-${String(index + 1).padStart(3, '0')}.mp4`;
    const input = scene.kind === 'graphic'
      ? ['-f', 'lavfi', '-i', `color=c=0x080c14:s=${m.width}x${m.height}:r=${m.fps}:d=${scene.duration}`]
      : scene.kind === 'image'
        ? ['-loop', '1', '-i', assets.get(scene.asset).path]
        : ['-ss', String(scene.in), '-i', assets.get(scene.asset).path];
    let filters = `${scale(m, scene.fit)},fps=${m.fps},setsar=1,setpts=PTS-STARTPTS`;
    if (scene.kind === 'graphic') {
      const fontSize = Math.round(Math.min(m.width / 22, m.height / 18));
      const writeText = async (label, textValue) => {
        const filename = `text-${index}-${label}.txt`;
        await writeNew(path.join(output, filename), textValue);
        return filename;
      };
      const title = await writeText('title', scene.graphic.title);
      filters += `,drawtext=fontfile=font.ttf:textfile=${title}:expansion=none:fontsize=${fontSize}:fontcolor=white:x=w*0.08:y=h*0.1`;
      for (const [rowIndex, row] of scene.graphic.rows.entries()) {
        const label = await writeText(`row${rowIndex}`, row.label);
        const y = Math.round(m.height * (0.25 + rowIndex * 0.12));
        const reveal = Math.min(scene.duration * 0.6, (rowIndex + 1) * scene.duration / (scene.graphic.rows.length + 2));
        filters += `,drawtext=fontfile=font.ttf:textfile=${label}:expansion=none:fontsize=${Math.round(fontSize * 0.72)}:fontcolor=white:x=w*0.08:y=${y}:enable='gte(t,${reveal})'`;
        if (row.value > 0) filters += `,drawbox=x=iw*0.08:y=${y + fontSize}:w=${Math.max(1, Math.round(m.width * 0.8 * row.value))}:h=${Math.max(3, Math.round(m.height * 0.016))}:color=0x48c9ef:t=fill:enable='gte(t,${reveal})'`;
      }
      const citation = await writeText('citation', scene.graphic.citation);
      const citationSize = Math.max(1, Math.floor(Math.min(fontSize * 0.4, m.width * 0.84 / (scene.graphic.citation.length * 0.7))));
      filters += `,drawtext=fontfile=font.ttf:textfile=${citation}:expansion=none:fontsize=${citationSize}:fontcolor=0xaaaaaa:x=w*0.08:y=h*0.92`;
    }
    if (scene.broll) {
      const b = scene.broll;
      input.push('-ss', String(b.in), '-t', String(b.duration), '-i', assets.get(b.asset).path);
      const graph = `[0:v]${filters}[base];[1:v]${scale(m, 'cover')},fps=${m.fps},setsar=1,setpts=PTS-STARTPTS+${b.start}/TB[br];` +
        `[base][br]overlay=eof_action=pass:enable='gte(t,${b.start})*lt(t,${b.start + b.duration})'[v]`;
      await ffmpeg([...input, '-filter_complex', graph, '-map', '[v]', '-an', '-t', String(scene.duration),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', name]);
    } else {
      await ffmpeg([...input, '-vf', filters, '-an', '-t', String(scene.duration),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', name]);
    }
    const metadata = await inspectMedia(path.join(output, name), execute);
    check(Math.abs(metadata.duration - scene.duration) <= 1 / m.fps, `rendered segment duration mismatch: ${name}`);
    await ffmpeg(['-ss', String(scene.duration / 2), '-i', name, '-frames:v', '1', '-update', '1', `${name}.png`]);
    segments.push(name);
  }
  const audioTracks = [];
  for (const label of ['narration', 'music']) {
    if (!m[label]) continue;
    const config = m[label];
    const args = label === 'music' ? ['-stream_loop', '-1'] : [];
    args.push('-i', assets.get(config.asset).path, '-vn', '-t', String(duration),
      '-af', `volume=${config.gainDb}dB${label === 'music' ? `,afade=t=out:st=${Math.max(0, duration - 1)}:d=${Math.min(1, duration)}` : ''}`,
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', `${label}.wav`);
    await ffmpeg(args);
    audioTracks.push(`${label}.wav`);
  }
  await writeNew(path.join(output, 'concat.txt'), segments.map(name => `file '${name}'`).join('\n'));
  const previewInputs = ['-f', 'concat', '-safe', '1', '-i', 'concat.txt',
    ...audioTracks.flatMap(name => ['-i', name])];
  const mix = audioTracks.map((_, index) => `[${index + 1}:a]`).join('') +
    `amix=inputs=${audioTracks.length}:normalize=0:duration=longest,alimiter=limit=0.95:latency=1[a]`;
  await ffmpeg([...previewInputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
    '-t', String(duration), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'preview.mp4']);
  const measured = await inspectMedia(path.join(output, 'preview.mp4'), execute);
  check(measured.video?.width === m.width && measured.video?.height === m.height && measured.audio &&
    Math.abs(measured.duration - duration) <= 1 / m.fps + 0.03, 'preview metadata mismatch');
  await ffmpeg(['-i', 'preview.mp4', '-f', 'null', '-']);
  if (finishing === 'ffmpeg') await copyFile(path.join(output, 'preview.mp4'), path.join(output, 'delivery-candidate.mp4'));
  const plan = {
    ...m, durationFrames: loaded.totalFrames,
    clips: m.scenes.map((scene, index) => ({ mediaId: `scene-${index}`, in: 0, out: scene.duration, purpose: scene.purpose }))
  };
  const inventory = { media: segments.map((name, index) => ({
    id: `scene-${index}`, path: path.resolve(output, name), duration: m.scenes[index].duration,
    fps: m.fps, width: m.width, height: m.height
  })) };
  const escape = value => String(value).replace(/[<>&"']/g, char => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[char]);
  const audioXml = audioTracks.map((name, index) =>
    `<track><clipitem id="audio-${index}"><name>${name}</name><duration>${loaded.totalFrames}</duration>` +
    `<rate><timebase>${m.fps}</timebase><ntsc>FALSE</ntsc></rate><start>0</start><end>${loaded.totalFrames}</end><in>0</in><out>${loaded.totalFrames}</out>` +
    `<file id="audio-file-${index}"><name>${name}</name><pathurl>${escape(pathToFileURL(path.resolve(output, name)).href)}</pathurl>` +
    `<rate><timebase>${m.fps}</timebase><ntsc>FALSE</ntsc></rate><duration>${loaded.totalFrames}</duration>` +
    '<media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics>' +
    '<channelcount>2</channelcount></audio></media></file><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' +
    '</clipitem></track>').join('');
  await writeNew(path.join(output, 'timeline.xml'),
    resolveXml(plan, inventory).replace('</video></media></sequence>', `</video><audio>${audioXml}</audio></media></sequence>`));
  const report = {
    version: 1, status: finishing === 'ffmpeg' ? 'candidate-needs-human-review' : 'draft-needs-resolve-review',
    finishing, fingerprint: loaded.fingerprint,
    checks: { encoding: 'PASS', dimensions: 'PASS', duration: 'PASS', audioPresent: 'PASS',
      factualAccuracy: 'NOT VERIFIED', visualReadability: 'NOT VERIFIED', audioLoudness: 'NOT VERIFIED',
      resolveImport: 'NOT VERIFIED', finalPlayback: 'NOT VERIFIED', finalExport: 'NOT VERIFIED' },
    measured: { duration: measured.duration, width: measured.video.width, height: measured.video.height },
    scenes: segments, credits: [...assets.values()].map(({ id, rights, attribution, sourceUrl }) => ({ id, rights, attribution, sourceUrl }))
  };
  await writeJson(path.join(output, 'production-report.json'), report);
  await writeJson(path.join(output, 'production.json'), m);
  await writeNew(path.join(output, 'REVIEW.txt'), [
    'DRAFT ASSEMBLY, NOT AN AUTOMATICALLY APPROVED FINAL PRODUCTION VIDEO.',
    'Review preview.mp4 and each scene contact image. Graphics use schematic normalized bars; verify values, labels and citations.',
    ...(finishing === 'resolve' ? [
      'Create a NEW Resolve Free project. Import timeline.xml; check both audio channels, scene order, sync, fps and duration.',
      'If XML audio import differs in your Resolve version, use preview.mp4 as a flattened audiovisual draft instead.',
      'The preview includes a safety limiter; separate WAV tracks in the XML do not. Set and measure final dynamics/loudness in Resolve.',
      'Complete titles/captions, mixing and color in Resolve. Export only after whole-timeline approval.'
    ] : [
      'Non-Resolve workflow: delivery-candidate.mp4 is the assembled audiovisual candidate; Resolve is not required.',
      'Preview and candidate share a safety limiter, not measured mastering. Complete any approved FFmpeg caption/mix/color steps and verify again.',
      'Run production-verify on the actual candidate with agreed LUFS/true-peak targets. Failures block delivery.',
      'Watch/listen end-to-end; record playback approval and accept factual/rights/creative quality before delivery.'
    ]),
    'B-roll source audio is intentionally silent. Narration/music are separate prepared WAV tracks. No automatic ducking or caption generation.',
    'Review every asset license, attribution, identity, factual claim, crop and text for both target orientations.',
    'Verify actual export metadata and watch/listen end-to-end before calling it final. Publishing is separate.',
    'Generated segments are baked clips, not editable Fusion node graphs.',
    '', 'CREDITS', ...report.credits.map(asset => `${asset.id}: ${asset.attribution}; ${asset.rights}; ${asset.sourceUrl || 'local asset'}`)
  ].join('\n'));
  return report;
}

export async function verifyProduction(media, manifest, output, options, execute = run) {
  check(!(await exists(output)), 'verification output exists');
  check(Number.isFinite(options.targetLufs) && options.targetLufs >= -30 && options.targetLufs <= -5 &&
    Number.isFinite(options.maxTruePeak) && options.maxTruePeak >= -9 && options.maxTruePeak <= 0,
  'choose target LUFS (-30 to -5) and maximum true peak (-9 to 0 dBTP)');
  const expected = await loadProduction(manifest, execute);
  const measured = await inspectMedia(path.resolve(media), execute);
  check(measured.video && measured.audio, 'export requires picture and audio');
  const [numerator, denominator] = (measured.video.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = numerator / denominator;
  const { stderr } = await execute(mediaTool('ffmpeg'), [
    '-hide_banner', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', path.resolve(media), '-map', '0:v:0', '-map', '0:a:0',
    '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'
  ]);
  const metrics = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  check(metrics, 'loudness measurement unavailable');
  const loudness = JSON.parse(metrics[0]);
  const integratedLufs = Number(loudness.input_i);
  const truePeakDb = Number(loudness.input_tp);
  const checks = {
    decode: 'PASS',
    dimensions: measured.video.width === expected.manifest.width && measured.video.height === expected.manifest.height ? 'PASS' : 'FAIL',
    fps: Math.abs(fps - expected.manifest.fps) < 0.00001 ? 'PASS' : 'FAIL',
    duration: Math.abs(measured.duration - expected.duration) <= 1 / expected.manifest.fps + 0.03 ? 'PASS' : 'FAIL',
    loudness: Number.isFinite(integratedLufs) && Math.abs(integratedLufs - options.targetLufs) <= 1 ? 'PASS' : 'FAIL',
    truePeak: Number.isFinite(truePeakDb) && truePeakDb <= options.maxTruePeak ? 'PASS' : 'FAIL',
    wholeVideoPlayback: options.playbackApproved === true ? 'USER ATTESTED' : 'NOT VERIFIED',
    factsRightsAndCreativeQuality: 'HUMAN REVIEW REQUIRED'
  };
  const report = {
    version: 1, status: Object.values(checks).includes('FAIL') ? 'failed-technical-checks' :
      options.playbackApproved === true ? 'technical-checks-passed-playback-attested' : 'technical-checks-passed-awaiting-playback',
    media: path.resolve(media), sha256: await digest(media), checks,
    measured: { duration: measured.duration, fps, width: measured.video.width, height: measured.video.height,
      integratedLufs: Number.isFinite(integratedLufs) ? integratedLufs : null, truePeakDb: Number.isFinite(truePeakDb) ? truePeakDb : null },
    targets: { integratedLufs: options.targetLufs, toleranceLu: 1, maxTruePeakDb: options.maxTruePeak },
    note: 'Technical tests and a playback attestation do not establish factual accuracy, rights, edit quality or publication approval.'
  };
  await writeJson(output, report);
  return report;
}
