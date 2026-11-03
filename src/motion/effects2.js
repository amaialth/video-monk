// More built-in templates, chosen from the HyperFrames catalog review (the "build next" list) and written from scratch for this toolkit:
// hand-drawn annotation marks, a code diff, a code focus sweep, a bar-chart race, confetti and a success check. Same contract as every
// template: render(root, props, ctx, VM) builds the DOM once and returns update(t), a pure function of time. All randomness is seeded.

const str = (max, required = false) => ({ type: 'string', max, required });
const num = (required = false, min = -1e12, max = 1e12) => ({ type: 'number', required, min, max });
const color = { type: 'color' };

export const EFFECTS2 = {
  annotate: {
    description: 'A hand-drawn mark over a region of the shot: circle, underline, arrow, marker (highlighter) or bracket, with an optional label. x, y, w, h are fractions of the frame; an arrow runs from (x, y) to (x + w, y + h).',
    fullFrame: true,
    schema: { kind: { type: 'enum', values: ['circle', 'underline', 'arrow', 'marker', 'bracket'], required: true }, x: num(true, 0, 1), y: num(true, 0, 1), w: num(true, -1, 1), h: num(true, -1, 1),
      label: str(60), color, seed: num(false, 1, 9999) },
    render(root, props, ctx, VM) {
      const X = props.x * ctx.w, Y = props.y * ctx.h, W = props.w * ctx.w, H = props.h * ctx.h;
      const col = props.color || ctx.theme.accent;
      let s = ((props.seed || 11) * 9301 + 49297) % 233280;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };   // seeded: the same wobble every render
      const jit = ctx.u * 0.35;
      const pts = [];
      const add = (x, y) => pts.push([x + rnd() * jit * 2, y + rnd() * jit * 2]);
      const cx = X + W / 2, cy = Y + H / 2, rx = Math.abs(W) / 2 * 1.08, ry = Math.abs(H) / 2 * 1.12;
      if (props.kind === 'circle') { for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + (i / 40) * Math.PI * 2.18; const k = 1 + 0.05 * Math.sin(i * 0.5) + i / 40 * 0.05; add(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k); } }
      else if (props.kind === 'underline') { const n = 18; for (let i = 0; i <= n; i++) add(X + (W * i) / n, Y + H + Math.sin(i * 1.3) * ctx.u * 0.5); }
      else if (props.kind === 'marker') { const rows = Math.max(2, Math.round(Math.abs(H) / (ctx.u * 2.2))); for (let r = 0; r < rows; r++) { const yy = Y + (H * (r + 0.5)) / rows; if (r % 2) { add(X + W, yy); add(X, yy); } else { add(X, yy); add(X + W, yy); } } }
      else if (props.kind === 'bracket') { const d = ctx.u * 1.6; add(X + d, Y); add(X, Y); add(X, Y + H); add(X + d, Y + H); add(X + W - d, Y + H); add(X + W, Y + H); add(X + W, Y); add(X + W - d, Y); }
      else { // arrow: a gentle curve from (X, Y) to (X + W, Y + H)
        const bx = X + W, by = Y + H, mx = X + W * 0.5 - H * 0.18, my = Y + H * 0.5 + W * 0.18;
        for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; add(u * u * X + 2 * u * t * mx + t * t * bx, u * u * Y + 2 * u * t * my + t * t * by); }
      }
      const d = pts.map((p, i) => (i ? 'L' : 'M') + VM.r(p[0], 1) + ' ' + VM.r(p[1], 1)).join(' ');
      const svg = VM.svg('svg', { width: ctx.w, height: ctx.h, viewBox: '0 0 ' + ctx.w + ' ' + ctx.h, style: 'position:absolute;inset:0' }, root);
      const thick = props.kind === 'marker' ? Math.max(ctx.u * 2.2, Math.abs(H) / Math.max(2, Math.round(Math.abs(H) / (ctx.u * 2.2)))) : ctx.u * 0.7;
      const path = VM.svg('path', { d, fill: 'none', stroke: col, 'stroke-width': thick, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: props.kind === 'marker' ? 0.38 : 1 }, svg);
      let head = null;
      if (props.kind === 'arrow' && pts.length > 3) {
        const a = pts[pts.length - 1], b = pts[pts.length - 4], ang = Math.atan2(a[1] - b[1], a[0] - b[0]), L = ctx.u * 3;
        head = VM.svg('path', { d: 'M' + VM.r(a[0] - Math.cos(ang - 0.45) * L, 1) + ' ' + VM.r(a[1] - Math.sin(ang - 0.45) * L, 1) + ' L' + VM.r(a[0], 1) + ' ' + VM.r(a[1], 1) + ' L' + VM.r(a[0] - Math.cos(ang + 0.45) * L, 1) + ' ' + VM.r(a[1] - Math.sin(ang + 0.45) * L, 1),
          fill: 'none', stroke: col, 'stroke-width': ctx.u * 0.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      }
      const len = path.getTotalLength ? path.getTotalLength() : 2000;
      const label = props.label ? VM.el('div', { style: { position: 'absolute', left: Math.max(ctx.u, Math.min(ctx.w - ctx.u * 30, cx - ctx.u * 12)) + 'px', top: Math.min(ctx.h - ctx.u * 6, Math.max(ctx.u, Y + Math.max(H, 0) + ctx.u * 3.4)) + 'px',
        color: col, fontWeight: '800', fontSize: (ctx.u * 3.6) + 'px', fontFamily: "'Segoe Print','Bradley Hand','Marker Felt','Comic Sans MS',cursive", textShadow: '0 1px 6px rgba(0,0,0,.55)' } }, root, props.label) : null;
      return t => {
        const k = VM.ease.inOut(VM.p(t, 0.15, props.kind === 'marker' ? 0.9 : 0.75));
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        path.style.strokeDasharray = VM.r(len + 4, 1); path.style.strokeDashoffset = VM.r((len + 4) * (1 - k), 1); path.style.opacity = VM.r((props.kind === 'marker' ? 0.38 : 1) * out);
        if (head) { head.style.opacity = VM.r(VM.p(t, 0.15 + 0.7, 0.15) * out); }
        if (label) { label.style.opacity = VM.r(VM.p(t, 0.7, 0.35) * out); label.style.transform = 'translateY(' + VM.r((1 - VM.ease.out(VM.p(t, 0.7, 0.4))) * ctx.u * 1.5) + 'px) rotate(-2deg)'; }
      };
    }
  },

  'code-diff': {
    description: 'A code change: the old lines collapse in red, the new lines expand in green. Pass the code before and after; changed lines are found for you.',
    schema: { filename: str(60), before: { type: 'string', max: 1200, required: true, multiline: true }, after: { type: 'string', max: 1200, required: true, multiline: true } },
    render(root, props, ctx, VM) {
      const A = props.before.replace(/\t/g, '  ').split('\n'), B = props.after.replace(/\t/g, '  ').split('\n');
      // line diff by longest common subsequence
      const m = A.length, n = B.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const rows = [];
      let i = 0, j = 0;
      while (i < m || j < n) {
        if (i < m && j < n && A[i] === B[j]) { rows.push({ kind: 'same', text: A[i] }); i++; j++; }
        else if (j < n && (i >= m || L[i][j + 1] >= L[i + 1]?.[j])) { rows.push({ kind: 'add', text: B[j] }); j++; }
        else { rows.push({ kind: 'del', text: A[i] }); i++; }
      }
      const pad = ctx.u * 5;
      const win = VM.el('div', { style: { position: 'absolute', inset: pad + 'px', background: '#0d1117', borderRadius: (ctx.u * 1.6) + 'px', border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 ' + ctx.u + 'px ' + (ctx.u * 5) + 'px rgba(0,0,0,0.5)' } }, root);
      const bar = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: ctx.u + 'px', padding: (ctx.u * 1.4) + 'px ' + (ctx.u * 2) + 'px', background: 'rgba(255,255,255,0.05)' } }, win);
      ['#ff5f57', '#febc2e', '#28c840'].forEach(c => VM.el('span', { style: { width: (ctx.u * 1.4) + 'px', height: (ctx.u * 1.4) + 'px', borderRadius: '99px', background: c } }, bar));
      if (props.filename) VM.el('span', { style: { color: '#8b949e', fontSize: (ctx.u * 2.8) + 'px', marginLeft: (ctx.u * 1.5) + 'px' } }, bar, props.filename);
      const body = VM.el('div', { style: { padding: (ctx.u * 2.4) + 'px', flex: '1', fontFamily: "VMMono,'SF Mono',Menlo,Consolas,monospace", color: '#e6edf3', whiteSpace: 'pre', overflow: 'hidden' } }, win);
      const longest = Math.max(...rows.map(r => r.text.length), 10);
      const fs = Math.min(ctx.u * 4.2, (ctx.h - pad * 2 - ctx.u * 11) / (rows.length * 1.5), (ctx.w - pad * 2 - ctx.u * 12) / ((longest + 6) * 0.62));
      body.style.fontSize = fs + 'px';
      const colors = { comment: '#8b949e', string: '#a5d6ff', number: '#79c0ff', keyword: '#ff7b72', ident: '#e6edf3', punct: '#c9d1d9', space: '' };
      const els = rows.map(r => {
        const outer = VM.el('div', { style: { overflow: 'hidden', borderRadius: (ctx.u * 0.4) + 'px', lineHeight: '1.5' } }, body);
        const row = VM.el('div', { style: { display: 'flex', whiteSpace: 'pre' } }, outer);
        VM.el('span', { style: { width: '1.6em', flex: '0 0 auto', color: r.kind === 'add' ? '#3fb950' : r.kind === 'del' ? '#f85149' : '#484f58', fontWeight: '800' } }, row, r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' ');
        const c = VM.el('span', {}, row);
        for (const tok of VM.tokens(r.text)) VM.el('span', { style: { color: colors[tok.kind] } }, c, tok.text);
        return { r, outer, row };
      });
      const t0 = 0.5, t1 = Math.min(1.7, 0.5 + ctx.duration * 0.25);
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        VM.set(win, { opacity: VM.r(VM.tw(t, 0, 0.35, 0, 1) * o), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 3, 0, 'expo')) + 'px)' });
        const mark = VM.ease.out(VM.p(t, t0, 0.35)), act = VM.ease.inOut(VM.p(t, t1, 0.7));   // first the change is marked, then the old lines leave and the new arrive
        els.forEach(({ r, outer, row }) => {
          if (r.kind === 'same') return;
          if (r.kind === 'del') { VM.set(outer, { background: 'rgba(248,81,73,' + VM.r(0.2 * mark) + ')', maxHeight: VM.r((1 - act) * 3) + 'em', opacity: VM.r(1 - act * 0.9) }); row.style.textDecoration = act > 0.05 ? 'line-through' : 'none'; }
          else VM.set(outer, { background: 'rgba(63,185,80,' + VM.r(0.2 * act) + ')', maxHeight: VM.r(act * 3) + 'em', opacity: VM.r(act) });
        });
      };
    }
  },

  'code-focus': {
    description: 'Code with one line (or a few) lit by a sweeping band while the rest dims: "look at this line".',
    schema: { filename: str(60), code: { type: 'string', max: 1600, required: true, multiline: true }, lines: { type: 'array', required: true, minItems: 1, maxItems: 6, items: num(true, 1, 200) }, note: str(80) },
    render(root, props, ctx, VM) {
      const lines = props.code.replace(/\t/g, '  ').split('\n');
      const focus = new Set(props.lines);
      const pad = ctx.u * 5;
      const win = VM.el('div', { style: { position: 'absolute', inset: pad + 'px', background: '#0d1117', borderRadius: (ctx.u * 1.6) + 'px', border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 ' + ctx.u + 'px ' + (ctx.u * 5) + 'px rgba(0,0,0,0.5)' } }, root);
      const bar = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: ctx.u + 'px', padding: (ctx.u * 1.4) + 'px ' + (ctx.u * 2) + 'px', background: 'rgba(255,255,255,0.05)' } }, win);
      ['#ff5f57', '#febc2e', '#28c840'].forEach(c => VM.el('span', { style: { width: (ctx.u * 1.4) + 'px', height: (ctx.u * 1.4) + 'px', borderRadius: '99px', background: c } }, bar));
      if (props.filename) VM.el('span', { style: { color: '#8b949e', fontSize: (ctx.u * 2.8) + 'px', marginLeft: (ctx.u * 1.5) + 'px' } }, bar, props.filename);
      const body = VM.el('div', { style: { padding: (ctx.u * 2.4) + 'px', flex: '1', fontFamily: "VMMono,'SF Mono',Menlo,Consolas,monospace", color: '#e6edf3', whiteSpace: 'pre', overflow: 'hidden', position: 'relative' } }, win);
      const longest = Math.max(...lines.map(l => l.length), 10);
      const fs = Math.min(ctx.u * 4.4, (ctx.h - pad * 2 - ctx.u * 12) / (lines.length * 1.5), (ctx.w - pad * 2 - ctx.u * 12) / ((longest + 4) * 0.62));
      body.style.fontSize = fs + 'px';
      const colors = { comment: '#8b949e', string: '#a5d6ff', number: '#79c0ff', keyword: '#ff7b72', ident: '#e6edf3', punct: '#c9d1d9', space: '' };
      const rows = lines.map((text, i) => {
        const row = VM.el('div', { style: { display: 'flex', lineHeight: '1.5', borderRadius: (ctx.u * 0.4) + 'px', transformOrigin: 'left center' } }, body);
        VM.el('span', { style: { color: '#484f58', width: '2.6em', flex: '0 0 auto', textAlign: 'right', paddingRight: '1em' } }, row, String(i + 1));
        const c = VM.el('span', {}, row);
        for (const tok of VM.tokens(text)) VM.el('span', { style: { color: colors[tok.kind] } }, c, tok.text);
        return row;
      });
      const note = props.note ? VM.el('div', { style: { position: 'absolute', right: (ctx.u * 3) + 'px', bottom: (ctx.u * 3) + 'px', background: ctx.theme.accent, color: ctx.theme.background, fontWeight: '800', fontSize: (ctx.u * 3) + 'px', padding: (ctx.u * 0.8) + 'px ' + (ctx.u * 1.8) + 'px', borderRadius: (ctx.u * 1) + 'px' } }, win, props.note) : null;
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        VM.set(win, { opacity: VM.r(VM.tw(t, 0, 0.35, 0, 1) * o), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 3, 0, 'expo')) + 'px)' });
        const k = VM.ease.inOut(VM.p(t, 0.7, 0.8));
        rows.forEach((row, i) => {
          const on = focus.has(i + 1);
          VM.set(row, { opacity: VM.r(on ? 1 : 1 - 0.65 * k), background: on ? 'rgba(56,139,253,' + VM.r(0.22 * k) + ')' : 'transparent', transform: on ? 'scale(' + VM.r(1 + 0.02 * k) + ')' : 'none' });
        });
        if (note) VM.set(note, { opacity: VM.r(VM.p(t, 1.3, 0.35) * o), transform: 'translateY(' + VM.r((1 - VM.ease.out(VM.p(t, 1.3, 0.4))) * ctx.u * 2) + 'px)' });
      };
    }
  },

  'bar-chart-race': {
    description: 'Ranked bars that overtake each other across periods (a bar-chart race). Give each item its value for every period; bars re-rank as the values change.',
    schema: { title: str(70), unit: str(12), periods: { type: 'array', required: true, minItems: 2, maxItems: 12, items: str(12) },
      items: { type: 'array', required: true, minItems: 2, maxItems: 8, items: { type: 'object', fields: { name: str(24, true), values: { type: 'array', required: true, minItems: 2, maxItems: 12, items: num(true, 0, 1e9) }, color } } },
      decimals: num(false, 0, 3), illustrative: { type: 'boolean' } },
    render(root, props, ctx, VM) {
      const P = props.periods.length, items = props.items.map((it, i) => ({ ...it, color: it.color || ctx.theme.palette[i % ctx.theme.palette.length] }));
      const N = items.length, pad = ctx.u * 8, top = props.title ? ctx.u * 15 : ctx.u * 8;
      const rowH = Math.min(ctx.u * 9, (ctx.h - top - pad) / N), barMax = ctx.w - pad * 2 - ctx.u * 24;
      const dec = props.decimals ?? 0;
      if (props.title) VM.el('div', { style: { position: 'absolute', left: pad + 'px', top: (ctx.u * 4) + 'px', fontWeight: '800', fontSize: (ctx.u * 4.6) + 'px' } }, root, props.title);
      if (props.illustrative) VM.el('div', { style: { position: 'absolute', right: pad + 'px', top: (ctx.u * 4.6) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.4) + 'px', letterSpacing: '0.14em', textTransform: 'uppercase' } }, root, 'Illustrative');
      const period = VM.el('div', { style: { position: 'absolute', right: pad + 'px', bottom: (ctx.u * 3) + 'px', fontWeight: '900', fontSize: (ctx.u * 10) + 'px', color: VM.hexToRgba(ctx.theme.text, 0.16), letterSpacing: '-0.03em' } }, root);
      const rows = items.map(it => {
        const row = VM.el('div', { style: { position: 'absolute', left: pad + 'px', height: (rowH * 0.78) + 'px', width: (ctx.w - pad * 2) + 'px', display: 'flex', alignItems: 'center' } }, root);
        VM.el('div', { style: { width: (ctx.u * 18) + 'px', textAlign: 'right', paddingRight: (ctx.u * 1.6) + 'px', fontWeight: '700', fontSize: (rowH * 0.34) + 'px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, row, it.name);
        const bar = VM.el('div', { style: { height: '100%', background: it.color, borderRadius: (ctx.u * 0.8) + 'px', minWidth: '2px' } }, row);
        const val = VM.el('div', { style: { marginLeft: (ctx.u * 1.2) + 'px', fontWeight: '800', fontSize: (rowH * 0.34) + 'px', fontVariantNumeric: 'tabular-nums' } }, row);
        return { it, row, bar, val };
      });
      const vmax = Math.max(...items.flatMap(it => it.values.slice(0, P)), 1);
      const span = Math.max(0.5, ctx.duration - 1.2);
      const valueAt = (it, f) => { const a = Math.min(P - 2, Math.floor(f)), e = VM.ease.inOut(f - a); const v0 = it.values[Math.min(a, it.values.length - 1)], v1 = it.values[Math.min(a + 1, it.values.length - 1)]; return v0 + (v1 - v0) * e; };
      const rankNow = f => { const order = items.map((it, i) => [i, valueAt(it, f)]).sort((x, y) => y[1] - x[1] || x[0] - y[0]); const r = new Array(N); order.forEach(([i], k) => { r[i] = k; }); return r; };
      // Ranks are discrete: a bar changes place only when its value really passes another, then slides to the new place in 0.45 s.
      // The rank history is precomputed from the data (a pure function of the props), so any time can be drawn in any order.
      const STEP = 1 / 60, SWAP = 0.45, history = [];
      let prev = rankNow(0);
      history.push({ t: 0, ranks: prev, from: prev });
      for (let tt = STEP; tt <= span + 1e-9; tt += STEP) { const f = VM.clamp(tt / span) * (P - 1), r = rankNow(f); if (r.some((v, i) => v !== prev[i])) { history.push({ t: tt, ranks: r, from: prev }); prev = r; } }
      const rankAtTime = (i, tt) => {
        let k = 0; while (k + 1 < history.length && history[k + 1].t <= tt) k++;
        const h = history[k], q = VM.ease.inOut(VM.p(tt, h.t, SWAP));
        return h.from[i] + (h.ranks[i] - h.from[i]) * (k === 0 ? 1 : q);
      };
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        const tt = Math.max(0, t - 0.4), f = VM.clamp(tt / span) * (P - 1), idx = Math.min(P - 1, Math.round(f));
        period.textContent = props.periods[idx]; period.style.opacity = VM.r(o);
        rows.forEach(({ it, row, bar, val }, i) => {
          const v = valueAt(it, f);
          VM.set(row, { top: VM.r(top + rankAtTime(i, Math.min(tt, span)) * rowH) + 'px', opacity: VM.r(VM.p(t, 0.05 * i, 0.3) * o) });
          bar.style.width = VM.r(Math.max(2, (v / vmax) * barMax)) + 'px';
          val.textContent = VM.fmt(v, dec) + (props.unit || '');
        });
      };
    }
  },

  confetti: {
    description: 'A burst or shower of confetti, fully seeded (the same frames every render), with an optional message. For a milestone, a launch or a result.',
    schema: { message: str(60), style: { type: 'enum', values: ['burst', 'shower'] }, count: num(false, 20, 260), seed: num(false, 1, 9999), colors: { type: 'array', maxItems: 8, items: color } },
    render(root, props, ctx, VM) {
      const cvs = VM.el('canvas', { width: ctx.w, height: ctx.h, style: { position: 'absolute', inset: '0' } }, root);
      const g = cvs.getContext('2d');
      let s = ((props.seed || 5) * 9301 + 49297) % 233280;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const cols = props.colors && props.colors.length ? props.colors : ctx.theme.palette;
      const n = props.count || 120, burst = (props.style || 'burst') === 'burst', grav = ctx.h * 1.1;
      const ps = Array.from({ length: n }, () => {
        const a = burst ? -Math.PI / 2 + (rnd() - 0.5) * 2.2 : Math.PI / 2, sp = burst ? ctx.h * (0.55 + rnd() * 0.9) : ctx.h * (0.12 + rnd() * 0.2);
        return { x: burst ? ctx.w / 2 + (rnd() - 0.5) * ctx.w * 0.1 : rnd() * ctx.w, y: burst ? ctx.h * 0.72 : -ctx.h * 0.1 - rnd() * ctx.h * 0.3, vx: Math.cos(a) * sp * (burst ? 1 : 0.15) + (rnd() - 0.5) * ctx.w * 0.05, vy: Math.sin(a) * sp,
          w: ctx.u * (0.9 + rnd() * 1.1), h: ctx.u * (0.5 + rnd() * 0.7), r0: rnd() * 6.28, vr: (rnd() - 0.5) * 12, c: cols[Math.floor(rnd() * cols.length)], delay: burst ? rnd() * 0.1 : rnd() * 1.6, drag: 0.55 + rnd() * 0.4 };
      });
      const msg = props.message ? VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (ctx.h * 0.4) + 'px', textAlign: 'center', fontWeight: '900', fontSize: (ctx.u * 9) + 'px', letterSpacing: '-0.02em', textShadow: '0 2px 24px rgba(0,0,0,.5)' } }, root, props.message) : null;
      return t => {
        g.clearRect(0, 0, ctx.w, ctx.h);
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.5, 0.5)) : 1;
        for (const p of ps) {
          const tt = Math.max(0, t - p.delay); if (tt <= 0) continue;
          const damp = Math.exp(-p.drag * tt * 1.2), x = p.x + p.vx * (1 - damp) / (p.drag * 1.2), y = p.y + p.vy * (1 - damp) / (p.drag * 1.2) + 0.5 * grav * tt * tt * (burst ? 0.55 : 0.18);
          if (y > ctx.h * 1.1) continue;
          g.save(); g.translate(x, y); g.rotate(p.r0 + p.vr * tt); g.scale(1, Math.cos(p.r0 * 3 + tt * 7));
          g.globalAlpha = VM.clamp(1 - VM.p(tt, 2.2, 1.6)) * out; g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
        }
        if (msg) { msg.style.opacity = VM.r(VM.p(t, 0.25, 0.4) * out); msg.style.transform = 'scale(' + VM.r(0.85 + 0.15 * VM.ease.back(VM.p(t, 0.25, 0.5))) + ')'; }
      };
    }
  },

  'success-check': {
    description: 'A ring pops in and a check mark draws itself, with a label: done, approved, sent, shipped.',
    schema: { label: str(60, true), sub: str(100), color },
    render(root, props, ctx, VM) {
      const col = props.color || ctx.theme.palette[3] || ctx.theme.accent, size = ctx.u * 22;
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: (ctx.u * 3) + 'px' } }, root);
      const svg = VM.svg('svg', { width: size, height: size, viewBox: '0 0 100 100' }, wrap);
      const ring = VM.svg('circle', { cx: 50, cy: 50, r: 44, fill: 'none', stroke: col, 'stroke-width': 6 }, svg);
      const fill = VM.svg('circle', { cx: 50, cy: 50, r: 44, fill: col, opacity: 0.14 }, svg);
      const check = VM.svg('path', { d: 'M28 52 L44 67 L73 35', fill: 'none', stroke: col, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      const label = VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 5.4) + 'px', textAlign: 'center', maxWidth: (ctx.w * 0.8) + 'px' } }, wrap, props.label);
      const sub = props.sub ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3) + 'px', textAlign: 'center', maxWidth: (ctx.w * 0.7) + 'px', marginTop: (-ctx.u * 1.4) + 'px' } }, wrap, props.sub) : null;
      const rl = 2 * Math.PI * 44, cl = 66;
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        const pop = VM.ease.back(VM.p(t, 0.05, 0.5)), draw = VM.ease.out(VM.p(t, 0.45, 0.45));
        svg.style.transform = 'scale(' + VM.r(0.4 + 0.6 * pop) + ')'; svg.style.opacity = VM.r(VM.p(t, 0, 0.2) * o);
        ring.style.strokeDasharray = VM.r(rl, 1); ring.style.strokeDashoffset = VM.r(rl * (1 - VM.ease.out(VM.p(t, 0.05, 0.5))), 1);
        fill.style.opacity = VM.r(0.14 * VM.p(t, 0.4, 0.3));
        check.style.strokeDasharray = cl; check.style.strokeDashoffset = VM.r(cl * (1 - draw), 2);
        label.style.opacity = VM.r(VM.p(t, 0.7, 0.35) * o); label.style.transform = 'translateY(' + VM.r((1 - VM.ease.out(VM.p(t, 0.7, 0.4))) * ctx.u * 2) + 'px)';
        if (sub) sub.style.opacity = VM.r(VM.p(t, 0.9, 0.35) * o);
      };
    }
  }
};
