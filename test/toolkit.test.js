import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoint, youtubeChannel, integer, run, writeNew, writeJson, readJson, exists, loadProject } from '../src/core.js';
import { catalog, downloadVideo, probe, analyze } from '../src/media.js';
import { complete, parseModelJson, styleContent } from '../src/llm.js';
import { PLAN_SCHEMA, validateInventory, validatePlan, captionsSrt, resolveXml, requireXmlRates } from '../src/plan.js';
import { install } from '../src/cli.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(root, 'bin', 'video-monk.js');
const cli = (...args) => run(process.execPath, [bin, ...args]);
const config = { baseUrl: 'http://127.0.0.1:12345/v1', model: 'test-model', apiKeyEnv: 'VIDEO_MONK_TEST_KEY_NOT_SET' };

async function temporary(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'video-monk-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

function inventory(file = path.join(root, 'source #1.mp4')) {
  return {
    version: 1,
    media: [{ id: 'intro', path: file, role: 'source', description: 'Original footage',
      duration: 10, fps: 24, width: 1920, height: 1080, hasAudio: true }]
  };
}

function plan() {
  return structuredClone(PLAN_SCHEMA);
}

function probeResult({ duration = '10', fps = '24/1' } = {}) {
  return { stdout: JSON.stringify({
    format: { duration },
    streams: [
      { codec_type: 'video', avg_frame_rate: fps, width: 1920, height: 1080 },
      { codec_type: 'audio' }
    ]
  }), stderr: '' };
}

test('YouTube channel validation normalizes supported channels only', () => {
  assert.equal(youtubeChannel('https://youtube.com/@ByteMonk/videos'), 'https://www.youtube.com/@ByteMonk');
  assert.equal(youtubeChannel('https://www.youtube.com/channel/UCabc123/streams'), 'https://www.youtube.com/channel/UCabc123');
  for (const url of [
    'https://youtube.com.evil.example/@ByteMonk', 'http://youtube.com/@ByteMonk',
    'https://user:password@youtube.com/@ByteMonk', 'https://youtube.com/watch?v=123',
    'https://example.com/@ByteMonk', 'file:///C:/test'
  ]) assert.throws(() => youtubeChannel(url));
});

test('endpoint permits HTTPS and loopback HTTP only; preserves provider prefix', () => {
  assert.equal(endpoint('https://example.com/api/v1/'), 'https://example.com/api/v1/chat/completions');
  assert.equal(endpoint('http://localhost:9000/v1'), 'http://localhost:9000/v1/chat/completions');
  for (const url of ['http://example.com/v1', 'https://user:key@example.com/v1', 'https://example.com/v1?key=x', 'file:///C:/data']) {
    assert.throws(() => endpoint(url));
  }
});

test('numeric options reject NaN, infinity, decimals and out-of-range values', () => {
  assert.equal(integer('24', 'frames', 1, 24), 24);
  for (const value of ['x', Infinity, 0, 25, 1.5]) assert.throws(() => integer(value, 'frames', 1, 24));
});

test('writeNew is exclusive and preserves the original content', async t => {
  const folder = await temporary(t);
  const file = path.join(folder, 'nested', 'output.txt');
  await writeNew(file, 'original');
  await assert.rejects(writeNew(file, 'replacement'), /EEXIST/);
  assert.equal(await readFile(file, 'utf8'), 'original');
  assert.equal(await exists(path.join(folder, 'missing')), false);
});

test('subprocess arguments are literal and missing tools are explicit', async () => {
  const argument = 'hello; echo UNEXPECTED & "quoted"';
  const { stdout } = await run(process.execPath, ['-e', 'console.log(process.argv[1])', argument]);
  assert.equal(stdout.trim(), argument);
  await assert.rejects(run('video-monk-nonexistent-executable', []), /Missing executable/);
});

test('CLI init persists config, examples, and refuses destructive reruns', async t => {
  const folder = await temporary(t);
  const project = path.join(folder, 'project');
  await cli('init', '--dir', project, '--model', 'test-model');
  const { config: saved } = await loadProject(project);
  assert.equal(saved.channel, 'https://www.youtube.com/@ByteMonk');
  assert.equal(saved.llm.model, 'test-model');
  assert.ok(await exists(path.join(project, 'inventory.example.json')));
  await assert.rejects(cli('init', '--dir', project, '--model', 'different'), /already exists/);
  assert.equal((await loadProject(project)).config.llm.model, 'test-model');
});

test('CLI rejects unknown flags, missing values and prototype command names', async () => {
  await assert.rejects(cli('constructor'), /Unknown command/);
  await assert.rejects(cli('init', '--unknown'), /Unknown option/);
  await assert.rejects(cli('init', '--dir', 'unused-test-folder'), /Missing --model/);
  const { stdout } = await cli('--help');
  assert.match(stdout, /picture|timeline|handoff/);
});

test('installer installs discoverable skills and agents without overwriting', async t => {
  const folder = await temporary(t);
  const files = await install(folder);
  assert.equal(files.length, 24);
  const skills = await readdir(path.join(folder, '.github', 'skills'));
  assert.equal(skills.length, 3);
  for (const skill of skills) {
    const text = (await readFile(path.join(folder, '.github', 'skills', skill, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
    assert.ok(text.startsWith(`---\nname: ${skill}\ndescription: '`));
    assert.match(text, /## Procedure/);
  }
  const agents = await readdir(path.join(folder, '.github', 'agents'));
  assert.equal(agents.length, 4);
  for (const agent of agents) {
    const text = (await readFile(path.join(folder, '.github', 'agents', agent), 'utf8')).replace(/\r\n/g, '\n');
    assert.match(text, /^---\nname: [\w-]+\ndescription: '[^\n]+'\ntools: \[[^\n]+\]\nagents: \[[^\n]*\]\n---/);
  }
  const first = await readFile(files[0], 'utf8');
  await assert.rejects(install(folder), /already exists/);
  assert.equal(await readFile(files[0], 'utf8'), first);
});

test('installer checks all conflicts before writing any file', async t => {
  const folder = await temporary(t);
  const conflict = path.join(folder, '.github', 'agents', 'video-monk-quality-reviewer.agent.md');
  await writeNew(conflict, 'user customization');
  await assert.rejects(install(folder), /already exists/);
  assert.equal(await exists(path.join(folder, '.github', 'skills')), false);
  assert.equal(await readFile(conflict, 'utf8'), 'user customization');
});

test('catalog processes all returned entries, labels metadata, and limits explicitly', async () => {
  const calls = [];
  const execute = async (command, args) => {
    calls.push({ command, args });
    return { stdout: JSON.stringify({ entries: [
      { id: 'abcdefghijk', title: 'First', duration: 100 },
      { id: 'lmnopqrstuv', title: 'Second' }
    ] }) };
  };
  const all = await catalog('https://youtube.com/@ByteMonk', 0, 'videos', execute);
  assert.equal(all.videos.length, 2);
  assert.match(all.evidence, /metadata only/);
  assert.ok(!calls[0].args.includes('--playlist-end'));
  assert.equal(calls[0].args.at(-1), 'https://www.youtube.com/@ByteMonk/videos');
  const limited = await catalog('https://youtube.com/@ByteMonk', 1, 'shorts', execute);
  assert.match(limited.coverage, /not all/);
  assert.ok(calls[1].args.includes('--playlist-end'));
  await assert.rejects(catalog('https://youtube.com/@ByteMonk', 0, '../evil', execute), /Invalid channel tab/);
});

test('catalog rejects empty responses and unsafe IDs instead of inventing coverage', async () => {
  await assert.rejects(catalog('https://youtube.com/@ByteMonk', 0, 'videos', async () => ({
    stdout: JSON.stringify({ entries: [] })
  })), /No accessible/);
  await assert.rejects(catalog('https://youtube.com/@ByteMonk', 0, 'videos', async () => ({
    stdout: JSON.stringify({ entries: [{ id: '../../file' }] })
  })), /invalid video ID/);
});

test('downloads require permission and a catalog ID before executing', async t => {
  const folder = await temporary(t);
  const never = async () => { throw new Error('must not execute'); };
  await assert.rejects(downloadVideo(folder, 'abcdefghijk', [], false, never), /allow-download/);
  await assert.rejects(downloadVideo(folder, 'abcdefghijk', [], true, never), /catalog/);
  await assert.rejects(downloadVideo(folder, '../outside', [], true, never), /catalog/);
});

test('authorized download uses fixed names and verifies the returned file', async t => {
  const folder = await temporary(t);
  const id = 'abcdefghijk';
  const expected = path.join(folder, 'references', id, 'reference.mp4');
  const execute = async (command, args) => {
    assert.equal(command, 'yt-dlp');
    assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('--no-overwrites'));
    assert.ok(args.includes(expected.replace(/\.mp4$/, '.%(ext)s')));
    await writeNew(expected, 'mock video bytes');
    return { stdout: `${expected}\n` };
  };
  assert.equal(await downloadVideo(folder, id, [{ id }], true, execute), expected);
  await assert.rejects(downloadVideo(folder, id, [{ id }], true, execute), /already exists/);
});

test('probe parses rational source frame rate and rejects missing video metadata', async () => {
  const media = await probe('sample.mp4', async () => probeResult({ fps: '30000/1001' }));
  assert.equal(media.fps, 30000 / 1001);
  assert.equal(media.hasAudio, true);
  await assert.rejects(probe('sample.mp4', async () => probeResult({ fps: '0/0' })), /Cannot determine/);
  await assert.rejects(probe('sample.mp4', async () => probeResult({ duration: 'N/A' })), /Cannot determine/);
});

test('analysis writes measured windows, frames and honest cut/audio limitations', async t => {
  const folder = await temporary(t);
  const output = path.join(folder, 'evidence');
  let sceneArgs;
  const execute = async (command, args) => {
    if (command === 'ffprobe') return probeResult({ duration: '100' });
    if (args.includes('null')) {
      sceneArgs = args;
      return { stderr: '[showinfo] pts_time:1.0\n[showinfo] pts_time:3.0\n[showinfo] pts_time:7.0' };
    }
    await writeNew(args.at(-1), 'mock JPEG');
    return { stderr: '' };
  };
  const result = await analyze('reference.mp4', output, { seconds: 20, frames: 2 }, execute);
  assert.equal(result.analyzedSeconds, 20);
  assert.deepEqual(result.candidateCuts, [1, 3, 7]);
  assert.equal(result.medianCandidateInterval, 3);
  assert.deepEqual(result.frames.map(frame => frame.time), [5, 15]);
  assert.equal(sceneArgs[sceneArgs.indexOf('-t') + 1], '20');
  assert.match(result.limitations.join(' '), /Audio.*not been analyzed/);
  assert.equal((await readJson(path.join(output, 'evidence.json'))).version, 1);
  await assert.rejects(analyze('reference.mp4', output, {}, execute), /already exists/);
});

test('analysis clamps window to actual duration and reports no-cut evidence as null', async t => {
  const folder = await temporary(t);
  const execute = async (command, args) => {
    if (command === 'ffprobe') return probeResult();
    if (!args.includes('null')) await writeNew(args.at(-1), 'mock JPEG');
    return { stderr: '' };
  };
  const result = await analyze('reference.mp4', path.join(folder, 'evidence'), { seconds: 100, frames: 1 }, execute);
  assert.equal(result.analyzedSeconds, 10);
  assert.equal(result.medianCandidateInterval, null);
});

test('LLM requests are never made without consent', async () => {
  let called = false;
  await assert.rejects(complete(config, 'system', 'private', false, async () => { called = true; }), /allow-llm/);
  assert.equal(called, false);
});

test('LLM chat-completions request shape, endpoint, content and redirect policy', async () => {
  const result = await complete(config, 'system', 'user', true, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:12345/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'test-model');
    assert.deepEqual(body.messages, [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }]);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'response' } }] }) };
  });
  assert.equal(result, 'response');
});

