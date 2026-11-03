// Readability audit for a rendered motion graphic: text that falls off the canvas or is clipped, text too small to read on a phone,
// and text with too little contrast against what is behind it. Runs inside the page at a few settled moments.
export const MIN_FONT_RATIO = 0.022; // of the short side: 24 px on a 1080p frame
export const MIN_CONTRAST = 3;       // WCAG AA for large text; small text is flagged by size instead

// Source of the in-page function (evaluated, not imported), so it must be self-contained.
export function auditExpression(width, height, background) {
  return `(${function (W, H, BG, minRatio, minContrast) {
    const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
    const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a }; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const issues = [];
    const seen = new Set();
    const add = (kind, text, detail) => { const key = kind + '|' + text; if (!seen.has(key)) { seen.add(key); issues.push({ kind, text: text.slice(0, 40), detail }); } };
    const base = parse(BG) || { r: 11, g: 16, b: 32, a: 1 };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      let opacity = 1, hidden = false;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const o = Number(getComputedStyle(e).opacity); opacity *= o; }
      if (opacity < 0.85) continue; // still animating in or out
      const range = document.createRange(); range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const tol = 2;
      if (box.left < -tol || box.top < -tol || box.right > W + tol || box.bottom > H + tol) add('offcanvas', text, Math.round(box.left) + ',' + Math.round(box.top) + ' to ' + Math.round(box.right) + ',' + Math.round(box.bottom));
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        const clips = s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible';
        if (clips && e.scrollWidth > e.clientWidth + 3 && e.clientWidth > 0) { add('clipped', text, 'content ' + e.scrollWidth + ' px wide in ' + e.clientWidth + ' px'); break; }
        if (clips && e.scrollHeight > e.clientHeight + 3 && e.clientHeight > 0) { add('clipped', text, 'content ' + e.scrollHeight + ' px tall in ' + e.clientHeight + ' px'); break; }
      }
      const isSvg = el instanceof SVGElement;
      const size = parseFloat(style.fontSize);
      if (!isSvg && size < minRatio * Math.min(W, H)) add('small', text, Math.round(size) + ' px');
      // Effective background: nearest opaque-ish ancestor chain composited over the page background.
      let layers = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) layers.push(c); }
      let bg = base;
      for (const c of layers.reverse()) bg = over(c, bg);
      const fg0 = parse(isSvg ? style.fill : style.color);
      if (!fg0) continue;
      const fg = over({ ...fg0, a: fg0.a * opacity }, bg);
      const r = ratio(fg, bg);
      if (r < minContrast) add('contrast', text, r.toFixed(2) + ':1');
    }
    return issues;
  }.toString()})(${width}, ${height}, ${JSON.stringify(background)}, ${MIN_FONT_RATIO}, ${MIN_CONTRAST})`;
}
