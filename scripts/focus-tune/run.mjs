// Tune `focus --detect` against a scripted screen recording whose events are known (app.html + truth.json), or against your own recording.
//   node scripts/focus-tune/run.mjs                      render the simulated app, encode it at three qualities, score the detector over a sensitivity sweep
//   node scripts/focus-tune/run.mjs rec.mkv --align      score a real OBS recording of the live session (node scripts/focus-tune/serve.mjs): the magenta flash lines it up
//   node scripts/focus-tune/run.mjs my.mp4 truth.json    score a recording whose events you listed in a truth file (same format)
// A detection counts as a hit when it lands within -0.5/+0.9 s of an event and 0.22 of the frame from its position; "neutral" events (a modal closing, a scroll)
// are neither hits nor false alarms. This script needs Chrome (to render the simulation) and ffmpeg. Dev tool: not shipped in the package.
import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/core.js';
import { findActivity } from '../../src/focus.js';
import { locateSyncFlash, FLASH_AT } from './align.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), align = argv.includes('--align'), detailAt = argv.includes('--detail') ? Number(argv[argv.indexOf('--detail') + 1]) : null;
const [mediaArg, truthArg] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--detail'));
const truth = JSON.parse(await readFile(truthArg || path.join(here, 'truth.json'), 'utf8'));

async function frames(media) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', media, '-an', '-vf', 'fps=5,scale=128:72:flags=area,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 });
  return stdout;
}
let offset = 0, page = { x: 0, y: 0, w: 1, h: 1 };   // recording time minus page time, and where the page sits in the frame, both from the sync flash (identity for the simulation)
const inPage = c => ({ ...c, at: c.at - offset, x: +((c.x - page.x) / page.w).toFixed(3), y: +((c.y - page.y) / page.h).toFixed(3) });
function score(found) {
  found = found.map(inPage).filter(c => c.at >= 0.4 && c.at <= 25);   // only the scripted window counts (not what was on screen before Start or after Done)
  const win = (e, c) => c.at >= e.at - 0.5 && c.at <= e.at + 0.9;
  const hit = truth.events.filter(e => found.some(c => win(e, c) && Math.hypot(c.x - e.x, c.y - e.y) < (align ? 0.3 : 0.22))).length;
  const neutral = found.filter(c => (truth.neutral || []).some(n => win(n, c)));
  const matched = found.filter(c => truth.events.some(e => win(e, c)));
  const false_ = found.filter(c => !matched.includes(c) && !neutral.includes(c));
  return `found ${String(found.length).padEnd(3)} hit ${hit}/${truth.events.length}  false ${false_.length}${false_.length ? ' at ' + JSON.stringify(false_.map(c => c.at)) : ''}`;
}
// Per-event view: which scripted events were found (and where), which were missed, and what else was proposed.
function detail(found) {
  found = found.map(inPage).filter(c => c.at >= 0.4 && c.at <= 25);
  const win = (e, c) => c.at >= e.at - 0.5 && c.at <= e.at + 0.9;
  console.log(`\n  per event at sensitivity ${detailAt}:`);
  for (const e of truth.events) { const c = found.find(c => win(e, c)); console.log(`    ${c ? 'found  ' : 'MISSED '} ${e.name.padEnd(16)} expected ${e.at.toFixed(1)} s (${e.x}, ${e.y})${c ? `  got ${c.at.toFixed(1)} s (${c.x}, ${c.y}) strength ${(c.strength * 100).toFixed(2)}%` : ''}`); }
  for (const c of found.filter(c => !truth.events.some(e => win(e, c)))) { const n = (truth.neutral || []).find(n => win(n, c)); console.log(`    ${n ? 'neutral' : 'FALSE  '} ${(n ? n.name : 'not in the script').padEnd(16)} at ${c.at.toFixed(1)} s (${c.x}, ${c.y}) strength ${(c.strength * 100).toFixed(2)}%`); }
}
async function sweep(label, media) {
  const data = await frames(media);
  console.log(`\n${label}`);
  for (const sensitivity of [0.6, 0.8, 1, 1.3, 1.7, 2.2]) console.log(`  sensitivity ${String(sensitivity).padEnd(4)} ${score(findActivity(data, { width: 128, height: 72, sensitivity, minGap: 2, max: 50 }))}`);
  if (detailAt !== null) detail(findActivity(data, { width: 128, height: 72, sensitivity: detailAt, minGap: 2, max: 50 }));
}

if (mediaArg) {
  const media = path.resolve(mediaArg);
  if (align) {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', media, '-an', '-vf', 'fps=10,scale=128:72:flags=area', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 });
    const flash = locateSyncFlash(stdout, { width: 128, height: 72, fps: 10, share: 0.15 });
    if (flash === null) { console.error('The magenta sync flash was not found. Start recording before you press Start on the page, and capture the whole page.'); process.exit(1); }
    offset = flash.t - FLASH_AT; page = flash.rect;
    console.log(`Sync flash found at ${flash.t.toFixed(1)} s in the recording: the script started ${offset.toFixed(1)} s in. The page fills ${(page.w * 100).toFixed(0)}% x ${(page.h * 100).toFixed(0)}% of the frame, starting at (${(page.x * 100).toFixed(0)}%, ${(page.y * 100).toFixed(0)}%).`);
  }
  await sweep(mediaArg, media);
}
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