test('LLM errors do not echo private provider response bodies; empty responses fail', async () => {
  let readPrivateBody = false;
  await assert.rejects(complete(config, 's', 'u', true, async () => ({
    ok: false, status: 401, text: async () => { readPrivateBody = true; return 'private'; }
  })), /HTTP 401/);
  assert.equal(readPrivateBody, false);
  await assert.rejects(complete(config, 's', 'u', true, async () => ({
    ok: true, json: async () => ({ choices: [] })
  })), /no text/);
});

test('HTTPS providers require an environment key before sending', async () => {
  await assert.rejects(complete({ ...config, baseUrl: 'https://example.com/v1' }, 's', 'u', true,
    async () => { throw new Error('must not execute'); }), /Set VIDEO_MONK_TEST_KEY_NOT_SET/);
});

test('model JSON accepts JSON fences but rejects prose or executable output', () => {
  assert.deepEqual(parseModelJson('```json\n{"version":1}\n```'), { version: 1 });
  assert.throws(() => parseModelJson('Here is code: process.exit(0)'), /not valid JSON/);
});

test('style content sends images only when explicitly selected and hides source paths', async t => {
  const folder = await temporary(t);
  const evidenceFile = path.join(folder, 'evidence.json');
  await writeJson(evidenceFile, {
    version: 1, media: { path: path.join(folder, 'private', 'reference.mp4'), duration: 10 },
    frames: [{ file: 'frame-01.jpg', time: 5 }], sourceUrl: null
  });
  await writeNew(path.join(folder, 'frame-01.jpg'), 'mock JPEG');
  const textOnly = await styleContent([evidenceFile], false);
  assert.ok(textOnly.every(item => item.type === 'text'));
  assert.ok(!JSON.stringify(textOnly).includes('private'));
  const vision = await styleContent([evidenceFile], true);
  assert.equal(vision.filter(item => item.type === 'image_url').length, 1);
  await assert.rejects(styleContent([], true), /at least one/);
});

