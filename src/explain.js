// Explainer planner: turns a timed transcript into a storyboard of motion graphics, then applies it to a
// version-2 manifest as timeline overlays. Offline and deterministic; every word, number and label in a graphic
// comes from the transcript (nothing is invented). Planning rules follow the motion-graphics skill (Barty-Bart,
// MIT): density levels, a per-idea choice of full-frame cutaway / side panel / nothing, graphics timed to spoken
// words, minimum face time between cutaways, no cutaway on the hook, one idea per graphic. Text styling follows
// the kinetic-typography skill (iart.ai, MIT) via the stress-aware templates.
import { run } from './core.js';
import { markStress, cleanWord, STOP_WORDS } from './stress.js';
import { validateProps } from './motion/templates.js';

const round = n => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DENSITY = {
  light: { perMinute: 3, cutawayMax: 7, faceGap: 3, fillGap: 60 },
  medium: { perMinute: 6, cutawayMax: 8, faceGap: 2, fillGap: 35 },
  heavy: { perMinute: 10, cutawayMax: 9, faceGap: 1.2, fillGap: 20 }
};
export const GRAPHIC_MODES = ['mixed', 'cutaway', 'panel'];

// Minimum on-screen seconds per template so the reveal can finish and be read.
// Maximum on-screen seconds per template as a full-frame cutaway / overlay (long ideas become side panels instead).
export const MAX_DURATION = { title: 4.5, chapter: 3.5, 'kinetic-text': 5, stat: 4.5, term: 7.5, flow: 9, steps: 9, bullets: 8, comparison: 7 };
export const MIN_DURATION = { title: 3.2, chapter: 2.4, 'kinetic-text': 1.8, term: 3.6, stat: 2.8, flow: 3.2, steps: 3.2, bullets: 3, comparison: 3, 'lower-third': 3 };

