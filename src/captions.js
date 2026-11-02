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

// Group words into caption pages: break on sentence punctuation, long pauses, max words or max characters.
export function pageWords(words, { maxWords = 6, maxChars = 32, maxGap = 0.6, minDuration = 0.5 } = {}) {
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
