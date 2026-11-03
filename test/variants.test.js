import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chooseVariant, applyVariantChoices, heroItems, variantPrompt, generateVariants } from '../src/variants.js';
import { run } from '../src/core.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-variants-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const text = 'Requests go from the client to the cache and then to the database when the cache misses.';
const words = text.split(' ').map((t, i) => ({ text: t, start: 5 + i * 0.35, end: 5.3 + i * 0.35 }));
const storyboard = () => ({ version: 1, engine: 'claude', density: 'medium', graphics: 'mixed', theme: 'night', duration: 30, stats: { graphics: 2, byTemplate: {} }, notes: [],
  items: [
    { id: 'g01', kind: 'llm', template: 'bullets', mode: 'cutaway', start: 5, duration: 5, score: 8, why: 'Lists the hops', line: text, props: { items: ['Client', 'Cache', 'Database'] } },
    { id: 'g02', kind: 'chapter', template: 'chapter', mode: 'cutaway', start: 20, duration: 3, score: 9, why: 'Chapter', line: '', props: { title: 'Next' } }] });

test('variants: only explanatory moments get alternatives, the prompt carries the brief and the line, and a tie keeps the proven design', () => {
  assert.deepEqual(heroItems(storyboard()).map(i => i.id), ['g01'], 'chapter cards are not redesigned');
  const prompt = variantPrompt(storyboard().items[0], words, { count: 3, theme: 'night', approaches: [{ id: 'structure', templates: ['flow'], brief: 'Show the structure.' }, { id: 'typographic', templates: ['term'], brief: 'Say it with type.' }] });
  assert.match(prompt, /motion-graphics editor/); assert.match(prompt, /Requests go from the client/); assert.match(prompt, /STRUCTURE: Show the structure/); assert.match(prompt, /never invent numbers/);
  const alts = [{ template: 'bullets', audit: { soft: 0 } }, { template: 'flow', audit: { soft: 0 } }, { template: 'term', audit: { soft: 0 } }];
  assert.equal(chooseVariant(alts), 0, 'a tie keeps the original');
  assert.equal(chooseVariant([{ template: 'bullets', audit: { soft: 0 } }, { template: 'flow', audit: { soft: 0 } }], { neighbours: ['bullets'] }), 1, 'avoids repeating a neighbour');
  assert.equal(chooseVariant([{ template: 'bullets', rejected: 'clipped' }, { template: 'flow', audit: { soft: 3 } }, { template: 'term', rejected: 'x' }]), 1, 'rejected ones are never chosen');
  assert.equal(chooseVariant([{ rejected: 'a' }, { rejected: 'b' }]), 0, 'if everything is rejected the original stays');
});

test('choosing an alternative swaps the template and props; editing "chosen" switches back', () => {
  const sb = storyboard();
  sb.items[0].alternatives = [{ approach: 'baseline', template: 'bullets', props: sb.items[0].props, duration: 5, why: 'Lists the hops' },
    { approach: 'structure', template: 'flow', props: { nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Cache' }] }, duration: 6, why: 'Shows the path' }];
  sb.items[0].chosen = 1;
  const out = applyVariantChoices(sb);
  assert.equal(out.items[0].template, 'flow'); assert.match(out.items[0].why, /variant: structure/); assert.equal(out.stats.byTemplate.flow, 1);
  out.items[0].chosen = 0;
  const back = applyVariantChoices(out);
  assert.equal(back.items[0].template, 'bullets');
  assert.equal(back.items[1].template, 'chapter', 'items without alternatives are untouched');
});

test('generating variants: needs permission, drafts alternatives with Claude, renders and audits stills, keeps all, writes a comparison page', { skip: ffmpegOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  await assert.rejects(generateVariants(storyboard(), words, { count: 3, dir: path.join(folder, 'v'), allowLlm: false }), /--allow-llm/);
  await assert.rejects(generateVariants(storyboard(), words, { count: 9, dir: path.join(folder, 'v'), allowLlm: true }), /2 to 4/);
  const prompts = [];
  const claude = async (command, args) => {
    assert.equal(command, 'claude');
    prompts.push(args[1]);
    return { stdout: JSON.stringify({ structured_output: { items: [
      { start: 5, end: 10, template: 'flow', mode: 'cutaway', priority: 7, why: 'Shows the path', props: { nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Cache' }, { id: 'c', label: 'Database' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'miss' }] }, cues: ['client', 'cache', 'database'] },
      { start: 5, end: 10, template: 'term', mode: 'cutaway', priority: 6, why: 'Names the idea', props: { term: 'Cache *miss*', definition: 'When the *cache* has no answer, ask the database.' } }] }, total_cost_usd: 0.03 }) };
  };
  const dir = path.join(folder, 'variants');
  const made = await generateVariants(storyboard(), words, { count: 3, dir, execute: claude, allowLlm: true });
  assert.equal(prompts.length, 1, 'one request per key moment');
  const g = made.storyboard.items[0];
  assert.deepEqual(g.alternatives.map(a => a.approach), ['baseline', 'structure', 'typographic']);
  assert.ok(g.alternatives.every(a => a.still), 'every alternative has a rendered still');
  for (const a of g.alternatives) await access(path.join(dir, a.still));
  await access(path.join(dir, 'g01-compare.png'));
  assert.ok(g.alternatives.every(a => a.audit && typeof a.audit.hard === 'number'), 'each was audited');
  assert.ok(Number.isInteger(g.chosen) && g.template === g.alternatives[g.chosen].template, 'the chosen alternative is applied');
  assert.equal(made.storyboard.items[1].alternatives, undefined);
  assert.equal(made.storyboard.stats.variants.alternatives, 2);
  assert.equal(made.costUsd, 0.03);
  assert.match(await readFile(path.join(dir, 'VARIANTS.md'), 'utf8'), /Chosen: \*\*\d\*\*/);
});

test('an alternative that invents a number is rejected by the grounding check and never chosen', { skip: ffmpegOk ? false : 'needs ffmpeg and Chrome', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  const claude = async () => ({ stdout: JSON.stringify({ structured_output: { items: [
    { start: 5, end: 10, template: 'stat', mode: 'cutaway', priority: 9, why: 'A number', props: { value: 99, suffix: '%', label: 'cache hit rate' } }] }, total_cost_usd: 0.01 }) });
  const made = await generateVariants(storyboard(), words, { count: 2, dir: path.join(folder, 'v'), execute: claude, allowLlm: true });
  const g = made.storyboard.items[0];
  assert.equal(g.alternatives.length, 2);
  assert.match(g.alternatives[1].rejected || '', /number|99|not in the transcript/);
  assert.equal(g.chosen, 0);
});
