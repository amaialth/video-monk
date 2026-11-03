// Tune `focus --detect` against a scripted screen recording whose events are known (app.html + truth.json), or against your own recording.
//   node scripts/focus-tune/run.mjs                      render the simulated app, encode it at three qualities, score the detector over a sensitivity sweep
//   node scripts/focus-tune/run.mjs my.mp4 truth.json    score a real recording whose events you listed in a truth file (same format)
// A detection counts as a hit when it lands within -0.5/+0.9 s of an event and 0.22 of the frame from its position; "neutral" events (a modal closing, a scroll)
// are neither hits nor false alarms. This script needs Chrome (to render the simulation) and ffmpeg. Dev tool: not shipped in the package.
import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/core.js';
import { findActivity } from '../../src/focus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [,, mediaArg, truthArg] = process.argv;
const truth = JSON.parse(await readFile(truthArg || path.join(here, 'truth.json'), 'utf8'));

async function frames(media) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', media, '-an', '-vf', 'fps=5,scale=128:72:flags=area,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 });
  return stdout;
}
function score(found) {
  const win = (e, c) => c.at >= e.at - 0.5 && c.at <= e.at + 0.9;
  const hit = truth.events.filter(e => found.some(c => win(e, c) && Math.hypot(c.x - e.x, c.y - e.y) < 0.22)).length;
  const neutral = found.filter(c => (truth.neutral || []).some(n => win(n, c)));
  const matched = found.filter(c => truth.events.some(e => win(e, c)));
  const false_ = found.filter(c => !matched.includes(c) && !neutral.includes(c));
  return `found ${String(found.length).padEnd(3)} hit ${hit}/${truth.events.length}  false ${false_.length}${false_.length ? ' at ' + JSON.stringify(false_.map(c => c.at)) : ''}`;
}
async function sweep(label, media) {
  const data = await frames(media);
  console.log(`\n${label}`);
  for (const sensitivity of [0.6, 0.8, 1, 1.3, 1.7, 2.2]) console.log(`  sensitivity ${String(sensitivity).padEnd(4)} ${score(findActivity(data, { width: 128, height: 72, sensitivity, minGap: 1.5, max: 50 }))}`);
}

if (mediaArg) await sweep(mediaArg, path.resolve(mediaArg));
else {
  const { MotionRenderer } = await import('../../src/motion/render.js');
  const work = path.join(os.tmpdir(), `video-monk-focus-tune-${process.pid}`);
  await mkdir(work, { recursive: true });
  const r = new MotionRenderer(); await r.start();
  const res = await r.render({ html: path.join(here, 'app.html'), width: 1280, height: 720, fps: 15, duration: 24, background: 'plain', exit: false, theme: { preset: 'paper' } }, work);
  await r.close();
  for (const crf of [22, 30, 36]) {
    const out = path.join(work, `sim-crf${crf}.mp4`);
    await run('ffmpeg', ['-v', 'error', '-y', '-framerate', '15', '-i', res.pattern, '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-g', '60', out]);
    await sweep(`simulated app, compressed at crf ${crf}`, out);
  }
  await rm(work, { recursive: true, force: true });
}
