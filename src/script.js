// Script verification: find words the transcriber mis-heard (sound-alikes such as "wrist" / "rist" for REST, "red is" for Redis,
// "a patchy camel" for Apache Camel) and apply corrections with timing kept. The code finds candidates and applies fixes; deciding
// whether a candidate is right *in context* is the script-verifier agent's job (or the Claude reviewer's).

const clean = w => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// A rough sound key: spelling variants that sound alike collapse to the same key (wrist, rist, rest -> "rst").
export function soundKey(word) {
  let s = clean(word);
  if (!s) return '';
  s = s.replace(/^wr/, 'r').replace(/^kn/, 'n').replace(/^ps/, 's').replace(/^wh/, 'w').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/gh/g, '').replace(/z/g, 's').replace(/dg/g, 'j').replace(/mb$/, 'm');
  const first = /^[aeiou]/.test(s) ? 'a' : s[0];
  const rest = s.slice(1).replace(/[aeiouyw]/g, '').replace(/h/g, '');
  return (first + rest).replace(/(.)\1+/g, '$1');
}

// Glossary file: one entry per line, "TERM" or "TERM | hint; hint; hint". Hints are words that show the term is meant (REST | api; http).
// Commas also separate plain terms on one line (older format).
export function parseGlossary(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const [left, right] = line.split('|');
    const hints = (right || '').split(/[;,]/).map(h => h.trim().toLowerCase()).filter(Boolean);
    const terms = right === undefined ? left.split(',') : [left];
    for (const t of terms.map(x => x.trim()).filter(Boolean)) out.push({ term: t, hints });
  }
  return out;
}
export const asEntries = glossary => (glossary || []).map(g => (typeof g === 'string' ? { term: g, hints: [] } : g));

const trailing = text => text.match(/[^\p{L}\p{N}]+$/u)?.[0] || '';

// Candidate corrections: [{ index, count, to, kind: 'sound'|'spelling', term, heard }]. Spans of up to term-words + 1 words are tried,
// so a term the recogniser split ("red is") or merged is found too. Hints, when given, must appear within 30 words for a sound match.
export function findMisheard(words, glossary) {
  const entries = asEntries(glossary);
  const found = [];
  const taken = new Set();
  const near = (index, hints) => !hints.length || words.slice(Math.max(0, index - 30), index + 31).some(w => hints.some(h => clean(w.text).includes(clean(h))));
  for (const { term, hints } of entries) {
    const termWords = term.split(/\s+/).length;
    const termClean = clean(term), termKey = soundKey(term);
    if (termClean.length < 3) continue;
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= termWords + 1; n++) {
        if (i + n > words.length) break;
        if ([...Array(n).keys()].some(k => taken.has(i + k))) continue;
        const span = words.slice(i, i + n);
        const heard = clean(span.map(w => w.text).join(''));
        const exact = span.map(w => clean(w.text)).join(' ') === term.split(/\s+/).map(clean).join(' ');
        if (!heard || exact) { if (exact) [...Array(n).keys()].forEach(k => taken.add(i + k)); continue; }
        const spelling = (n === 1 || heard === termClean) && Math.abs(heard.length - termClean.length) <= 1 && heard.length >= 3 && editDistance(heard, termClean) <= 1;
        const sound = termKey.length >= 3 && termClean.length >= 4 && soundKey(heard) === termKey && near(i, hints);
        if (!spelling && !sound) continue;
        found.push({ index: i, count: n, to: term + trailing(span.at(-1).text), kind: spelling ? 'spelling' : 'sound', term, heard: span.map(w => w.text).join(' ') });
        [...Array(n).keys()].forEach(k => taken.add(i + k));
        break;
      }
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Apply a list of fixes written by the script-verifier agent (or by hand). Indices refer to the ORIGINAL words.
//   { "index": 12, "to": "REST", "reason": "..." }                 replace one word
//   { "index": 12, "count": 2, "to": "Redis", "reason": "..." }     replace a span with one word (timing spans the originals)
//   { "index": 12, "drop": true, "reason": "..." }                  remove a word (stutter, filler)
//   { "phrase": "wrist api", "to": "REST API", "reason": "..." }    replace every occurrence of a phrase
// Returns { words, log: [{ at, from, to, reason }] }; nothing is changed silently.
export function applyScriptFixes(words, fixes) {
  const out = words.map(w => ({ ...w }));
  const remove = new Set();
  const log = [];
  const spans = [];
  for (const fx of fixes) {
    if (fx.phrase) {
      const seq = fx.phrase.toLowerCase().split(/\s+/).map(clean);
      for (let i = 0; i + seq.length <= words.length; i++) {
        if (seq.every((s, k) => clean(words[i + k].text) === s)) spans.push({ index: i, count: seq.length, to: fx.to + trailing(words[i + seq.length - 1].text), reason: fx.reason });
      }
    } else if (Number.isInteger(fx.index) && words[fx.index]) spans.push({ index: fx.index, count: fx.count || 1, to: fx.drop ? null : fx.to, reason: fx.reason });
    else throw new Error(`Script fix needs an index or a phrase: ${JSON.stringify(fx)}`);
  }
  spans.sort((a, b) => a.index - b.index);
  let last = -1;
  for (const s of spans) {
    if (s.index <= last || s.index + s.count > words.length) continue; // overlapping or out of range: skipped, first one wins
    last = s.index + s.count - 1;
    const from = words.slice(s.index, s.index + s.count).map(w => w.text).join(' ');
    if (s.to === null) { for (let k = 0; k < s.count; k++) remove.add(s.index + k); log.push({ at: words[s.index].start, from, to: '(removed)', reason: s.reason }); continue; }
    if (typeof s.to !== 'string' || !s.to.trim()) throw new Error(`Script fix at word ${s.index} has no replacement text`);
    out[s.index].text = s.to;
    out[s.index].end = words[s.index + s.count - 1].end;
    for (let k = 1; k < s.count; k++) remove.add(s.index + k);
    log.push({ at: words[s.index].start, from, to: s.to, reason: s.reason });
  }
  return { words: out.filter((_, i) => !remove.has(i)), log };
}

export function fixesMarkdown(log, title = 'Transcript corrections') {
  const t = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `# ${title}\n\n${log.length} change(s). Review each in context; nothing is applied to the audio, only to the words used for captions and graphics.\n\n| Time | Heard | Corrected to | Why |\n|---|---|---|---|\n` +
    log.map(l => `| ${t(l.at)} | ${l.from} | ${l.to} | ${(l.reason || '').replace(/\|/g, '/')} |`).join('\n') + '\n';
}
