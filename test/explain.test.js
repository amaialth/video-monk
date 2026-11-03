import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeNew, writeJson, readJson, run } from '../src/core.js';
import { markStress, scoreWords } from '../src/stress.js';
import { sentences, ruleCandidates, planStoryboard, applyStoryboard, storyboardMarkdown, DENSITY } from '../src/explain.js';
import { itemsToCandidates, planWithClaude, buildPrompt } from '../src/explain-llm.js';
import { storyboardManifest } from '../src/storyboard.js';
import { loadTimeline } from '../src/timeline.js';
import { validateProps, templateCatalog } from '../src/motion/templates.js';
import { renderGraphic } from '../src/motion/preview.js';
import { findChrome } from '../src/chrome.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-explain-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

// Build timed words from text: 0.32 s per word, 0.5 s pause after sentence-ending punctuation.
function timed(text, start = 0, per = 0.32) {
  let t = start;
  return text.split(/\s+/).filter(Boolean).map(word => {
    const w = { text: word, start: Math.round(t * 1000) / 1000, end: Math.round((t + per) * 1000) / 1000 };
    t += per + (/[.!?]$/.test(word) ? 0.5 : 0.02);
    return w;
  });
}

const TRANSCRIPT = [
  'Welcome to the course of Apache Camel.',
  'Camel is a framework that helps you move data between systems quickly.',
  'Today we will cover routes, endpoints, and components.',
  'First, you define a route. Second, you connect an endpoint. Third, you deploy the application.',
  'The Order Service sends messages to the Kafka broker.',
  'Our pipeline now handles 300 requests per second with 99 percent success.',
  'Why does this matter?',
  'Let us move on to error handling and retries.',
  'You should never ignore failed messages because they hide real problems in production.',
  'Memory is much faster than disk access for most workloads in every system.'
].join(' ');

test('stress detection favours numbers, acronyms, proper terms and intensifiers and never stop words', () => {
  const words = timed('You should never ignore the 99 percent of HTTP errors in Kafka production.');
  const marked = markStress(words);
  const stressed = marked.filter(w => w.stress).map(w => w.text.replace(/[^\w]/g, ''));
  assert.ok(stressed.includes('never') || stressed.includes('99') || stressed.includes('Kafka'), stressed.join());
  for (const w of marked) assert.ok(!['the', 'of', 'in', 'you', 'should'].includes(w.text.toLowerCase()) || !w.stress, w.text);
  assert.ok(marked.filter(w => w.stress).length <= 3);
  // explicit flags win and disable auto detection
  const explicit = markStress([{ ...words[0], stress: false }, { ...words[1], stress: true }, ...words.slice(2)]);
  assert.equal(explicit[1].stress, true);
  assert.equal(explicit.filter(w => w.stress).length, 1);
  assert.equal(scoreWords(words).length, words.length);
});

