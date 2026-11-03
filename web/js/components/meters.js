import { h } from '../ui.js';
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// Half-circle gauge. value within [min, max]; the band [goodFrom, goodTo] is drawn as the target range.
export function gauge({ value, min, max, goodFrom, goodTo, label, unit = '', decimals = 1 }) {
  const svg = s('svg', { viewBox: '0 0 150 92' });
  const arc = (a0, a1, r = 62) => { const p = a => [75 + r * Math.cos(Math.PI * (1 - a)), 80 - r * Math.sin(Math.PI * (1 - a))]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`; };
  const frac = v => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const track = s('path', { d: arc(0, 1), fill: 'none', stroke: 'currentColor', 'stroke-opacity': .12, 'stroke-width': 10, 'stroke-linecap': 'round' });
  svg.append(track);
  if (goodFrom !== undefined) svg.append(s('path', { d: arc(frac(goodFrom), frac(goodTo)), fill: 'none', stroke: 'var(--good)', 'stroke-opacity': .45, 'stroke-width': 10 }));
  const ok = Number.isFinite(value) && (goodFrom === undefined || (value >= goodFrom && value <= goodTo));
  if (Number.isFinite(value)) {
    svg.append(s('path', { d: arc(0, Math.max(.01, frac(value))), fill: 'none', stroke: ok ? 'var(--accent)' : 'var(--warn)', 'stroke-width': 10, 'stroke-linecap': 'round' }));
    const a = Math.PI * (1 - frac(value)); svg.append(s('circle', { cx: 75 + 62 * Math.cos(a), cy: 80 - 62 * Math.sin(a), r: 5.5, fill: 'var(--text)' }));
  }
  return h('div', { class: 'gauge' }, h('div', { class: 'gw' }, svg, h('div', { class: 'gv' }, Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '–')), h('div', { class: 'gl' }, label));
}

export function donut(ratio, { size = 96, label = '' } = {}) {
  const r = 38, c = 2 * Math.PI * r;
  const svg = s('svg', { viewBox: '0 0 100 100', width: size, height: size });
  svg.append(s('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: 'currentColor', 'stroke-opacity': .12, 'stroke-width': 11 }));
  svg.append(s('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * Math.max(0, Math.min(1, ratio))} ${c}`, transform: 'rotate(-90 50 50)' }));
  const t = s('text', { x: 50, y: 56, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 20, 'font-weight': 650 }); t.textContent = `${Math.round(ratio * 100)}%`; svg.append(t);
  return h('div', { style: { textAlign: 'center' } }, svg, label ? h('div', { class: 'faint tiny' }, label) : null);
}
