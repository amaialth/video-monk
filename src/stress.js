// Decide which spoken words deserve visual stress (italic serif + accent colour in captions and pull-text).
// Evidence used, all from the transcript itself: numbers, acronyms, proper terms, intensifiers, long/technical words,
// words the speaker lingers on (duration per letter) and words bracketed by pauses. No audio prosody is claimed.

const STOP = new Set(('a an the and or but if so then than that this these those it its it\'s is are was were be been being am do does did done have has had ' +
  'of to in on at by for with from as into onto over under about up down out off not no nor too very just also can could will would shall should may might ' +
  'i me my mine we us our ours you your yours he him his she her hers they them their theirs what which who whom whose when where why how there here ' +
  'some any each all both either neither more less much many such own same other another again once yes okay ok well like really actually basically ' +
  'gonna wanna kind sort lot lots thing things way ways get got getting go going goes went come comes came let lets let\'s make makes made see saw ' +
  'say says said know knows knew want wants need needs use uses used using take takes took one two three').split(/\s+/));

const INTENSIFIERS = new Set(('never always only every must key important biggest most best worst free fast slow huge zero million billion thousand critical ' +
  'essential simple easy hard powerful real exactly completely entire whole none nothing everything without instead finally first last new ' +
  'secret mistake problem solution fail fails broken wrong right faster slower bigger smaller cheaper safer simpler').split(/\s+/));

const clean = text => text.replace(/[^\p{L}\p{N}'%.+#-]/gu, '').replace(/^[.'-]+|[.'-]+$/g, '');
const endsSentence = text => /[.!?]["')\]]?$/.test(text);

export function scoreWords(words) {
  const ratios = words.map(w => (w.end - w.start) / Math.max(1, clean(w.text).length)).sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0.06;
  return words.map((w, i) => {
    const c = clean(w.text);
    const lower = c.toLowerCase();
    if (!c || STOP.has(lower)) return -5;
    let score = 0;
    const numeric = /\d/.test(c);
    const acronym = c.length >= 2 && c === c.toUpperCase() && /[A-Z]/.test(c) && !numeric;
    if (c.length < 3 && !numeric && !acronym) return -3;
    if (numeric) score += 3;
    if (acronym) score += 2.5;
    const first = i === 0 || endsSentence(words[i - 1].text);
    if (!first && /^\p{Lu}/u.test(c) && !acronym) score += 2;
    if (INTENSIFIERS.has(lower)) score += 2.5;
    if (c.length >= 9) score += 1; else if (c.length >= 7) score += 0.5;
    const ratio = (w.end - w.start) / Math.max(1, c.length);
    if (median > 0 && ratio > median * 1.35 && w.end - w.start > 0.28) score += 1.5;
    if (i > 0 && w.start - words[i - 1].end > 0.3) score += 0.5;
    if (i < words.length - 1 && words[i + 1].start - w.end > 0.3) score += 0.5;
    if (endsSentence(w.text)) score += 0.5;
    return score;
  });
}

// Mark stress on a word list. Returns new word objects with a boolean `stress`. Explicit `stress` flags are respected.
export function markStress(words, { threshold = 2.5, perWords = 7 } = {}) {
  if (words.some(w => typeof w.stress === 'boolean')) return words.map(w => ({ ...w, stress: w.stress === true }));
  const scores = scoreWords(words);
  const out = words.map(w => ({ ...w, stress: false }));
  // Windows = sentences (or long runs split every `perWords * 2` words).
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const last = i === words.length - 1;
    if (endsSentence(words[i].text) || last || i - from >= perWords * 2 || (i < words.length - 1 && words[i + 1].start - words[i].end > 0.9)) {
      const budget = Math.max(1, Math.round((i - from + 1) / perWords));
      const ranked = [];
      for (let j = from; j <= i; j++) if (scores[j] >= threshold) ranked.push(j);
      ranked.sort((a, b) => scores[b] - scores[a] || a - b);
      for (const j of ranked.slice(0, budget)) {
        out[j].stress = true;
        // Keep proper-noun phrases together ("Apache Camel").
        const properNoun = k => /^\p{Lu}/u.test(clean(words[k].text)) && !STOP.has(clean(words[k].text).toLowerCase()) && !endsSentence(words[k - 1]?.text ?? '');
        if (/^\p{Lu}/u.test(clean(words[j].text))) {
          for (let k = j + 1; k <= i && /^\p{Lu}/u.test(clean(words[k].text)) && !STOP.has(clean(words[k].text).toLowerCase()); k++) out[k].stress = true;
          for (let k = j - 1; k >= from && properNoun(k) && k > from; k--) out[k].stress = true;
        }
      }
      from = i + 1;
    }
  }
  return out;
}

// Indices of words that should be stressed in a short phrase (used for pull-text and titles).
export function stressIndices(words) {
  return markStress(words).map((w, i) => (w.stress ? i : -1)).filter(i => i >= 0);
}

export { clean as cleanWord, STOP as STOP_WORDS };
