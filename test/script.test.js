import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { soundKey, parseGlossary, findMisheard, applyScriptFixes, fixesMarkdown } from '../src/script.js';
import { reviewTranscript, reviseTranscript } from '../src/stages.js';

const say = text => text.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));

test('sound keys collapse sound-alike spellings', () => {
  assert.equal(soundKey('wrist'), soundKey('rest'));
  assert.equal(soundKey('RIST'), soundKey('REST'));
  assert.equal(soundKey('Jason'), soundKey('JSON'));
  assert.notEqual(soundKey('rust'), soundKey('rest') + 'x');
});

test('glossary parsing: hints after a bar, plain terms by comma', () => {
  assert.deepEqual(parseGlossary('REST | api; http\nRedis, Kafka'), [{ term: 'REST', hints: ['api', 'http'] }, { term: 'Redis', hints: [] }, { term: 'Kafka', hints: [] }]);
});

test('REST heard as wrist or rist is corrected in an API context, and left alone elsewhere', () => {
  const g = parseGlossary('REST | api; http; endpoint; server');
  const words = say('A wrist API exposes an endpoint and rist services use http verbs.');
  const found = findMisheard(words, g);
  assert.deepEqual(found.map(f => [f.heard, f.to]), [['wrist', 'REST'], ['rist', 'REST']]);
  const body = say('My wrist hurts after typing all day.');
  assert.deepEqual(findMisheard(body, g), [], 'no API words nearby, so a real "wrist" is kept');
  assert.deepEqual(findMisheard(say('The REST API is fine.'), g), [], 'already correct');
});

test('split and merged terms: "red is" becomes Redis, "a patchy camel" becomes Apache Camel; punctuation is kept', () => {
  const g = parseGlossary('Redis\nApache Camel');
  const a = findMisheard(say('We cache in red is, then read it.'), g);
  assert.equal(a[0].count, 2); assert.equal(a[0].to, 'Redis,');
  const b = findMisheard(say('What is apachi camel really?'), g);
  assert.equal(b[0].to, 'Apache Camel');
});

test('fixes apply with timing kept, a readable log, and overlapping fixes cannot double-edit', () => {
  const words = say('so red is stores a wrist API data um here');
  const { words: out, log } = applyScriptFixes(words, [
    { index: 1, count: 2, to: 'Redis', reason: 'split term' }, { phrase: 'wrist api', to: 'REST API', reason: 'REST' }, { index: 8, drop: true, reason: 'filler' }, { index: 2, to: 'x' }]);
  assert.deepEqual(out.map(w => w.text), ['so', 'Redis', 'stores', 'a', 'REST API', 'data', 'here']);
  assert.equal(out[1].start, words[1].start); assert.equal(out[1].end, words[2].end);
  assert.equal(log.length, 3);
  assert.match(fixesMarkdown(log), /\| red is \| Redis \| split term \|/);
  assert.throws(() => applyScriptFixes(words, [{ to: 'x' }]), /needs an index or a phrase/);
});

test('the transcript reviewer proposes span fixes and the reviser applies them', () => {
  const words = say('use red is for a wrist api server because http is common');
  const verdict = reviewTranscript({ words }, { glossary: parseGlossary('Redis\nREST | api; http; server') });
  const fixes = verdict.findings.filter(f => f.fix?.op === 'replaceSpan');
  assert.equal(fixes.length, 2);
  const { artifact } = reviseTranscript({ words }, fixes);
  assert.deepEqual(artifact.words.map(w => w.text).slice(0, 5), ['use', 'Redis', 'for', 'a', 'REST']);
});
