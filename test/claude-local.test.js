import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, importPlan } from '../src/cli.js';
import { writeNew, writeJson, readJson, exists, run } from '../src/core.js';
import { PLAN_SCHEMA, resolveXml } from '../src/plan.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function temporary(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'video-monk-claude-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('Claude installation converts agents, preserves skills and resolves relative links', async t => {
  const folder = await temporary(t);
  const files = await install(folder, 'claude');
  assert.equal(files.length, 24);
  assert.equal(await exists(path.join(folder, '.github')), false);
  const agents = await readdir(path.join(folder, '.claude', 'agents'));
  assert.equal(agents.length, 4);
  for (const name of agents) {
    assert.ok(!name.endsWith('.agent.md'));
    const text = await readFile(path.join(folder, '.claude', 'agents', name), 'utf8');
    assert.match(text, /^---\nname: video-monk-[\w-]+\ndescription: '[^\n]+'\ntools: /);
    assert.doesNotMatch(text, /^agents:/m);
    assert.match(text, /no nested subagent delegation/);
    const expected = /analyst|quality-reviewer/.test(name)
      ? 'Read, Grep, Glob' : 'Read, Grep, Glob, Write, Edit, Bash';
    assert.equal(text.match(/^tools: (.+)$/m)[1], expected);
  }
  for (const file of files) {
    if (path.basename(file) === 'SKILL.md') {
      const relative = path.relative(path.join(folder, '.claude'), file);
      assert.equal(await readFile(file, 'utf8'), await readFile(path.join(root, 'templates', relative), 'utf8'));
    }
    const text = await readFile(file, 'utf8');
    for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
      assert.ok(await exists(path.resolve(path.dirname(file), target)), `${file}: broken ${target}`);
    }
  }
});

test('Claude install preflights every conflict and preserves user files', async t => {
  const folder = await temporary(t);
  const conflict = path.join(folder, '.claude', 'agents', 'video-monk-quality-reviewer.md');
  await writeNew(conflict, 'user agent');
  await assert.rejects(install(folder, 'claude'), /already exists/);
  assert.equal(await exists(path.join(folder, '.claude', 'skills')), false);
  assert.equal(await readFile(conflict, 'utf8'), 'user agent');
  await assert.rejects(install(folder, 'unknown'), /copilot or claude/);
});

async function fixture(t) {
  const folder = await temporary(t);
  const source = path.join(folder, 'media', 'original.mp4');
  await writeNew(source, 'local fixture; not real video');
  const inventory = path.join(folder, 'inventory.json');
  await writeJson(inventory, { version: 1, media: [{
    id: 'intro', path: path.join('media', 'original.mp4'), role: 'source',
    description: 'Original narrated intro', duration: 9999, fps: 60
  }] });
  const plan = path.join(folder, 'draft.json');
  const output = path.join(folder, 'bundle.json');
  const draft = structuredClone(PLAN_SCHEMA);
  draft.captions = [];
  await writeJson(plan, draft);
  const probed = [];
  const probe = async file => {
    probed.push(file);
    return { duration: 10, fps: 24, width: 1920, height: 1080, hasAudio: true };
  };
  return { folder, source, options: { inventory, plan, output }, draft, probed, probe };
}

test('local plan import re-probes media and persists a handoff-compatible draft without project config', async t => {
  const f = await fixture(t);
  const bundle = await importPlan(f.options, f.probe);
  assert.deepEqual(f.probed, [f.source]);
  assert.equal(bundle.inventory.media[0].duration, 10);
  assert.equal(bundle.inventory.media[0].fps, 24);
  assert.equal(bundle.plan.durationFrames, 120);
  assert.equal(bundle.status, 'draft-needs-human-review');
  assert.deepEqual(await readJson(f.options.output), bundle);
  assert.match(resolveXml(bundle.plan, bundle.inventory), /<duration>120<\/duration>/);
  assert.equal(await exists(path.join(f.folder, 'video-monk.json')), false);
  await assert.rejects(importPlan(f.options, f.probe), /already exists/);
  assert.equal(f.probed.length, 1, 'Existing output rejected before probing');
});

test('local plan rejects captions without a transcript and empty transcript input', async t => {
  const f = await fixture(t);
  f.draft.captions = [{ start: 0, end: 2, text: 'Original words' }];
  await writeJson(path.join(f.folder, 'captioned.json'), f.draft);
  f.options.plan = path.join(f.folder, 'captioned.json');
  await assert.rejects(importPlan(f.options, f.probe), /verified source transcript/);
  assert.equal(await exists(f.options.output), false);
  const transcript = path.join(f.folder, 'empty.txt');
  await writeNew(transcript, ' \n');
  await assert.rejects(importPlan({ ...f.options, transcript }, f.probe), /must not be empty/);
  const verified = path.join(f.folder, 'transcript.txt');
  await writeNew(verified, 'Original words');
  const bundle = await importPlan({ ...f.options, transcript: verified }, f.probe);
  assert.equal(bundle.plan.captions.length, 1);
  assert.match(bundle.captionTiming, /verify words and alignment/);
});

test('local plan rejects invalid bounds, unknown IDs, missing media and probe failures without output', async t => {
  const f = await fixture(t);
  for (const [name, update, error] of [
    ['bounds', draft => { draft.clips[0].out = 11; }, /invalid bounds/],
    ['id', draft => { draft.clips[0].mediaId = 'invented'; }, /unknown or reference media/],
    ['effects', draft => { draft.clips[0].transition = 'fade'; }, /unsupported fields/]
  ]) {
    const draft = structuredClone(f.draft);
    update(draft);
    const plan = path.join(f.folder, `${name}.json`);
    await writeJson(plan, draft);
    await assert.rejects(importPlan({ ...f.options, plan }, f.probe), error);
    assert.equal(await exists(f.options.output), false);
  }
  await assert.rejects(importPlan(f.options, async () => { throw new Error('Missing ffprobe'); }), /Missing ffprobe/);
  await assert.rejects(importPlan({ ...f.options, inventory: path.join(f.folder, 'absent.json') }, f.probe), /ENOENT/);
  assert.equal(await exists(f.options.output), false);
});

test('CLI exposes Claude format and strict local plan import', async t => {
  const folder = await temporary(t);
  const bin = path.join(root, 'bin', 'video-monk.js');
  const { stdout } = await run(process.execPath, [bin, 'install', '--target', folder, '--format', 'claude']);
  assert.match(stdout, /24 claude/);
  await assert.rejects(run(process.execPath, [bin, 'import-plan']), /Missing --output/);
  const help = await run(process.execPath, [bin, '--help']);
  assert.match(help.stdout, /import-plan/);
});