test('style content rejects frame path traversal', async t => {
  const folder = await temporary(t);
  const file = path.join(folder, 'evidence.json');
  await writeJson(file, { version: 1, media: { path: 'ref.mp4' }, frames: [{ file: '../secret.jpg', time: 0 }] });
  await assert.rejects(styleContent([file], true), /Invalid evidence frame/);
});

test('inventory resolves relative media, verifies descriptions/rights roles and unique IDs', async t => {
  const folder = await temporary(t);
  await writeNew(path.join(folder, 'source.mp4'), 'fixture');
  const value = { version: 1, media: [{ id: 'intro', path: 'source.mp4', role: 'source', description: 'Original video' }] };
  assert.equal((await validateInventory(value, folder)).media[0].path, path.join(folder, 'source.mp4'));
  for (const update of [
    { role: 'reference' }, { description: '' }, { path: 'missing.mp4' }, { id: '../invalid' }
  ]) {
    await assert.rejects(validateInventory({ version: 1, media: [{ ...value.media[0], ...update }] }, folder));
  }
  await assert.rejects(validateInventory({ version: 1, media: [value.media[0], value.media[0]] }, folder), /unique/);
});

test('valid plans preserve existing shape and compute actual frame-quantized duration', () => {
  const result = validatePlan(plan(), inventory());
  assert.equal(result.durationFrames, 120);
  assert.equal(result.clips[0].mediaId, 'intro');
  const quantized = plan();
  quantized.clips[0].in = 0.02;
  quantized.clips[0].out = 1.02;
  quantized.captions = [];
  assert.equal(validatePlan(quantized, inventory()).durationFrames, 24);
});

