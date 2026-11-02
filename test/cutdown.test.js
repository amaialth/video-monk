import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson, readJson } from '../src/core.js';
import { cutdownManifest, snapToSentence, pickHighlight } from '../src/cutdown.js';
import { resolveBrief, QUESTIONS, briefToAutoOptions } from '../src/brief.js';
import { reviewProduction, buildProduction } from '../src/production.js';
import { MotionRenderer } from '../src/motion/render.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-cutdown-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);

const word = (text, start) => ({ text, start, end: start + 0.4 });
const longManifest = () => ({ version: 2, title: 'Long', fps: 24, width: 640, height: 360,
  assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
  scenes: [
    { id: 's1', kind: 'video', asset: 'rec', in: 0, duration: 4, fit: 'cover', audio: {}, purpose: 'a', overlays: [{ template: 'kinetic-text', props: { text: 'Hi' }, start: 1, duration: 2, placement: 'strip-top' }] },
    { id: 's2', kind: 'video', asset: 'rec', in: 4, duration: 4, fit: 'cover', audio: {}, purpose: 'b' },
    { id: 's3', kind: 'video', asset: 'rec', in: 8, duration: 4, fit: 'cover', audio: {}, purpose: 'c' }],
  globalOverlays: [{ template: 'panel-test', props: {}, start: 5, duration: 2, placement: 'left', layout: 'split' }],
  captions: { words: 'words.json', style: 'kinetic', maxWords: 7 }, audio: { music: [{ asset: 'rec', start: 0, end: 12, in: 0 }] } });

test('cutdown reformats to 9:16, slices a window, shifts captions and drops what straddles the edge', async t => {
  const folder = await temporary(t);
  await writeJson(path.join(folder, 'long.json'), longManifest());
  const words = [word('Alpha', 0.5), word('beta.', 1), word('Gamma', 4.5), word('delta', 5), word('end.', 5.5), word('Later', 9)];
  await writeJson(path.join(folder, 'words.json'), words);
  const out = path.join(folder, 'short.json');
  const r = await cutdownManifest(path.join(folder, 'long.json'), out, { aspect: '9:16', from: 4, to: 8, width: 540 });
  assert.deepEqual([r.width, r.height], [540, 960]);
  assert.equal(r.scenes, 1);
  const m = await readJson(out);
  assert.equal(m.scenes[0].in, 4); assert.equal(m.scenes[0].duration, 4); assert.equal(m.scenes[0].fit, 'blur');
  assert.equal(m.globalOverlays[0].start, 1); assert.equal(m.globalOverlays[0].layout, undefined, 'split layout is dropped for vertical');
  assert.deepEqual(m.audio.music.map(b => [b.start, b.end, b.in]), [[0, 4, 4]]);
  const kept = await readJson(path.join(folder, m.captions.words));
  assert.deepEqual(kept.map(w => w.text), ['Gamma', 'delta', 'end.']);
  assert.equal(kept[0].start, 0.5);
  await assert.rejects(cutdownManifest(path.join(folder, 'long.json'), out, { aspect: '9:16' }), /already exists/);
  await assert.rejects(cutdownManifest(path.join(folder, 'long.json'), path.join(folder, 'x.json'), { aspect: '2:1' }), /aspect must be/);
});

test('cutdown ends a clip on a sentence and proposes a highlight; long shorts are warned about', async t => {
  const words = [word('One', 0), word('two.', 1), word('Three', 2), word('four', 3), word('five.', 4), word('Six', 5), word('7', 6), word('seven.', 7)];
  assert.equal(snapToSentence(words, 0, 5.2), 4.4);
  const pick = pickHighlight(words, [5.2], 6.5, 8);
  assert.equal(pick.from, 2, `highlight should favour the part with a graphic: ${JSON.stringify(pick)}`);
  const folder = await temporary(t);
  const long = longManifest(); long.scenes[0].duration = 200; delete long.globalOverlays; long.scenes[0].overlays = [];
  await writeJson(path.join(folder, 'long.json'), long);
  await writeJson(path.join(folder, 'words.json'), words);
  const r = await cutdownManifest(path.join(folder, 'long.json'), path.join(folder, 'short.json'), { aspect: '9:16' });
  assert.ok(r.warnings.some(w => /Shorts limit/.test(w)));
});