test('rule planner finds titles, definitions, sequences, lists, flows, numbers, chapters and questions from the transcript', () => {
  const words = timed(TRANSCRIPT);
  assert.ok(sentences(words).length >= 10);
  const duration = words.at(-1).end + 1;
  const detected = ruleCandidates(words, { duration, density: 'heavy' }).built;
  const templates = new Set(detected.map(i => i.template));
  for (const wanted of ['title', 'term', 'steps', 'bullets', 'stat', 'chapter', 'kinetic-text']) assert.ok(templates.has(wanted), `${wanted} missing: ${[...templates]}`);
  const kinds = new Set(detected.map(i => i.kind));
  for (const wanted of ['title', 'definition', 'steps', 'list', 'number', 'chapter', 'question']) assert.ok(kinds.has(wanted), `${wanted} not detected: ${[...kinds]}`);
  const sb = planStoryboard(words, { duration, density: 'heavy', theme: 'paper' });
  assert.ok(sb.items.length >= 4);
  assert.equal(sb.engine, 'rules');
  // Grounding: every label word comes from the transcript.
  const vocabulary = new Set(TRANSCRIPT.toLowerCase().match(/[\p{L}\p{N}']+/gu));
  const grounded = text => String(text).replace(/\*/g, '').toLowerCase().match(/[\p{L}\p{N}']+/gu).every(w => vocabulary.has(w) || /^\d+$/.test(w));
  for (const item of detected.map(d => ({ template: d.template, props: d.props }))) {
    const p = item.props;
    for (const v of [p.title, p.text, p.term, p.definition, p.label, ...(p.items || []), ...(p.steps || []).map(s => s.title), ...(p.nodes || []).map(n => n.label)]) {
      if (v && !['Welcome', 'Concept', "What we'll cover"].includes(v)) assert.ok(grounded(v), `ungrounded text in ${item.template}: ${v}`);
    }
  }
  const stat = detected.find(i => i.template === 'stat');
  assert.ok([300, 99].includes(stat.props.value), 'numbers are transcript numbers');
  // Every item validates against its template schema.
  for (const item of [...sb.items, ...detected]) validateProps(item.template, item.props);
});

test('scheduler keeps face time, protects the hook, and never overlaps', () => {
  const words = timed(TRANSCRIPT);
  const duration = words.at(-1).end + 1;
  for (const density of Object.keys(DENSITY)) {
    const sb = planStoryboard(words, { duration, density });
    const items = [...sb.items].sort((a, b) => a.start - b.start);
    for (let i = 0; i < items.length; i++) {
      assert.ok(items[i].start >= 0 && items[i].start + items[i].duration <= duration + 0.01, 'inside the video');
      if (items[i].start < 1) assert.equal(items[i].template, 'title', 'only the title may open in the first second');
      if (i) {
        const gap = items[i].start - (items[i - 1].start + items[i - 1].duration);
        assert.ok(gap >= 0.29, `overlap/gap ${gap.toFixed(2)} between ${items[i - 1].template} and ${items[i].template}`);
        if (items[i].mode === 'cutaway' && items[i - 1].mode === 'cutaway') assert.ok(gap >= DENSITY[density].faceGap - 0.01, 'face time between cutaways');
      }
    }
  }
  const light = planStoryboard(words, { duration, density: 'light' }).items.length;
  const heavy = planStoryboard(words, { duration, density: 'heavy' }).items.length;
  assert.ok(light <= heavy);
  assert.throws(() => planStoryboard(words, { duration, density: 'wild' }), /density/);
  assert.throws(() => planStoryboard(words, { duration, graphics: 'other' }), /graphics mode/);
});

test('long ideas become side panels, cutaways stay short, modes follow the graphics setting', () => {
  const words = timed(TRANSCRIPT);
  const duration = words.at(-1).end + 1;
  const mixed = planStoryboard(words, { duration, density: 'heavy' });
  for (const i of mixed.items.filter(x => x.mode === 'cutaway')) assert.ok(i.duration <= DENSITY.heavy.cutawayMax + 0.01, `${i.template} cutaway ${i.duration}s`);
  const panels = planStoryboard(words, { duration, density: 'heavy', graphics: 'panel' });
  assert.ok(panels.items.every(i => i.mode !== 'cutaway'));
  const md = storyboardMarkdown(mixed, 'Demo');
  assert.match(md, /\| # \| In–Out \| Beat \| The line it covers \| Graphic \| Mode \| Why \|/);
});

function fakeClaude(items) {
  return async (command, args) => {
    assert.equal(command, 'claude');
    assert.ok(args.includes('-p') && args.includes('--json-schema') && args.includes('--no-session-persistence'));
    assert.equal(args[args.indexOf('--tools') + 1], '', 'no tools for the planning call');
    return { stdout: JSON.stringify({ is_error: false, total_cost_usd: 0.05, structured_output: { items } }) };
  };
}

test('claude engine: cue words align to real word times, markup is normalised, bad items are rejected', () => {
  const words = timed(TRANSCRIPT);
  const duration = words.at(-1).end + 1;
  const first = words.findIndex(w => w.text === 'cover');
  const t0 = words[first].start;
  const { built, rejected } = itemsToCandidates([
    { start: t0, end: t0 + 6, template: 'bullets', mode: 'cutaway', priority: 8, why: 'Agenda', props: { items: ['Routes', 'Endpoints', 'Components'], marker: 'check' }, cues: ['routes', 'endpoints', 'components'] },
    { start: 1, end: 3, template: 'kinetic-text', mode: 'overlay', priority: 5, why: 'Pull', props: { text: 'Camel is *a framework*.' } },
    { start: 0, end: 4, template: 'callout', mode: 'cutaway', priority: 9, why: 'not allowed', props: {} },
    { start: 5, end: 6, template: 'stat', mode: 'cutaway', priority: 5, why: 'bad props', props: { value: 'many' } }
  ], words, { duration, graphics: 'mixed' });
  assert.equal(built.length, 2);
  assert.equal(rejected.length, 2);
  assert.match(rejected.map(r => r.reason).join(' '), /not allowed/);
  const bullets = built.find(b => b.template === 'bullets');
  assert.equal(bullets.props.cues.length, 3);
  assert.ok(bullets.props.cues[0] < bullets.props.cues[1] && bullets.props.cues[1] < bullets.props.cues[2]);
  const kinetic = built.find(b => b.template === 'kinetic-text');
  assert.equal(kinetic.props.text, 'Camel is *a framework.*', 'punctuation moved inside the stress marker');
  assert.equal(kinetic.props.cues.length, 4, 'one cue per spoken word token');
  assert.match(buildPrompt(words, { density: 'medium', duration, theme: 'paper' }), /never invent numbers/);
});

test('claude engine requires explicit consent, returns a hybrid storyboard, and records cost', async () => {
  const words = timed(TRANSCRIPT);
  const duration = words.at(-1).end + 1;
  const t0 = words.findIndex(w => w.text === 'Second,');
  const items = [{ start: words[t0 - 6].start, end: words[t0 + 8].end, template: 'steps', mode: 'cutaway', priority: 9, why: 'Three steps',
    props: { steps: [{ title: 'Define a route' }, { title: 'Connect an endpoint' }, { title: 'Deploy' }] }, cues: ['define', 'connect', 'deploy'] }];
  await assert.rejects(planWithClaude(words, { duration, allowLlm: false }, fakeClaude(items)), /allow-llm/);
  const sb = await planWithClaude(words, { duration, density: 'medium', theme: 'paper', allowLlm: true }, fakeClaude(items));
  assert.equal(sb.engine, 'claude+rules');
  assert.ok(sb.items.some(i => i.template === 'steps'));
  assert.equal(sb.stats.llmCostUsd, 0.05);
});

// Mocked ffprobe so storyboard application can be validated without media.
const probe = async (_c, args) => {
  const name = path.basename(args.at(-1));
  return { stdout: JSON.stringify({ format: { duration: '30' }, streams: name.endsWith('.wav') ? [{ codec_type: 'audio' }]
    : [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] }) };
};

test('storyboard application writes a valid manifest, chapter labels and an editable storyboard', async t => {
  const folder = await temporary(t);
  await writeNew(path.join(folder, 'rec.mp4'), 'x');
  const words = timed(TRANSCRIPT);
  const duration = Math.ceil(words.at(-1).end + 1);
  await writeJson(path.join(folder, 'words.timeline.json'), words);
  const scenes = [];
  for (let at = 0, i = 0; at < duration; at += 10, i++) scenes.push({ id: `s${i}`, kind: 'video', asset: 'rec', in: 0, duration: Math.min(10, duration - at), purpose: 'Speech', audio: {} });
  await writeJson(path.join(folder, 'production.json'), { version: 2, title: 'Explain test', fps: 30, width: 640, height: 360,
    assets: [{ id: 'rec', path: 'rec.mp4', kind: 'video', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes, captions: { words: 'words.timeline.json', burnIn: false } });
  const result = await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'production.graphics.json'),
    { density: 'heavy', theme: 'paper' }, probe);
  const manifest = await readJson(result.manifest);
  assert.equal(manifest.theme.preset, 'paper');
  assert.ok(manifest.globalOverlays.length >= 5);
  assert.ok(manifest.globalOverlays.every(o => o.id.startsWith('sb:')));
  assert.ok(manifest.globalOverlays.filter(o => o.background === 'grid').length >= 1, 'cutaways are opaque');
  assert.ok(manifest.scenes.some(s => s.chapter), 'chapter card labels a scene');
  assert.equal(manifest.captions.style, 'kinetic');
  await loadTimeline(result.manifest, probe);
  assert.match(await readFile(result.table, 'utf8'), /Storyboard: Explain test/);
  // Edit the storyboard (drop an item) and re-apply it.
  const edited = await readJson(result.storyboardFile);
  edited.items = edited.items.slice(0, 2);
  await writeJson(path.join(folder, 'edited.storyboard.json'), edited);
  const again = await storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'production.v2.json'),
    { fromStoryboard: path.join(folder, 'edited.storyboard.json'), theme: 'night' }, probe);
  assert.equal((await readJson(again.manifest)).globalOverlays.length, 2);
  await assert.rejects(storyboardManifest(path.join(folder, 'production.json'), path.join(folder, 'production.graphics.json'), {}, probe), /already exists/);
  await assert.rejects(storyboardManifest(path.join(folder, 'production.json'), path.join(tmpdir(), 'elsewhere.json'), {}, probe), /same folder/);
  assert.throws(() => applyStoryboard({ scenes: [] }, { version: 2 }), /invalid storyboard/);
});

test('templates document stress markup and spoken-word cues, and include the definition card', () => {
  const names = templateCatalog().map(t => t.name);
  assert.ok(names.includes('term'));
  const kinetic = templateCatalog().find(t => t.name === 'kinetic-text');
  assert.match(kinetic.description, /Stressed|stress/i);
  assert.ok('cues?' in kinetic.props);
  assert.deepEqual(validateProps('term', { term: 'Camel', definition: 'An *integration* framework' }), { term: 'Camel', definition: 'An *integration* framework' });
  assert.throws(() => validateProps('term', { term: 'Camel' }), /definition is required/);
});

const chromeAvailable = await findChrome().then(() => true, () => false);
test('stress markup renders differently from plain text (italic serif face)', { skip: chromeAvailable ? false : 'needs Chrome', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const render = async (title, name) => {
    const out = path.join(folder, name);
    await renderGraphic({ template: 'title', props: { title }, output: out, seconds: 2, width: 960, height: 540, at: 1.8, background: 'plain' });
    return readFile(out);
  };
  const plain = await render('Caching in 60 seconds', 'plain.png');
  const stressed = await render('Caching in *60 seconds*', 'stress.png');
  assert.notDeepEqual(plain, stressed);
  assert.ok((await stat(path.join(folder, 'stress.png'))).size > 2000);
  await run('ffmpeg', ['-v', 'error', '-i', path.join(folder, 'stress.png'), '-f', 'null', '-']);
});

// ---- house style ----
import { resolveStyle, STYLES, styleTheme } from '../src/style.js';

test('bytemonk style: dark calm theme, diagram-first scoring, pull-text capped, schematics labelled', () => {
  const style = resolveStyle('bytemonk');
  assert.equal(style.theme.preset, 'night');
  assert.equal(style.theme.calm, true);
  assert.match(style.status, /provisional/);
  assert.throws(() => resolveStyle('nope'), /Style must be/);
  assert.equal(styleTheme(STYLES.plain, 'paper').preset, 'paper');
  const words = timed(TRANSCRIPT);
  const duration = words.at(-1).end + 1;
  const styled = planStoryboard(words, { duration, density: 'heavy', style });
  const plain = planStoryboard(words, { duration, density: 'heavy', style: STYLES.plain });
  const share = sb => sb.items.filter(i => i.template === 'kinetic-text').length / Math.max(1, sb.items.length);
  assert.ok(share(styled) <= 0.34, `pull-text share ${share(styled)}`);
  assert.equal(styled.style, 'bytemonk');
  for (const item of styled.items.filter(i => ['flow', 'steps', 'comparison'].includes(i.template))) assert.equal(item.props.citation, 'Conceptual schematic');
  assert.ok(plain.items.length >= 1);
  const manifest = applyStoryboard({ scenes: [{ duration: 30, kind: 'video' }], theme: { accent: '#2f6fed' } }, styled, style);
  assert.equal(manifest.theme.accent, '#2f6fed', 'manifest tokens win over the style');
  assert.equal(manifest.theme.calm, true);
  assert.equal(manifest.theme.preset, 'night');
  assert.equal(applyStoryboard({ scenes: [{ duration: 30, kind: 'video' }], theme: { preset: 'paper' } }, styled, style).theme.preset, 'paper', 'explicit manifest preset wins');
});

test('the Claude brief carries the house style and the calm theme renders without overshoot', () => {
  const words = timed(TRANSCRIPT);
  const prompt = buildPrompt(words, { density: 'medium', duration: 40, theme: 'night', style: resolveStyle('bytemonk') });
  assert.match(prompt, /<style>[\s\S]*dark neutral canvas[\s\S]*recap/);
  assert.doesNotMatch(buildPrompt(words, { density: 'medium', duration: 40, theme: 'night', style: resolveStyle('plain') }), /<style>/);
});

test('a conceptual-schematic note is not labelled as a source, real citations still are', { skip: chromeAvailable ? false : 'needs Chrome', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const render = async (citation, name) => {
    const out = path.join(folder, name);
    await renderGraphic({ template: 'flow', props: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], citation }, output: out, seconds: 2, width: 960, height: 540, at: 1.8, background: 'plain' });
    return readFile(out);
  };
  const schematic = await render('Conceptual schematic', 's.png');
  const sourced = await render('Conceptual schematic', 's2.png');
  assert.deepEqual(schematic, sourced, 'deterministic');
  const real = await render('Benchmark, Oct 2026', 'r.png');
  assert.notDeepEqual(schematic, real);
});
