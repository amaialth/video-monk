// Tiny DOM helpers, icons and formatters shared by every view. No framework: views build nodes with h() and replace their container.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...nodes) => { clear(el); el.append(...nodes.flat(Infinity).filter(Boolean)); return el; };

const P = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', film: 'M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14', play: 'M7 5l12 7-12 7z', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14', home: 'M4 11l8-7 8 7v9H5z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 6l3 .8-3 13-3-.8z', gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 13v-2l2-.6.6-1.4-1-1.8 1.4-1.4 1.8 1 1.4-.6L11 4h2l.6 2.2 1.4.6 1.8-1 1.4 1.4-1 1.8.6 1.4L20 11v2l-2.2.6-.6 1.4 1 1.8-1.4 1.4-1.8-1-1.4.6L13 20h-2l-.6-2.2-1.4-.6-1.8 1-1.4-1.4 1-1.8-.6-1.4z',
  sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4', scissors: 'M6 6a2.5 2.5 0 1 0 0 .01M6 18a2.5 2.5 0 1 0 0 .01M8 8l12 9M8 16l12-9', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5', sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  wave: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2', render: 'M4 5h16v11H4zM8 20h8M12 16v4', phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.5', download: 'M12 4v11M7 11l5 5 5-5M5 20h14', back: 'M15 5l-7 7 7 7', trash: 'M5 7h14M10 4h4M7 7l1 13h8l1-13', copy: 'M8 8h11v12H8zM5 16V4h11', clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  chev: 'M9 6l6 6-6 6', external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5', up: 'M12 19V6M6 11l6-6 6 6', music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9a1 1 0 1 0 0 .01', text: 'M5 6h14M12 6v13M9 19h6', book: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12',
  flash: 'M13 3L5 14h6l-1 7 8-11h-6z', stop: 'M6 6h12v12H6z', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
};
export function icon(name, size = 18, extra = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  if (extra) svg.setAttribute('class', extra);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] || P.info);
  svg.append(path);
  return svg;
}

export const fmt = {
  dur(s) { if (!Number.isFinite(s)) return '–'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; },
  size(b) { if (!Number.isFinite(b)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`; },
  ago(iso) { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`; return new Date(iso).toLocaleDateString(); },
  time(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); },
  num(n, d = 1) { return Number.isFinite(n) ? (Math.round(n * 10 ** d) / 10 ** d).toString() : '–'; },
  pct(n) { return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '–'; }
};

export const STATUS = {
  draft: ['Not started', ''], running: ['Running', 'run'], waiting: ['Needs your approval', 'warn'], done: ['Approved', 'good'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', ''], interrupted: ['Interrupted', 'warn'], imported: ['Imported', 'info'],
  'needs-attention': ['Needs attention', 'warn'], 'changes-requested': ['Changes requested', 'warn'], pending: ['Waiting', ''], skipped: ['Skipped', '']
};
export function statusChip(status, label) {
  const [text, kind] = STATUS[status] || [status, ''];
  return h('span', { class: `chip ${kind}` }, status === 'running' ? h('i', { class: 'pulse' }) : null, label || text);
}

let toastTimer;
export function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, message);
  box.append(t);
  clearTimeout(toastTimer);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}

export function modal(content, { onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(); } }, h('div', { class: 'modal card' }, typeof content === 'function' ? content(close) : content));
  document.addEventListener('keydown', esc);
  document.body.append(back);
  return close;
}

export function confirmDialog(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    modal(close => h('div', { class: 'col' }, h('h3', {}, title), h('p', { class: 'muted' }, body),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { close(); resolve(true); } }, okLabel))),
    { onClose: () => resolve(false) });
  });
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const draw = () => mount(wrap, options.map(([v, label]) => h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; draw(); onChange(v); } }, label)));
  draw();
  return wrap;
}
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