test('brief: every deliverable resolves, vertical questions apply only to vertical, bad answers are refused', () => {
  assert.ok(QUESTIONS.find(q => q.id === 'deliverable').options.length === 4);
  const long = resolveBrief({ deliverable: 'long', content: 'talking-head' });
  assert.equal(long.primaryFormat, 'landscape'); assert.equal(long.shortSelection, undefined); assert.equal(long.pace, 'tight');
  const short = resolveBrief({ deliverable: 'short', content: 'screen' });
  assert.equal(short.primaryFormat, 'vertical'); assert.equal(short.fit, 'blur');
  const both = resolveBrief({ deliverable: 'both', content: 'talking-head', shortLength: '30' });
  assert.equal(both.primaryFormat, 'landscape'); assert.equal(both.fit, undefined); assert.equal(both.shortFit, 'cover');
  assert.deepEqual(briefToAutoOptions(both).shortMax, 30);
  assert.equal(resolveBrief({ deliverable: 'feed' }).primaryFormat, 'square');
  assert.throws(() => resolveBrief({ deliverable: 'wide' }), /deliverable must be/);
  assert.throws(() => resolveBrief({ deliverable: 'short', shortPick: 'range', shortFrom: 10, shortTo: 5 }), /time range/);
});

test('graphic audit flags text off the canvas, tiny text and low contrast, and accepts good text', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(folder, 't.html'), `<!doctype html><html><body style="margin:0;background:#0b1020">
<div style="position:absolute;left:300px;top:50px;font-size:40px;color:#fff;white-space:nowrap">Runs off the right edge of a small frame</div>
<div style="position:absolute;left:20px;top:150px;font-size:5px;color:#fff">tiny text here</div>
<div style="position:absolute;left:20px;top:200px;font-size:40px;color:#223355">low contrast</div>
<div style="position:absolute;left:20px;top:280px;font-size:40px;color:#fff">Fine text</div>
<script>window.__seek=()=>{};window.__vmReady=true;</script></body></html>`);
  const r = new MotionRenderer(); await r.start();
  try {
    const out = await r.render({ html: path.join(folder, 't.html'), width: 640, height: 360, fps: 5, duration: 1, audit: true, theme: {} }, path.join(folder, 'cache'));
    const kinds = out.audit.map(i => `${i.kind}:${i.text}`);
    assert.ok(kinds.some(k => k.startsWith('offcanvas:Runs off')), JSON.stringify(out.audit));
    assert.ok(kinds.some(k => k.startsWith('small:tiny')));
    assert.ok(kinds.some(k => k.startsWith('contrast:low')));
    assert.ok(!kinds.some(k => k.includes('Fine text')));
  } finally { await r.close(); }
});

test('a vertical build with the blurred-background fit shows the whole landscape picture', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  // four vertical stripes: green | red | blue | yellow. A centre crop to 9:16 would lose green and yellow; blur-fit keeps them.
  await ff(['-filter_complex', 'color=c=0x00ff00:s=80x180:d=2:r=24[a];color=c=0xff0000:s=80x180:d=2:r=24[b];color=c=0x0000ff:s=80x180:d=2:r=24[c];color=c=0xffff00:s=80x180:d=2:r=24[d];[a][b][c][d]hstack=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'wide.mp4')]);
  const manifest = fit => ({ version: 2, title: fit, fps: 24, width: 180, height: 320, assets: [{ id: 'rec', path: 'wide.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'video', asset: 'rec', in: 0, duration: 1, fit, purpose: 'x' }] });
  const pixel = async (file, x, y) => {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', `scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    return [...stdout];
  };
  const results = {};
  for (const fit of ['blur', 'cover']) {
    const file = path.join(folder, `${fit}.json`);
    await writeJson(file, manifest(fit));
    await reviewProduction(file, path.join(folder, `${fit}-r.json`), true);
    await buildProduction(file, path.join(folder, `${fit}-r.json`), path.join(folder, `${fit}-out`), true, undefined, undefined, { quality: 'draft' });
    results[fit] = [await pixel(path.join(folder, `${fit}-out`, 'final.mp4'), 6, 160), await pixel(path.join(folder, `${fit}-out`, 'final.mp4'), 173, 160)];
  }
  const [leftBlur, rightBlur] = results.blur;
  assert.ok(leftBlur[1] > 150 && leftBlur[0] < 90, `blur-fit keeps the green stripe: ${leftBlur}`);
  assert.ok(rightBlur[0] > 150 && rightBlur[1] > 150 && rightBlur[2] < 90, `blur-fit keeps the yellow stripe: ${rightBlur}`);
  const [leftCover] = results.cover;
  assert.ok(!(leftCover[1] > 150 && leftCover[0] < 90), `a centre crop loses the green stripe: ${leftCover}`);
});
