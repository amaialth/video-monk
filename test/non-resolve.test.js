import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { install } from '../src/cli.js';
import { exists, writeNew, writeJson, readJson, run } from '../src/core.js';
import { transcribeParakeet, renderHyperframes } from '../src/external-tools.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const roles = {
  'claude-editor': 'Read, Grep, Glob, Write, Edit, Bash',
  'parakeet-transcriber': 'Read, Grep, Glob, Write, Edit, Bash',
  'hyperframes-animator': 'Read, Grep, Glob, Write, Edit, Bash',
  'chrome-researcher': 'Read, Grep, Glob',
  'obs-screen-recorder': 'Read, Grep, Glob, Write, Edit',
  'free-sound-designer': 'Read, Grep, Glob, Write, Edit',
  'ffmpeg-finisher': 'Read, Grep, Glob, Write, Edit, Bash',
  'stage-reviewer': 'Read, Grep, Glob, Bash',
  'asset-librarian': 'Read, Grep, Glob, Write, Edit, Bash',
  'short-scripter': 'Read, Grep, Glob, Write, Edit, Bash',
  'visual-researcher': 'Read, Grep, Glob, Bash'
};

async function temporary(t) {
  // realpath: macOS tmpdir() is a /var -> /private/var symlink; adapters resolve real paths.
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-no-resolve-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

for (const format of ['claude', 'copilot']) {
  for (const workflow of ['resolve', 'non-resolve', 'both']) {
    test(`${format} installs ${workflow} as a distinct, linked agent set`, async t => {
      const folder = await temporary(t);
      const files = await install(folder, format, workflow);
      const agentFiles = files.filter(file => path.basename(path.dirname(file)) === 'agents');
      assert.equal(agentFiles.length, workflow === 'resolve' ? 4 : workflow === 'both' ? 16 : 12);
      const isAgent = role => agentFiles.find(file => path.basename(file).startsWith(`video-monk-${role}.`));
      if (workflow !== 'resolve') {
        for (const [role, tools] of Object.entries(roles)) {
          const text = (await readFile(isAgent(role), 'utf8')).replace(/\r\n/g, '\n');
          assert.match(text, /^---\nname: video-monk-[\w-]+\ndescription: 'Use when [^\n]+'\n(?:model: [\w-]+\n)?tools:/);
          if (format === 'claude') {
            assert.equal(text.match(/^tools: (.*)$/m)[1], tools, role);
            assert.doesNotMatch(text, /^agents:/m);
          }
          assert.ok(text.includes('../skills/non-resolve-production/SKILL.md'));
          assert.ok(text.trimEnd().split('\n').length <= 35);
          if (role === 'obs-screen-recorder') {
            assert.match(text, /user operates OBS locally/);
            assert.match(text, /assembler drops video sound/);
          }
          if (role === 'free-sound-designer') {
            assert.match(text, /YouTube[\s\S]*Audio Library; Pixabay is optional/);
            assert.match(text, /required attribution exactly/);
            assert.match(text, /Content ID claims/);
          }
        }
      }
      assert.equal(Boolean(isAgent('producer')), workflow !== 'non-resolve');
      assert.equal(Boolean(isAgent('claude-editor')), workflow !== 'resolve');
      assert.equal(Boolean(isAgent('tella-screen-editor')), false);
      assert.equal(Boolean(isAgent('epidemic-sound-designer')), false);
      for (const file of files) {
        const text = await readFile(file, 'utf8');
        for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
          assert.ok(await exists(path.resolve(path.dirname(file), target)), `Broken installed link: ${file} -> ${target}`);
        }
      }
      const before = await readFile(files[0], 'utf8');
      await assert.rejects(install(folder, format, workflow), /already exists/);
      assert.equal(await readFile(files[0], 'utf8'), before);
    });
  }
}

test('invalid workflow and non-Resolve conflicts fail before installing anything', async t => {
  const folder = await temporary(t);
  await assert.rejects(install(folder, 'claude', 'unknown'), /Workflow must/);
  const file = path.join(folder, '.claude', 'agents', 'video-monk-obs-screen-recorder.md');
  await writeNew(file, 'user customized');
  await assert.rejects(install(folder, 'claude', 'non-resolve'), /already exists/);
  assert.equal(await exists(path.join(folder, '.claude', 'skills')), false);
  assert.equal(await readFile(file, 'utf8'), 'user customized');
});

async function toolFixture(t) {
  const folder = await temporary(t);
  const entry = path.join(folder, 'fake hyperframes.mjs');
  const media = path.join(folder, 'recording with spaces.wav');
  await writeNew(entry, '// Test fixture, no real model');
  await writeNew(media, 'media fixture');
  const old = process.env.VIDEO_MONK_HYPERFRAMES;
  process.env.VIDEO_MONK_HYPERFRAMES = entry;
  t.after(() => {
    if (old === undefined) delete process.env.VIDEO_MONK_HYPERFRAMES;
    else process.env.VIDEO_MONK_HYPERFRAMES = old;
  });
  return { folder, entry, media };
}

