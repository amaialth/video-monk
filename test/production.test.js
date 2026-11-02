import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeNew, writeJson, readJson, exists, run } from '../src/core.js';
import { loadProduction, reviewProduction, buildProduction, inspectMedia, verifyProduction } from '../src/production.js';
import { searchStock, downloadStock } from '../src/stock.js';

async function temporary(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'video-monk-production-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

function manifest() {
  return {
    version: 1, title: 'Original demo', fps: 24, width: 320, height: 180, font: 'font.ttf',
    assets: [
      { id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Original recording', attribution: 'Author' },
      { id: 'footage', path: 'footage.mp4', kind: 'video', approved: true, rights: 'Original recording', attribution: 'Author' }
    ],
    narration: { asset: 'voice', gainDb: 0 },
    scenes: [{ kind: 'video', asset: 'footage', in: 0, duration: 3, fit: 'contain', purpose: 'Teach the mechanism',
      broll: { asset: 'footage', in: 0, start: 1, duration: 1 } }]
  };
}

async function fixture(t) {
  const folder = await temporary(t);
  const value = manifest();
  for (const name of ['voice.wav', 'footage.mp4', 'font.ttf']) await writeNew(path.join(folder, name), 'fixture');
  const file = path.join(folder, 'production.json');
  await writeJson(file, value);
  const execute = async (_command, args) => ({
    stdout: JSON.stringify({ format: { duration: '3' }, streams: args.at(-1).endsWith('.wav')
      ? [{ codec_type: 'audio' }] : [{ codec_type: 'video', width: 320, height: 180 }] })
  });
  return { folder, file, value, execute };
}

test('production validates local rights, narration coverage and frame-aligned plan', async t => {
  const f = await fixture(t);
  const loaded = await loadProduction(f.file, f.execute);
  assert.equal(loaded.totalFrames, 72);
  assert.equal(loaded.assets.get('voice').sha256.length, 64);
  assert.equal(loaded.fingerprint.length, 64);
  const report = await reviewProduction(f.file, path.join(f.folder, 'pending.json'), false, f.execute);
  assert.equal(report.decision, 'pending');
  assert.equal(report.checks.facts, 'NOT VERIFIED');
});

for (const [label, change, error] of [
  ['rights', m => { m.assets[0].approved = false; }, /approval, rights/],
  ['duration', m => { m.scenes[0].duration = 4; }, /exceeds source/],
  ['narration', m => { m.scenes[0].duration = 2; m.scenes[0].broll = undefined; }, /match narration/],
  ['broll bounds', m => { m.scenes[0].broll.start = 2.5; }, /invalid broll timing/],
  ['unknown effect', m => { m.scenes[0].effect = 'invented'; }, /unsupported field/],
  ['unsafe text', m => { m.scenes = [{ kind: 'graphic', duration: 3, fit: 'contain', purpose: 'Explain',
    graphic: { title: 'x\ninjection', citation: 'Source', rows: [{ label: 'Value', value: 0.5 }] } }]; }, /short title/],
  ['invented ID', m => { m.scenes[0].asset = 'missing'; }, /kind mismatch/],
  ['fractional frames', m => { m.scenes[0].duration = 2.99; }, /aligned to timeline/],
  ['wrong aspect', m => { m.width = 300; }, /16:9 or 9:16/]
]) {
  test(`production rejects ${label}`, async t => {
    const f = await fixture(t);
    change(f.value);
    const file = path.join(f.folder, 'invalid.json');
    await writeJson(file, f.value);
    await assert.rejects(loadProduction(file, f.execute), error);
  });
}

test('render requires scoped approval and invalidates changes to media, font or plan', async t => {
  const f = await fixture(t);
  const review = path.join(f.folder, 'approved.json');
  await reviewProduction(f.file, review, true, f.execute);
  const output = path.join(f.folder, 'render');
  await assert.rejects(buildProduction(f.file, review, output, false, f.execute), /allow-render/);
  await writeNew(path.join(f.folder, 'changed.wav'), 'different');
  f.value.assets[0].path = 'changed.wav';
  const changed = path.join(f.folder, 'changed.json');
  await writeJson(changed, f.value);
  await assert.rejects(buildProduction(changed, review, output, true, f.execute), /changed manifest/);
  assert.equal(await exists(output), false);
});

test('stock search is opt-in and returns candidates/attribution, not automatic reuse rights', async t => {
  const folder = await temporary(t);
  const output = path.join(folder, 'candidates.json');
  let called = false;
  const fetcher = async (url, options) => {
    called = true;
    assert.equal(url.hostname, 'api.pexels.com');
    assert.equal(url.pathname, '/v1/videos/search');
    assert.equal(options.redirect, 'error');
    return Response.json({ videos: [{ id: 1, url: 'https://www.pexels.com/video/demo-1/',
      user: { name: 'Creator', url: 'https://www.pexels.com/@creator/' }, video_files: [
        { id: 2, file_type: 'video/mp4', link: 'https://videos.pexels.com/test.mp4', width: 320, height: 180 }
      ] }] });
  };
  await assert.rejects(searchStock('servers', output, false, fetcher), /allow-search/);
  assert.equal(called, false);
  const original = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = 'test-not-real';
  try {
    const result = await searchStock('servers', output, true, fetcher);
    assert.equal(result.status, 'candidates-not-approved');
    assert.equal(result.candidates[0].creator, 'Creator');
    const download = path.join(folder, 'stock');
    await assert.rejects(downloadStock(output, '1', '2', download), /rights-confirmed/);
    const asset = await downloadStock(output, '1', '2', download,
      { allowDownload: true, rightsConfirmed: true },
      async () => new Response(new Uint8Array([0, 1, 2]), { headers: { 'content-type': 'video/mp4' } }));
    assert.equal(asset.approved, true);
    assert.match(asset.attribution, /Creator on Pexels/);
    assert.equal((await readJson(path.join(download, 'provenance.json'))).bytes, 3);
    assert.equal(await exists(path.join(download, 'stock.mp4')), true);
  } finally {
    if (original === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = original;
  }
});

test('stock refuses unsafe origins, redirects/errors, oversized and empty downloads', async t => {
  const folder = await temporary(t);
  const catalog = path.join(folder, 'catalog.json');
  const record = { version: 1, provider: 'Pexels', candidates: [{
    id: '1', creator: 'Creator', sourceUrl: 'https://www.pexels.com/video/test/',
    files: [{ id: '2', url: 'https://evil.example/clip.mp4' }]
  }] };
  await writeJson(catalog, record);
  const flags = { allowDownload: true, rightsConfirmed: true };
  await assert.rejects(downloadStock(catalog, '1', '2', path.join(folder, 'bad'), flags), /direct HTTPS/);
  record.candidates[0].files[0].url = 'https://videos.pexels.com/test.mp4';
  const safe = path.join(folder, 'safe.json');
  await writeJson(safe, record);
  await assert.rejects(downloadStock(safe, '1', '2', path.join(folder, 'large'), flags,
    async () => new Response('x', { headers: { 'content-type': 'video/mp4', 'content-length': String(251 * 1024 * 1024) } })), /250 MiB/);
  const empty = path.join(folder, 'empty');
  await assert.rejects(downloadStock(safe, '1', '2', empty, flags,
    async () => new Response('', { headers: { 'content-type': 'video/mp4' } })), /empty/);
  assert.equal(await exists(path.join(empty, 'stock.mp4')), false);
});

test('real landscape and portrait assembly includes B-roll, animated graphics, narration and music', {
  skip: !process.env.VIDEO_MONK_FFMPEG || !process.env.VIDEO_MONK_FFPROBE || !process.env.VIDEO_MONK_TEST_FONT
    ? 'Set VIDEO_MONK_FFMPEG, VIDEO_MONK_FFPROBE and VIDEO_MONK_TEST_FONT for real-media integration' : false
}, async t => {
  const folder = await temporary(t);
  const ffmpeg = process.env.VIDEO_MONK_FFMPEG;
  const render = args => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...args]);
  const source = path.join(folder, 'footage.mp4');
  const voice = path.join(folder, 'voice.wav');
  const music = path.join(folder, 'music.wav');
  const image = path.join(folder, 'image.png');
  const cutaway = path.join(folder, 'broll.mp4');
  await render(['-f', 'lavfi', '-i', 'color=blue:s=320x180:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  await render(['-f', 'lavfi', '-i', 'color=green:s=320x180:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', cutaway]);
  await render(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000', voice]);
  await render(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1:sample_rate=48000', music]);
  await render(['-f', 'lavfi', '-i', 'color=red:s=320x180', '-frames:v', '1', '-update', '1', image]);
  for (const [width, height] of [[320, 180], [180, 320]]) {
    const m = manifest();
    Object.assign(m, { width, height, font: process.env.VIDEO_MONK_TEST_FONT });
    m.assets.push(
      { id: 'image', path: 'image.png', kind: 'image', rights: 'Original', attribution: 'Test fixture', approved: true },
      { id: 'broll', path: 'broll.mp4', kind: 'video', rights: 'Original', attribution: 'Test fixture', approved: true },
      { id: 'music', path: 'music.wav', kind: 'audio', rights: 'Original', attribution: 'Test fixture', approved: true }
    );
    m.music = { asset: 'music', gainDb: -24 };
    m.scenes = [
      { kind: 'video', asset: 'footage', in: 0, duration: 1, fit: 'cover', purpose: 'A-roll',
        broll: { asset: 'broll', in: 1, start: 0.25, duration: 0.5 } },
      { kind: 'image', asset: 'image', in: 0, duration: 1, fit: 'contain', purpose: 'Still B-roll' },
      { kind: 'graphic', duration: 1, fit: 'contain', purpose: 'Mechanism graphic',
        graphic: { title: 'Measured demo', citation: 'Synthetic test data',
          rows: [{ label: 'Example A: 50%', value: 0.5 }, { label: 'Example B: 90%', value: 0.9 }] } }
    ];
    const file = path.join(folder, `production-${width}.json`);
    const review = path.join(folder, `review-${width}.json`);
    const output = path.join(folder, `render-${width}`);
    await writeJson(file, m);
    await reviewProduction(file, review, true);
    const report = await buildProduction(file, review, output, true);
    assert.equal(report.status, 'draft-needs-resolve-review');
    assert.equal(report.checks.finalExport, 'NOT VERIFIED');
    const metadata = await inspectMedia(path.join(output, 'preview.mp4'));
    assert.equal(metadata.video.width, width);
    assert.equal(metadata.video.height, height);
    assert.ok(metadata.audio);
    assert.ok(Math.abs(metadata.duration - 3) < 0.05);
    const xml = await readFile(path.join(output, 'timeline.xml'), 'utf8');
    assert.match(xml, /<audio><track>/);
    assert.match(xml, /music.wav/);
    assert.match(xml, /narration.wav/);
    assert.equal((xml.match(/<clipitem /g) || []).length, 5);
    assert.equal(await exists(path.join(output, 'scene-003.mp4.png')), true);
    // Sample before and after the progressive reveal rather than just testing file existence.
    const sample = async (scene, time) => {
      const result = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', path.join(output, scene),
        '-frames:v', '1', '-vf', 'scale=16:16', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
      return result.stdout;
    };
    assert.notDeepEqual(await sample('scene-003.mp4', 0.05), await sample('scene-003.mp4', 0.9), 'Graphic must visibly change over time');
    const before = await sample('scene-001.mp4', 0.1);
    const during = await sample('scene-001.mp4', 0.5);
    const after = await sample('scene-001.mp4', 0.9);
    assert.ok(before[2] > before[1], 'A-roll is blue before cutaway');
    assert.ok(during[1] > during[2], 'B-roll is green during approved placement');
    assert.ok(after[2] > after[1], 'A-roll returns after cutaway');
    if (process.platform === 'win32') {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; [xml]$doc = Get-Content -Raw -LiteralPath '${path.join(output, 'timeline.xml').replace(/'/g, "''")}'; if ($doc.xmeml.sequence.media.audio.track.Count -ne 2) { throw 'Expected two audio tracks' }`]);
    }
    const verification = await verifyProduction(path.join(output, 'preview.mp4'), file,
      path.join(output, 'verification-initial.json'), { targetLufs: -16, maxTruePeak: -1 });
    assert.ok(Number.isFinite(verification.measured.integratedLufs));
    const accepted = await verifyProduction(path.join(output, 'preview.mp4'), file,
      path.join(output, 'verification-measured.json'),
      { targetLufs: verification.measured.integratedLufs, maxTruePeak: 0, playbackApproved: true });
    assert.equal(accepted.status, 'technical-checks-passed-playback-attested');
    assert.equal(accepted.checks.factsRightsAndCreativeQuality, 'HUMAN REVIEW REQUIRED');
  }
});
