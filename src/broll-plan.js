// B-roll planning: decide where B-roll is needed, offline, from the transcript and what the edit already shows.
// A moment is a spoken line that names something a viewer can picture ("a data center", "a busy warehouse") where no graphic is already
// on screen, plus any long stretch where only the speaker has been visible. Queries are drafts for the editor to refine; nothing is fetched here.
import { sentences } from './explain.js';
import { STOP_WORDS, cleanWord } from './stress.js';
import { graphicsOf } from './sfx.js';

const round = n => Math.round(n * 1000) / 1000;

// Things a camera can show. Multi-word entries are matched as phrases and win over single words.
const CONCRETE = {
  tech: ['server', 'servers', 'data center', 'datacenter', 'network', 'router', 'cable', 'cables', 'laptop', 'computer', 'keyboard', 'monitor', 'screen', 'smartphone', 'phone', 'chip', 'circuit', 'robot', 'drone', 'satellite', 'antenna', 'battery', 'wifi', 'cloud', 'database'],
  place: ['city', 'office', 'warehouse', 'factory', 'airport', 'station', 'bank', 'store', 'shop', 'market', 'restaurant', 'kitchen', 'hospital', 'school', 'university', 'library', 'farm', 'port', 'harbor', 'street', 'highway', 'bridge', 'building', 'skyscraper', 'house', 'home', 'garden', 'stadium', 'laboratory', 'lab'],
  transport: ['truck', 'trucks', 'ship', 'ships', 'train', 'plane', 'airplane', 'car', 'cars', 'traffic', 'road', 'rocket', 'bicycle', 'container', 'containers', 'delivery', 'package', 'packages', 'courier'],
  nature: ['forest', 'ocean', 'sea', 'river', 'mountain', 'desert', 'rain', 'storm', 'fire', 'water', 'sun', 'sunrise', 'sunset', 'snow', 'field', 'tree', 'trees', 'flower', 'flowers', 'beach', 'lightning', 'earth', 'planet', 'space', 'stars'],
  money: ['money', 'cash', 'coins', 'bank', 'wallet', 'invoice', 'payment', 'payments', 'credit card', 'stock market', 'trading'],
  work: ['meeting', 'team', 'customer', 'customers', 'crowd', 'queue', 'handshake', 'whiteboard', 'notebook', 'paperwork', 'contract', 'documents', 'typing', 'coding', 'writing', 'cooking', 'building', 'construction', 'assembly line', 'production line'],
  things: ['clock', 'time', 'lock', 'key', 'door', 'gate', 'maze', 'puzzle', 'chain', 'gears', 'gear', 'engine', 'lightbulb', 'light bulb', 'magnifying glass', 'compass', 'map', 'camera', 'microphone', 'book', 'books']
};
const LEXICON = new Map();
for (const [category, list] of Object.entries(CONCRETE)) for (const term of list) if (!LEXICON.has(term)) LEXICON.set(term, category);
const PHRASES = [...LEXICON.keys()].filter(t => t.includes(' ')).sort((a, b) => b.length - a.length);

export const BROLL_DENSITY = { light: { perMinute: 1, gap: 40 }, medium: { perMinute: 2, gap: 25 }, heavy: { perMinute: 3, gap: 18 } };
// By footage type: screens and interviews are the content themselves, so B-roll is rare.
export const CONTENT_DENSITY = { 'talking-head': 'medium', explainer: 'medium', screen: 'light', interview: 'light' };

const tokens = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);

// Concrete subjects in a sentence, strongest first: [{ term, category }].
export function concreteTerms(text) {
  const low = ` ${tokens(text).join(' ')} `;
  const found = [];
  for (const phrase of PHRASES) if (low.includes(` ${phrase} `)) found.push({ term: phrase, category: LEXICON.get(phrase) });
  for (const t of tokens(text)) if (LEXICON.has(t) && !found.some(f => f.term.includes(t))) found.push({ term: t, category: LEXICON.get(t) });
  return found;
}

