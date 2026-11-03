// Facts first: for graphics that are not backed by a transcript (a launch film, an animated chart, an explainer made from a script), every
// number on screen must come from a fact list the user approved, and every fact needs a source. Adapted from the house rules of
// charlie947/motion-graphics-skills (MIT): "every name, date and number on screen comes from a list you approve; nothing invented".
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SKIP_KEYS = new Set(['icon', 'color', 'marker', 'align', 'reveal', 'position', 'mode', 'id', 'citation', 'cues', 'at', 'placement', 'theme', 'variant']);

// Every string a viewer can read in a graphic's props.
export function textsOf(value, where, out = []) {
  if (typeof value === 'string') out.push({ where, text: value.replace(/\*/g, '') });
  else if (typeof value === 'number') out.push({ where, text: String(value) });
  else if (Array.isArray(value)) value.forEach((v, i) => textsOf(v, `${where}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) textsOf(v, `${where}.${k}`, out);
  return out;
}

export function graphicTexts(manifest) {
  const out = [];
  manifest.scenes.forEach((s, i) => {
    if (s.kind === 'graphic' && s.graphic) textsOf(s.graphic.props, `scene ${i + 1} (${s.graphic.template})`, out);
    (s.overlays || []).forEach((o, k) => textsOf(o.props, `scene ${i + 1} overlay ${k + 1} (${o.template})`, out));
  });
  (manifest.globalOverlays || []).forEach((o, i) => textsOf(o.props, `overlay ${i + 1} (${o.template})`, out));
  return out;
}

// Numbers as comparable strings: 250,000 -> 250000, 4.50 -> 4.5, 12% -> 12. Years and small counts are numbers too.
export const numbersIn = text => (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, '')).map(n => (n.includes('.') ? String(Number(n)) : n.replace(/^0+(?=\d)/, '')));

// facts: { facts: [{ text, source }], allow?: [numbers or words that may appear without a fact, e.g. "01"] }
export function checkFacts(manifest, factsFile) {
  const facts = Array.isArray(factsFile?.facts) ? factsFile.facts : [];
  const unsourced = facts.map((f, i) => ({ index: i, text: String(f?.text || '').slice(0, 80), ok: Boolean(f?.text && String(f.source || '').trim()) })).filter(f => !f.ok);
  const known = new Set(facts.flatMap(f => numbersIn(f.text)));
  for (const a of factsFile?.allow || []) for (const n of numbersIn(a)) known.add(n);
  const unlisted = [];
  let checked = 0;
  for (const { where, text } of graphicTexts(manifest)) {
    for (const n of numbersIn(text)) {
      checked++;
      if (!known.has(n)) unlisted.push({ where, number: n, text: text.slice(0, 70) });
    }
  }
  return { facts: facts.length, checked, unsourced, unlisted, ok: !unsourced.length && !unlisted.length };
}

export async function readFacts(file) {
  const data = JSON.parse(await readFile(path.resolve(file), 'utf8'));
  if (!Array.isArray(data.facts) || !data.facts.length) throw new Error('Facts: the file needs a nonempty "facts" list: [{ "text": "...", "source": "URL or note" }]');
  return data;
}
