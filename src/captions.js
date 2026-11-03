// Word-timed captions: validation, paging into readable lines, SRT/VTT export.

export function validateWords(words, maxTime = Infinity, label = 'words') {
  if (!Array.isArray(words) || !words.length || words.length > 500000) throw new Error(`Captions: ${label} must be a nonempty word array`);
  let previous = 0;
  return words.map((word, index) => {
    const ok = word && typeof word.text === 'string' && word.text.trim() && !/[\x00-\x1f]/.test(word.text) &&
      Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start &&
      word.start >= previous - 0.0005 && word.end <= maxTime + 0.25;
    if (!ok) throw new Error(`Captions: ${label}[${index}] is invalid, unordered or beyond the timeline`);
    previous = word.start;
    return { text: word.text.trim(), start: word.start, end: Math.min(word.end, maxTime) };
  });
}

// Clean transcript words before they become captions: drop cut-off fragments ("es--"), drawn-out fillers
// ("ummm"), immediate stutter repeats and bare punctuation; glue stray punctuation onto the previous word;
// then apply the user's fixes ({ replace: {"gpt 4": "GPT-4"}, drop: ["you know"] }).
const FILLER = /^(?:u+m+|u+h+|e+r+m*|a+h+m*|h+m+|m+h*m+)[.,!?]?$/i;
export function cleanCaptionWords(words, fixes = {}) {
  const out = [];
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    if (/^[.,!?;:…]+$/.test(text)) { if (out.length) out.at(-1).text += text; continue; }
    if (/[-\u2013\u2014]$/.test(text) && text.replace(/[-\u2013\u2014]+$/, '').length <= 4) continue;
    if (FILLER.test(text)) continue;
    const key = text.toLowerCase().replace(/[.,!?]+$/, '');
    const prev = out.at(-1);
    if (prev && key.length <= 3 && key === prev.text.toLowerCase().replace(/[.,!?]+$/, '') && word.start - prev.end < 0.35) { prev.end = word.end; continue; }
    out.push({ ...word, text });
  }
  return applyCaptionFixes(out, fixes);
}

export function applyCaptionFixes(words, fixes = {}) {
  const drop = (fixes.drop || []).map(x => String(x).toLowerCase().split(/\s+/)).filter(x => x[0]);
  const replace = Object.entries(fixes.replace || {}).map(([from, to]) => [String(from).toLowerCase().split(/\s+/), String(to)]);
  const norm = w => w.text.toLowerCase().replace(/[.,!?]+$/, '');
  const result = [];
  for (let i = 0; i < words.length;) {
    const match = list => list.find(item => { const seq = Array.isArray(item[0]) ? item[0] : item; return seq.every((x, k) => words[i + k] && norm(words[i + k]) === x); });
    const d = match(drop);
    if (d) { i += d.length; continue; }
    const r = match(replace);
    if (r) {
      const n = r[0].length, last = words[i + n - 1];
      result.push({ text: r[1] + (words[i + n - 1].text.match(/[.,!?]+$/)?.[0] || ''), start: words[i].start, end: last.end });
      i += n; continue;
    }
    result.push(words[i]); i++;
  }
  return result;
}

