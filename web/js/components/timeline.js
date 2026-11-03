import { h, fmt } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); for (const c of kids.flat()) if (c) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };

export const LANE_COLORS = { cut: '#5b6b8a', cutAlt: '#475672', cutaway: '#a78bfa', panel: '#4cc9f0', overlay: '#fbbf24', broll: '#34d399', sfx: '#f472b6', music: '#60a5fa' };

// Multi-lane timeline: cuts, graphics (by mode), B-roll, sound effects, music, with chapter markers and a clickable ruler.
export function timeline(data, { onSeek, removed = new Set() } = {}) {
  if (!data) return h('div', { class: 'muted' }, 'No timeline yet.');
  const W = 1000, labelW = 78, laneH = 22, gap = 7, top = 22;
  const lanes = [['Cuts', 'cut'], ['Graphics', 'gfx'], ['B-roll', 'broll'], ['Sound', 'sfx']];
  if (data.music?.length) lanes.push(['Music', 'music']);
  const H = top + lanes.length * (laneH + gap) + 6;
  const dur = Math.max(1, data.duration);
  const x = t => labelW + (t / dur) * (W - labelW - 8);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Timeline of cuts, graphics, B-roll and sound' });
  // ruler
  const step = [5, 10, 15, 30, 60, 120, 300, 600].find(v => dur / v <= 12) || 600;
  for (let t = 0; t <= dur; t += step) { svg.append(s('line', { x1: x(t), x2: x(t), y1: top - 5, y2: H, stroke: 'currentColor', 'stroke-opacity': .08 }), s('text', { x: x(t) + 3, y: 12, fill: 'currentColor', 'fill-opacity': .55, 'font-size': 10.5, 'font-family': 'Geist Mono, monospace' }, fmt.dur(t))); }
  const laneY = i => top + i * (laneH + gap);
  lanes.forEach(([label], i) => { svg.append(s('text', { x: 0, y: laneY(i) + 15, fill: 'currentColor', 'fill-opacity': .6, 'font-size': 11.5, 'font-weight': 600 }, label), s('rect', { x: labelW, y: laneY(i), width: W - labelW - 8, height: laneH, rx: 5, fill: 'currentColor', 'fill-opacity': .04 })); });
  const bar = (i, start, d, color, title, opacity = 1) => { const r = s('rect', { x: x(start), y: laneY(i), width: Math.max(2, x(start + d) - x(start) - 1), height: laneH, rx: 4, fill: color, 'fill-opacity': opacity }); r.append(s('title', {}, title)); svg.append(r); return r; };
  data.cuts.forEach((c, k) => bar(0, c.start, c.duration, k % 2 ? LANE_COLORS.cut : LANE_COLORS.cutAlt, `Cut ${k + 1}: ${fmt.dur(c.start)} for ${c.duration.toFixed(1)} s`, .85));
  data.graphics.forEach(g => { const r = bar(1, g.start, g.duration, LANE_COLORS[g.mode] || LANE_COLORS.cutaway, `${g.template} (${g.mode}) at ${fmt.dur(g.start)}, ${g.duration.toFixed(1)} s`, .9); if (g.id && removed.has(g.id)) r.setAttribute('fill-opacity', .15); });
  data.broll.forEach(b => bar(2, b.start, b.duration, LANE_COLORS.broll, `B-roll at ${fmt.dur(b.start)}, ${b.duration.toFixed(1)} s`, .9));
  data.sfx.forEach(f => { const c = s('circle', { cx: x(f.at), cy: laneY(3) + laneH / 2, r: 5, fill: LANE_COLORS.sfx }); c.append(s('title', {}, `${f.kind} at ${fmt.dur(f.at)}`)); svg.append(c); });
  (data.music || []).forEach(m => bar(4, m.start, m.end - m.start, LANE_COLORS.music, 'Music bed', .55));
  (data.chapters || []).forEach(c => { svg.append(s('line', { x1: x(c.at), x2: x(c.at), y1: top - 2, y2: H - 2, stroke: '#fbbf24', 'stroke-opacity': .55, 'stroke-dasharray': '3 3' })); });
  const head = s('line', { x1: labelW, x2: labelW, y1: top - 6, y2: H, stroke: 'var(--accent)', 'stroke-width': 2, opacity: 0 });
  svg.append(head);
  svg.style.cursor = onSeek ? 'pointer' : 'default';
  svg.addEventListener('click', e => { if (!onSeek) return; const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; const t = Math.max(0, Math.min(dur, (px - labelW) / (W - labelW - 8) * dur)); onSeek(t); });
  const legend = h('div', { class: 'legend' }, [['Cut', LANE_COLORS.cut], ['Full-frame graphic', LANE_COLORS.cutaway], ['Side panel', LANE_COLORS.panel], ['Top-bar text', LANE_COLORS.overlay], ['B-roll', LANE_COLORS.broll], ['Sound effect', LANE_COLORS.sfx]].map(([l, c]) => h('span', {}, h('i', { style: { background: c } }), l)));
  const el = h('div', { class: 'lanes' }, svg, legend);
  el.setPlayhead = t => { const px = x(t); head.setAttribute('x1', px); head.setAttribute('x2', px); head.setAttribute('opacity', 1); };
  return el;
}
