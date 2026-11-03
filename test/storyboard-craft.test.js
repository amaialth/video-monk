import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planStoryboard, beatOf, storyboardMarkdown, finalizeStoryboard } from '../src/explain.js';
import { reviewStoryboard } from '../src/stages.js';

const say = (text, from = 2, gap = 0.4) => text.split(' ').map((t, i) => ({ text: t, start: from + i * gap, end: from + i * gap + 0.3 }));
const script = () => say('Welcome to the course on caching. What is a cache. A cache is a small fast store that keeps recent results close to the user. First we check the cache then we ask the database and finally we save the answer. Latency drops by half when the cache is warm. So remember the cache keeps hot data close.');

test('a call to action you supply closes the video as a title card in your words, never overlapping, and is not judged as ungrounded', () => {
  const words = script();
  const duration = Math.ceil(words.at(-1).end + 4);
  const sb = planStoryboard(words, { duration, density: 'heavy', cta: 'Subscribe for part two' });
  const last = sb.items.at(-1);
  assert.equal(last.kind, 'cta'); assert.equal(last.template, 'title'); assert.equal(last.props.title, 'Subscribe for part two'); assert.equal(last.beat, 'CTA');
  assert.ok(last.start + last.duration <= duration + 1e-6);
  for (let i = 1; i < sb.items.length; i++) assert.ok(sb.items[i].start >= sb.items[i - 1].start + sb.items[i - 1].duration - 0.01, 'nothing overlaps the card');
  const verdict = reviewStoryboard({ storyboard: sb, words, duration });
  assert.ok(!verdict.findings.some(f => f.target?.item === last.id), 'the user\'s own words are not checked against the transcript');
  assert.equal(sb.cta, 'Subscribe for part two');
  assert.throws(() => planStoryboard(words, { duration, cta: 'x'.repeat(111) }), /1-110 characters/);
  assert.equal(planStoryboard(words, { duration, density: 'heavy' }).items.some(i => i.kind === 'cta'), false, 'no call to action unless asked for');
});

test('every graphic gets a purpose label, and the storyboard document leads with the visual theme and the story arc', () => {
  const words = script();
  const duration = Math.ceil(words.at(-1).end + 1);
  const sb = planStoryboard(words, { duration, density: 'heavy', theme: 'paper', cta: 'Visit the docs' });
  assert.ok(sb.items.every(i => ['Hook', 'Setup', 'Explain', 'Proof', 'Emphasis', 'Recap', 'CTA'].includes(i.beat)));
  assert.equal(sb.visualTheme.preset, 'paper'); assert.equal(sb.visualTheme.palette.length, 7); assert.match(sb.visualTheme.type, /Instrument Serif/);
  const md = storyboardMarkdown(sb);
  assert.match(md, /## Visual theme/); assert.match(md, /## Story arc/); assert.match(md, /Call to action: “Visit the docs”/); assert.match(md, /\| Beat \|/);
  assert.equal(beatOf({ kind: 'title', start: 0 }, 100), 'Hook'); assert.equal(beatOf({ kind: 'number', start: 50, template: 'stat' }, 100), 'Proof');
  assert.equal(beatOf({ kind: 'list', start: 92, template: 'bullets' }, 100), 'Recap'); assert.equal(beatOf({ kind: 'definition', start: 30, template: 'term' }, 100), 'Explain');
});

test('a long video that ends on nothing gets a closing-beat note; a call to action removes it', () => {
  const words = say('So here is how the cache works in practice. The cache keeps hot data close to the user.', 5);
  const built = [{ kind: 'definition', mode: 'panel', start: 8, duration: 6, score: 6, template: 'term', props: { term: 'Cache', definition: 'Hot data close to the user.' }, why: 'x', line: 'x' }];
  const open = finalizeStoryboard(built, { words, duration: 120, density: 'medium' });
  const noted = reviewStoryboard({ storyboard: open, words, duration: 120 });
  assert.ok(noted.findings.some(f => f.id === 'sb-closing-beat' && f.severity === 'minor'));
  assert.equal(noted.decision, 'approved', 'a note, not a block');
  const closed = finalizeStoryboard(built, { words, duration: 120, density: 'medium', cta: 'Subscribe' });
  assert.ok(!reviewStoryboard({ storyboard: closed, words, duration: 120 }).findings.some(f => f.id === 'sb-closing-beat'));
});