const lc = w => cleanWord(w.text).toLowerCase();
const trimEdgePunct = s => s.replace(/^[\s"'(\[,;:.\-–—]+|[\s"')\]\-–—]+$/g, '').replace(/[,;:]+$/g, '').replace(/[.!]+$/g, '');
const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
function limitWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return trimEdgePunct(cut.slice(0, at > max * 0.5 ? at : max));
}
const phraseOf = (words, a, b) => words.slice(a, b + 1).map(w => w.text).join(' ');
const isEnd = text => /[.!?]["')\]]?$/.test(text);

export function sentences(words) {
  const out = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const gap = i < words.length - 1 && words[i + 1].start - words[i].end > 0.8;
    if (isEnd(words[i].text) || gap || i - from >= 34 || i === words.length - 1) {
      const ws = words.slice(from, i + 1);
      out.push({ index: out.length, from, to: i, start: ws[0].start, end: ws.at(-1).end, words: ws, text: ws.map(w => w.text).join(' ') });
      from = i + 1;
    }
  }
  return out;
}

// ---- icon guess from a noun phrase (all keywords are generic; unknown phrases get a neutral box) ----
const ICON_RULES = [
  [/\b(database|db|sql|postgres|mysql|mongo|oracle|storage|store|warehouse|table|redis|cache)\b/i, 'database'],
  [/\b(queue|kafka|message|messages|broker|jms|activemq|rabbit|rabbitmq|topic|stream|event|events|bus)\b/i, 'queue'],
  [/\b(user|users|client|clients|customer|customers|browser|person|people|developer|developers|team)\b/i, 'user'],
  [/\b(cloud|aws|azure|gcp|saas|s3|lambda)\b/i, 'cloud'],
  [/\b(file|files|ftp|sftp|csv|xml|json|document|documents|folder|spreadsheet|pdf)\b/i, 'file'],
  [/\b(http|https|rest|web|website|endpoint|endpoints|url|soap|api|apis|internet|webservice)\b/i, 'globe'],
  [/\b(email|mail|smtp|imap|inbox)\b/i, 'mail'],
  [/\b(java|code|class|bean|processor|script|function|library|framework|sdk|route|routes)\b/i, 'code'],
  [/\b(security|secure|ssl|tls|auth|oauth|password|encrypt|encryption)\b/i, 'lock'],
  [/\b(server|servers|service|services|app|apps|application|applications|backend|microservice|microservices|system|systems|platform)\b/i, 'server'],
  [/\b(phone|mobile|android|ios)\b/i, 'phone'],
  [/\b(cpu|chip|hardware|machine|compute)\b/i, 'cpu']
];
const iconFor = phrase => (ICON_RULES.find(([re]) => re.test(phrase)) || [null, 'box'])[1];

// ---- rule vocabulary ----
const PRONOUNS = new Set('it this that there here which what who they he she we you i these those one'.split(' '));
const ARTICLES = new Set('the a an your our my their his her its this that these those some any'.split(' '));
const FLOW_VERBS = new Set(('send sends sending sent pass passes passing route routes routing forward forwards forwarding transform transforms transforming convert converts ' +
  'converting publish publishes publishing consume consumes consuming read reads reading write writes writing call calls calling invoke invokes invoking move moves ' +
  'moving fetch fetches fetching deliver delivers delivering receive receives receiving produce produces producing pull pulls push pushes pushing transfer transfers ' +
  'transferring map maps mapping connect connects connecting integrate integrates integrating talk talks communicate communicates').split(' '));
const FLOW_PREPS = new Set('to into from via through onto across with between'.split(' '));
const CLAUSE_BREAK = new Set('that which who because so but and or then when while if where how why what'.split(' '));
const FILLERS = new Set('so well okay ok right now next then also again here basically actually just really quickly easily simply very maybe usually already anything everything something nothing there'.split(' '));
const AUX_VERBS = new Set('have has had will would can could should may might do does did use uses used using create creates created see saw go goes get got let make makes made want wants need needs try tries learn learned know knows'.split(' '));
const LIST_STARTERS = new Set('how what why when where you we they it i to is are was be can will would should if that which who not no just also your our their this these those and but so'.split(' '));
const ORDINALS = /^(?:so |and |okay,? |now,? )?(first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth|fifth|next|then|finally|lastly|step (?:one|two|three|four|five|1|2|3|4|5)|number (?:one|two|three|four|five))\b[,:]?\s*(.*)$/i;

function nounPhrase(words, a, b) {
  // words[a..b] inclusive -> cleaned phrase without leading articles / trailing punctuation, or null.
  let i = a, j = b;
  while (i <= j && ARTICLES.has(lc(words[i]))) i++;
  while (j >= i && (!cleanWord(words[j].text) || STOP_WORDS.has(lc(words[j])))) j--;
  if (i > j) return null;
  const text = trimEdgePunct(phraseOf(words, i, j));
  const content = words.slice(i, j + 1).filter(w => !STOP_WORDS.has(lc(w)) && !FILLERS.has(lc(w)) && !PRONOUNS.has(lc(w)));
  if (!text || !content.length) return null;
  if (/ly$/i.test(lc(words[j])) || FILLERS.has(lc(words[j])) || content.every(w => AUX_VERBS.has(lc(w)))) return null;
  return { text: limitWords(capitalize(text), 28), from: i, to: j };
}

// ---- candidate detectors. Each returns candidates { kind, score, template, startWord, endWord, make(start) -> props, why } ----
function detectTitle(s) {
  const m = s.text.match(/^(?:hi|hello|hey|hi there|hello everyone|hey everyone)?[ ,!.]*(?:welcome(?: back)?)\s+to\s+(.+?)[.!?]*$/i);
  if (!m || s.start > 20) return [];
  const restCount = m[1].trim().split(/\s+/).length;
  let tail = s.words.slice(s.words.length - restCount);
  while (tail.length > 1 && ARTICLES.has(lc(tail[0]))) tail = tail.slice(1);
  if (!tail.length) return [];
  const markup = markStress(tail, { threshold: 2 }).map(w => (w.stress ? `*${trimEdgePunct(w.text)}*` : trimEdgePunct(w.text))).join(' ');
  return [{ kind: 'title', score: 9, template: 'title', startWord: s.from, endWord: s.to, why: 'Opening line names the topic',
    make: () => ({ kicker: 'Welcome', title: limitWords(markup, 100) }) }];
}

function detectChapter(s) {
  const patterns = [
    /^(?:so |okay,? |alright,? |now,? |and )*(?:let'?s|let us)\s+(?:now\s+)?(?:move on to|move to|go to|jump (?:in)?to|dive (?:in)?to|talk about|look at|see|understand|discuss|explore|start with|begin with|get started with|cover)\s+(.+)/i,
    /^(?:next|moving on|now)(?: up)?,?\s+(?:we(?:'ll| will)? (?:talk about|look at|see|cover|discuss)|let'?s (?:talk about|look at)|about)\s+(.+)/i,
    /^in this (?:section|lesson|chapter|part|module|video),?\s+(?:we(?:'ll| will)|you(?:'ll| will)|let'?s)\s+(?:talk about|look at|learn|learn about|see|cover|discuss|explore|understand)\s+(.+)/i
  ];
  for (const re of patterns) {
    const m = s.text.match(re);
    if (!m) continue;
    const title = trimEdgePunct(m[1].split(/[,.;]| and then | so that /i)[0]);
    if (title.length < 3) continue;
    const restCount = m[1].trim().split(/\s+/).length;
    const titleWords = s.words.slice(s.words.length - restCount, s.words.length - restCount + title.split(/\s+/).length);
    if (!titleWords.length) continue;
    const markup = limitWords(markStress(titleWords, { threshold: 2 }).map(w => (w.stress ? `*${trimEdgePunct(w.text)}*` : trimEdgePunct(w.text))).join(' '), 78);
    return [{ kind: 'chapter', score: 5, template: 'chapter', startWord: s.from, endWord: s.to, why: 'Topic change',
      make: () => ({ number: '00', title: markup }), numbered: true, plainTitle: title }];
  }
  return [];
}

function detectDefinition(s) {
  if (s.words.length < 6) return [];
  const re = /^(?:so |and |now |okay,? |basically |in short,? |in simple terms,? |well,? )*(?:the |a |an )?(.{2,45}?)\s+(is|are|means|refers to|stands for|helps you|lets you|allows you to|enables you to|provides|offers)\s+(.{12,})$/i;
  const m = s.text.match(re);
  if (!m) return [];
  const subjectWords = m[1].trim().split(/\s+/).filter(w => !FILLERS.has(w.toLowerCase()));
  if (!subjectWords.length || subjectWords.length > 4 || PRONOUNS.has(subjectWords[0].toLowerCase()) || subjectWords.some(w => AUX_VERBS.has(w.toLowerCase())) ||
      subjectWords.every(w => STOP_WORDS.has(w.toLowerCase()))) return [];
  // "X is <article/adjective noun>" reads as a definition; "X is going to..." / "X is not mandatory" does not.
  const tail = m[3].trim().split(/\s+/)[0].toLowerCase();
  if (['is', 'are', 'means'].includes(m[2].toLowerCase()) && !/^(a|an|the|used|simply|basically|one|called|where|short|nothing|your|our|an?)$/.test(tail)) return [];
  const capital = subjectWords.some(w => /^\p{Lu}/u.test(w)) || subjectWords.length >= 2;
  if (!capital && subjectWords[0].length < 5) return [];
  const verb = m[2].toLowerCase();
  const verbWords = verb.split(/\s+/).length;
  // locate the subject / verb / rest in word indices
  let verbIdx = -1;
  for (let i = 1; i < s.words.length; i++) {
    if (s.words.slice(i, i + verbWords).map(lc).join(' ') === verb) { verbIdx = i; break; }
  }
  if (verbIdx < 1) return [];
  let subjFrom = 0;
  while (subjFrom < verbIdx - 1 && (FILLERS.has(lc(s.words[subjFrom])) || ARTICLES.has(lc(s.words[subjFrom])))) subjFrom++;
  const subj = nounPhrase(s.words, subjFrom, verbIdx - 1);
  if (!subj || subj.to - subj.from > 3) return [];
  const defStart = ['is', 'are', 'means'].includes(verb) ? verbIdx + verbWords : verbIdx;
  let defEnd = s.words.length - 1;
  // Prefer the first clause when the sentence is long.
  const maxChars = 150;
  let chars = 0;
  let cut = -1;
  for (let i = defStart; i <= defEnd; i++) {
    chars += s.words[i].text.length + 1;
    if (chars > maxChars) { cut = i - 1; break; }
  }
  if (cut >= 0) {
    let back = cut;
    while (back > defStart + 6 && !/[,;]$/.test(s.words[back].text)) back--;
    defEnd = back > defStart + 6 ? back : cut;
  }
  const defWords = s.words.slice(defStart, defEnd + 1);
  if (defWords.length < 4) return [];
  const stressed = markStress(defWords, { threshold: 3 });
  const markup = stressed.map(w => (w.stress ? `*${w.text}*` : w.text)).join(' ').replace(/[,;]+$/, '');
  const definition = capitalize(markup.replace(/^\*?/, m0 => m0));
  return [{ kind: 'definition', score: capital ? 7 : 5, template: 'term', startWord: s.from, endWord: s.from + defEnd, why: `Defines “${subj.text}”`,
    make: start => ({ term: subj.text, definition: definition.replace(/^(\*?)(\p{L})/u, (_, a, b) => a + b.toUpperCase()), category: 'Concept',
      cues: defWords.map(w => round(Math.max(0.5, w.start - start))) }),
    lastCue: defWords.at(-1).start }];
}

function detectSteps(sents) {
  const out = [];
  for (let i = 0; i < sents.length; i++) {
    const first = sents[i].text.match(ORDINALS);
    if (!first || !/^(first|firstly|step (?:one|1)|number one)/i.test(first[1])) continue;
    const group = [];
    for (let j = i; j < sents.length && group.length < 7; j++) {
      const m = sents[j].text.match(ORDINALS);
      if (!m || (j > i && sents[j].start - sents[j - 1].end > 3)) break;
      group.push({ s: sents[j], rest: m[2] });
    }
    if (group.length < 2) continue;
    const steps = group.map(g => {
      const title = limitWords(capitalize(trimEdgePunct(g.rest.split(/[,;.]| and then | so /i)[0])), 38);
      return { title: title || 'Next', s: g.s };
    }).filter(x => x.title.length >= 3);
    if (steps.length < 2) continue;
    out.push({ kind: 'steps', score: 8, template: 'steps', startWord: group[0].s.from, endWord: group.at(-1).s.to, why: `${steps.length}-step sequence`,
      make: start => ({ steps: steps.map(x => ({ title: x.title, at: round(Math.max(0.4, x.s.start - start)) })) }),
      lastCue: group.at(-1).s.start });
    i += group.length - 1;
  }
  return out;
}

function detectList(s) {
  const out = [];
  const tokens = s.words;
  const triggers = [
    { re: /^(cover|covers|learn|discuss|talk|explore|look)$/, title: "What we'll cover", marker: 'check', score: 7 },
    { re: /^(include|includes|including|like|such|example|examples)$/, title: null, marker: 'dot', score: 5 }
  ];
  for (const t of triggers) {
    for (let i = 0; i < tokens.length - 4; i++) {
      if (!t.re.test(lc(tokens[i]))) continue;
      let k = i + 1;
      while (k < tokens.length && /^(about|at|as|of|the|to|following|on|in|with|:)$/i.test(lc(tokens[k]) || tokens[k].text)) k++;
      const items = [];
      let startIdx = k;
      for (let j = k; j < tokens.length; j++) {
        const word = lc(tokens[j]);
        if (CLAUSE_BREAK.has(word) && word !== 'and' && word !== 'or' && j > startIdx) break;
        const boundary = /[,;]$/.test(tokens[j].text) || word === 'and' || word === 'or' || j === tokens.length - 1 || isEnd(tokens[j].text);
        if ((word === 'and' || word === 'or') && j === startIdx) { startIdx = j + 1; continue; }
        if (boundary) {
          const endIdx = (word === 'and' || word === 'or') ? j - 1 : j;
          const np = endIdx >= startIdx ? nounPhrase(tokens, startIdx, endIdx) : null;
          if (np && np.to - np.from < 4 && !LIST_STARTERS.has(lc(tokens[np.from]))) items.push({ text: limitWords(np.text, 34), at: tokens[np.from].start });
          startIdx = j + 1;
          if (isEnd(tokens[j].text)) break;
        }
      }
      const clean = items.filter((it, n, arr) => arr.findIndex(o => o.text.toLowerCase() === it.text.toLowerCase()) === n).slice(0, 6);
      if (clean.length >= 3) {
        out.push({ kind: 'list', score: t.score, template: 'bullets', startWord: s.from, endWord: s.to, why: t.title ? 'Agenda / list of topics' : 'List of examples',
          make: start => ({ ...(t.title ? { title: t.title } : {}), items: clean.map(it => it.text), marker: t.marker, cues: clean.map(it => round(Math.max(0.5, it.at - start))) }),
          lastCue: clean.at(-1).at });
        return out;
      }
    }
  }
  return out;
}

function detectNumber(s) {
  const tokens = s.words;
  for (let i = 0; i < tokens.length; i++) {
    const raw = cleanWord(tokens[i].text);
    const m = raw.match(/^(\d[\d,]*(?:\.\d+)?)(%?)$/);
    if (!m) continue;
    const value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value > 1e12) continue;
    const next = tokens[i + 1] ? lc(tokens[i + 1]) : '';
    let suffix = m[2] ? '%' : '';
    if (!suffix && (next === 'percent' || next === '%')) suffix = '%';
    else if (!suffix && ['million', 'billion', 'thousand'].includes(next)) suffix = ` ${next}`;
    const unit = !suffix && tokens[i + 1] && !STOP_WORDS.has(next) ? next : '';
    const isYear = value >= 1900 && value <= 2100 && !suffix && !unit;
    if (isYear || (value < 10 && !suffix && !unit)) continue;
    if (tokens.length < 4) continue;
    const decimals = (m[1].split('.')[1] || '').length;
    const label = limitWords(capitalize(trimEdgePunct(s.text)), 78);
    return [{ kind: 'number', score: suffix ? 6.5 : 5, template: 'stat', startWord: s.from, endWord: s.to, why: `States ${m[0]}${suffix}`,
      make: () => ({ value, decimals, ...(suffix ? { suffix } : {}), label }) }];
  }
  return [];
}

function detectComparison(s) {
  const m = s.text.match(/^(?:.*?\b(?:between|compare|compared)\s+)?(.{3,40}?)\s+(vs\.?|versus|as opposed to|compared (?:to|with)|instead of|rather than)\s+(.{3,40}?)(?:[,.!?]|$)/i);
  if (!m) return [];
  const a = nounPhrase(s.words, 0, Math.max(0, s.text.slice(0, s.text.toLowerCase().indexOf(m[2].toLowerCase())).split(/\s+/).filter(Boolean).length - 1));
  if (!a) return [];
  const marker = /instead of|rather than/i.test(m[2]) ? m[2].toLowerCase() : 'vs';
  const b = trimEdgePunct(m[3]).split(/\s+/).slice(0, 4).join(' ');
  const aText = a.text.split(/\s+/).slice(-4).join(' ');
  if (!b || STOP_WORDS.has(b.toLowerCase())) return [];
  return [{ kind: 'comparison', score: 5.5, template: 'kinetic-text', startWord: s.from, endWord: s.to, why: 'Contrast between two things',
    make: () => ({ text: `${aText} *${marker}* ${b}`, reveal: 'blur', position: 'center' }) }];
}

function detectFlow(s) {
  const tokens = s.words;
  for (let v = 1; v < tokens.length - 2; v++) {
    const verb = lc(tokens[v]);
    if (!FLOW_VERBS.has(verb)) continue;
    // subject: up to 4 tokens before the verb, stopping at clause breaks
    let a = v - 1;
    while (a > 0 && v - a < 4 && !CLAUSE_BREAK.has(lc(tokens[a - 1])) && !/[,;]$/.test(tokens[a - 1].text)) a--;
    const subject = nounPhrase(tokens, a, v - 1);
    // destination: first preposition after the verb
    let p = -1;
    for (let i = v + 1; i < Math.min(tokens.length, v + 9); i++) if (FLOW_PREPS.has(lc(tokens[i]))) { p = i; break; }
    if (!subject || p < 0 || p >= tokens.length - 1) continue;
    let d = p + 1;
    let e = d;
    while (e < tokens.length - 1 && e - d < 3 && !CLAUSE_BREAK.has(lc(tokens[e + 1])) && !/[,;.!?]$/.test(tokens[e].text) && !FLOW_VERBS.has(lc(tokens[e + 1]))) e++;
    const dest = nounPhrase(tokens, d, e);
    if (!dest || dest.text.toLowerCase() === subject.text.toLowerCase()) continue;
    const object = p - v > 1 ? nounPhrase(tokens, v + 1, p - 1) : null;
    const edge = limitWords(`${verb}${object ? ` ${object.text.toLowerCase()}` : ''}`, 24);
    return [{ kind: 'flow', score: 8, template: 'flow', startWord: s.from, endWord: s.to, why: `${subject.text} → ${dest.text}`,
      nodes: [{ label: subject.text, at: tokens[subject.from].start }, { label: dest.text, at: tokens[dest.from].start }], edges: [{ label: edge }],
      make() { return flowProps(this, arguments[0]); } }];
  }
  const between = s.text.match(/\bbetween\s+(.{3,30}?)\s+and\s+(.{3,30}?)(?:[,.!?]|$)/i);
  if (between) {
    const bi = tokens.findIndex(w => lc(w) === 'between');
    const ai = tokens.findIndex((w, i) => i > bi && lc(w) === 'and');
    const x = bi >= 0 && ai > bi ? nounPhrase(tokens, bi + 1, ai - 1) : null;
    let e = ai + 1;
    while (ai >= 0 && e < tokens.length - 1 && e - ai < 3 && !/[,;.!?]$/.test(tokens[e].text) && !CLAUSE_BREAK.has(lc(tokens[e + 1]))) e++;
    const y = ai >= 0 ? nounPhrase(tokens, ai + 1, e) : null;
    if (x && y) {
      return [{ kind: 'flow', score: 7, template: 'flow', startWord: s.from, endWord: s.to, why: `${x.text} ↔ ${y.text}`,
        nodes: [{ label: x.text, at: tokens[x.from].start }, { label: y.text, at: tokens[y.from].start }], edges: [{ label: '' }],
        make() { return flowProps(this, arguments[0]); } }];
    }
  }
  return [];
}

function flowProps(candidate, start) {
  return {
    nodes: candidate.nodes.map((n, i) => ({ id: `n${i}`, label: n.label, icon: iconFor(n.label), at: round(Math.max(0.3, n.at - start)) })),
    edges: candidate.edges.map((e, i) => ({ from: `n${i}`, to: `n${i + 1}`, ...(e.label ? { label: e.label } : {}) })),
    packets: true
  };
}

// Merge adjacent flow candidates that share a node into one diagram (max 5 nodes).
function chainFlows(list) {
  const merged = [];
  for (const c of list) {
    const last = merged.at(-1);
    if (c.kind === 'flow' && last && last.kind === 'flow' && c.startWord - last.endWord <= 25 && last.nodes.length < 5) {
      const tail = last.nodes.at(-1).label.toLowerCase();
      const idx = c.nodes.findIndex(n => n.label.toLowerCase() === tail);
      if (idx === 0) {
        last.nodes.push(...c.nodes.slice(1));
        last.edges.push(...c.edges);
        last.endWord = c.endWord;
        last.why = last.nodes.map(n => n.label).join(' → ');
        continue;
      }
    }
    merged.push(c);
  }
  return merged;
}

function detectQuestion(s) {
  if (!/\?["')\]]?$/.test(s.text) || s.words.length < 4 || s.words.length > 18) return [];
  const stressed = markStress(s.words, { threshold: 2.5 });
  const text = stressed.map(w => (w.stress ? `*${w.text}*` : w.text)).join(' ');
  return [{ kind: 'question', score: 4.5, template: 'kinetic-text', startWord: s.from, endWord: s.to, why: 'Question to the viewer',
    make: start => ({ text, reveal: 'mask', position: 'center', cues: s.words.map(w => round(Math.max(0.1, w.start - start))) }) }];
}

function detectKeyPhrase(s) {
  if (s.words.length < 7) return [];
  const stressed = markStress(s.words, { threshold: 2.5 });
  const hits = stressed.map((w, i) => (w.stress ? i : -1)).filter(i => i >= 0);
  if (!hits.length) return [];
  // 3-8 word window around the stressed words, clipped at commas.
  let a = Math.max(0, hits[0] - 2);
  let b = Math.min(s.words.length - 1, Math.max(hits.at(-1) + 2, a + 3));
  if (b - a > 7) b = a + 7;
  for (let i = a; i < b; i++) if (/[,;]$/.test(s.words[i].text) && i - a >= 2) { b = i; break; }
  const win = stressed.slice(a, b + 1);
  if (win.length < 3) return [];
  const text = win.map(w => (w.stress ? `*${trimEdgePunct(w.text)}*` : trimEdgePunct(w.text))).join(' ');
  return [{ kind: 'phrase', score: 1.5 + Math.min(1.4, hits.length * 0.5), template: 'kinetic-text', startWord: s.from + a, endWord: s.from + b, why: 'Key phrase',
    make: start => ({ text, reveal: 'blur', position: 'center', cues: win.map(w => round(Math.max(0.1, w.start - start))) }) }];
}

// ---- scheduling ----
export function modeFor(candidate, graphicsMode) {
  const overlayDefault = candidate.template === 'kinetic-text';
  if (graphicsMode === 'cutaway') return 'cutaway';
  if (graphicsMode === 'panel') return 'panel';
  return overlayDefault ? 'overlay' : 'cutaway';
}

export function ruleCandidates(words, { duration, graphics = 'mixed', density = 'medium' }) {
  const conf = DENSITY[density];
  const sents = sentences(words);
  const rawCandidates = [];
  for (const s of sents) {
    for (const detect of [detectTitle, detectChapter, detectDefinition, detectList, detectNumber, detectComparison, detectFlow, detectQuestion, detectKeyPhrase]) {
      for (const c of detect(s)) rawCandidates.push({ ...c, sentence: s.index });
    }
  }
  rawCandidates.push(...detectSteps(sents).map(c => ({ ...c, sentence: sents.findIndex(s => s.from <= c.startWord && s.to >= c.startWord) })));
  rawCandidates.sort((a, b) => a.startWord - b.startWord);
  const candidates = chainFlows(rawCandidates);

  const skipped = [];
  const built = [];
  for (const c of candidates) {
    const first = words[c.startWord], last = words[c.endWord];
    if (!first || !last) continue;
    const kind = modeFor(c, graphics);
    let start = Math.max(0, first.start - 0.12);
    const span = Math.max(last.end, c.lastCue ?? 0) - start;
    const min = MIN_DURATION[c.template] ?? 2.5;
    let dur = Math.max(min, span + (kind === 'cutaway' ? 0.7 : 0.5));
    const isPanel = kind === 'panel' || (kind === 'cutaway' && dur > conf.cutawayMax && c.template !== 'title');
    const maxDur = isPanel ? 26 : kind === 'cutaway' ? conf.cutawayMax : 5;
    dur = Math.min(dur, maxDur);
    if (start + dur > duration) dur = duration - start;
    if (dur < min * 0.7) { skipped.push({ kind: c.kind, reason: 'too close to the end' }); continue; }
    let props;
    try { props = c.make(start); validateProps(c.template, props, `${c.kind}.props`); } catch (error) { skipped.push({ kind: c.kind, reason: error.message.slice(0, 120) }); continue; }
    const mode = isPanel ? 'panel' : kind;
    built.push({ c, kind: c.kind, mode, start: round(start), duration: round(Math.round(dur * 30) / 30), score: c.score, template: c.template, props, why: c.why,
      line: limitWords(trimEdgePunct(phraseOf(words, c.startWord, c.endWord)), 140), numbered: c.numbered, plainTitle: c.plainTitle });
  }

  return { built, candidates: candidates.length, skipped: skipped.length };
}

export function planStoryboard(words, options = {}) {
  const { duration = words.at(-1).end, density = 'medium', graphics = 'mixed', presenter = null, role = null, theme = 'night', style = null } = options;
  if (!DENSITY[density]) throw new Error(`Explain: density must be ${Object.keys(DENSITY).join(', ')}`);
  if (!GRAPHIC_MODES.includes(graphics)) throw new Error(`Explain: graphics mode must be ${GRAPHIC_MODES.join(', ')}`);
  const { built, candidates, skipped } = ruleCandidates(words, { duration, graphics, density });
  return finalizeStoryboard(built, { words, duration, density, graphics, presenter, role, theme, candidates, skipped, engine: 'rules', style });
}


// Select graphics under the density budget and face-time rules, then number chapters and assemble the storyboard.
// `built` items: { kind, mode, start, duration, score, template, props, why, line, numbered?, plainTitle? }.
export function finalizeStoryboard(built, { words, duration, density = 'medium', graphics = 'mixed', presenter = null, role = null, theme = 'night', candidates = built.length, skipped = 0, engine = 'rules', style = null }) {
  const conf = DENSITY[density];
  void words;
  // House style: boost the templates it prefers (diagrams, flows, comparisons) and cap pull-text.
  if (style?.scoreBoost) built = built.map(it => ({ ...it, score: it.score + (style.scoreBoost[it.template] ?? 0) }));
  // Normalize durations: long full-frame ideas become side panels so the picture stays visible; others are capped per template.
  built = built.map(it => {
    let mode = it.mode;
    let dur = it.duration;
    if (mode === 'cutaway' && it.template !== 'title' && dur > conf.cutawayMax && graphics !== 'cutaway') mode = 'panel';
    if (mode === 'panel') dur = Math.min(dur, 26);
    else {
      const cap = MAX_DURATION[it.template] ?? 5;
      dur = Math.min(dur, mode === 'cutaway' ? Math.min(cap, conf.cutawayMax) : cap);
    }
    return { ...it, mode, duration: round(Math.round(dur * 30) / 30) };
  });
  // Greedy selection under the density budget and face-time rules.
  const minutes = Math.max(duration / 60, 0.25);
  const budget = Math.max(2, Math.round(conf.perMinute * minutes));
  const chosen = [];
  const fits = it => {
    for (const o of chosen) {
      const gapNeeded = it.mode === 'cutaway' && o.mode === 'cutaway' ? conf.faceGap : (it.mode === 'overlay' && o.mode === 'overlay') ? 0.35 : 0.3;
      const overlap = it.start < o.start + o.duration + gapNeeded && o.start < it.start + it.duration + gapNeeded;
      // Nothing overlaps: strips would collide with side panels, and a cutaway hides everything.
      if (overlap) return false;
    }
    return true;
  };
  const hookSafe = it => it.start >= 1 || it.kind === 'title';
  const shareCap = template => (style?.maxShare?.[template] === undefined ? Infinity : Math.max(1, Math.floor(style.maxShare[template] * budget)));
  const count = template => chosen.filter(c => c.template === template).length;
  for (const it of [...built].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (chosen.length >= budget) break;
    if (!hookSafe(it) || !fits(it) || count(it.template) >= shareCap(it.template)) continue;
    chosen.push(it);
  }
  // Fill long gaps with the best remaining candidate that fits there.
  chosen.sort((a, b) => a.start - b.start);
  for (let pass = 0; pass < 3; pass++) {
    const points = [0, ...chosen.map(x => x.start + x.duration), duration];
    let added = false;
    for (let i = 0; i < points.length - 1; i++) {
      const gapStart = points[i], gapEnd = i + 1 < points.length - 1 ? chosen[i].start : duration;
      if (gapEnd - gapStart < conf.fillGap) continue;
      const pick = built.filter(it => !chosen.includes(it) && it.start >= gapStart && it.start + it.duration <= gapEnd && hookSafe(it) && fits(it) && count(it.template) < shareCap(it.template))
        .sort((a, b) => b.score - a.score)[0];
      if (pick) { chosen.push(pick); chosen.sort((a, b) => a.start - b.start); added = true; break; }
    }
    if (!added) break;
  }

  // Number chapter cards in order and finalize overlay geometry.
  let chapterNumber = 0;
  const items = chosen.map((it, i) => {
    const props = it.numbered ? (() => { chapterNumber += 1; return { ...it.props, number: String(chapterNumber).padStart(2, '0') }; })() : it.props;
    if (style?.labelSchematic && ['flow', 'steps', 'comparison'].includes(it.template) && !props.citation) props.citation = 'Conceptual schematic';
    const item = { id: `g${String(i + 1).padStart(2, '0')}`, kind: it.kind, template: it.template, mode: it.mode, start: it.start, duration: it.duration,
      score: round(it.score), why: it.why, line: it.line, props };
    if (it.plainTitle) item.chapterTitle = it.plainTitle;
    return item;
  });
  if (presenter && !items.some(x => x.start < 6 && x.mode === 'cutaway' && x.start < 1.5)) {
    items.unshift({ id: 'presenter', kind: 'presenter', template: 'lower-third', mode: 'overlay', start: 1, duration: 4, score: 10, why: 'Presenter introduction', line: '',
      props: { name: presenter, ...(role ? { role } : {}) } });
  }
  const byTemplate = {};
  for (const it of items) byTemplate[it.template] = (byTemplate[it.template] || 0) + 1;
  return {
    version: 1, engine, style: style?.name ?? 'plain', density, graphics, theme, duration: round(duration),
    stats: { graphics: items.length, perMinute: round(items.length / minutes), cutawaySeconds: round(items.filter(x => x.mode === 'cutaway').reduce((n, x) => n + x.duration, 0)),
      candidates, skipped, byTemplate },
    notes: ['Every label, number and phrase comes from the transcript; no data is invented. Verify wording and numbers before publishing.'],
    items
  };
}

// ---- applying a storyboard to a version-2 manifest ----
const OVERLAY_PLACEMENT = { overlay: 'strip-center', panel: 'right' };
export function applyStoryboard(manifest, storyboard, style = null) {
  const out = JSON.parse(JSON.stringify(manifest));
  if (!storyboard || storyboard.version !== 1 || !Array.isArray(storyboard.items)) throw new Error('Explain: invalid storyboard.json');
  // Theme tokens the manifest already sets win; the house style fills the rest, then the storyboard's preset.
  const manifestPreset = out.theme?.preset;
  out.theme = { ...(style?.theme || {}), ...(out.theme || {}) };
  if (!manifestPreset && storyboard.theme) out.theme.preset = storyboard.theme;
  out.globalOverlays = (out.globalOverlays || []).filter(o => !String(o.id || '').startsWith('sb:'));
  for (const it of storyboard.items) {
    const overlay = { id: `sb:${it.id}`, note: `${it.kind}: ${it.why}`.slice(0, 300), template: it.template, props: it.props, start: it.start, duration: it.duration };
    if (it.mode === 'cutaway') overlay.background = 'grid';
    else if (it.template !== 'lower-third') {
      overlay.placement = it.placement || (it.mode === 'panel' ? 'right' : (it.template === 'kinetic-text' ? 'strip-top' : OVERLAY_PLACEMENT[it.mode]));
      overlay.panel = true;
    }
    if (style?.panelLayout === 'split' && overlay.placement === 'right' && it.mode === 'panel') overlay.layout = 'split';
    out.globalOverlays.push(overlay);
  }
  // No camera motion under a graphic: a zoom behind a panel or card reads as flicker and crops the content being explained.
  {
    let at = 0;
    const spans = out.scenes.map((scene, i) => { const start = at; at += scene.duration - (scene.transition?.duration ?? 0); return [start, start + scene.duration]; });
    const windows = storyboard.items.map(i => [i.start, i.start + i.duration]);
    out.scenes.forEach((scene, i) => {
      if (scene.motion && windows.some(([a, b]) => spans[i][0] < b && spans[i][1] > a)) delete scene.motion;
    });
  }
  // Chapter cards double as YouTube chapter labels on the scene they fall in.
  let cursor = 0;
  const starts = out.scenes.map((scene, i) => { const s = cursor; cursor += scene.duration - (out.scenes[i].transition?.duration ?? 0); return s; });
  for (const it of storyboard.items.filter(x => x.chapterTitle)) {
    let idx = starts.findIndex((s, i) => s <= it.start && (i === starts.length - 1 || starts[i + 1] > it.start));
    if (idx < 0) idx = 0;
    if (!out.scenes[idx].chapter) out.scenes[idx].chapter = it.chapterTitle.slice(0, 80);
  }
  if (out.captions && !out.captions.style) out.captions.style = 'kinetic';
  return out;
}

export function storyboardMarkdown(storyboard, title = 'Storyboard') {
  const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const rows = storyboard.items.map((it, i) => `| ${i + 1} | ${fmt(it.start)}–${fmt(it.start + it.duration)} | ${it.line.replace(/\|/g, '/') || '(presenter)'} | \`${it.template}\` | ${it.mode} | ${it.why.replace(/\|/g, '/')} |`);
  return `# ${title}\n\nDensity **${storyboard.density}**, graphics mode **${storyboard.graphics}**, theme **${storyboard.theme}**. ` +
    `${storyboard.stats.graphics} graphics (${storyboard.stats.perMinute}/min), ${storyboard.stats.cutawaySeconds}s of full-frame cutaways.\n\n` +
    `| # | In–Out | The line it covers | Graphic | Mode | Why |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n` +
    `${storyboard.notes.join('\n')}\n\nEdit \`storyboard.json\` (change, delete or add items) and re-apply it with \`video-monk storyboard --from-storyboard\`.\n`;
}

// Choose a theme preset from the picture: bright footage (slides, documents) gets the paper theme, dark footage night.
export async function pickTheme(media, execute = run) {
  try {
    const { stdout } = await execute(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', media,
      '-vf', 'fps=1/20,scale=16:9,format=gray', '-frames:v', '12', '-f', 'rawvideo', '-'], { encoding: 'buffer', timeout: 600_000 });
    const data = Buffer.from(stdout);
    if (!data.length) return 'night';
    let sum = 0;
    for (const b of data) sum += b;
    return sum / data.length > 128 ? 'paper' : 'night';
  } catch { return 'night'; }
}
