// Premium motion effects as built-in templates. They follow the "one object turning into another" recipes from the
// motion-graphics skills (our own implementation, our own words): chart morph, search to results, card to workspace,
// button to player, tabs to panels, spring stack, glass focus, particle text, perspective layers and a magnetic dock.
// Like every template, `render` is serialized into the page: it may only use its arguments, builds the DOM once and
// returns update(t), a pure function of time. Numbers a viewer could mistake for real data carry an "illustrative" label.

const str = (max, required = false) => ({ type: 'string', max, required });
const num = (required = false, min = -1e12, max = 1e12) => ({ type: 'number', required, min, max });
const illustrative = { type: 'boolean' };

export const EFFECTS = {
  'chart-morph': {
    description: 'Bars that melt into a line chart and back (one dataset, two readings). Pass real values, or set illustrative: true to label them as samples.',
    schema: { title: str(70), labels: { type: 'array', required: true, minItems: 3, maxItems: 8, items: str(14) },
      values: { type: 'array', required: true, minItems: 3, maxItems: 8, items: num(true, -1e9, 1e9) }, unit: str(8), illustrative },
    render(root, props, ctx, VM) {
      const n = Math.min(props.labels.length, props.values.length);
      const pad = ctx.u * 9, W = ctx.w - pad * 2, H = ctx.h - pad * 2.6;
      const top = pad * 1.5;
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0' } }, root);
      if (props.title) VM.el('div', { style: { position: 'absolute', left: pad + 'px', top: (pad * 0.5) + 'px', fontWeight: '800', fontSize: (ctx.u * 4.6) + 'px' } }, wrap, props.title);
      if (props.illustrative) VM.el('div', { style: { position: 'absolute', right: pad + 'px', top: (pad * 0.55) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.4) + 'px', letterSpacing: '0.14em', textTransform: 'uppercase' } }, wrap, 'Illustrative');
      const max = Math.max(...props.values.slice(0, n), 1), min = Math.min(0, ...props.values.slice(0, n));
      const y = v => top + H - ((v - min) / (max - min || 1)) * H * 0.9;
      const slot = W / n, bw = slot * 0.56;
      const svg = VM.svg('svg', { width: ctx.w, height: ctx.h, viewBox: '0 0 ' + ctx.w + ' ' + ctx.h, style: 'position:absolute;inset:0' }, wrap);
      const line = VM.svg('polyline', { fill: 'none', stroke: ctx.theme.accent, 'stroke-width': ctx.u * 0.7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const bars = [], dots = [], labels = [], vals = [];
      for (let i = 0; i < n; i++) {
        bars.push(VM.svg('rect', { fill: ctx.theme.palette[0], rx: ctx.u * 0.8 }, svg));
        dots.push(VM.svg('circle', { r: ctx.u * 1.1, fill: ctx.theme.background, stroke: ctx.theme.accent, 'stroke-width': ctx.u * 0.45 }, svg));
        labels.push(VM.svg('text', { 'text-anchor': 'middle', fill: ctx.theme.muted, 'font-size': ctx.u * 2.6, 'font-family': 'inherit' }, svg, props.labels[i]));
        vals.push(VM.svg('text', { 'text-anchor': 'middle', fill: ctx.theme.text, 'font-size': ctx.u * 2.8, 'font-weight': 700, 'font-family': 'inherit' }, svg, VM.fmt(props.values[i], props.values[i] % 1 ? 1 : 0) + (props.unit || '')));
      }
      return t => {
        const m = VM.ease.inOut(VM.p(t, ctx.duration * 0.28, 0.9)) * (1 - VM.ease.inOut(VM.p(t, ctx.duration - 1.4, 0.9)));
        const pts = [];
        for (let i = 0; i < n; i++) {
          const cx = pad + slot * (i + 0.5), grow = VM.ease.expo(VM.p(t, 0.15 + i * 0.07, 0.7));
          const yy = y(props.values[i]), base = y(min);
          const h = (base - yy) * grow;
          bars[i].setAttribute('x', VM.r(cx - bw / 2)); bars[i].setAttribute('width', VM.r(bw * (1 - m * 0.85)));
          bars[i].setAttribute('x', VM.r(cx - (bw * (1 - m * 0.85)) / 2));
          bars[i].setAttribute('y', VM.r(base - h)); bars[i].setAttribute('height', VM.r(Math.max(0, h * (1 - m) + ctx.u * 0.6 * m)));
          bars[i].setAttribute('opacity', VM.r(1 - m * 0.55));
          dots[i].setAttribute('cx', VM.r(cx)); dots[i].setAttribute('cy', VM.r(base - (base - yy) * grow)); dots[i].setAttribute('opacity', VM.r(m));
          pts.push(VM.r(cx) + ',' + VM.r(base - (base - yy) * grow));
          labels[i].setAttribute('x', VM.r(cx)); labels[i].setAttribute('y', VM.r(top + H + ctx.u * 4)); labels[i].setAttribute('opacity', VM.r(grow));
          vals[i].setAttribute('x', VM.r(cx)); vals[i].setAttribute('y', VM.r(base - (base - yy) * grow - ctx.u * 2.2)); vals[i].setAttribute('opacity', VM.r(VM.p(t, 0.7 + i * 0.07, 0.4)));
        }
        line.setAttribute('points', pts.join(' '));
        line.setAttribute('opacity', VM.r(m));
        line.style.strokeDasharray = '3000'; line.style.strokeDashoffset = VM.r(3000 * (1 - VM.clamp(m * 1.25)));
      };
    }
  },

  'search-results': {
    description: 'A search box types a query, then results rise into place. Use for "what you find" moments; results are the real titles you pass.',
    schema: { query: str(60, true), results: { type: 'array', required: true, minItems: 2, maxItems: 5, items: { type: 'object', fields: { title: str(70, true), meta: str(60) } } }, hint: str(40) },
    render(root, props, ctx, VM) {
      const w = Math.min(ctx.w * 0.8, ctx.u * 90);
      const col = VM.el('div', { style: { position: 'absolute', left: ((ctx.w - w) / 2) + 'px', top: (ctx.h * 0.12) + 'px', width: w + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 1.8) + 'px' } }, root);
      const box = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: (ctx.u * 2) + 'px', padding: (ctx.u * 2.2) + 'px ' + (ctx.u * 3) + 'px', background: ctx.theme.surface, borderRadius: (ctx.u * 3) + 'px', border: '2px solid ' + ctx.theme.accent, boxShadow: '0 ' + ctx.u * 1.5 + 'px ' + ctx.u * 5 + 'px rgba(0,0,0,.35)' } }, col);
      VM.icon('search', ctx.u * 4, ctx.theme.accent, box);
      const text = VM.el('div', { style: { fontSize: (ctx.u * 3.8) + 'px', fontWeight: '600', minHeight: '1.2em', flex: '1' } }, box);
      const caret = VM.el('span', { style: { display: 'inline-block', width: (ctx.u * 0.4) + 'px', height: '1em', background: ctx.theme.accent, marginLeft: '2px', verticalAlign: 'text-bottom' } }, text);
      const typed = VM.el('span', {}, text); text.insertBefore(typed, caret);
      const rows = props.results.map(r => {
        const row = VM.el('div', { style: { padding: (ctx.u * 2) + 'px ' + (ctx.u * 3) + 'px', background: ctx.theme.surface, borderRadius: (ctx.u * 2) + 'px', borderLeft: (ctx.u * 0.7) + 'px solid ' + ctx.theme.accent } }, col);
        VM.el('div', { style: { fontWeight: '700', fontSize: (ctx.u * 3.4) + 'px' } }, row, r.title);
        if (r.meta) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.4) + 'px', marginTop: (ctx.u * 0.5) + 'px' } }, row, r.meta);
        return row;
      });
      const typeEnd = Math.min(2.2, ctx.duration * 0.4);
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        root.style.opacity = VM.r(out);
        const k = Math.floor(VM.clamp((t - 0.3) / typeEnd) * props.query.length);
        typed.textContent = props.query.slice(0, k);
        caret.style.opacity = Math.floor(t * 2.2) % 2 ? '0' : '1';
        rows.forEach((row, i) => { const s = 0.3 + typeEnd + 0.15 + i * 0.14; VM.set(row, { opacity: VM.r(VM.p(t, s, 0.3)), transform: 'translateY(' + VM.r(VM.tw(t, s, 0.5, ctx.u * 4, 0, 'expo')) + 'px)' }); });
      };
    }
  },

  'card-workspace': {
    description: 'A small card grows into a full workspace window (title bar, sidebar, content). Announces a feature: the card is the idea, the window is the product.',
    schema: { card: str(40, true), workspace: str(50, true), sidebar: { type: 'array', minItems: 2, maxItems: 6, items: str(24) }, lines: { type: 'array', minItems: 2, maxItems: 6, items: str(60) } },
    render(root, props, ctx, VM) {
      const side = props.sidebar || ['Overview', 'Files', 'Team'], lines = props.lines || [];
      const cw = ctx.u * 34, ch = ctx.u * 16, ww = ctx.w * 0.84, wh = ctx.h * 0.74;
      const win = VM.el('div', { style: { position: 'absolute', left: '50%', top: '50%', background: ctx.theme.surface, overflow: 'hidden', boxShadow: '0 ' + ctx.u * 2 + 'px ' + ctx.u * 7 + 'px rgba(0,0,0,.45)' } }, root);
      const card = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', fontWeight: '800', fontSize: (ctx.u * 3.8) + 'px', textAlign: 'center', padding: (ctx.u * 2) + 'px' } }, win, props.card);
      const full = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', width: ww + 'px', height: wh + 'px' } }, win);
      const bar = VM.el('div', { style: { height: (ctx.u * 6) + 'px', display: 'flex', alignItems: 'center', gap: (ctx.u * 1.2) + 'px', padding: '0 ' + ctx.u * 2.5 + 'px', background: VM.hexToRgba(ctx.theme.text, 0.06) } }, full);
      [0, 1, 2].forEach(i => VM.el('i', { style: { width: (ctx.u * 1.4) + 'px', height: (ctx.u * 1.4) + 'px', borderRadius: '99px', background: ctx.theme.palette[i + 1] } }, bar));
      VM.el('div', { style: { marginLeft: (ctx.u * 2) + 'px', fontWeight: '700', fontSize: (ctx.u * 2.8) + 'px', color: ctx.theme.muted } }, bar, props.workspace);
      const body = VM.el('div', { style: { flex: '1', display: 'flex' } }, full);
      const sb = VM.el('div', { style: { width: '26%', padding: (ctx.u * 2.5) + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 1.6) + 'px', borderRight: '1px solid ' + VM.hexToRgba(ctx.theme.text, 0.1) } }, body);
      const items = side.map((s, i) => VM.el('div', { style: { fontSize: (ctx.u * 2.8) + 'px', fontWeight: i === 0 ? '700' : '500', color: i === 0 ? ctx.theme.accent : ctx.theme.muted } }, sb, s));
      const content = VM.el('div', { style: { flex: '1', padding: (ctx.u * 3) + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 2) + 'px' } }, body);
      const ls = lines.map(l => VM.el('div', { style: { fontSize: (ctx.u * 3) + 'px', fontWeight: '600', padding: (ctx.u * 1.6) + 'px ' + (ctx.u * 2) + 'px', background: VM.hexToRgba(ctx.theme.accent, 0.12), borderRadius: (ctx.u * 1.4) + 'px' } }, content, l));
      return t => {
        const k = VM.ease.expo(VM.p(t, 0.55, 0.9)), out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        const w = cw + (ww - cw) * k, h = ch + (wh - ch) * k;
        VM.set(win, { width: VM.r(w) + 'px', height: VM.r(h) + 'px', marginLeft: VM.r(-w / 2) + 'px', marginTop: VM.r(-h / 2) + 'px', borderRadius: VM.r(ctx.u * 2.4 - ctx.u * 0.8 * k) + 'px', opacity: VM.r(VM.p(t, 0, 0.3) * out),
          background: k < 0.5 ? ctx.theme.accent : ctx.theme.surface });
        VM.set(card, { opacity: VM.r(1 - VM.p(t, 0.55, 0.25)), color: ctx.theme.background });
        VM.set(full, { opacity: VM.r(VM.p(t, 0.85, 0.35)) });
        items.forEach((n, i) => VM.set(n, { opacity: VM.r(VM.p(t, 1.1 + i * 0.1, 0.3)) }));
        ls.forEach((n, i) => VM.set(n, { opacity: VM.r(VM.p(t, 1.3 + i * 0.16, 0.3)), transform: 'translateY(' + VM.r(VM.tw(t, 1.3 + i * 0.16, 0.5, ctx.u * 2, 0, 'expo')) + 'px)' }));
      };
    }
  },

  'button-player': {
    description: 'A call-to-action button turns into a video player with a progress bar (the "watch the demo" moment).',
    schema: { label: str(30, true), caption: str(80), seconds: num(false, 1, 600) },
    render(root, props, ctx, VM) {
      const bw = ctx.u * 36, bh = ctx.u * 11, pw = ctx.w * 0.68, ph = pw * 9 / 16;
      const box = VM.el('div', { style: { position: 'absolute', left: '50%', top: '50%', overflow: 'hidden', background: ctx.theme.accent, boxShadow: '0 ' + ctx.u * 2 + 'px ' + ctx.u * 7 + 'px rgba(0,0,0,.4)' } }, root);
      const label = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: (ctx.u * 1.5) + 'px', fontWeight: '800', fontSize: (ctx.u * 3.8) + 'px', color: ctx.theme.background } }, box);
      VM.el('span', {}, label, '▶'); VM.el('span', {}, label, props.label);
      const player = VM.el('div', { style: { position: 'absolute', inset: '0', background: '#05070d' } }, box);
      const play = VM.el('div', { style: { position: 'absolute', left: '50%', top: '46%', width: (ctx.u * 14) + 'px', height: (ctx.u * 14) + 'px', marginLeft: (-ctx.u * 7) + 'px', marginTop: (-ctx.u * 7) + 'px', borderRadius: '99px', background: ctx.theme.accent, display: 'grid', placeItems: 'center', color: ctx.theme.background, fontSize: (ctx.u * 5) + 'px' } }, player, '▶');
      const cap = props.caption ? VM.el('div', { style: { position: 'absolute', left: '0', right: '0', bottom: (ctx.u * 7) + 'px', textAlign: 'center', fontWeight: '600', fontSize: (ctx.u * 2.8) + 'px', color: ctx.theme.text } }, player, props.caption) : null;
      const track = VM.el('div', { style: { position: 'absolute', left: (ctx.u * 3) + 'px', right: (ctx.u * 3) + 'px', bottom: (ctx.u * 3) + 'px', height: (ctx.u * 0.8) + 'px', borderRadius: '99px', background: VM.hexToRgba(ctx.theme.text, 0.2) } }, player);
      const fill = VM.el('div', { style: { height: '100%', borderRadius: '99px', background: ctx.theme.accent } }, track);
      return t => {
        const k = VM.ease.expo(VM.p(t, 0.7, 0.9)), out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        const w = bw + (pw - bw) * k, h = bh + (ph - bh) * k;
        VM.set(box, { width: VM.r(w) + 'px', height: VM.r(h) + 'px', marginLeft: VM.r(-w / 2) + 'px', marginTop: VM.r(-h / 2) + 'px', borderRadius: VM.r(h * 0.5 * (1 - k) + ctx.u * 2 * k) + 'px', opacity: VM.r(VM.p(t, 0, 0.3) * out),
          transform: 'scale(' + VM.r(1 + 0.04 * Math.sin(Math.min(t, 0.7) * Math.PI / 0.7)) + ')' });
        VM.set(label, { opacity: VM.r(1 - VM.p(t, 0.7, 0.25)) });
        VM.set(player, { opacity: VM.r(VM.p(t, 1.0, 0.4)) });
        VM.set(play, { transform: 'scale(' + VM.r(VM.tw(t, 1.2, 0.5, 0.4, 1, 'back')) + ')', opacity: VM.r(1 - VM.p(t, 2.4, 0.3)) });
        if (cap) VM.set(cap, { opacity: VM.r(VM.p(t, 1.6, 0.5)) });
        fill.style.width = VM.r(VM.clamp((t - 2.2) / Math.max(1, ctx.duration - 3)) * 100) + '%';
      };
    }
  },

  'tabs-panels': {
    description: 'A tab bar switches between panels of points, one tab per beat, with a sliding underline.',
    schema: { title: str(60), tabs: { type: 'array', required: true, minItems: 2, maxItems: 4, items: { type: 'object', fields: { label: str(18, true), points: { type: 'array', required: true, minItems: 1, maxItems: 4, items: str(70) } } } } },
    render(root, props, ctx, VM) {
      const n = props.tabs.length, w = Math.min(ctx.w * 0.84, ctx.u * 100), left = (ctx.w - w) / 2;
      const wrap = VM.el('div', { style: { position: 'absolute', left: left + 'px', top: (ctx.h * 0.14) + 'px', width: w + 'px' } }, root);
      if (props.title) VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 4.6) + 'px', marginBottom: (ctx.u * 3) + 'px' } }, wrap, props.title);
      const bar = VM.el('div', { style: { position: 'relative', display: 'flex', borderBottom: '2px solid ' + VM.hexToRgba(ctx.theme.text, 0.12) } }, wrap);
      const heads = props.tabs.map(tb => VM.el('div', { style: { flex: '1', textAlign: 'center', padding: (ctx.u * 1.8) + 'px 0', fontWeight: '700', fontSize: (ctx.u * 3) + 'px' } }, bar, tb.label));
      const ul = VM.el('div', { style: { position: 'absolute', bottom: '-2px', height: (ctx.u * 0.6) + 'px', width: (100 / n) + '%', background: ctx.theme.accent, borderRadius: '99px' } }, bar);
      const area = VM.el('div', { style: { position: 'relative', minHeight: (ctx.u * 34) + 'px' } }, wrap);
      const panels = props.tabs.map(tb => { const p = VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (ctx.u * 4) + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 2) + 'px' } }, area); const pts = tb.points.map(x => VM.el('div', { style: { fontSize: (ctx.u * 3.4) + 'px', padding: (ctx.u * 2) + 'px ' + (ctx.u * 3) + 'px', background: ctx.theme.surface, borderRadius: (ctx.u * 1.6) + 'px' } }, p, x)); return { p, pts }; });
      const slot = Math.max(1.6, (ctx.duration - 0.6) / n);
      return t => {
        const f = VM.clamp((t - 0.4) / slot, 0, n - 0.001), idx = Math.floor(f), frac = f - idx;
        const slide = idx === 0 ? 0 : VM.ease.inOut(VM.clamp(frac / 0.25));
        const pos = idx - 1 + slide * (idx === 0 ? 0 : 1);
        ul.style.left = VM.r(((idx === 0 ? 0 : pos) / n) * 100) + '%';
        heads.forEach((h, i) => { h.style.color = i === idx ? ctx.theme.text : ctx.theme.muted; });
        panels.forEach(({ p, pts }, i) => {
          const on = i === idx, s = VM.clamp((t - 0.4 - i * slot) / 0.3);
          p.style.opacity = on ? '1' : '0';
          pts.forEach((el, j) => { const k = on ? VM.ease.expo(VM.p(t, 0.4 + i * slot + 0.2 + j * 0.12, 0.5)) : 0; el.style.opacity = VM.r(k * s); el.style.transform = 'translateY(' + VM.r((1 - k) * ctx.u * 3) + 'px)'; });
        });
      };
    }
  },

  'spring-stack': {
    description: 'Cards drop in one after another with a physical spring and settle into a stack. Offers, case studies, testimonials.',
    schema: { title: str(60), cards: { type: 'array', required: true, minItems: 2, maxItems: 5, items: { type: 'object', fields: { title: str(40, true), body: str(100) } } } },
    render(root, props, ctx, VM) {
      const n = props.cards.length, cw = Math.min(ctx.w * 0.7, ctx.u * 74), chh = ctx.u * 17, gap = ctx.u * 2.2;
      const total = n * chh + (n - 1) * gap, top = (ctx.h - total) / 2 + (props.title ? ctx.u * 4 : 0);
      if (props.title) VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (top - ctx.u * 9) + 'px', textAlign: 'center', fontWeight: '800', fontSize: (ctx.u * 4.4) + 'px' } }, root, props.title);
      const cards = props.cards.map((c, i) => {
        const el = VM.el('div', { style: { position: 'absolute', left: ((ctx.w - cw) / 2) + 'px', top: (top + i * (chh + gap)) + 'px', width: cw + 'px', height: chh + 'px', background: ctx.theme.surface, borderRadius: (ctx.u * 2.4) + 'px', padding: (ctx.u * 2.6) + 'px ' + (ctx.u * 3.2) + 'px', boxSizing: 'border-box', borderLeft: (ctx.u * 0.8) + 'px solid ' + ctx.theme.palette[i % ctx.theme.palette.length], boxShadow: '0 ' + ctx.u + 'px ' + ctx.u * 4 + 'px rgba(0,0,0,.35)' } }, root);
        VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 3.6) + 'px' } }, el, c.title);
        if (c.body) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px', marginTop: (ctx.u * 0.8) + 'px' } }, el, c.body);
        return el;
      });
      const spring = x => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.exp(-7 * x) * Math.cos(11 * x)); // damped: one small overshoot, then rest
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        cards.forEach((c, i) => { const s = spring(VM.p(t, 0.2 + i * 0.35, 0.9)); VM.set(c, { opacity: VM.r(VM.p(t, 0.2 + i * 0.35, 0.15) * out), transform: 'translateY(' + VM.r((1 - s) * -ctx.h * 0.5) + 'px) scale(' + VM.r(0.92 + 0.08 * s) + ')' }); });
      };
    }
  },

  'glass-focus': {
    description: 'A block of text where everything blurs and dims except the one line that matters, which lifts onto a glass panel.',
    schema: { lines: { type: 'array', required: true, minItems: 3, maxItems: 7, items: str(90) }, focus: num(false, 0, 6) },
    render(root, props, ctx, VM) {
      const n = props.lines.length, f = Math.min(Math.round(props.focus === undefined ? Math.floor(n / 2) : props.focus), n - 1);
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: (ctx.u * 2.2) + 'px', padding: (ctx.u * 8) + 'px' } }, root);
      const els = props.lines.map((l, i) => VM.el('div', { style: { fontSize: (ctx.u * 4) + 'px', fontWeight: i === f ? '800' : '500', textAlign: 'center', maxWidth: (ctx.w * 0.8) + 'px', padding: (ctx.u * 1.6) + 'px ' + (ctx.u * 3.4) + 'px', borderRadius: (ctx.u * 2.2) + 'px' } }, wrap, l));
      return t => {
        const k = VM.ease.inOut(VM.p(t, 0.9, 0.8)), out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        els.forEach((e, i) => {
          const appear = VM.ease.out(VM.p(t, i * 0.08, 0.4));
          if (i === f) VM.set(e, { opacity: VM.r(appear * out), color: ctx.theme.text, background: VM.hexToRgba(ctx.theme.accent, 0.22 * k), boxShadow: '0 0 0 ' + VM.r(2 * k) + 'px ' + VM.hexToRgba(ctx.theme.accent, 0.7 * k) + ', 0 ' + VM.r(ctx.u * 2 * k) + 'px ' + VM.r(ctx.u * 7 * k) + 'px rgba(0,0,0,.35)', transform: 'scale(' + VM.r(1 + 0.12 * k) + ')' });
          else VM.set(e, { opacity: VM.r((1 - 0.68 * k) * appear * out), filter: 'blur(' + VM.r(ctx.u * 0.55 * k) + 'px)', color: ctx.theme.muted });
        });
      };
    }
  },

  'particle-text': {
    description: 'Dust that gathers into a word or mark, holds, then disperses. Closing card or launch name. Fully seeded: the same frames every render.',
    schema: { text: str(18, true), subtitle: str(60), seed: num(false, 1, 9999) },
    render(root, props, ctx, VM) {
      const cvs = VM.el('canvas', { width: ctx.w, height: ctx.h, style: { position: 'absolute', inset: '0' } }, root);
      const g = cvs.getContext('2d');
      const off = document.createElement('canvas'); off.width = ctx.w; off.height = ctx.h;
      const o = off.getContext('2d');
      let size = ctx.u * 22; o.font = '900 ' + size + 'px system-ui, sans-serif';
      while (o.measureText(props.text).width > ctx.w * 0.82 && size > ctx.u * 4) { size *= 0.94; o.font = '900 ' + size + 'px system-ui, sans-serif'; }
      o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(props.text, ctx.w / 2, ctx.h * 0.47);
      const data = o.getImageData(0, 0, ctx.w, ctx.h).data, step = Math.max(3, Math.round(ctx.u * 0.7));
      let s = (props.seed || 7) * 9301 % 233280;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const ps = [];
      for (let y = 0; y < ctx.h; y += step) for (let x = 0; x < ctx.w; x += step) if (data[(y * ctx.w + x) * 4 + 3] > 128) ps.push({ x, y, sx: rnd() * ctx.w, sy: rnd() * ctx.h, ex: ctx.w / 2 + (rnd() - 0.5) * ctx.w * 1.3, ey: ctx.h * 0.47 + (rnd() - 0.5) * ctx.h * 1.1, d: rnd() * 0.5, c: rnd() < 0.18 ? 1 : 0 });
      const sub = props.subtitle ? VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (ctx.h * 0.47 + size * 0.75) + 'px', textAlign: 'center', color: ctx.theme.muted, fontSize: (ctx.u * 3.6) + 'px', letterSpacing: '0.12em' } }, root, props.subtitle) : null;
      const r = Math.max(1, step * 0.42);
      return t => {
        g.clearRect(0, 0, ctx.w, ctx.h);
        const disperse = ctx.exit ? VM.ease.in(VM.p(t, ctx.duration - 0.9, 0.9)) : 0;
        for (const p of ps) {
          const k = VM.ease.expo(VM.p(t, 0.1 + p.d, 1.3));
          const x = p.sx + (p.x - p.sx) * k + (p.ex - p.x) * disperse * 0.4, y = p.sy + (p.y - p.sy) * k + (p.ey - p.y) * disperse * 0.4;
          g.globalAlpha = VM.r((0.25 + 0.75 * k) * (1 - disperse));
          g.fillStyle = p.c ? ctx.theme.accent : ctx.theme.text;
          g.fillRect(x, y, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        if (sub) sub.style.opacity = VM.r(VM.p(t, 1.5, 0.5) * (1 - disperse));
      };
    }
  },

  'perspective-layers': {
    description: 'A stack of tilted translucent layers that fan apart in 3D, each labelled. Explains the layers of a service, system or stack.',
    schema: { title: str(60), layers: { type: 'array', required: true, minItems: 2, maxItems: 5, items: { type: 'object', fields: { label: str(30, true), detail: str(60) } } } },
    render(root, props, ctx, VM) {
      const n = props.layers.length, lw = Math.min(ctx.w * 0.42, ctx.u * 50), lh = ctx.u * 15;
      if (props.title) VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (ctx.h * 0.08) + 'px', textAlign: 'center', fontWeight: '800', fontSize: (ctx.u * 4.4) + 'px' } }, root, props.title);
      const stage = VM.el('div', { style: { position: 'absolute', inset: '0', perspective: (ctx.w * 1.1) + 'px' } }, root);
      const layers = props.layers.map((l, i) => {
        const el = VM.el('div', { style: { position: 'absolute', left: ((ctx.w - lw) / 2) + 'px', top: (ctx.h / 2 - lh / 2 + ctx.h * 0.04) + 'px', width: lw + 'px', height: lh + 'px', borderRadius: (ctx.u * 2) + 'px', background: VM.hexToRgba(ctx.theme.palette[i % ctx.theme.palette.length], 0.28), border: '2px solid ' + ctx.theme.palette[i % ctx.theme.palette.length], boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 ' + ctx.u * 3 + 'px', backdropFilter: 'blur(2px)' } }, stage);
        VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 3.4) + 'px' } }, el, l.label);
        if (l.detail) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.3) + 'px' } }, el, l.detail);
        return el;
      });
      const spread = Math.min(lh * 1.3, (ctx.h * 0.95) / n);
      return t => {
        const k = VM.ease.inOut(VM.p(t, 0.3, 1.1)), out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        stage.style.opacity = VM.r(out);
        layers.forEach((l, i) => { const off = (i - (n - 1) / 2) * spread * k, lift = Math.sin(t * 0.8) * 0; l.style.transform = 'rotateX(' + VM.r(55 * k) + 'deg) rotateZ(' + VM.r(-24 * k) + 'deg) translateZ(' + VM.r(-off * 0.0) + 'px) translateY(' + VM.r(off) + 'px)'; l.style.zIndex = n - i; l.style.opacity = VM.r(VM.p(t, i * 0.1, 0.3)); });
      };
    }
  },

  dock: {
    description: 'A row of icons where a moving pointer magnifies the nearest ones (the magnetic dock). Show the tools you use or a product\'s integrations.',
    schema: { title: str(60), items: { type: 'array', required: true, minItems: 3, maxItems: 8, items: { type: 'object', fields: { icon: { type: 'enum', values: ['server', 'database', 'user', 'users', 'cloud', 'lock', 'gear', 'bolt', 'code', 'globe', 'phone', 'cpu', 'file', 'chart', 'shield', 'search', 'mail', 'key', 'star', 'network'] }, label: str(16, true) } } } },
    render(root, props, ctx, VM) {
      const n = props.items.length, base = ctx.u * 9, gapPx = ctx.u * 2;
      if (props.title) VM.el('div', { style: { position: 'absolute', left: '0', right: '0', top: (ctx.h * 0.2) + 'px', textAlign: 'center', fontWeight: '800', fontSize: (ctx.u * 4.6) + 'px' } }, root, props.title);
      const dockW = n * base + (n - 1) * gapPx + ctx.u * 6;
      const shell = VM.el('div', { style: { position: 'absolute', left: ((ctx.w - dockW) / 2) + 'px', bottom: (ctx.h * 0.3) + 'px', width: dockW + 'px', height: (base + ctx.u * 4) + 'px', background: VM.hexToRgba(ctx.theme.text, 0.08), border: '1px solid ' + VM.hexToRgba(ctx.theme.text, 0.18), borderRadius: (ctx.u * 3.4) + 'px' } }, root);
      const tiles = props.items.map((it, i) => {
        const el = VM.el('div', { style: { position: 'absolute', bottom: (ctx.u * 2) + 'px', width: base + 'px', height: base + 'px', borderRadius: (ctx.u * 2.2) + 'px', background: ctx.theme.surface, display: 'grid', placeItems: 'center', transformOrigin: '50% 100%', left: (ctx.u * 3 + i * (base + gapPx)) + 'px' } }, shell);
        if (it.icon) VM.icon(it.icon, base * 0.55, ctx.theme.palette[i % ctx.theme.palette.length], el); else VM.el('b', {}, el, it.label[0]);
        const tag = VM.el('div', { style: { position: 'absolute', top: (-ctx.u * 4.2) + 'px', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: (ctx.u * 2.3) + 'px', fontWeight: '700', color: ctx.theme.text, opacity: '0' } }, el, it.label);
        return { el, tag };
      });
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        const span = ctx.duration - 1.2, ph = VM.clamp((t - 0.9) / Math.max(0.5, span)), px = 3 * ctx.u + (dockW - 6 * ctx.u) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2 * 1.5 + Math.PI)) ; // pointer sweeps along the dock
        shell.style.opacity = VM.r(VM.p(t, 0, 0.4) * out);
        tiles.forEach(({ el, tag }, i) => {
          const cx = ctx.u * 3 + i * (base + gapPx) + base / 2, d = Math.abs(px - cx) / (base * 1.6), mag = VM.p(t, 0.9, 0.3) * Math.exp(-d * d * 1.6);
          const rise = VM.ease.expo(VM.p(t, 0.1 + i * 0.07, 0.6));
          el.style.transform = 'translateY(' + VM.r((1 - rise) * ctx.u * 6 - mag * ctx.u * 2) + 'px) scale(' + VM.r(0.4 + 0.6 * rise + mag * 0.55) + ')';
          el.style.opacity = VM.r(rise);
          tag.style.opacity = VM.r(mag > 0.8 ? 1 : 0);
        });
      };
    }
  }
};