// Short English search query for a stock site: a concrete subject, plus the adjective just before it when there is one.
export function queryFor(text, found) {
  const t = tokens(text);
  const top = found[0]?.term;
  if (!top) return keywordQuery(text);
  const idx = t.indexOf(top.split(' ')[0]);
  const before = idx > 0 ? t[idx - 1] : null;
  const adjective = before && !STOP_WORDS.has(before) && before.length > 3 && !LEXICON.has(before) && !/(ing|ly)$/.test(before) ? before : null;
  return [adjective, top, ...(found[1] && found[1].term !== top ? [found[1].term] : [])].filter(Boolean).slice(0, 3).join(' ');
}

function keywordQuery(text) {
  const tally = new Map();
  for (const t of tokens(text)) { const c = cleanWord(t).toLowerCase(); if (c.length > 3 && !STOP_WORDS.has(c) && !/^\d+$/.test(c)) tally.set(c, (tally.get(c) || 0) + 1); }
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w).join(' ') || 'abstract background';
}

// Stretches of the timeline where the speaker is the only thing on screen (no graphic, no B-roll), longer than `limit` seconds.
export function visualGaps(manifest, duration, limit) {
  const covered = graphicsOf(manifest).filter(g => g.mode !== 'overlay').map(g => [g.start, g.start + g.duration]);
  let at = 0;
  for (const s of manifest.scenes) {
    for (const b of Array.isArray(s.broll) ? s.broll : s.broll ? [s.broll] : []) covered.push([at + b.start, at + b.start + b.duration]);
    at += s.duration;
  }
  covered.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let from = 0;
  for (const [a, b] of covered) { if (a - from > limit) gaps.push({ from: round(from), to: round(a) }); from = Math.max(from, b); }
  if (duration - from > limit) gaps.push({ from: round(from), to: round(duration) });
  return gaps;
}

