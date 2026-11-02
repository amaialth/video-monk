// Render a single template to a reviewable file: .mp4 (opaque), .mov (ProRes 4444 with alpha) or .png (final still).
import path from 'node:path';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { exists, readJson, run } from '../core.js';
import { MotionRenderer } from './render.js';
import { validateProps } from './templates.js';

export async function renderGraphic(options, execute = run) {
  const { template, html, output } = options;
  const ext = path.extname(output).toLowerCase();
  if (!['.mp4', '.mov', '.png'].includes(ext)) throw new Error('Graphic: output must end in .mp4, .mov (alpha) or .png (still)');
  if (await exists(output)) throw new Error(`Graphic: output already exists: ${output}`);
  const props = typeof options.props === 'string'
    ? (options.props.trim().startsWith('{') ? JSON.parse(options.props) : await readJson(options.props)) : options.props ?? {};
  if (template) validateProps(template, props);
  const theme = options.theme ? await readJson(options.theme) : undefined;
  const transparent = ext === '.mov' || options.background === 'transparent';
  const job = {
    template, html: html ? path.resolve(html) : undefined, props, width: options.width ?? 1920, height: options.height ?? 1080,
    fps: options.fps ?? 30, duration: options.seconds ?? 5, theme, font: options.font ? path.resolve(options.font) : null,
    placement: options.placement, background: transparent ? 'transparent' : options.background || 'grid', exit: ext !== '.png' && options.exit !== false
  };
  const work = await mkdtemp(path.join(tmpdir(), 'video-monk-graphic-'));
  const renderer = new MotionRenderer();
  try {
    const r = await renderer.render(job, work);
    if (ext === '.png') {
      const at = Math.min(r.frames, Math.max(1, Math.round((options.at ?? job.duration) * job.fps)));
      await copyFile(path.join(r.dir, `frame-${String(at).padStart(6, '0')}.png`), output);
    } else {
      const codec = ext === '.mov'
        ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le']
        : ['-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      await execute(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-framerate', String(job.fps), '-i', r.pattern, '-frames:v', String(r.frames), ...codec, path.resolve(output)]);
    }
    return { output: path.resolve(output), frames: r.frames, captured: r.captured };
  } finally {
    await renderer.close();
    await rm(work, { recursive: true, force: true });
  }
}
