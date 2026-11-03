import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, validateProps, templateCatalog } from '../src/motion/templates.js';
import { EFFECTS } from '../src/motion/effects.js';
import { EXAMPLES } from '../src/motion/examples.js';

const SAMPLES = {
  'chart-morph': { labels: ['A', 'B', 'C'], values: [1, 3, 2], illustrative: true },
  'search-results': { query: 'reset password', results: [{ title: 'One' }, { title: 'Two', meta: 'Help' }] },
  'card-workspace': { card: 'New', workspace: 'Projects', sidebar: ['A', 'B'], lines: ['x', 'y'] },
  'button-player': { label: 'Watch' },
  'tabs-panels': { tabs: [{ label: 'A', points: ['1'] }, { label: 'B', points: ['2'] }] },
  'spring-stack': { cards: [{ title: 'One' }, { title: 'Two' }] },
  'glass-focus': { lines: ['a', 'b', 'c'], focus: 1 },
  'particle-text': { text: 'Hello' },
  'perspective-layers': { layers: [{ label: 'UI' }, { label: 'Data' }] },
  dock: { items: [{ icon: 'mail', label: 'Mail' }, { icon: 'cloud', label: 'Cloud' }, { icon: 'code', label: 'Code' }] }
};

test('every effect is a built-in template with a render function, a schema and a description', () => {
  assert.equal(Object.keys(EFFECTS).length, 10);
  for (const name of Object.keys(EFFECTS)) {
    assert.ok(TEMPLATES[name], name);
    assert.equal(typeof TEMPLATES[name].render, 'function');
    assert.ok(TEMPLATES[name].description.length > 20);
    assert.ok(templateCatalog().some(c => c.name === name), name);
    assert.ok(SAMPLES[name], `a sample for ${name}`);
  }
});

test('effect props validate, reject unknown fields and missing required fields', () => {
  for (const [name, props] of Object.entries(SAMPLES)) {
    assert.doesNotThrow(() => validateProps(name, props), name);
    assert.throws(() => validateProps(name, { ...props, surprise: 1 }), /unsupported|unknown/i, name);
  }
  assert.throws(() => validateProps('chart-morph', { labels: ['A', 'B'], values: [1, 2] }), /needs 3-8/);
  assert.throws(() => validateProps('dock', { items: [{ icon: 'nope', label: 'x' }, { label: 'y' }, { label: 'z' }] }), /one of/);
});

test('a chart morph labelled as a sample keeps the illustrative flag', () => {
  assert.equal(validateProps('chart-morph', SAMPLES['chart-morph']).illustrative, true);
});

test('every template example validates, so the studio can always preview it', () => {
  for (const [name, props] of Object.entries(EXAMPLES)) assert.doesNotThrow(() => validateProps(name, props), name);
  for (const name of Object.keys(EFFECTS)) assert.ok(EXAMPLES[name], `an example for ${name}`);
});

test('every public template has an example that validates (so the studio never opens on an empty form)', () => {
  for (const [name, def] of Object.entries(TEMPLATES)) {
    if (def.internal) continue;
    assert.ok(EXAMPLES[name], `an example for ${name}`);
    assert.doesNotThrow(() => validateProps(name, EXAMPLES[name]), name);
  }
});