test('Parakeet adapter pins engine, preserves literal arguments and writes a draft word transcript', async t => {
  const f = await toolFixture(t);
  const output = path.join(f.folder, 'output');
  let commandArgs;
  const execute = async (command, args) => {
    if (command === process.execPath) {
      commandArgs = args;
      assert.equal(args[0], f.entry);
      assert.equal(args[1], 'transcribe');
      const words = path.join(output, 'upstream.json');
      await writeJson(words, [{ text: 'Original', start: 0.1, end: 0.5 }, { text: 'speech', start: 0.6, end: 1 }]);
      return { stdout: JSON.stringify({ ok: true, transcriptPath: words }) };
    }
    return { stdout: JSON.stringify({ format: { duration: '2' }, streams: [{ codec_type: 'audio' }] }) };
  };
  const result = await transcribeParakeet(f.media, output, { allowTranscribe: true, allowToolNetwork: true }, execute);
  assert.deepEqual(commandArgs.slice(2, 6), [f.media, '--engine', 'parakeet', '--json']);
  assert.equal(result.status, 'draft-needs-speech-review');
  assert.equal(await readFile(path.join(output, 'transcript.txt'), 'utf8'), 'Original speech\n');
  assert.equal((await readJson(path.join(output, 'words.json'))).length, 2);
  await assert.rejects(transcribeParakeet(f.media, output, { allowTranscribe: true, allowToolNetwork: true }, execute), /output already exists/);
});

test('Parakeet rejects missing approval, invalid JSON, escaped artifacts and invalid word bounds', async t => {
  const f = await toolFixture(t);
  const meta = { stdout: JSON.stringify({ format: { duration: '2' }, streams: [{ codec_type: 'audio' }] }) };
  await assert.rejects(transcribeParakeet(f.media, path.join(f.folder, 'none'), {}), /allow-transcribe/);
  await assert.rejects(transcribeParakeet(f.media, path.join(f.folder, 'network'), { allowTranscribe: true }), /allow-tool-network/);
  for (const kind of ['json', 'escape', 'bounds']) {
    const output = path.join(f.folder, kind);
    const execute = async (command) => {
      if (command !== process.execPath) return meta;
      if (kind === 'json') return { stdout: 'not JSON' };
      if (kind === 'escape') return { stdout: JSON.stringify({ transcriptPath: f.media }) };
      const words = path.join(output, 'upstream.json');
      await writeJson(words, [{ text: 'Bad', start: 1, end: 10 }]);
      return { stdout: JSON.stringify({ transcriptPath: words }) };
    };
    await assert.rejects(transcribeParakeet(f.media, output, { allowTranscribe: true, allowToolNetwork: true }, execute),
      kind === 'json' ? /invalid JSON/ : kind === 'escape' ? /escapes/ : /word timestamp/);
    assert.equal(await exists(path.join(output, 'transcription-report.json')), false);
  }
});

test('HyperFrames render adapter validates decode, dimensions, FPS and duration, not just file existence', async t => {
  const f = await toolFixture(t);
  const html = path.join(f.folder, 'composition.html');
  await writeNew(html, '<html>Approved test fixture</html>');
  const output = path.join(f.folder, 'render');
  const options = { fps: 24, width: 1920, height: 1080, seconds: 2, allowRender: true, allowToolNetwork: true };
  const calls = [];
  const execute = async (command, args) => {
    calls.push({ command, args });
    if (command === process.execPath) {
      assert.deepEqual(args.slice(1, 5), ['render', f.folder, '--composition', 'composition.html']);
      await writeNew(path.join(output, 'animation.mp4'), 'fixture');
      return { stdout: '' };
    }
    if (args.includes('-show_streams')) return { stdout: JSON.stringify({
      format: { duration: '2' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '24/1' }]
    }) };
    return { stdout: '', stderr: '' };
  };
  const result = await renderHyperframes(f.folder, 'composition.html', output, options, execute);
  assert.equal(result.checks.decode, 'PASS');
  assert.equal(result.checks.factualAccuracy, 'NOT VERIFIED');
  assert.equal(calls.length, 3);
  await assert.rejects(renderHyperframes(f.folder, 'composition.html', path.join(f.folder, 'not-approved'), {}), /allow-render/);
  await assert.rejects(renderHyperframes(f.folder, '../elsewhere.html', path.join(f.folder, 'escape'), options, execute), /ENOENT|escapes/);
  const wrong = path.join(f.folder, 'mismatch');
  await assert.rejects(renderHyperframes(f.folder, 'composition.html', wrong, options, async (command) => {
    if (command === process.execPath) {
      await writeNew(path.join(wrong, 'animation.mp4'), 'fixture');
      return { stdout: '' };
    }
    return { stdout: JSON.stringify({ format: { duration: '2' },
      streams: [{ codec_type: 'video', width: 320, height: 180, avg_frame_rate: '24/1' }] }) };
  }), /differ from the approved expectation/);
});

test('new workflow CLI selectors and external tool commands are discoverable', async t => {
  const folder = await temporary(t);
  const bin = path.join(root, 'bin', 'video-monk.js');
  await run(process.execPath, [bin, 'install', '--target', folder, '--format', 'claude', '--workflow', 'non-resolve']);
  assert.ok(await exists(path.join(folder, '.claude', 'agents', 'video-monk-claude-editor.md')));
  const help = await run(process.execPath, [bin, '--help']);
  assert.match(help.stdout, /--workflow resolve\|non-resolve\|both/);
  assert.match(help.stdout, /transcribe/);
  assert.match(help.stdout, /animate/);
});