for (const [label, mutate] of [
  ['unsupported version', value => { value.version = 2; }],
  ['unsupported fractional timeline rate', value => { value.fps = 29.97; }],
  ['odd resolution', value => { value.width = 1919; }],
  ['oversized free-edition resolution', value => { value.height = 4320; }],
  ['unknown media ID', value => { value.clips[0].mediaId = 'unknown'; }],
  ['negative source time', value => { value.clips[0].in = -1; }],
  ['out beyond source', value => { value.clips[0].out = 11; }],
  ['zero-length clip', value => { value.clips[0].out = 0; }],
  ['nonfinite bounds', value => { value.clips[0].out = Infinity; }],
  ['subframe clip', value => { value.clips[0].out = 0.001; }],
  ['caption beyond timeline', value => { value.captions[0].end = 6; }],
  ['overlapping captions', value => { value.captions.push({ start: 1, end: 3, text: 'overlap' }); }],
  ['caption SRT injection', value => { value.captions[0].text = 'a --> b'; }],
  ['caption multiline block injection', value => { value.captions[0].text = 'a\n\n2'; }],
  ['unsupported edit operations', value => { value.clips[0].transition = 'crossfade'; }],
  ['unrecognized finishing fields', value => { value.finishing.unrecognized = 'not a supported task'; }],
  ['null clip objects', value => { value.clips[0] = null; }],
  ['missing finishing notes', value => { value.finishing.color = []; }]
]) {
  test(`plan validator rejects ${label}`, () => {
    const value = plan();
    mutate(value);
    assert.throws(() => validatePlan(value, inventory()), /Invalid edit plan/);
  });
}