// Group words into caption pages: break on sentence punctuation, long pauses, max words or max characters.
export function pageWords(words, { maxWords = 6, maxChars = 32, maxGap = 0.6, minDuration = 0.9 } = {}) {
  const pages = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    pages.push({ start: current[0].start, end: current.at(-1).end, words: current });
    current = [];
  };
  for (const word of words) {
    const last = current.at(-1);
    const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    // Allow a little overflow so a sentence's final word is not orphaned on its own page.
    const ends = /[.!?]["')\]]?$/.test(word.text);
    const limitWords = ends ? maxWords + 1 : maxWords;
    const limitChars = ends ? maxChars * 1.3 : maxChars;
    if (last && (current.length >= limitWords || chars > limitChars || word.start - last.end > maxGap)) flush();
    current.push(word);
    if (/[.!?]["')\]]?$/.test(word.text)) flush();
  }
  flush();
  // A page of one short word reads as a flicker: fold it into the next page when they are close together.
  for (let i = 0; i < pages.length - 1; i++) {
    const p = pages[i], n = pages[i + 1];
    if (p.words.length === 1 && p.words[0].text.length <= 3 && n.start - p.end < maxGap && n.words.length < maxWords + 1) {
      n.words.unshift(...p.words); n.start = p.start; pages.splice(i, 1); i--;
    }
  }
  // Hold each page until the next begins (bounded), so captions do not flicker between words.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    const hold = Math.max(pages[i].end, pages[i].start + minDuration);
    pages[i].end = next ? Math.min(Math.max(hold, pages[i].end), next.start, pages[i].end + 0.8) : hold;
    if (next && pages[i].end > next.start) pages[i].end = next.start;
    if (pages[i].end <= pages[i].start) pages[i].end = pages[i].start + 0.05;
  }
  return pages;
}

const stamp = (seconds, sep) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${s}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
const pageText = page => page.words.map(w => w.text).join(' ').replace(/-->/g, '->');

export function pagesToSrt(pages) {
  return pages.map((p, i) => `${i + 1}\n${stamp(p.start, ',')} --> ${stamp(p.end, ',')}\n${pageText(p)}\n`).join('\n');
}

export function pagesToVtt(pages) {
  return `WEBVTT\n\n${pages.map(p => `${stamp(p.start, '.')} --> ${stamp(p.end, '.')}\n${pageText(p)}\n`).join('\n')}`;
}

// Map source-relative word times onto an edited timeline given kept source ranges placed at timeline starts.
// ranges: [{ in, out, start }] where `start` is the timeline time of the range's first frame.
export function remapWords(words, ranges) {
  const out = [];
  for (const word of words) {
    // Use the kept range with the greatest overlap; words wholly inside removed spans are dropped.
    let range = null, best = 0;
    for (const r of ranges) {
      const overlap = Math.min(r.out, word.end) - Math.max(r.in, word.start);
      if (overlap > best) { best = overlap; range = r; }
    }
    if (!range || best < Math.min(0.03, (word.end - word.start) / 2)) continue;
    const speed = range.speed || 1;
    const start = (Math.max(range.in, word.start) - range.in) / speed + range.start;
    const end = (Math.min(range.out, word.end) - range.in) / speed + range.start;
    if (end > start) out.push({ text: word.text, start: round(start), end: round(end) });
  }
  return out;
}

const round = n => Math.round(n * 1000) / 1000;

// Caption quality audit on SRT text: reading speed, line length, flicker, overlap and lone-word pages.
// Returns [{ kind, count, examples: [{ at, text }], limit }] sorted by importance.
export function auditSrt(srt, { maxCps = 20, maxLine = 42, minOnScreen = 0.6 } = {}) {
  const toSec = t => { const [h, m, rest] = t.split(':'); const [s, ms] = rest.split(','); return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000; };
  const pages = srt.split(/\r?\n\r?\n/).map(b => b.trim().split(/\r?\n/)).filter(b => b.length >= 3).map(b => {
    const [from, to] = b[1].split(' --> ').map(toSec);
    return { from, to, text: b.slice(2).join(' ') };
  });
  const buckets = { overlap: [], fast: [], long: [], flicker: [], lone: [] };
  pages.forEach((p, i) => {
    const chars = p.text.length, dur = p.to - p.from;
    if (pages[i + 1] && p.to > pages[i + 1].from + 0.02) buckets.overlap.push(p);
    if (dur > 0 && chars / dur > maxCps) buckets.fast.push(p);
    if (chars > maxLine) buckets.long.push(p);
    if (dur < minOnScreen && p.text.split(' ').length > 1) buckets.flicker.push(p);
    if (p.text.split(' ').length === 1 && chars <= 4 && !/[.!?]$/.test(p.text)) buckets.lone.push(p);
  });
  const limits = { overlap: 'no overlap', fast: `${maxCps} characters per second`, long: `${maxLine} characters per page`, flicker: `${minOnScreen} s on screen`, lone: 'no lone short words' };
  return Object.entries(buckets).filter(([, v]) => v.length).map(([kind, v]) => ({ kind, count: v.length, limit: limits[kind], total: pages.length,
    examples: v.slice(0, 3).map(p => ({ at: Math.round(p.from * 10) / 10, text: p.text })) }));
}
