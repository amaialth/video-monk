// Version 2 build pipeline: motion graphics (headless Chrome) -> per-scene composites (FFmpeg) ->
// transition joins -> audio mix with ducking -> loudness mastering -> final encode -> verified deliverables.
import path from 'node:path';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { exists, readJson, run, writeJson, writeNew } from './core.js';
import { inspectMedia, digest } from './production.js';
import { loadTimeline, chapters } from './timeline.js';
import { MotionRenderer, pool } from './motion/render.js';
import { pageWords, pagesToSrt, pagesToVtt } from './captions.js';

const fail = message => { throw new Error(`Build: ${message}`); };
const check = (condition, message) => { if (!condition) fail(message); };
const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const pad3 = n => String(n).padStart(3, '0');
const sec = n => Number(n.toFixed(6)).toString();
const hex = c => `0x${c.replace('#', '')}`;

export async function reviewTimeline(file, output, approve = false, execute = run) {
  check(!(await exists(output)), 'review output exists');
  const loaded = await loadTimeline(file, execute);
  const motionCount = loaded.timeline.reduce((n, t) => n + t.overlays.length + (t.scene.kind === 'graphic' ? 1 : 0), 0) +
    (loaded.manifest.globalOverlays || []).length;
  const report = {
    version: 2, fingerprint: loaded.fingerprint, decision: approve ? 'approved' : 'pending',
    scope: 'Timeline, motion-graphics data and asset selection; not final-video approval',
    checks: { structure: 'PASS', sourceBounds: 'PASS', frameAlignment: 'PASS', templateProps: 'PASS',
      rights: 'USER ATTESTED; verify license and releases', facts: 'NOT VERIFIED', captionsAccuracy: loaded.words ? 'NOT VERIFIED' : 'NO CAPTIONS',
      finalPlayback: 'NOT VERIFIED' },
    duration: loaded.duration, frames: loaded.totalFrames, scenes: loaded.timeline.length, motionGraphics: motionCount,
    transitions: loaded.timeline.filter(t => t.transition).length, chapters: chapters(loaded).map(c => c.label),
    assets: [...loaded.assets.values()].map(({ id, rights, attribution, sourceUrl, sha256 }) => ({ id, rights, attribution, sourceUrl, sha256 })),
    next: approve ? 'Run production-build --allow-render, then watch final.mp4 end to end.' :
      'Review facts, chart values, captions source and asset rights; then re-run with --approve-plan.'
  };
  await writeJson(output, report);
  return report;
}

// Fit a visual stream to the frame, with optional camera motion. `frames` = output frame count of that layer.
function fitChain({ width: W, height: H, fps }, fit = 'cover', motion, frames) {
  const type = motion?.type || 'none';
  const cover = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
  const contain = (w, h, bg) => `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg}`;
  const fitTo = (w, h) => (fit === 'contain' ? contain(w, h, '0x0b1020') : cover(w, h));
  if (type === 'none') return `fps=${fps},${fitTo(W, H)},setsar=1`;
  if (type === 'punch-in') {
    const a = motion.amount ?? 0.12;
    const w = Math.ceil(W * (1 + a) / 2) * 2, h = Math.ceil(H * (1 + a) / 2) * 2;
    return `fps=${fps},${fitTo(w, h)},crop=${W}:${H},setsar=1`;
  }
  // Smooth (cosine-eased) zoom/pan via zoompan on a 2x canvas for sub-pixel precision.
  const a = motion.amount ?? (type.startsWith('zoom') ? 0.1 : 0.15);
  const n = Math.max(1, frames - 1);
  const e = `(0.5-0.5*cos(PI*min(on/${n},1)))`;
  const z = type === 'zoom-in' ? `1+${a}*${e}` : type === 'zoom-out' ? `1+${a}-${a}*${e}` : `${1 + a}`;
  const cx = 'iw/2-iw/zoom/2', cy = 'ih/2-ih/zoom/2';
  const x = type === 'pan-left' ? `(iw-iw/zoom)*(1-${e})` : type === 'pan-right' ? `(iw-iw/zoom)*${e}` : cx;
  const y = type === 'pan-up' ? `(ih-ih/zoom)*(1-${e})` : type === 'pan-down' ? `(ih-ih/zoom)*${e}` : cy;
  return `fps=${fps},${fitTo(W * 2, H * 2)},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps},setsar=1`;
}