test('plan rejects reference media regardless of a matching source ID', () => {
  const value = inventory();
  value.media[0].role = 'reference';
  assert.throws(() => validatePlan(plan(), value), /reference media/);
});

test('captions produce exact SRT timestamps and empty transcripts produce empty SRT', () => {
  assert.equal(captionsSrt([{ start: 1.234, end: 62.999, text: 'Original words' }]),
    '1\n00:00:01,234 --> 00:01:02,999\nOriginal words\n');
  assert.equal(captionsSrt([]), '');
});

test('XML handoff escapes content, preserves paths, source frames and sequential timeline bounds', () => {
  const value = plan();
  value.title = 'Original <edit> & "safe"';
  value.clips.push({ mediaId: 'intro', in: 1, out: 3, purpose: 'Second beat' });
  const xml = resolveXml(validatePlan(value, inventory()), inventory());
  assert.match(xml, /Original &lt;edit&gt; &amp; &quot;safe&quot;/);
  assert.match(xml, /source%20%231\.mp4/);
  assert.match(xml, /<start>0<\/start><end>120<\/end><in>0<\/in><out>120<\/out>/);
  assert.match(xml, /<start>120<\/start><end>168<\/end><in>24<\/in><out>72<\/out>/);
  assert.match(xml, /<sequence><name>.*<\/name><duration>168<\/duration>/);
  assert.ok(!xml.includes('<audio>'), 'XML deliberately advertises picture only');
});

test('fractional source frame rates fail explicitly for XML rather than being silently relabeled', () => {
  const value = inventory();
  value.media[0].fps = 30000 / 1001;
  assert.throws(() => requireXmlRates(value), /integer source frame rates/);
  assert.doesNotThrow(() => requireXmlRates(inventory()));
});

test('npm manifest allowlist excludes tests, media and environment files', async () => {
  const manifest = await readJson(path.join(root, 'package.json'));
  assert.equal(manifest.name, '@amailath/video-monk');
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.deepEqual(manifest.files, ['bin', 'src', 'templates', 'assets', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts.prepack, 'npm run check && npm test');
});
