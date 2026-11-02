import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../src/cli.js';
import { exists, run } from '../src/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const studyRoot = path.join('skills', 'channel-editing-study');
const references = path.join(studyRoot, 'references');
const skillNames = ['channel-editing-study', 'original-edit-planning', 'resolve-assisted-finishing'];
const roleTools = {
  producer: ['read', 'edit', 'search', 'execute', 'agent'],
  analyst: ['read', 'search'],
  editor: ['read', 'edit', 'search', 'execute'],
  'quality-reviewer': ['read', 'search']
};
const topicCaveats = {
  tpu: [/one reported video only/, /Video URL\/ID: not supplied/],
  'agent-loop': [/sponsor/i, /Title and video URL\/ID: not supplied/],
  php: [/Both identifiers[\s\S]*UNVERIFIED/],
  uber: [/population, cadence, concurrency, units/],
  owasp: [/continuous scenario/, /21:02 is a cited CTA anchor/],
  recursive: [/Runtime growth is not automatically capability improvement/],
  docker: [/six core modules[\s\S]*seven modules/, /Never run it/],
  versioning: [/do not make real payment requests/],
  jvm: [/No benchmark or profiler trace was/],
  dragonfly: [/separate explicit authorization/],
  messaging: [/lists six names/, /Do not invent the missing two/],
  nodejs: [/worker pool and JavaScript Worker Threads are different/]
};
let folder;
let github;
const installed = new Map();
const reportFile = topic => path.join(references, `bytemonk-${topic}-pilot.md`);
const content = file => {
  assert.ok(installed.has(file), `Installed resource missing: ${file}`);
  return installed.get(file);
};
const lines = text => text.trimEnd().split('\n').length;
const list = value => value.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean);

function frontmatter(file) {
  const match = /^---\n([\s\S]+?)\n---\n/.exec(content(file));
  assert.ok(match, `Missing frontmatter: ${file}`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const field = /^([a-z-]+): (.+)$/.exec(line);
    assert.ok(field, `Unsupported frontmatter syntax in ${file}: ${line}`);
    assert.ok(!Object.hasOwn(fields, field[1]), `Duplicate frontmatter field: ${file}`);
    fields[field[1]] = field[2];
  }
  assert.match(fields.description, /^'Use when [^'\n]+'$/, `Discovery description: ${file}`);
  return fields;
}

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'video-monk-customizations-'));
  github = path.join(folder, '.github');
  for (const file of await install(folder)) {
    installed.set(path.relative(github, file), (await readFile(file, 'utf8')).replace(/\r\n/g, '\n'));
  }
});

after(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

test('all customization resources install unchanged with exact discovery identities', async () => {
  const expected = [
    ...skillNames.map(name => path.join('skills', name, 'SKILL.md')),
    ...Object.keys(roleTools).map(role => path.join('agents', `video-monk-${role}.agent.md`)),
    ...Object.keys(topicCaveats).map(reportFile),
    path.join(references, 'workflow-contract.md'),
    path.join(references, 'study-index.md'),
    path.join('skills', 'resolve-assisted-finishing', 'references', 'manual-recipes.md'),
    path.join('skills', 'original-edit-planning', 'references', 'production.md'),
    path.join('skills', 'original-edit-planning', 'references', 'production.example.json')
  ];
  assert.deepEqual([...installed.keys()].sort(), expected.sort());
  for (const file of expected) {
    assert.equal(content(file), (await readFile(path.join(root, 'templates', file), 'utf8')).replace(/\r\n/g, '\n'));
  }
  for (const name of skillNames) {
    const fields = frontmatter(path.join('skills', name, 'SKILL.md'));
    assert.equal(fields.name, name);
    assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
  }
});

test('agent tools and delegation enforce distinct read-only and operator roles', () => {
  for (const [role, tools] of Object.entries(roleTools)) {
    const file = path.join('agents', `video-monk-${role}.agent.md`);
    const fields = frontmatter(file);
    assert.equal(fields.name, `video-monk-${role}`);
    assert.deepEqual(list(fields.tools), tools);
    assert.deepEqual(list(fields.agents), role === 'producer'
      ? ['video-monk-analyst', 'video-monk-editor', 'video-monk-quality-reviewer'] : []);
    assert.deepEqual(Object.keys(fields).sort(), ['agents', 'description', 'name', 'tools']);
  }
  assert.match(content(path.join('agents', 'video-monk-analyst.agent.md')), /Operator-only steps[\s\S]*do not override/);
  assert.match(content(path.join('agents', 'video-monk-quality-reviewer.agent.md')), /Read\/search is permitted/);
});

test('installed relative Markdown links resolve inside the customization tree', async () => {
  let checked = 0;
  for (const [file, text] of installed) {
    for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
      const link = decodeURIComponent(target.split('#')[0]);
      const resolved = path.resolve(github, path.dirname(file), link);
      const relative = path.relative(github, resolved);
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Escaping link in ${file}: ${target}`);
      assert.ok(await exists(resolved), `Broken installed link in ${file}: ${target}`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `Expected routed/shared resource links, checked ${checked}`);
});

test('router covers every report once and derives declared duration without inventing OWASP runtime', () => {
  const index = content(path.join(references, 'study-index.md'));
  const rows = [...index.matchAll(/\| \[[^\]]+\]\(\.\/(bytemonk-[\w-]+-pilot\.md)\) \| ([\d:]+|Unknown) \|/g)];
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map(row => row[1])).size, 12);
  assert.deepEqual(rows.map(row => row[1]).sort(), Object.keys(topicCaveats).map(topic => `bytemonk-${topic}-pilot.md`).sort());
  let total = 0;
  let declared = 0;
  for (const [, file, duration] of rows) {
    const report = content(path.join(references, file));
    if (duration === 'Unknown') {
      assert.equal(file, 'bytemonk-owasp-pilot.md');
      assert.match(report, /Duration: not supplied/);
      assert.match(report, /Examined range\/access method: not explicitly disclosed/);
      continue;
    }
    const [minutes, seconds] = duration.split(':').map(Number);
    const supplied = report.match(/(\d{1,2}:\d{2}) \((\d+) seconds\)/);
    assert.ok(supplied, `Declared runtime missing in ${file}`);
    assert.equal(supplied[1], duration, `Runtime mismatch in ${file}`);
    assert.equal(Number(supplied[2]), minutes * 60 + seconds);
    total += Number(supplied[2]);
    declared++;
  }
  assert.equal(declared, 11);
  assert.equal(total, 8370);
  assert.ok(index.includes(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} (${total} seconds)`));
  assert.match(index, /not independently watched time/i);
  assert.match(index, /duplicate submissions[\s\S]*add no reports or coverage/);
});