async function ffmpeg(args, execute, cwd) {
  const long = args.find(a => typeof a === 'string' && a.length > 6000);
  if (long) {
    // Very long filter graphs go through a script file (FFmpeg 7+ syntax: -/filter_complex <file>).
    const index = args.indexOf(long);
    const file = path.join(cwd, `graph-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await writeFile(file, long);
    args = [...args.slice(0, index - 1), '-/filter_complex', file, ...args.slice(index + 1)];
  }
  return execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd, timeout: 6 * 3600_000 });
}

function motionJob(loaded, spec, duration, overlay) {
  const m = loaded.manifest;
  return {
    template: spec.template, html: spec.html ? path.resolve(loaded.base, spec.html) : undefined, props: spec.props ?? {},
    width: m.width, height: m.height, fps: m.fps, duration, theme: m.theme ? { ...m.theme, font: undefined } : undefined,
    font: loaded.font, placement: spec.placement, panel: spec.panel,
    background: overlay ? 'transparent' : (spec.background || 'grid'), exit: overlay
  };
}

export async function buildTimeline(file, approval, output, options = {}) {
  const { allowRender, execute = run, log = () => {}, concurrency = 4, keepWork = false, quality = 'final' } = options;
  check(allowRender === true, 'rendering requires --allow-render');
  check(!(await exists(output)), `output already exists: ${output}`);
  const loaded = await loadTimeline(file, execute);
  const reviewed = await readJson(approval);
  check(reviewed.decision === 'approved' && reviewed.fingerprint === loaded.fingerprint,
    'missing approval or the manifest/media/captions changed since review; run production-review --approve-plan again');
  const { manifest: m, timeline, duration, totalFrames, assets } = loaded;
  const draft = quality === 'draft';
  const work = path.join(output, 'work');
  await mkdir(work, { recursive: true });
  await mkdir(path.join(output, 'stems'), { recursive: true });
  const started = Date.now();

  // 1. Motion graphics
  const jobs = [];
  for (const t of timeline) {
    if (t.scene.kind === 'graphic') jobs.push({ key: `g${t.index}`, job: motionJob(loaded, t.scene.graphic, t.scene.duration, false) });
    t.overlays.forEach((o, i) => jobs.push({ key: `o${t.index}-${i}`, job: motionJob(loaded, o, o.duration, true) }));
  }
  (m.globalOverlays || []).forEach((o, i) => jobs.push({ key: `global-${i}`, job: motionJob(loaded, o, o.duration, true) }));
  let captionPages = null;
  if (loaded.words) {
    const c = m.captions;
    captionPages = pageWords(loaded.words, { maxWords: c.maxWords ?? (m.height > m.width ? 4 : 7), maxChars: c.maxChars ?? (m.height > m.width ? 22 : 38) });
    if (c.burnIn !== false) {
      jobs.push({ key: 'captions', job: { ...motionJob(loaded, { template: 'captions' }, duration, true), exit: false,
        props: { pages: captionPages, style: c.style || 'karaoke', position: c.position || 'bottom' } } });
    }
  }
  const rendered = new Map();
  if (jobs.length) {
    log(`Rendering ${jobs.length} motion graphic(s) in headless Chrome...`);
    const renderer = new MotionRenderer();
    try {
      await renderer.start();
      await pool(jobs, concurrency, async ({ key, job }) => {
        const result = await renderer.render(job, path.join(work, 'motion'));
        rendered.set(key, result);
        log(`  motion ${key}: ${result.frames} frames (${result.captured} captured)`);
      });
    } finally {
      await renderer.close();
    }
  }

  // 2. Scene composites (video only) + source-audio clips
  const vcodec = ['-c:v', 'libx264', '-preset', draft ? 'ultrafast' : 'fast', '-crf', draft ? '23' : '14', '-pix_fmt', 'yuv420p', '-r', String(m.fps)];
  log(`Compositing ${timeline.length} scene(s)...`);
  await pool(timeline, Math.max(1, Math.min(3, concurrency)), async t => {
    const s = t.scene;
    const name = `scene-${pad3(t.index + 1)}.mp4`;
    const inputs = [];
    const add = args => { inputs.push(...args); return inputs.filter(a => a === '-i').length - 1; };
    const graph = [];
    const asset = s.asset ? assets.get(s.asset) : null;
    if (s.kind === 'video') add(['-ss', sec(s.in ?? 0), '-t', sec(s.duration + 0.5), '-i', asset.path]);
    else if (s.kind === 'image') add(['-loop', '1', '-framerate', String(m.fps), '-t', sec(s.duration), '-i', asset.path]);
    else if (s.kind === 'graphic') add(['-framerate', String(m.fps), '-i', rendered.get(`g${t.index}`).pattern]);
    else add(['-f', 'lavfi', '-i', `color=c=${hex(s.color)}:s=${m.width}x${m.height}:r=${m.fps}:d=${sec(s.duration)}`]);
    const baseFit = s.kind === 'graphic' ? `fps=${m.fps},setsar=1` : fitChain(m, s.fit, s.motion, t.frames);
    graph.push(`[0:v]${baseFit},tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${t.frames},setpts=PTS-STARTPTS,format=yuv444p[l0]`);
    let current = 'l0';
    t.broll.forEach((b, i) => {
      const ba = assets.get(b.asset);
      const idx = ba.kind === 'video'
        ? add(['-ss', sec(b.in ?? 0), '-t', sec(b.duration + 0.5), '-i', ba.path])
        : add(['-loop', '1', '-framerate', String(m.fps), '-t', sec(b.duration), '-i', ba.path]);
      const frames = Math.round(b.duration * m.fps);
      graph.push(`[${idx}:v]${fitChain(m, b.fit, b.motion, frames)},tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${frames},format=yuv444p,setpts=PTS-STARTPTS+${sec(b.start)}/TB[b${i}]`);
      graph.push(`[${current}][b${i}]overlay=eof_action=pass:enable='between(t,${sec(b.start)},${sec(b.start + b.duration - 0.5 / m.fps)})'[lb${i}]`);
      current = `lb${i}`;
    });
    t.overlays.forEach((o, i) => {
      const idx = add(['-framerate', String(m.fps), '-i', rendered.get(`o${t.index}-${i}`).pattern]);
      graph.push(`[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${sec(o.start)}/TB[o${i}]`);
      graph.push(`[${current}][o${i}]overlay=eof_action=pass:format=yuv444:enable='between(t,${sec(o.start)},${sec(o.start + o.duration - 0.5 / m.fps)})'[lo${i}]`);
      current = `lo${i}`;
    });
    graph.push(`[${current}]format=yuv420p[v]`);
    await ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-frames:v', String(t.frames), '-an', ...vcodec, name], execute, work);
    if (s.audio) {
      const fadeIn = s.audio.fadeIn ?? Math.max(0.012, timeline[t.index - 1]?.transition?.duration ?? 0);
      const fadeOut = s.audio.fadeOut ?? Math.max(0.012, t.transition?.duration ?? 0);
      await ffmpeg(['-ss', sec(s.in ?? 0), '-t', sec(s.duration), '-i', asset.path, '-vn',
        '-af', `aresample=48000,aformat=channel_layouts=stereo,volume=${s.audio.gainDb ?? 0}dB,apad,atrim=0:${sec(s.duration)},` +
          `afade=t=in:d=${sec(fadeIn)},afade=t=out:st=${sec(Math.max(0, s.duration - fadeOut))}:d=${sec(fadeOut)}`,
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', `scene-${pad3(t.index + 1)}.wav`], execute, work);
    }
  });

  // 3. Join runs: scenes separated by hard cuts are stream-copied together; transitions use xfade.
  const runs = [[]];
  for (const t of timeline) { runs.at(-1).push(t); if (t.transition) runs.push([]); }
  const runFiles = [];
  for (const [ri, list] of runs.entries()) {
    if (list.length === 1) { runFiles.push({ file: `scene-${pad3(list[0].index + 1)}.mp4`, frames: list[0].frames, list }); continue; }
    const concat = `run-${pad3(ri + 1)}.txt`;
    await writeFile(path.join(work, concat), list.map(t => `file 'scene-${pad3(t.index + 1)}.mp4'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', `run-${pad3(ri + 1)}.mp4`], execute, work);
    runFiles.push({ file: `run-${pad3(ri + 1)}.mp4`, frames: list.reduce((n, t) => n + t.frames, 0), list });
  }

  // 4. Audio mix with stems
  log('Mixing audio (voice, music with ducking, SFX)...');
  const audio = m.audio || {};
  const aIn = [];
  const aAdd = args => { aIn.push(...args); return aIn.filter(a => a === '-i').length - 1; };
  const ag = [];
  const D = sec(duration);
  const norm = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const voiceParts = [];
  if (audio.narration) {
    const i = aAdd(['-i', assets.get(audio.narration.asset).path]);
    const delay = Math.round((audio.narration.start ?? 0) * 1000);
    ag.push(`[${i}:a]${norm},volume=${audio.narration.gainDb ?? 0}dB,adelay=${delay}:all=1[n0]`);
    voiceParts.push('[n0]');
  }
  for (const t of timeline) {
    if (!t.scene.audio) continue;
    const i = aAdd(['-i', path.join(work, `scene-${pad3(t.index + 1)}.wav`)]);
    ag.push(`[${i}:a]${norm},adelay=${Math.round(t.start * 1000)}:all=1[s${t.index}]`);
    voiceParts.push(`[s${t.index}]`);
  }
  const silence = label => { ag.push(`anullsrc=r=48000:cl=stereo,atrim=0:${D}[${label}]`); return `[${label}]`; };
  const bus = (parts, label) => {
    if (!parts.length) return silence(label);
    ag.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=longest,apad=whole_dur=${D},atrim=0:${D}[${label}]`);
    return `[${label}]`;
  };
  bus(voiceParts, 'voice');
  const musicParts = (audio.music || []).map((bed, k) => {
    const start = bed.start ?? 0, end = bed.end ?? duration, len = end - start;
    const i = aAdd([...(bed.loop !== false ? ['-stream_loop', '-1'] : []), '-i', assets.get(bed.asset).path]);
    const fi = bed.fadeIn ?? 1, fo = Math.min(bed.fadeOut ?? 2, len / 2);
    ag.push(`[${i}:a]${norm},atrim=start=${sec(bed.in ?? 0)}:duration=${sec(len)},asetpts=PTS-STARTPTS,volume=${bed.gainDb ?? -18}dB,` +
      `afade=t=in:d=${sec(Math.min(fi, len / 2))},afade=t=out:st=${sec(Math.max(0, len - fo))}:d=${sec(fo)},adelay=${Math.round(start * 1000)}:all=1[m${k}]`);
    return `[m${k}]`;
  });
  bus(musicParts, 'musicraw');
  const ducking = (audio.ducking?.enabled ?? true) && voiceParts.length && musicParts.length;
  if (ducking) {
    const amount = audio.ducking?.amountDb ?? 12;
    ag.push(`[voice]asplit=2[voiceout][voicesc]`);
    ag.push(`[musicraw][voicesc]sidechaincompress=threshold=0.015:ratio=${Math.min(20, 1 + amount / 1.5).toFixed(2)}:attack=20:release=400:knee=4[music]`);
  } else {
    ag.push('[voice]anull[voiceout]', '[musicraw]anull[music]');
  }
  const sfxParts = (audio.sfx || []).map((fx, k) => {
    const i = aAdd(['-i', assets.get(fx.asset).path]);
    ag.push(`[${i}:a]${norm},volume=${fx.gainDb ?? -6}dB,adelay=${Math.round(fx.at * 1000)}:all=1[x${k}]`);
    return `[x${k}]`;
  });
  bus(sfxParts, 'sfx');
  ag.push('[voiceout]asplit=2[vstem][vmix]', '[music]asplit=2[mstem][mmix]', '[sfx]asplit=2[xstem][xmix]');
  ag.push(`[vmix][mmix][xmix]amix=inputs=3:normalize=0:duration=longest,atrim=0:${D}[mix]`);
  const pcm = ['-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le'];
  if (!aIn.length) aIn.push('-f', 'lavfi', '-t', D, '-i', 'anullsrc=r=48000:cl=stereo');
  await ffmpeg([...aIn, '-filter_complex', ag.join(';'),
    '-map', '[vstem]', ...pcm, path.join(output, 'stems', 'voice.wav'),
    '-map', '[mstem]', ...pcm, path.join(output, 'stems', 'music.wav'),
    '-map', '[xstem]', ...pcm, path.join(output, 'stems', 'sfx.wav'),
    '-map', '[mix]', ...pcm, 'mix.wav'], execute, work);

  // 5. Two-pass loudness mastering to the delivery target
  const target = loaded.delivery;
  const measured = await measureLoudness(path.join(work, 'mix.wav'), execute, target);
  const master = path.join(output, 'stems', 'master.wav');
  if (Number.isFinite(measured.input_i) && measured.input_i > -70) {
    // Gain to target, then an oversampled peak limiter; a second corrective pass absorbs limiter loss.
    const ceiling = Math.pow(10, (target.truePeak - 0.8) / 20).toFixed(4);
    const limit = gain => `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${ceiling}:level=false:attack=1:release=60:latency=1,aresample=48000`;
    let gain = target.targetLufs - measured.input_i;
    const pass = path.join(work, 'master-pass1.wav');
    await ffmpeg(['-i', path.join(work, 'mix.wav'), '-af', limit(gain), ...pcm, pass], execute, work);
    const check1 = await measureLoudness(pass, execute, target);
    if (Math.abs(check1.input_i - target.targetLufs) > 0.3) gain += target.targetLufs - check1.input_i;
    await ffmpeg(['-i', path.join(work, 'mix.wav'), '-af', limit(gain), ...pcm, master], execute, work);
  } else {
    await copyFile(path.join(work, 'mix.wav'), master);
  }

  // 6. Final encode: transitions + captions + global overlays + mastered audio in one pass
  log('Encoding final video...');
  const fIn = [];
  const fAdd = args => { fIn.push(...args); return fIn.filter(a => a === '-i').length - 1; };
  const fg = [];
  runFiles.forEach(r => { const i = fAdd(['-i', r.file]); fg.push(`[${i}:v]fps=${m.fps},settb=AVTB,setsar=1,format=yuv420p[r${i}]`); });
  let cur = 'r0';
  let length = runFiles[0].frames;
  for (let i = 1; i < runFiles.length; i++) {
    const tr = runFiles[i - 1].list.at(-1).transition;
    const d = Math.round(tr.duration * m.fps);
    fg.push(`[${cur}][r${i}]xfade=transition=${tr.type}:duration=${sec(d / m.fps)}:offset=${sec((length - d) / m.fps)}[x${i}]`);
    cur = `x${i}`;
    length += runFiles[i].frames - d;
  }
  check(length === totalFrames, `internal frame accounting mismatch (${length} vs ${totalFrames})`);
  const overlaysFinal = [];
  (m.globalOverlays || []).forEach((o, i) => overlaysFinal.push({ key: `global-${i}`, start: o.start, duration: o.duration }));
  if (rendered.has('captions')) overlaysFinal.push({ key: 'captions', start: 0, duration });
  if (overlaysFinal.length) fg.push(`[${cur}]format=yuv444p[base]`), cur = 'base';
  overlaysFinal.forEach((o, k) => {
    const i = fAdd(['-framerate', String(m.fps), '-i', rendered.get(o.key).pattern]);
    fg.push(`[${i}:v]format=rgba,setpts=PTS-STARTPTS+${sec(o.start)}/TB[g${k}]`);
    fg.push(`[${cur}][g${k}]overlay=eof_action=pass:format=yuv444:enable='between(t,${sec(o.start)},${sec(o.start + o.duration - 0.5 / m.fps)})'[go${k}]`);
    cur = `go${k}`;
  });
  fg.push(`[${cur}]format=yuv420p[vout]`);
  const ai = fAdd(['-i', master]);
  const finalFile = path.join(output, 'final.mp4');
  await ffmpeg([...fIn, '-filter_complex', fg.join(';'), '-map', '[vout]', '-map', `${ai}:a`, '-frames:v', String(totalFrames),
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : target.preset, '-crf', String(draft ? 26 : target.crf), '-pix_fmt', 'yuv420p',
    '-r', String(m.fps), '-g', String(m.fps * 2), '-c:a', 'aac', '-b:a', `${target.audioBitrate}k`, '-ar', '48000',
    '-movflags', '+faststart', '-metadata', `title=${m.title}`, '-shortest', finalFile], execute, work);

  // 7. Deliverables
  log('Writing captions, chapters, thumbnail, contact sheet and verification...');
  if (captionPages) {
    await writeNew(path.join(output, 'captions.srt'), pagesToSrt(captionPages));
    await writeNew(path.join(output, 'captions.vtt'), pagesToVtt(captionPages));
  }
  const chapterList = chapters(loaded);
  if (chapterList.length) await writeNew(path.join(output, 'chapters.txt'), `${chapterList.map(c => c.label).join('\n')}\n`);
  await thumbnail(loaded, output, finalFile, execute);
  await contactSheet(loaded, output, finalFile, execute);
  await writeNew(path.join(output, 'timeline.xml'), timelineXml(loaded, work, output));
  const verification = await verifyMedia(finalFile, loaded, execute);
  const credits = [...assets.values()].map(({ id, rights, attribution, sourceUrl }) => ({ id, rights, attribution, sourceUrl }));
  await writeNew(path.join(output, 'CREDITS.txt'), credits.map(a => `${a.attribution} — ${a.rights}${a.sourceUrl ? ` (${a.sourceUrl})` : ''}`).join('\n') + '\n');
  const report = {
    version: 2, status: verification.passed ? 'technical-checks-passed-needs-human-review' : 'failed-technical-checks',
    fingerprint: loaded.fingerprint, quality, renderSeconds: Math.round((Date.now() - started) / 1000),
    outputs: { video: 'final.mp4', captions: captionPages ? ['captions.srt', 'captions.vtt'] : [], chapters: chapterList.length ? 'chapters.txt' : null,
      thumbnail: 'thumbnail.png', contactSheet: 'contact-sheet.png', stems: ['stems/voice.wav', 'stems/music.wav', 'stems/sfx.wav', 'stems/master.wav'],
      resolveTimeline: 'timeline.xml' },
    timeline: { duration, frames: totalFrames, scenes: timeline.length, transitions: runFiles.length - 1, motionGraphics: jobs.length },
    verification,
    humanReview: { facts: 'NOT VERIFIED', captionsWording: captionPages ? 'NOT VERIFIED' : 'N/A', rights: 'USER ATTESTED', wholeVideoPlayback: 'NOT VERIFIED' },
    credits
  };
  await writeJson(path.join(output, 'report.json'), report);
  await writeNew(path.join(output, 'REVIEW.txt'), [
    `${m.title} — ${verification.passed ? 'technical checks PASSED' : 'technical checks FAILED'}`,
    `final.mp4: ${verification.measured.width}x${verification.measured.height} @ ${verification.measured.fps}fps, ${verification.measured.duration.toFixed(2)}s, ` +
      `${verification.measured.integratedLufs} LUFS, ${verification.measured.truePeakDb} dBTP`,
    '', 'Before publishing, a human must:',
    '- Watch and listen to final.mp4 end to end (contact-sheet.png gives a quick per-scene overview).',
    '- Check every number, label and citation in charts and diagrams.',
    ...(captionPages ? ['- Proofread captions (captions.srt/.vtt are also provided for platform upload).'] : []),
    '- Confirm rights/attribution for every asset (CREDITS.txt).',
    ...(chapterList.length ? ['- Paste chapters.txt into the video description (YouTube chapters).'] : []),
    'Optional: import timeline.xml into DaVinci Resolve for manual finishing; stems/ holds voice, music, SFX and the master.'
  ].join('\n') + '\n');
  await copyFile(path.resolve(file), path.join(output, 'production.json'));
  if (!keepWork) await rm(path.join(work, 'motion'), { recursive: true, force: true });
  log(`Done in ${report.renderSeconds}s: ${finalFile}`);
  return report;
}

export async function measureLoudness(media, execute = run, target = { targetLufs: -14, truePeak: -1 }) {
  const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', media, '-vn',
    '-af', `loudnorm=I=${target.targetLufs}:TP=${target.truePeak}:LRA=11:print_format=json`, '-f', 'null', '-'], { timeout: 6 * 3600_000 });
  const match = String(stderr).match(/\{\s*"input_i"[\s\S]*?\}/);
  check(match, 'loudness measurement unavailable');
  const values = JSON.parse(match[0]);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number.isFinite(Number(v)) ? Number(v) : v === '-inf' ? -Infinity : v]));
}

export async function verifyMedia(media, loaded, execute = run) {
  const m = loaded.manifest;
  const info = await inspectMedia(media, execute);
  const [num, den] = (info.video?.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = num / den;
  await execute(tool('ffmpeg'), ['-v', 'error', '-nostdin', '-i', media, '-f', 'null', '-'], { timeout: 6 * 3600_000 });
  const loud = await measureLoudness(media, execute, loaded.delivery);
  const silent = !(loud.input_i > -70);
  const checks = {
    decode: 'PASS',
    dimensions: info.video?.width === m.width && info.video?.height === m.height ? 'PASS' : 'FAIL',
    fps: Math.abs(fps - m.fps) < 0.001 ? 'PASS' : 'FAIL',
    duration: Math.abs(info.duration - loaded.duration) <= 2 / m.fps + 0.05 ? 'PASS' : 'FAIL',
    audioPresent: info.audio ? 'PASS' : 'FAIL',
    loudness: silent ? 'SILENT' : Math.abs(loud.input_i - loaded.delivery.targetLufs) <= 1 ? 'PASS' : 'FAIL',
    truePeak: silent ? 'SILENT' : loud.input_tp <= loaded.delivery.truePeak + 0.3 ? 'PASS' : 'FAIL'
  };
  return {
    passed: !Object.values(checks).includes('FAIL'), checks, sha256: await digest(media),
    measured: { width: info.video?.width, height: info.video?.height, fps, duration: info.duration,
      integratedLufs: silent ? null : loud.input_i, truePeakDb: silent ? null : loud.input_tp },
    targets: { integratedLufs: loaded.delivery.targetLufs, toleranceLu: 1, maxTruePeakDb: loaded.delivery.truePeak }
  };
}

async function thumbnail(loaded, output, finalFile, execute) {
  const m = loaded.manifest;
  const spec = loaded.delivery.thumbnail;
  const out = path.join(output, 'thumbnail.png');
  if (spec?.template) {
    const renderer = new MotionRenderer();
    try {
      const r = await renderer.render({ ...motionJob(loaded, { template: spec.template, props: spec.props }, 2, false), exit: false }, path.join(output, 'work', 'motion'));
      await copyFile(path.join(r.dir, `frame-${String(r.frames).padStart(6, '0')}.png`), out);
    } finally { await renderer.close(); }
    return;
  }
  const firstGraphic = loaded.timeline.find(t => t.scene.kind === 'graphic');
  const time = spec?.time ?? (firstGraphic ? firstGraphic.start + Math.min(2, firstGraphic.scene.duration * 0.7) : loaded.duration * 0.1);
  await ffmpeg(['-ss', sec(Math.min(time, loaded.duration - 1 / m.fps)), '-i', finalFile, '-frames:v', '1', '-update', '1', out], execute, output);
}

async function contactSheet(loaded, output, finalFile, execute) {
  const m = loaded.manifest;
  const picks = loaded.timeline.slice(0, 60).map(t => t.startFrame + Math.floor(t.frames / 2));
  const cols = Math.min(6, picks.length), rows = Math.ceil(picks.length / cols);
  const tileW = m.width >= m.height ? 384 : 216;
  const select = picks.map(f => `eq(n\\,${f})`).join('+');
  await ffmpeg(['-i', finalFile, '-vf', `select='${select}',scale=${tileW}:-2,tile=${cols}x${rows}:padding=4:color=0x111111`,
    '-frames:v', '1', '-update', '1', '-fps_mode', 'passthrough', path.join(output, 'contact-sheet.png')], execute, output);
}

function timelineXml(loaded, work, output) {
  const m = loaded.manifest;
  const esc = v => String(v).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  const rate = `<rate><timebase>${m.fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  // Alternate scenes across two video tracks so transition overlaps never collide.
  const tracks = [[], []];
  loaded.timeline.forEach((t, i) => {
    const file = path.join(work, `scene-${pad3(t.index + 1)}.mp4`);
    tracks[i % 2].push(`<clipitem id="scene-${t.index + 1}"><name>${esc(t.scene.id || `scene ${t.index + 1}`)}</name><duration>${t.frames}</duration>${rate}` +
      `<start>${t.startFrame}</start><end>${t.startFrame + t.frames}</end><in>0</in><out>${t.frames}</out>` +
      `<file id="scene-file-${t.index + 1}"><name>${path.basename(file)}</name><pathurl>${esc(pathToFileURL(file).href)}</pathurl>${rate}<duration>${t.frames}</duration>` +
      `<media><video><samplecharacteristics><width>${m.width}</width><height>${m.height}</height></samplecharacteristics></video></media></file></clipitem>`);
  });
  const audioTracks = ['voice', 'music', 'sfx'].map((stem, i) => {
    const file = path.join(output, 'stems', `${stem}.wav`);
    return `<track><clipitem id="stem-${stem}"><name>${stem}.wav</name><duration>${loaded.totalFrames}</duration>${rate}<start>0</start><end>${loaded.totalFrames}</end>` +
      `<in>0</in><out>${loaded.totalFrames}</out><file id="stem-file-${i}"><name>${stem}.wav</name><pathurl>${esc(pathToFileURL(file).href)}</pathurl>${rate}` +
      `<duration>${loaded.totalFrames}</duration><media><audio><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics>` +
      '<channelcount>2</channelcount></audio></media></file><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem></track>';
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence><name>${esc(m.title)}</name><duration>${loaded.totalFrames}</duration>${rate}` +
    `<media><video><format><samplecharacteristics>${rate}<width>${m.width}</width><height>${m.height}</height><anamorphic>FALSE</anamorphic>` +
    `<pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${tracks.filter(t => t.length).map(t => `<track>${t.join('')}</track>`).join('')}</video>` +
    `<audio>${audioTracks}</audio></media></sequence></xmeml>\n`;
}