// manifest: the version-2 manifest object; words: timeline-relative caption words. Returns the plan.
export function planBroll(manifest, words, { density, content = 'talking-head', hookSeconds = 5, tailSeconds = 5 } = {}) {
  const level = density || CONTENT_DENSITY[content] || 'medium';
  if (level === 'off') return { version: 1, density: 'off', content, moments: [], gaps: [], stats: { moments: 0 }, notes: ['B-roll planning is off.'] };
  if (!BROLL_DENSITY[level]) throw new Error(`B-roll: density must be off, ${Object.keys(BROLL_DENSITY).join(', ')}`);
  const conf = BROLL_DENSITY[level];
  const duration = manifest.scenes.reduce((n, s) => n + s.duration, 0);
  const windows = graphicsOf(manifest).map(g => [g.start - 0.4, g.start + g.duration + 0.4]);
  const existing = [];
  let cursor = 0;
  for (const s of manifest.scenes) { for (const b of Array.isArray(s.broll) ? s.broll : s.broll ? [s.broll] : []) existing.push([cursor + b.start - 0.4, cursor + b.start + b.duration + 0.4]); cursor += s.duration; }
  const blocked = [...windows, ...existing];
  const free = (a, b) => a >= hookSeconds && b <= duration - tailSeconds && !blocked.some(([x, y]) => a < y && x < b);

  const candidates = [];
  for (const s of sentences(words)) {
    const found = concreteTerms(s.text);
    if (!found.length) continue;
    const at = round(Math.max(hookSeconds, s.start + 0.3));
    const length = Math.min(7, Math.max(3, s.end - s.start + 0.6));
    candidates.push({ at, duration: round(Math.round(length * 24) / 24), line: s.text.slice(0, 140), found, score: found.length * 2 + found.filter(f => f.term.includes(' ')).length,
      query: queryFor(s.text, found), alternatives: [...new Set(found.map(f => f.term))].slice(0, 3), why: `names ${found.slice(0, 2).map(f => `"${f.term}"`).join(' and ')}, which a viewer can picture` });
  }
  const budget = Math.max(1, Math.round(conf.perMinute * (duration / 60)));
  const chosen = [];
  const compatible = c => free(c.at, c.at + c.duration) && chosen.every(o => c.at >= o.at + o.duration + 12 || o.at >= c.at + c.duration + 12);
  for (const c of [...candidates].sort((a, b) => b.score - a.score || a.at - b.at)) {
    if (chosen.length >= budget) break;
    if (compatible(c)) chosen.push({ ...c, kind: 'concrete', confidence: c.score >= 3 ? 'high' : 'medium' });
  }
  // Long stretches with only the speaker: propose something there even when no concrete subject was named.
  const sorted = list => list.sort((a, b) => a.at - b.at);
  for (let pass = 0; pass < 4; pass++) {
    const stillGaps = visualGaps({ ...manifest, scenes: manifest.scenes.map(s => s), globalOverlays: [...(manifest.globalOverlays || []), ...chosen.map(c => ({ template: 'broll', start: c.at, duration: c.duration, background: 'x' }))] }, duration, conf.gap);
    if (!stillGaps.length) break;
    const gap = stillGaps[0];
    const middle = (gap.from + gap.to) / 2;
    const near = sentences(words).filter(s => free(Math.max(hookSeconds, s.start + 0.3), Math.max(hookSeconds, s.start + 0.3) + 4) && s.start > gap.from && s.end < gap.to)
      .sort((a, b) => Math.abs(a.start - middle) - Math.abs(b.start - middle))[0];
    if (!near) break;
    const found = concreteTerms(near.text);
    const at = round(Math.max(hookSeconds, near.start + 0.3));
    chosen.push({ at, duration: 4, line: near.text.slice(0, 140), found, score: 1, query: queryFor(near.text, found), alternatives: [keywordQuery(near.text)], kind: 'gap', confidence: 'low',
      why: `${round(gap.to - gap.from)} s with only the speaker on screen; refine the query to the topic` });
    sorted(chosen);
  }
  const moments = sorted(chosen).map((c, i) => ({ id: `b${String(i + 1).padStart(2, '0')}`, at: c.at, duration: c.duration, line: c.line, query: c.query, alternatives: c.alternatives, kind: c.kind, confidence: c.confidence, why: c.why }));
  const gapsAfter = visualGaps({ ...manifest, globalOverlays: [...(manifest.globalOverlays || []), ...moments.map(m => ({ template: 'broll', start: m.at, duration: m.duration, background: 'x' }))] }, duration, conf.gap);
  const covered = moments.reduce((n, m) => n + m.duration, 0);
  return {
    version: 1, density: level, content, duration: round(duration), moments, gaps: gapsAfter,
    stats: { moments: moments.length, perMinute: round(moments.length / Math.max(duration / 60, 0.25)), coveredSeconds: round(covered), coveredShare: round(covered / Math.max(duration, 1)), gapsBefore: visualGaps(manifest, duration, conf.gap).length, gapsAfter: gapsAfter.length },
    notes: ['Queries are drafts from the transcript. Refine each in English (2-4 words), look at the clip before placing it, and skip any moment where B-roll would hide the point.',
      ...(level === 'light' ? [`Footage type "${content}": B-roll is kept sparse because the picture itself is the content.`] : [])]
  };
}

export function brollPlanMarkdown(plan, title = 'B-roll plan') {
  const t = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (!plan.moments.length) return `# ${title}\n\nNo B-roll needed: ${plan.notes.join(' ')}\n`;
  const rows = plan.moments.map(m => `| ${m.id} | ${t(m.at)} | ${m.duration}s | ${m.line.replace(/\|/g, '/')} | \`${m.query}\` | ${m.confidence} | ${m.why.replace(/\|/g, '/')} |`);
  return `# ${title}\n\n${plan.stats.moments} moment(s), ${plan.stats.coveredSeconds}s of B-roll (${Math.round(plan.stats.coveredShare * 100)}% of the video), density **${plan.density}**, footage **${plan.content}**.\n` +
    `Stretches over the speaker-only limit: ${plan.stats.gapsBefore} before planning, ${plan.stats.gapsAfter} after.\n\n| # | At | Length | The line it covers | Search | Confidence | Why |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n${plan.notes.join('\n')}\n\n` +
    `Next: \`video-monk broll-fetch --plan <plan.json> ...\` (needs --allow-search --allow-download --rights-confirmed), look at the previews, then \`video-monk broll-apply\`.\n`;
}
