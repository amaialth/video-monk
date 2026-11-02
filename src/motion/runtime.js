// In-page runtime shared by all motion templates. Serialized into each render page.
// Everything is a pure function of time `t`: no CSS transitions, timers or randomness.
export const RUNTIME = String.raw`
const VM = (() => {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = {
    linear: x => x,
    in: x => x * x * x,
    out: x => 1 - Math.pow(1 - x, 3),
    inOut: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    expo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x))
  };
  const p = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));
  const tw = (t, start, dur, from, to, e = 'out') => from + (to - from) * ease[e](p(t, start, dur));
  const SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs = {}, parent, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style') Object.assign(node.style, v); else node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.appendChild(node);
    return node;
  }
  function svg(tag, attrs = {}, parent, text) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.appendChild(node);
    return node;
  }
  const set = (node, styles) => { for (const [k, v] of Object.entries(styles)) node.style[k] = v; };
  const r = (n, d = 3) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
  function fmt(n, decimals = 0) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  // Shrink a node's font until its content fits within maxWidth (and optional maxHeight).
  function fit(node, maxWidth, size, min, maxHeight) {
    let s = size;
    node.style.fontSize = s + 'px';
    while (s > min && (node.scrollWidth > maxWidth + 1 || (maxHeight && node.scrollHeight > maxHeight + 1))) {
      s = s * 0.94;
      node.style.fontSize = s + 'px';
    }
    return s;
  }
  // Standard enter/exit envelope: 0 -> 1 over the intro, 1 -> 0 over the outro (overlays only).
  function life(t, ctx, delay = 0, dur = 0.5) {
    const enter = ease.out(p(t, delay, dur));
    const exit = ctx.exit ? 1 - ease.in(p(t, ctx.duration - 0.35, 0.35)) : 1;
    return Math.min(enter, exit);
  }
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(v.slice(0, 6), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }
  const ICONS = {
    server: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.9 3.1-6 7-6s7 2.1 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.3c2.4.7 4 2.6 4 5.7"/>',
    cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.3 9.2 5 5 0 0 0 7 19z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    check: '<path d="M4 12.5 9.5 18 20 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    code: '<path d="M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    queue: '<rect x="2" y="8" width="5" height="8" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/><rect x="17" y="8" width="5" height="8" rx="1"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    mail: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    key: '<circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 9-9M17 6l3 3"/>',
    warning: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
    star: '<path d="m12 2 3 6.6 7 .9-5.2 4.8 1.4 7L12 17.8 5.8 21.3l1.4-7L2 9.5l7-.9z"/>',
    arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5 6.5 17M12 11.5l5.5 5.5"/>'
  };
  function icon(name, size, color, parent) {
    const box = el('span', { style: { display: 'inline-block', width: size + 'px', height: size + 'px', flex: '0 0 auto' } }, parent);
    box.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="' + color +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return box;
  }
  // Tiny generic syntax highlighter: comments, strings, numbers, keywords.
  const KEYWORDS = new Set(('if else for while return function const let var class new import from export def async await ' +
    'try except catch finally with as in of not and or is None null true false True False public private static void ' +
    'int string bool struct type interface package go func select where insert update delete create table join on ' +
    'yield lambda raise throw extends implements this self fn mut match impl use pub enum case switch break continue do')
    .split(' '));
  function tokens(code) {
    const out = [];
    const re = /(\/\/[^\n]*|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|(\s+)|([^\sA-Za-z_\d])/g;
    let m;
    while ((m = re.exec(code))) {
      const kind = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'number' : m[4] ? (KEYWORDS.has(m[4]) ? 'keyword' : 'ident') : m[5] ? 'space' : 'punct';
      out.push({ kind, text: m[0] });
    }
    return out;
  }
  return { clamp, ease, p, tw, el, svg, set, r, fmt, fit, life, hexToRgba, icon, ICONS, tokens };
})();
`;

// Builds a complete self-contained render page. Props/theme are JSON-escaped; text is inserted with textContent.
export function renderPage({ templateSource, props, ctx, fontDataUrl, background }) {
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const t = ctx.theme;
  const backgrounds = {
    transparent: 'transparent',
    plain: t.background,
    gradient: `radial-gradient(120% 90% at 20% 10%, ${t.surface} 0%, ${t.background} 60%)`,
    grid: `linear-gradient(${t.grid} 1px, transparent 1px) 0 0 / ${ctx.unit * 6}px ${ctx.unit * 6}px, ` +
      `linear-gradient(90deg, ${t.grid} 1px, transparent 1px) 0 0 / ${ctx.unit * 6}px ${ctx.unit * 6}px, ` +
      `radial-gradient(120% 90% at 20% 10%, ${t.surface} 0%, ${t.background} 65%)`
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontDataUrl ? `@font-face{font-family:VMFont;src:url(${fontDataUrl});}` : ''}
html,body{margin:0;padding:0;width:${ctx.width}px;height:${ctx.height}px;overflow:hidden;background:transparent;}
#frame{position:absolute;inset:0;background:${backgrounds[background] || 'transparent'};}
#stage{position:absolute;box-sizing:border-box;overflow:hidden;color:${t.text};
  font-family:VMFont,-apple-system,'SF Pro Display','Helvetica Neue','Segoe UI',Roboto,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.15;}
#stage *{box-sizing:border-box;}
</style></head><body><div id="frame"></div><div id="stage"></div>
<script>
${RUNTIME}
const __props = ${json(props)};
const __ctx = ${json(ctx)};
const __template = (${templateSource});
(async () => {
  try {
    if (${fontDataUrl ? 'true' : 'false'}) await document.fonts.load('32px VMFont');
    await document.fonts.ready;
    const stage = document.getElementById('stage');
    const box = __ctx.box;
    Object.assign(stage.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    if (__ctx.panel) Object.assign(stage.style, { background: VM.hexToRgba(__ctx.theme.background, 0.86),
      borderRadius: (__ctx.unit * 2.2) + 'px', boxShadow: '0 ' + __ctx.unit + 'px ' + (__ctx.unit * 4) + 'px rgba(0,0,0,0.45)',
      border: '1px solid ' + VM.hexToRgba(__ctx.theme.text, 0.12) });
    const ctx = Object.assign({}, __ctx, { w: box.w, h: box.h, u: Math.min(box.w, box.h) / 100 });
    const update = __template(stage, __props, ctx, VM);
    const frame = document.getElementById('frame');
    window.__seek = t => {
      update(t);
      if (__ctx.panel) {
        const k = VM.life(t, ctx, 0, 0.45);
        stage.style.opacity = VM.r(k);
        stage.style.transform = 'translateY(' + VM.r((1 - k) * ctx.u * 4) + 'px)';
      }
    };
    window.__sig = () => {
      const s = stage.outerHTML;
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16) + ':' + s.length;
    };
    window.__seek(0);
    window.__vmReady = true;
  } catch (error) {
    window.__vmError = String(error && error.stack || error);
  }
})();
</script></body></html>`;
}