test('reports preserve provenance, timestamped evidence and distinctive safety/technical caveats', () => {
  const missing = [];
  for (const [topic, caveats] of Object.entries(topicCaveats)) {
    const text = content(reportFile(topic));
    assert.match(text, /NOT INDEPENDENTLY VERIFIED/, topic);
    assert.match(text, /## Provenance and coverage/, topic);
    assert.match(text, /## Reported (?:sequence|narrative anchors)/, topic);
    assert.match(text, /\d{2}:\d{2}/, topic);
    for (const caveat of caveats) {
      if (!caveat.test(text)) missing.push(`${topic}: missing ${caveat}`);
    }
    assert.ok(text.includes('[study index](./study-index.md)'), topic);
    assert.doesNotMatch(text, /## (?:Current )?(?:\w+-report (?:synthesis|comparison)|Cross-report comparison)/i);
  }
  assert.deepEqual(missing, [], 'Report-specific caveats must survive consolidation');
});

test('core prompts stay bounded and route rather than embedding topic histories', () => {
  const core = [...installed].filter(([file]) => path.basename(file) === 'SKILL.md' || file.endsWith('.agent.md'));
  assert.equal(core.length, 7);
  let total = 0;
  for (const [file, text] of core) {
    const isAgent = file.endsWith('.agent.md');
    assert.ok(lines(text) <= (isAgent ? 40 : 90), `${file}: line budget exceeded`);
    assert.ok(Buffer.byteLength(text) <= (isAgent ? 2200 : 6500), `${file}: byte budget exceeded`);
    assert.doesNotMatch(text, /bytemonk-[\w-]+-pilot\.md|\d+-report ledger|\d+:\d{2} \(\d+ seconds\)/);
    total += lines(text);
  }
  assert.ok(total <= 400, `Core prompts: ${total} lines, budget 400 (previously 696)`);
  const study = content(path.join(studyRoot, 'SKILL.md'));
  assert.ok(study.includes('[study index](./references/study-index.md)'));
  assert.match(study, /only the report\(s\)[\s\S]*relevant/);
});

test('shared evidence, provisional planning and picture-only/manual review gates stay explicit', () => {
  const contract = content(path.join(references, 'workflow-contract.md'));
  assert.match(contract, /measured[\s\S]*observed[\s\S]*reported[\s\S]*hypothesis[\s\S]*unknown/);
  assert.match(contract, /untrusted data/);
  assert.match(contract, /No verified source transcript means[\s\S]*empty captions/);
  assert.match(contract, /XML is picture-only/);
  assert.match(contract, /render queue\/start;[\s\S]*publishing/);
  for (const skill of skillNames) {
    assert.ok(content(path.join('skills', skill, 'SKILL.md')).includes('workflow-contract.md'));
  }
  assert.match(content(path.join('skills', 'original-edit-planning', 'SKILL.md')), /verified reference guide OR[\s\S]*provisional creative direction/);
  const finishing = content(path.join('skills', 'resolve-assisted-finishing', 'SKILL.md'));
  assert.match(finishing, /does not bind approval to a timeline[\s\S]*ID/);
  assert.match(finishing, /actual output existence and metadata, then full playback/);
  assert.ok(finishing.includes('./references/manual-recipes.md'));
});

test('documented skill CLI examples use supported commands and options', async () => {
  const examples = new Set();
  for (const skill of skillNames) {
    for (const [, command] of content(path.join('skills', skill, 'SKILL.md')).matchAll(/`video-monk ([^`]+)`/g)) {
      examples.add(command);
    }
  }
  assert.ok(examples.size >= 8);
  for (const command of examples) {
    const { stdout } = await run(process.execPath, [
      path.join(root, 'bin', 'video-monk.js'), ...command.split(/\s+/), '--help'
    ]);
    assert.match(stdout, /video-monk - evidence-based editing skills/);
  }
});
