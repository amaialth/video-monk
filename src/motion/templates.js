// Motion-graphics template library. Each `render` is serialized into a headless Chrome page and must be
// self-contained: it may only use its arguments (root, props, ctx, VM). It builds the DOM once and returns
// update(t), a pure function of time in seconds. Text is always inserted with textContent.

import { EFFECTS } from './effects.js';

const str = (max, required = false) => ({ type: 'string', max, required });
const num = (required = false, min = -1e12, max = 1e12) => ({ type: 'number', required, min, max });
const color = { type: 'color' };
const iconName = { type: 'string', max: 24 };
const citation = str(160);

export const TEMPLATES = {
  title: {
    description: 'Kinetic title card: kicker, mask-revealed headline with *stressed* words in italic serif, accent rule, subtitle.',
    schema: { kicker: str(60), title: str(110, true), subtitle: str(140), align: { type: 'enum', values: ['center', 'left'] } },
    render(root, props, ctx, VM) {
      const left = props.align === 'left';
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: left ? 'flex-start' : 'center', textAlign: left ? 'left' : 'center',
        padding: (ctx.u * 8) + 'px' } }, root);
      const kicker = props.kicker ? VM.el('div', { style: { color: ctx.theme.accent, fontWeight: '700', letterSpacing: '0.18em',
        textTransform: 'uppercase', fontSize: (ctx.u * 3.2) + 'px', marginBottom: (ctx.u * 2.5) + 'px' } }, wrap, props.kicker) : null;
      const title = VM.el('div', { style: { fontWeight: '800', lineHeight: '1.06', letterSpacing: '-0.025em', maxWidth: (ctx.w - ctx.u * 16) + 'px' } }, wrap);
      const words = VM.words(title, props.title, { stressColor: ctx.theme.accent });
      VM.fit(title, ctx.w - ctx.u * 16, ctx.u * 11, ctx.u * 4, ctx.h * 0.5);
      const rule = VM.el('div', { style: { height: (ctx.u * 0.8) + 'px', background: ctx.theme.accent, borderRadius: '99px',
        marginTop: (ctx.u * 3) + 'px', width: (ctx.u * 18) + 'px', transformOrigin: left ? 'left' : 'center' } }, wrap);
      const sub = props.subtitle ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.8) + 'px',
        marginTop: (ctx.u * 3) + 'px', maxWidth: (ctx.w * 0.8) + 'px' } }, wrap, props.subtitle) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        if (kicker) VM.set(kicker, { opacity: VM.r(VM.tw(t, 0, 0.4, 0, 1) * out), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 2, 0)) + 'px)' });
        words.forEach((w, i) => {
          const k = VM.ease.expo(VM.p(t, 0.12 + i * 0.055, 0.6));
          // mask rise for every word; stressed words also focus-pull (blur-in) so they read as the beat.
          VM.set(w.inner, { transform: 'translateY(' + VM.r((1 - k) * 112 + (1 - out) * -112) + '%)',
            filter: w.stress ? 'blur(' + VM.r((1 - VM.ease.out(VM.p(t, 0.12 + i * 0.055, 0.5))) * ctx.u * 0.9) + 'px)' : 'none' });
        });
        VM.set(rule, { transform: 'scaleX(' + VM.r(VM.tw(t, 0.35, 0.6, 0, 1, 'inOut') * out) + ')' });
        if (sub) VM.set(sub, { opacity: VM.r(VM.tw(t, 0.55, 0.5, 0, 1) * out) });
      };
    }
  },

  chapter: {
    description: 'Section bumper with large chapter number and name.',
    schema: { number: str(6, true), title: str(80, true), subtitle: str(120) },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center',
        gap: (ctx.u * 5) + 'px', padding: (ctx.u * 10) + 'px', flexDirection: ctx.narrow ? 'column' : 'row', justifyContent: 'center' } }, root);
      const n = VM.el('div', { style: { fontSize: (ctx.u * 26) + 'px', fontWeight: '900', color: 'transparent',
        WebkitTextStroke: (ctx.u * 0.35) + 'px ' + ctx.theme.accent, lineHeight: '1' } }, wrap, props.number);
      const col = VM.el('div', { style: { display: 'flex', flexDirection: 'column', gap: (ctx.u * 1.5) + 'px', textAlign: ctx.narrow ? 'center' : 'left' } }, wrap);
      const tt = VM.el('div', { style: { fontWeight: '800', letterSpacing: '-0.025em', maxWidth: (ctx.w * 0.6) + 'px' } }, col);
      VM.rich(tt, props.title, { stressColor: ctx.theme.accent });
      VM.fit(tt, ctx.narrow ? ctx.w * 0.85 : ctx.w * 0.6, ctx.u * 8, ctx.u * 3.5, ctx.h * 0.4);
      const st = props.subtitle ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.4) + 'px' } }, col, props.subtitle) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        VM.set(n, { opacity: VM.r(VM.tw(t, 0, 0.5, 0, 1) * out), transform: 'scale(' + VM.r(VM.tw(t, 0, 0.7, 1.25, 1, 'expo')) + ')' });
        VM.set(tt, { opacity: VM.r(VM.tw(t, 0.25, 0.5, 0, 1) * out), transform: 'translateX(' + VM.r(VM.tw(t, 0.25, 0.6, ctx.u * 6, 0, 'expo')) + 'px)' });
        if (st) VM.set(st, { opacity: VM.r(VM.tw(t, 0.5, 0.5, 0, 1) * out) });
      };
    }
  },

  'lower-third': {
    description: 'Name/role strap that slides in near the bottom of the frame (full-frame overlay).',
    fullFrame: true,
    schema: { name: str(48, true), role: str(80), position: { type: 'enum', values: ['left', 'right'] } },
    render(root, props, ctx, VM) {
      const right = props.position === 'right';
      const box = VM.el('div', { style: { position: 'absolute', bottom: (ctx.h * (ctx.portrait ? 0.28 : 0.12)) + 'px',
        [right ? 'right' : 'left']: (ctx.u * 6) + 'px', display: 'flex', alignItems: 'stretch', gap: (ctx.u * 1.2) + 'px' } }, root);
      const bar = VM.el('div', { style: { width: (ctx.u * 0.9) + 'px', background: ctx.theme.accent, borderRadius: '99px', transformOrigin: 'bottom' } }, box);
      const panel = VM.el('div', { style: { background: VM.hexToRgba(ctx.theme.background, 0.88), padding: (ctx.u * 1.6) + 'px ' + (ctx.u * 2.8) + 'px',
        borderRadius: (ctx.u * 1.2) + 'px', overflow: 'hidden' } }, box);
      const name = VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 4.2) + 'px', whiteSpace: 'nowrap' } }, panel, props.name);
      const role = props.role ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.8) + 'px', marginTop: (ctx.u * 0.5) + 'px', whiteSpace: 'nowrap' } }, panel, props.role) : null;
      return t => {
        const k = VM.life(t, ctx, 0.15, 0.5);
        VM.set(bar, { transform: 'scaleY(' + VM.r(VM.life(t, ctx, 0, 0.35)) + ')' });
        VM.set(panel, { opacity: VM.r(k), clipPath: 'inset(0 ' + VM.r((1 - k) * 100) + '% 0 0)' });
        VM.set(name, { transform: 'translateX(' + VM.r((1 - k) * -ctx.u * 3) + 'px)' });
        if (role) VM.set(role, { opacity: VM.r(VM.life(t, ctx, 0.35, 0.4)) });
      };
    }
  },

  'kinetic-text': {
    description: 'Large pull-text revealed word by word (mask rise / blur-in / pop). *Stressed* words switch to italic serif in the accent colour. Optional cues land each word on its spoken time.',
    schema: { text: str(160, true), emphasis: { type: 'array', items: str(40), maxItems: 12 },
      reveal: { type: 'enum', values: ['mask', 'blur', 'pop'] }, mode: { type: 'enum', values: ['build', 'sequence'] },
      position: { type: 'enum', values: ['center', 'top', 'bottom'] }, align: { type: 'enum', values: ['center', 'left'] },
      cues: { type: 'array', maxItems: 40, items: num(true, 0, 3600) } },
    render(root, props, ctx, VM) {
      const pos = props.position || 'center';
      const left = props.align === 'left';
      const reveal = props.reveal || 'mask';
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', padding: (ctx.u * 4) + 'px',
        alignItems: pos === 'top' ? 'flex-start' : pos === 'bottom' ? 'flex-end' : 'center', justifyContent: left ? 'flex-start' : 'center' } }, root);
      const line = VM.el('div', { style: { fontWeight: '800', textAlign: left ? 'left' : 'center', lineHeight: '1.08', letterSpacing: '-0.025em' } }, wrap);
      const markup = VM.stressify(props.text, props.emphasis);
      const words = VM.words(line, markup, { stressColor: ctx.theme.accent, mask: reveal === 'mask' });
      VM.fit(line, ctx.w - ctx.u * 8, ctx.strip ? ctx.h * 0.46 : ctx.u * 12, ctx.strip ? ctx.h * 0.2 : ctx.u * 3.4, ctx.h - ctx.u * (ctx.strip ? 2 : 8));
      const cues = props.cues && props.cues.length === words.length ? props.cues : null;
      const span = Math.max(0.3, ctx.duration - 0.6);
      const step = Math.min(0.07, span * 0.7 / words.length);
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        words.forEach((w, i) => {
          const start = cues ? cues[i] : i * Math.max(step, 0.07);
          const e = VM.ease.expo(VM.p(t, start, reveal === 'pop' ? 0.35 : 0.55));
          const k = reveal === 'pop' ? VM.ease.back(VM.p(t, start, 0.35)) : e;
          const style = { opacity: VM.r(VM.clamp(reveal === 'mask' ? 1 : k * 1.4) * out) };
          if (reveal === 'mask') style.transform = 'translateY(' + VM.r((1 - e) * 112 + (1 - out) * -112) + '%)';
          else if (reveal === 'blur') { style.transform = 'translateY(' + VM.r((1 - e) * 0.3) + 'em)'; style.filter = 'blur(' + VM.r((1 - e) * ctx.u * 1.1) + 'px)'; }
          else style.transform = 'translateY(' + VM.r((1 - k) * 0.4) + 'em) scale(' + VM.r(0.85 + 0.15 * k) + ')';
          if (w.stress && reveal === 'mask') style.filter = 'blur(' + VM.r((1 - VM.ease.out(VM.p(t, start, 0.45))) * ctx.u * 0.9) + 'px)';
          VM.set(w.inner, style);
          if (reveal !== 'mask') VM.set(w.outer, { display: props.mode === 'sequence' && k <= 0 && t > start ? 'none' : 'inline-block' });
        });
      };
    }
  },

  term: {
    description: 'Definition card: a category pill, the term in large type, and its definition revealed word by word (use *stress* for the key word).',
    schema: { term: str(60, true), definition: str(190, true), category: str(28), icon: iconName, cues: { type: 'array', maxItems: 60, items: num(true, 0, 3600) } },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: (ctx.u * 9) + 'px', gap: (ctx.u * 2.2) + 'px' } }, root);
      const pill = VM.el('div', { style: { alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: (ctx.u * 1.2) + 'px', color: ctx.theme.accent,
        border: '1.5px solid ' + VM.hexToRgba(ctx.theme.accent, 0.6), borderRadius: '99px', padding: (ctx.u * 0.7) + 'px ' + (ctx.u * 2) + 'px',
        fontWeight: '700', letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: (ctx.u * 2.5) + 'px' } }, wrap);
      if (props.icon) VM.icon(props.icon, ctx.u * 3, ctx.theme.accent, pill);
      VM.el('span', {}, pill, props.category || 'Definition');
      const termLine = VM.el('div', { style: { fontWeight: '800', lineHeight: '1.04', letterSpacing: '-0.03em' } }, wrap);
      const termWords = VM.words(termLine, '*' + props.term.replace(/\*/g, '') + '*', { stressColor: ctx.theme.text });
      termWords.forEach(w => { w.inner.style.fontSize = '1.22em'; });
      VM.fit(termLine, ctx.w - ctx.u * 18, ctx.u * 15, ctx.u * 6, ctx.h * 0.35);
      const rule = VM.el('div', { style: { height: (ctx.u * 0.7) + 'px', width: (ctx.u * 14) + 'px', background: ctx.theme.accent, borderRadius: '99px', transformOrigin: 'left' } }, wrap);
      const def = VM.el('div', { style: { fontSize: (ctx.u * 4.4) + 'px', lineHeight: '1.3', color: ctx.theme.text, maxWidth: (ctx.w - ctx.u * 18) + 'px', fontWeight: '500' } }, wrap);
      const defWords = VM.words(def, props.definition, { stressColor: ctx.theme.accent, mask: false });
      VM.fit(def, ctx.w - ctx.u * 18, ctx.u * 4.4, ctx.u * 2.6, ctx.h * 0.4);
      const cues = props.cues && props.cues.length === defWords.length ? props.cues : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        VM.set(pill, { opacity: VM.r(VM.tw(t, 0, 0.3, 0, 1) * out), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.45, ctx.u * 1.5, 0)) + 'px)' });
        termWords.forEach((w, i) => VM.set(w.inner, { transform: 'translateY(' + VM.r((1 - VM.ease.expo(VM.p(t, 0.1 + i * 0.07, 0.6))) * 112 + (1 - out) * -112) + '%)' }));
        VM.set(rule, { transform: 'scaleX(' + VM.r(VM.tw(t, 0.4, 0.5, 0, 1, 'inOut') * out) + ')' });
        defWords.forEach((w, i) => {
          const start = cues ? cues[i] : 0.55 + i * 0.045;
          VM.set(w.inner, { opacity: VM.r(VM.tw(t, start, 0.25, 0, 1) * out), transform: 'translateY(' + VM.r(VM.tw(t, start, 0.35, ctx.u * 0.9, 0)) + 'px)' });
        });
      };
    }
  },

  'bar-chart': {
    description: 'Animated horizontal or vertical bar chart with real values, units and citation.',
    schema: { title: str(70), unit: str(16), max: num(), decimals: num(false, 0, 4),
      orientation: { type: 'enum', values: ['horizontal', 'vertical'] }, highlight: num(false, 0, 9), hideValues: { type: 'boolean' },
      bars: { type: 'array', required: true, minItems: 1, maxItems: 10,
        items: { type: 'object', fields: { label: str(40, true), value: num(true, 0), color, display: str(24), at: num(false, 0, 3600) } } },
      citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 7;
      const pal = ctx.theme.palette;
      const max = props.max || Math.max(...props.bars.map(b => b.value)) || 1;
      const vertical = props.orientation === 'vertical';
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', top: pad * 0.8 + 'px', right: pad + 'px', fontWeight: '800' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const top = pad * 0.8 + (title ? ctx.u * 10 : 0);
      const bottom = props.citation ? ctx.u * 9 : pad;
      const area = VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: top + 'px', bottom: bottom + 'px',
        display: 'flex', flexDirection: vertical ? 'row' : 'column', justifyContent: 'space-around', alignItems: vertical ? 'flex-end' : 'stretch',
        gap: (ctx.u * 2) + 'px' } }, root);
      const n = props.bars.length;
      const fontSize = Math.min(ctx.u * 4.4, (vertical ? ctx.w : ctx.h) / (n * 4.2));
      const items = props.bars.map((b, i) => {
        const c = b.color || (props.highlight === undefined ? pal[i % pal.length] : (props.highlight === i ? ctx.theme.accent : ctx.theme.muted));
        const row = VM.el('div', { style: vertical
          ? { flex: '1', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: (ctx.u * 1) + 'px' }
          : { display: 'flex', flexDirection: 'column', gap: (ctx.u * 0.8) + 'px' } }, area);
        const head = VM.el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: fontSize + 'px', gap: ctx.u + 'px',
          width: '100%', flexDirection: vertical ? 'column-reverse' : 'row', alignItems: vertical ? 'center' : 'baseline', textAlign: 'center' } }, row);
        const label = VM.el('span', { style: { color: ctx.theme.text, fontWeight: '600' } }, head, b.label);
        const value = VM.el('span', { style: { color: c, fontWeight: '800', fontVariantNumeric: 'tabular-nums' } }, head, '');
        if (vertical) row.insertBefore(head.removeChild(value), row.firstChild);
        const track = VM.el('div', { style: vertical
          ? { width: '62%', flex: '1', display: 'flex', alignItems: 'flex-end' }
          : { height: (fontSize * 1.1) + 'px', background: VM.hexToRgba(ctx.theme.text, 0.08), borderRadius: '99px', overflow: 'hidden' } }, row);
        if (vertical) row.appendChild(label);
        const fill = VM.el('div', { style: vertical
          ? { width: '100%', background: c, borderRadius: (ctx.u * 0.8) + 'px ' + (ctx.u * 0.8) + 'px 0 0' }
          : { height: '100%', background: c, borderRadius: '99px' } }, track);
        return { b, value, fill, row };
      });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', bottom: (ctx.u * 3) + 'px',
        color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        if (title) VM.set(title, { opacity: VM.r(VM.tw(t, 0, 0.4, 0, 1) * out) });
        items.forEach((it, i) => {
          const start = it.b.at !== undefined ? it.b.at : 0.3 + i * Math.min(0.25, (ctx.duration * 0.4) / n);
          const k = VM.ease.inOut(VM.p(t, start, 0.9));
          const share = Math.min(1, it.b.value / max);
          VM.set(it.row, { opacity: VM.r(VM.tw(t, start - 0.1, 0.3, 0, 1) * out) });
          if (vertical) it.fill.style.height = VM.r(share * k * 100) + '%';
          else it.fill.style.width = VM.r(share * k * 100) + '%';
          it.value.textContent = props.hideValues ? '' : it.b.display && k >= 1 ? it.b.display
            : VM.fmt(it.b.value * k, props.decimals || 0) + (props.unit ? (props.unit.length <= 2 ? '' : ' ') + props.unit : '');
        });
        if (cite) VM.set(cite, { opacity: VM.r(VM.tw(t, 0.6, 0.5, 0, 1) * out) });
      };
    }
  },

  'line-chart': {
    description: 'Animated line chart: series draw on over time with labelled axes and end values.',
    schema: { title: str(70), unit: str(16), yMin: num(), yMax: num(), decimals: num(false, 0, 4),
      labels: { type: 'array', required: true, minItems: 2, maxItems: 24, items: str(14) },
      series: { type: 'array', required: true, minItems: 1, maxItems: 4,
        items: { type: 'object', fields: { name: str(30, true), color, values: { type: 'array', required: true, minItems: 2, maxItems: 24, items: num(true) } } } },
      citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 7;
      const W = ctx.w, H = ctx.h;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', top: pad * 0.8 + 'px', fontWeight: '800', right: pad + 'px' } }, root, props.title) : null;
      if (title) VM.fit(title, W - pad * 2, ctx.u * 6, ctx.u * 3);
      const all = props.series.flatMap(s => s.values);
      const yMin = props.yMin ?? Math.min(0, ...all), yMax = props.yMax ?? (Math.max(...all) * 1.1 || 1);
      const left = pad + ctx.u * 8, right = W - pad - ctx.u * 12, top = pad * 0.8 + (title ? ctx.u * 12 : ctx.u * 2),
        bottom = H - (props.citation ? ctx.u * 12 : pad + ctx.u * 4);
      const svg = VM.svg('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;overflow:visible' }, root);
      const fs = ctx.u * 3;
      const n = props.labels.length;
      const x = i => left + (right - left) * (i / (n - 1));
      const y = v => bottom - (bottom - top) * ((v - yMin) / (yMax - yMin || 1));
      const grid = VM.svg('g', {}, svg);
      for (let g = 0; g <= 4; g++) {
        const v = yMin + (yMax - yMin) * g / 4;
        VM.svg('line', { x1: left, x2: right, y1: y(v), y2: y(v), stroke: VM.hexToRgba(ctx.theme.text, 0.12), 'stroke-width': 1 }, grid);
        VM.svg('text', { x: left - ctx.u, y: y(v) + fs * 0.35, fill: ctx.theme.muted, 'font-size': fs, 'text-anchor': 'end' }, grid,
          VM.fmt(v, props.decimals || 0));
      }
      const every = Math.ceil(n / 8);
      props.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) VM.svg('text', { x: x(i), y: bottom + fs * 1.6, fill: ctx.theme.muted, 'font-size': fs, 'text-anchor': 'middle' }, grid, l); });
      const lines = props.series.map((s, si) => {
        const c = s.color || ctx.theme.palette[si % ctx.theme.palette.length];
        const d = s.values.map((v, i) => (i ? 'L' : 'M') + VM.r(x(i), 1) + ' ' + VM.r(y(v), 1)).join(' ');
        const path = VM.svg('path', { d, fill: 'none', stroke: c, 'stroke-width': ctx.u * 0.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
        const len = path.getTotalLength();
        path.setAttribute('stroke-dasharray', VM.r(len, 1) + ' ' + VM.r(len, 1));
        const dot = VM.svg('circle', { r: ctx.u * 1.1, fill: c, stroke: ctx.theme.background, 'stroke-width': ctx.u * 0.35 }, svg);
        const tag = VM.svg('text', { fill: c, 'font-size': fs * 1.15, 'font-weight': 800 }, svg);
        return { s, path, len, dot, tag };
      });
      const legend = VM.el('div', { style: { position: 'absolute', right: pad + 'px', top: (top - ctx.u * 6) + 'px', display: 'flex', gap: (ctx.u * 3) + 'px', fontSize: fs + 'px' } }, root);
      lines.forEach(l => { const it = VM.el('span', { style: { display: 'flex', alignItems: 'center', gap: ctx.u + 'px' } }, legend);
        VM.el('span', { style: { width: (ctx.u * 2.5) + 'px', height: (ctx.u * 0.6) + 'px', background: l.path.getAttribute('stroke'), borderRadius: '9px' } }, it);
        VM.el('span', {}, it, l.s.name); });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', bottom: (ctx.u * 3) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        grid.setAttribute('opacity', VM.r(VM.tw(t, 0.1, 0.5, 0, 1)));
        legend.style.opacity = VM.r(VM.tw(t, 0.3, 0.5, 0, 1));
        lines.forEach((l, i) => {
          const k = VM.ease.inOut(VM.p(t, 0.4 + i * 0.25, Math.max(0.8, ctx.duration * 0.5)));
          l.path.setAttribute('stroke-dashoffset', VM.r(l.len * (1 - k), 1));
          const pt = l.path.getPointAtLength(l.len * k);
          l.dot.setAttribute('cx', VM.r(pt.x, 1)); l.dot.setAttribute('cy', VM.r(pt.y, 1));
          l.dot.setAttribute('opacity', k > 0 ? 1 : 0);
          const idx = Math.min(l.s.values.length - 1, Math.round(k * (l.s.values.length - 1)));
          l.tag.setAttribute('x', VM.r(pt.x + ctx.u * 1.8, 1)); l.tag.setAttribute('y', VM.r(pt.y + fs * 0.4, 1));
          l.tag.textContent = k > 0 ? VM.fmt(l.s.values[idx], props.decimals || 0) + (props.unit ? ' ' + props.unit : '') : '';
        });
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.6, 0.5, 0, 1));
      };
    }
  },

  donut: {
    description: 'Animated donut chart with legend percentages and a center label.',
    schema: { title: str(70), centerLabel: str(24), centerValue: str(16), unit: str(16),
      segments: { type: 'array', required: true, minItems: 1, maxItems: 7,
        items: { type: 'object', fields: { label: str(36, true), value: num(true, 0), color } } }, citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 7;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', top: pad * 0.8 + 'px', right: pad + 'px', fontWeight: '800', textAlign: ctx.narrow ? 'center' : 'left' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const total = props.segments.reduce((a, s) => a + s.value, 0) || 1;
      const size = Math.min(ctx.narrow ? ctx.w * 0.75 : ctx.w * 0.42, ctx.h * 0.62);
      const body = VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: (pad + (title ? ctx.u * 10 : 0)) + 'px',
        bottom: (props.citation ? ctx.u * 9 : pad) + 'px', display: 'flex', flexDirection: ctx.narrow ? 'column' : 'row', alignItems: 'center',
        justifyContent: 'center', gap: (ctx.u * 7) + 'px' } }, root);
      const holder = VM.el('div', { style: { position: 'relative', width: size + 'px', height: size + 'px', flex: '0 0 auto' } }, body);
      const svg = VM.svg('svg', { width: size, height: size, viewBox: '0 0 100 100', style: 'transform:rotate(-90deg)' }, holder);
      const R = 40, C = 2 * Math.PI * R;
      VM.svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: VM.hexToRgba(ctx.theme.text, 0.08), 'stroke-width': 14 }, svg);
      let acc = 0;
      const segs = props.segments.map((s, i) => {
        const c = s.color || ctx.theme.palette[i % ctx.theme.palette.length];
        const share = s.value / total;
        const node = VM.svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: c, 'stroke-width': 14 }, svg);
        const seg = { s, c, share, start: acc, node };
        acc += share;
        return seg;
      });
      const center = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } }, holder);
      const cv = VM.el('div', { style: { fontWeight: '900', fontSize: (size * 0.16) + 'px' } }, center, props.centerValue || '');
      if (props.centerLabel) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (size * 0.07) + 'px' } }, center, props.centerLabel);
      const legend = VM.el('div', { style: { display: 'flex', flexDirection: 'column', gap: (ctx.u * 2.4) + 'px', fontSize: (ctx.u * 4.2) + 'px' } }, body);
      const rows = segs.map(s => {
        const row = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: (ctx.u * 1.6) + 'px' } }, legend);
        VM.el('span', { style: { width: (ctx.u * 2.4) + 'px', height: (ctx.u * 2.4) + 'px', borderRadius: (ctx.u * 0.6) + 'px', background: s.c } }, row);
        VM.el('span', { style: { fontWeight: '800', minWidth: (ctx.u * 9) + 'px', fontVariantNumeric: 'tabular-nums' } }, row,
          (Math.round(s.share * 1000) / 10) + '%');
        VM.el('span', { style: { color: ctx.theme.muted } }, row, s.s.label);
        return row;
      });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', bottom: (ctx.u * 3) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        const k = VM.ease.inOut(VM.p(t, 0.2, Math.min(1.6, ctx.duration * 0.5)));
        segs.forEach(s => {
          const visible = Math.max(0, Math.min(s.share, k - s.start));
          s.node.setAttribute('stroke-dasharray', VM.r(visible * C, 2) + ' ' + VM.r(C, 2));
          s.node.setAttribute('stroke-dashoffset', VM.r(-s.start * C, 2));
        });
        holder.style.transform = 'scale(' + VM.r(VM.tw(t, 0, 0.6, 0.85, 1, 'back')) + ')';
        cv.style.opacity = VM.r(VM.tw(t, 0.8, 0.4, 0, 1));
        rows.forEach((row, i) => VM.set(row, { opacity: VM.r(VM.tw(t, 0.4 + i * 0.15, 0.4, 0, 1)), transform: 'translateX(' + VM.r(VM.tw(t, 0.4 + i * 0.15, 0.5, ctx.u * 3, 0)) + 'px)' }));
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.6, 0.5, 0, 1));
      };
    }
  },

  stat: {
    description: 'Big-number counter with prefix/suffix, label, note and citation.',
    schema: { value: num(true), decimals: num(false, 0, 4), prefix: str(6), suffix: str(10), label: str(80, true), note: str(120), citation },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: (ctx.u * 6) + 'px' } }, root);
      const big = VM.el('div', { style: { fontWeight: '900', color: ctx.theme.accent, fontVariantNumeric: 'tabular-nums', lineHeight: '1', whiteSpace: 'nowrap' } }, wrap);
      big.textContent = (props.prefix || '') + VM.fmt(props.value, props.decimals || 0) + (props.suffix || '');
      VM.fit(big, ctx.w - ctx.u * 12, ctx.u * 26, ctx.u * 8);
      const label = VM.el('div', { style: { fontWeight: '700', fontSize: (ctx.u * 5) + 'px', marginTop: (ctx.u * 2) + 'px', maxWidth: (ctx.w * 0.85) + 'px' } }, wrap);
      VM.rich(label, props.label, { stressColor: ctx.theme.accent });
      const note = props.note ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.2) + 'px', marginTop: (ctx.u * 1.5) + 'px', maxWidth: (ctx.w * 0.8) + 'px' } }, wrap, props.note) : null;
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', bottom: (ctx.u * 3) + 'px', left: '0', right: '0', textAlign: 'center', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        const k = VM.ease.expo(VM.p(t, 0.1, Math.min(1.8, ctx.duration * 0.55)));
        big.textContent = (props.prefix || '') + VM.fmt(props.value * k, props.decimals || 0) + (props.suffix || '');
        VM.set(big, { opacity: VM.r(VM.tw(t, 0, 0.3, 0, 1) * out), transform: 'scale(' + VM.r(VM.tw(t, 0, 0.6, 0.8, 1, 'back')) + ')' });
        VM.set(label, { opacity: VM.r(VM.tw(t, 0.4, 0.5, 0, 1) * out), transform: 'translateY(' + VM.r(VM.tw(t, 0.4, 0.5, ctx.u * 3, 0)) + 'px)' });
        if (note) note.style.opacity = VM.r(VM.tw(t, 0.7, 0.5, 0, 1) * out);
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.8, 0.5, 0, 1) * out);
      };
    }
  },

  comparison: {
    description: 'Two or three columns compared side by side (stacked in portrait), items checking in.',
    schema: { title: str(70), columns: { type: 'array', required: true, minItems: 2, maxItems: 3,
      items: { type: 'object', fields: { heading: str(36, true), icon: iconName, color, items: { type: 'array', required: true, minItems: 1, maxItems: 6, items: str(70) } } } },
    citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 6;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: pad + 'px', fontWeight: '800', textAlign: 'center' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const grid = VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: (pad + (title ? ctx.u * 11 : 0)) + 'px',
        bottom: (props.citation ? ctx.u * 9 : pad) + 'px', display: 'flex', flexDirection: ctx.narrow ? 'column' : 'row', gap: (ctx.u * 3) + 'px', alignItems: ctx.narrow ? 'stretch' : 'center', justifyContent: 'center' } }, root);
      const cols = props.columns.map((c, i) => {
        const colr = c.color || ctx.theme.palette[i % ctx.theme.palette.length];
        const col = VM.el('div', { style: { flex: '1', background: VM.hexToRgba(ctx.theme.text, 0.05), border: '1px solid ' + VM.hexToRgba(colr, 0.5),
          borderTop: (ctx.u * 0.7) + 'px solid ' + colr, borderRadius: (ctx.u * 1.6) + 'px', padding: (ctx.u * 3.5) + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 2.4) + 'px', minHeight: '0' } }, grid);
        const head = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: (ctx.u * 1.5) + 'px', fontWeight: '800', fontSize: (ctx.u * 5.6) + 'px', color: colr } }, col);
        if (c.icon) VM.icon(c.icon, ctx.u * 6, colr, head);
        VM.el('span', {}, head, c.heading);
        const items = c.items.map(text => {
          const row = VM.el('div', { style: { display: 'flex', gap: (ctx.u * 1.4) + 'px', alignItems: 'flex-start', fontSize: (ctx.u * 4.1) + 'px' } }, col);
          VM.el('span', { style: { width: (ctx.u * 1.2) + 'px', height: (ctx.u * 1.2) + 'px', borderRadius: '99px', background: colr, marginTop: '0.45em', flex: '0 0 auto' } }, row);
          VM.el('span', {}, row, text);
          return row;
        });
        return { col, items };
      });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', bottom: (ctx.u * 3) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      const total = cols.reduce((a, c) => a + c.items.length, 0);
      const step = Math.min(0.35, Math.max(0.12, (ctx.duration * 0.55) / total));
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        let n = 0;
        cols.forEach((c, i) => {
          VM.set(c.col, { opacity: VM.r(VM.tw(t, 0.15 + i * 0.15, 0.45, 0, 1)), transform: 'translateY(' + VM.r(VM.tw(t, 0.15 + i * 0.15, 0.6, ctx.u * 5, 0, 'expo')) + 'px)' });
          c.items.forEach(row => { const s = 0.6 + n++ * step; VM.set(row, { opacity: VM.r(VM.tw(t, s, 0.35, 0, 1)), transform: 'translateX(' + VM.r(VM.tw(t, s, 0.4, ctx.u * 2, 0)) + 'px)' }); });
        });
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.8, 0.5, 0, 1));
      };
    }
  },

  flow: {
    description: 'Architecture/process diagram: icon nodes appear, arrows draw, and packets travel the edges.',
    schema: { title: str(70),
      nodes: { type: 'array', required: true, minItems: 2, maxItems: 12,
        items: { type: 'object', fields: { id: { type: 'string', max: 32, required: true }, label: str(28, true), sub: str(40),
          icon: iconName, color, x: num(false, 0, 1), y: num(false, 0, 1), at: num(false, 0, 3600) } } },
      edges: { type: 'array', maxItems: 20, items: { type: 'object', fields: { from: str(32, true), to: str(32, true), label: str(24), dashed: { type: 'boolean' } } } },
      packets: { type: 'boolean' }, citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 6;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: pad + 'px', fontWeight: '800', textAlign: 'center' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const top = pad + (title ? ctx.u * 10 : 0), bottom = ctx.h - (props.citation ? ctx.u * 9 : pad);
      const n = props.nodes.length;
      const vertical = ctx.narrow;
      const pos = (node, i) => {
        const fx = node.x ?? (vertical ? 0.5 : (n === 1 ? 0.5 : 0.08 + 0.84 * i / (n - 1)));
        const fy = node.y ?? (vertical ? (n === 1 ? 0.5 : 0.08 + 0.84 * i / (n - 1)) : 0.5);
        return { x: pad + (ctx.w - pad * 2) * fx, y: top + (bottom - top) * fy };
      };
      const svg = VM.svg('svg', { width: ctx.w, height: ctx.h, style: 'position:absolute;left:0;top:0;overflow:visible' }, root);
      const defs = VM.svg('defs', {}, svg);
      const marker = VM.svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      VM.svg('path', { d: 'M0 0L10 5L0 10z', fill: ctx.theme.muted }, marker);
      const per = vertical ? Math.min(ctx.w * 0.88, ctx.u * 70) : Math.min((ctx.w - pad * 2) / Math.max(2, n) * 0.82, ctx.u * 30);
      const nodes = new Map();
      props.nodes.forEach((node, i) => {
        const c = node.color || ctx.theme.palette[i % ctx.theme.palette.length];
        const p = pos(node, i);
        const box = VM.el('div', { style: { position: 'absolute', left: p.x + 'px', top: p.y + 'px', transform: 'translate(-50%,-50%)', maxWidth: per + 'px',
          background: ctx.theme.surface, border: (ctx.u * 0.3) + 'px solid ' + c, borderRadius: (ctx.u * 1.8) + 'px', padding: (ctx.u * 1.8) + 'px ' + (ctx.u * 2.4) + 'px',
          display: 'flex', alignItems: 'center', gap: (ctx.u * 1.4) + 'px', boxShadow: '0 0 ' + (ctx.u * 3) + 'px ' + VM.hexToRgba(c, 0.25) } }, root);
        if (node.icon) VM.icon(node.icon, ctx.u * (n > 5 ? 5 : 6.5), c, box);
        const txt = VM.el('div', { style: { display: 'flex', flexDirection: 'column' } }, box);
        VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * (n > 5 ? 3.2 : 4)) + 'px', whiteSpace: 'nowrap' } }, txt, node.label);
        if (node.sub) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * (n > 5 ? 2.4 : 2.9)) + 'px', whiteSpace: 'nowrap' } }, txt, node.sub);
        const rect = box.getBoundingClientRect();
        nodes.set(node.id, { box, p, c, w: rect.width, h: rect.height, i });
      });
      // Clip a segment between centers to the node rectangles' borders.
      const clip = (a, b) => {
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y;
        const ta = Math.min(Math.abs((a.w / 2 + ctx.u) / (dx || 1e-9)), Math.abs((a.h / 2 + ctx.u) / (dy || 1e-9)));
        const tb = Math.min(Math.abs((b.w / 2 + ctx.u * 1.6) / (dx || 1e-9)), Math.abs((b.h / 2 + ctx.u * 1.6) / (dy || 1e-9)));
        return { x1: a.p.x + dx * ta, y1: a.p.y + dy * ta, x2: b.p.x - dx * tb, y2: b.p.y - dy * tb };
      };
      const order = props.nodes.length;
      const nodeStart = i => (props.nodes[i].at !== undefined ? props.nodes[i].at : 0.2 + i * Math.min(0.35, (ctx.duration * 0.45) / order));
      const edges = (props.edges || props.nodes.slice(1).map((nd, i) => ({ from: props.nodes[i].id, to: nd.id }))).map(e => {
        const a = nodes.get(e.from), b = nodes.get(e.to);
        if (!a || !b) throw new Error('flow edge references unknown node: ' + e.from + ' -> ' + e.to);
        const s = clip(a, b);
        const line = VM.svg('line', { ...s, stroke: ctx.theme.muted, 'stroke-width': ctx.u * 0.35, 'marker-end': 'url(#arrow)',
          'stroke-linecap': 'round' }, svg);
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (!e.dashed) line.setAttribute('stroke-dasharray', VM.r(len, 1) + ' ' + VM.r(len, 1));
        else line.setAttribute('stroke-dasharray', VM.r(ctx.u, 1) + ' ' + VM.r(ctx.u, 1));
        const steep = Math.abs(s.y2 - s.y1) > Math.abs(s.x2 - s.x1);
        const label = e.label ? VM.svg('text', { x: (s.x1 + s.x2) / 2 + (steep ? ctx.u * 1.8 : 0), y: (s.y1 + s.y2) / 2 + (steep ? ctx.u : -ctx.u * 1.2),
          fill: ctx.theme.muted, 'font-size': ctx.u * 2.8, 'text-anchor': steep ? 'start' : 'middle' }, svg, e.label) : null;
        const packet = props.packets !== false ? VM.svg('circle', { r: ctx.u * 0.9, fill: b.c }, svg) : null;
        return { e, s, line, len, label, packet, start: Math.max(nodeStart(a.i), nodeStart(b.i)) + 0.3 };
      });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', bottom: (ctx.u * 3) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        for (const nd of nodes.values()) {
          const k = VM.ease.back(VM.p(t, nodeStart(nd.i), 0.45));
          VM.set(nd.box, { opacity: VM.r(VM.clamp(k * 1.5)), transform: 'translate(-50%,-50%) scale(' + VM.r(0.6 + 0.4 * k) + ')' });
        }
        edges.forEach(ed => {
          const k = VM.ease.inOut(VM.p(t, ed.start, 0.5));
          ed.line.setAttribute('opacity', k > 0 ? 1 : 0);
          if (!ed.e.dashed) ed.line.setAttribute('stroke-dashoffset', VM.r(ed.len * (1 - k), 1));
          if (ed.label) ed.label.setAttribute('opacity', VM.r(k));
          if (ed.packet) {
            const cycle = 1.4;
            const local = t - ed.start - 0.5;
            const f = local < 0 ? -1 : (local % cycle) / cycle;
            ed.packet.setAttribute('opacity', f < 0 || f > 0.92 ? 0 : 1);
            const ff = Math.max(0, f);
            ed.packet.setAttribute('cx', VM.r(ed.s.x1 + (ed.s.x2 - ed.s.x1) * ff, 1));
            ed.packet.setAttribute('cy', VM.r(ed.s.y1 + (ed.s.y2 - ed.s.y1) * ff, 1));
          }
        });
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.6, 0.5, 0, 1));
      };
    }
  },

  steps: {
    description: 'Numbered process steps revealed in sequence along a growing connector.',
    schema: { title: str(70), steps: { type: 'array', required: true, minItems: 1, maxItems: 7,
      items: { type: 'object', fields: { title: str(40, true), detail: str(100), icon: iconName, at: num(false, 0, 3600) } } }, citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 7;
      const horizontal = !ctx.narrow && props.steps.length <= 5;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: pad * 0.8 + 'px', fontWeight: '800', textAlign: horizontal ? 'center' : 'left' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const list = VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: (pad + (title ? ctx.u * 10 : 0)) + 'px', bottom: pad + 'px',
        display: 'flex', flexDirection: horizontal ? 'row' : 'column', justifyContent: 'center', gap: (ctx.u * (horizontal ? 2 : 3)) + 'px', alignItems: horizontal ? 'flex-start' : 'stretch' } }, root);
      if (horizontal) Object.assign(list.style, { bottom: 'auto', top: (pad + (title ? ctx.u * 10 : 0) + (ctx.h - pad * 2 - (title ? ctx.u * 10 : 0)) * 0.3) + 'px' });
      const d = ctx.u * 9;
      const items = props.steps.map((s, i) => {
        const row = VM.el('div', { style: { flex: horizontal ? '1' : '0 0 auto', display: 'flex', flexDirection: horizontal ? 'column' : 'row', alignItems: horizontal ? 'center' : 'flex-start',
          textAlign: horizontal ? 'center' : 'left', gap: (ctx.u * 2) + 'px', position: 'relative' } }, list);
        const dot = VM.el('div', { style: { width: d + 'px', height: d + 'px', borderRadius: '99px', border: (ctx.u * 0.4) + 'px solid ' + ctx.theme.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', fontSize: (ctx.u * 4.2) + 'px', flex: '0 0 auto', background: ctx.theme.background, zIndex: '1' } }, row);
        if (s.icon) VM.icon(s.icon, ctx.u * 4.6, ctx.theme.accent, dot); else dot.textContent = String(i + 1);
        const txt = VM.el('div', {}, row);
        VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 4.6) + 'px' } }, txt, s.title);
        if (s.detail) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.3) + 'px', marginTop: (ctx.u * 0.6) + 'px' } }, txt, s.detail);
        return { row, dot };
      });
      const rail = VM.el('div', { style: { position: 'absolute', background: VM.hexToRgba(ctx.theme.accent, 0.5), transformOrigin: horizontal ? 'left' : 'top' } }, list);
      const a = items[0].dot.getBoundingClientRect(), b = items[items.length - 1].dot.getBoundingClientRect(), base = list.getBoundingClientRect();
      if (horizontal) Object.assign(rail.style, { left: (a.left - base.left + d / 2) + 'px', width: Math.max(0, b.left - a.left) + 'px', top: (a.top - base.top + d / 2) + 'px', height: (ctx.u * 0.4) + 'px' });
      else Object.assign(rail.style, { top: (a.top - base.top + d / 2) + 'px', height: Math.max(0, b.top - a.top) + 'px', left: (a.left - base.left + d / 2 - ctx.u * 0.2) + 'px', width: (ctx.u * 0.4) + 'px' });
      const step = Math.min(0.6, (ctx.duration * 0.7) / items.length);
      const at = i => (props.steps[i].at !== undefined ? props.steps[i].at : 0.3 + i * step);
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        rail.style.transform = (horizontal ? 'scaleX(' : 'scaleY(') + VM.r(VM.ease.inOut(VM.p(t, 0.3, step * items.length))) + ')';
        items.forEach((it, i) => {
          const s = at(i);
          VM.set(it.row, { opacity: VM.r(VM.tw(t, s, 0.35, 0, 1)), transform: 'translateY(' + VM.r(VM.tw(t, s, 0.5, ctx.u * 2, 0, 'expo')) + 'px)' });
          const active = t >= s;
          it.dot.style.background = active ? ctx.theme.accent : ctx.theme.background;
          it.dot.style.color = active ? ctx.theme.background : ctx.theme.text;
        });
      };
    }
  },

  bullets: {
    description: 'Title with bullet points revealed one by one.',
    schema: { title: str(70), items: { type: 'array', required: true, minItems: 1, maxItems: 8, items: str(110) },
      marker: { type: 'enum', values: ['dot', 'check', 'number', 'x'] }, cues: { type: 'array', maxItems: 8, items: num(true, 0, 3600) } },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 7;
      const wrap = VM.el('div', { style: { position: 'absolute', inset: pad + 'px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: (ctx.u * 2.4) + 'px' } }, root);
      const title = props.title ? VM.el('div', { style: { fontWeight: '800', marginBottom: (ctx.u * 1.5) + 'px' } }, wrap, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 8, ctx.u * 3);
      const fs = Math.min(ctx.u * 5.6, (ctx.h - pad * 2) / (props.items.length * 2.4));
      const rows = props.items.map((text, i) => {
        const row = VM.el('div', { style: { display: 'flex', gap: (ctx.u * 2) + 'px', alignItems: 'flex-start', fontSize: fs + 'px' } }, wrap);
        const m = props.marker || 'dot';
        if (m === 'check' || m === 'x') VM.icon(m, fs * 1.1, m === 'x' ? ctx.theme.palette[1] : ctx.theme.accent, row);
        else if (m === 'number') VM.el('span', { style: { color: ctx.theme.accent, fontWeight: '900', minWidth: '1.3em' } }, row, (i + 1) + '.');
        else VM.el('span', { style: { width: (fs * 0.35) + 'px', height: (fs * 0.35) + 'px', background: ctx.theme.accent, borderRadius: '99px', marginTop: '0.42em', flex: '0 0 auto' } }, row);
        VM.rich(VM.el('span', {}, row), text, { stressColor: ctx.theme.accent });
        return row;
      });
      const step = Math.min(0.5, (ctx.duration * 0.6) / rows.length);
      const cues = props.cues && props.cues.length === rows.length ? props.cues : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) VM.set(title, { opacity: VM.r(VM.tw(t, 0, 0.4, 0, 1)), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 2, 0)) + 'px)' });
        rows.forEach((row, i) => { const s = cues ? cues[i] : 0.35 + i * step; VM.set(row, { opacity: VM.r(VM.tw(t, s, 0.35, 0, 1)), transform: 'translateX(' + VM.r(VM.tw(t, s, 0.45, ctx.u * 3, 0, 'expo')) + 'px)' }); });
      };
    }
  },

  callout: {
    description: 'Highlights a region of the underlying shot (normalized x/y/w/h) with an animated box/ring and label.',
    fullFrame: true,
    schema: { x: num(true, 0, 1), y: num(true, 0, 1), w: num(true, 0.01, 1), h: num(true, 0.01, 1), label: str(60),
      shape: { type: 'enum', values: ['box', 'circle'] }, dim: { type: 'boolean' }, color },
    render(root, props, ctx, VM) {
      const c = props.color || ctx.theme.accent;
      const X = props.x * ctx.w, Y = props.y * ctx.h, W = props.w * ctx.w, H = props.h * ctx.h;
      const svg = VM.svg('svg', { width: ctx.w, height: ctx.h, style: 'position:absolute;left:0;top:0' }, root);
      let shade = null;
      if (props.dim) {
        const defs = VM.svg('defs', {}, svg);
        const mask = VM.svg('mask', { id: 'hole' }, defs);
        VM.svg('rect', { x: 0, y: 0, width: ctx.w, height: ctx.h, fill: 'white' }, mask);
        VM.svg(props.shape === 'circle' ? 'ellipse' : 'rect', props.shape === 'circle'
          ? { cx: X + W / 2, cy: Y + H / 2, rx: W / 2, ry: H / 2, fill: 'black' } : { x: X, y: Y, width: W, height: H, rx: ctx.u, fill: 'black' }, mask);
        shade = VM.svg('rect', { x: 0, y: 0, width: ctx.w, height: ctx.h, fill: 'black', mask: 'url(#hole)' }, svg);
      }
      const shape = VM.svg(props.shape === 'circle' ? 'ellipse' : 'rect', props.shape === 'circle'
        ? { cx: X + W / 2, cy: Y + H / 2, rx: W / 2, ry: H / 2 } : { x: X, y: Y, width: W, height: H, rx: ctx.u }, svg);
      Object.entries({ fill: 'none', stroke: c, 'stroke-width': ctx.u * 0.5 }).forEach(([k, v]) => shape.setAttribute(k, v));
      const len = shape.getTotalLength();
      shape.setAttribute('stroke-dasharray', VM.r(len, 1) + ' ' + VM.r(len, 1));
      const above = Y > ctx.h * 0.2;
      const label = props.label ? VM.el('div', { style: { position: 'absolute', left: Math.min(X, ctx.w - ctx.u * 40) + 'px', [above ? 'bottom' : 'top']: (above ? ctx.h - Y + ctx.u * 1.5 : Y + H + ctx.u * 1.5) + 'px',
        background: c, color: ctx.theme.background, fontWeight: '800', fontSize: (ctx.u * 3) + 'px', padding: (ctx.u * 0.8) + 'px ' + (ctx.u * 1.6) + 'px', borderRadius: (ctx.u * 0.8) + 'px', whiteSpace: 'nowrap' } }, root, props.label) : null;
      return t => {
        const k = VM.life(t, ctx, 0, 0.6);
        shape.setAttribute('stroke-dashoffset', VM.r(len * (1 - VM.ease.inOut(VM.p(t, 0, 0.6))), 1));
        shape.setAttribute('opacity', VM.r(k));
        if (shade) shade.setAttribute('opacity', VM.r(0.55 * k));
        if (label) VM.set(label, { opacity: VM.r(VM.life(t, ctx, 0.4, 0.4)), transform: 'translateY(' + VM.r((1 - VM.life(t, ctx, 0.4, 0.4)) * ctx.u * (above ? 2 : -2)) + 'px)' });
      };
    }
  },

  quote: {
    description: 'Quote card with large quotation mark, attributed author and source.',
    schema: { quote: str(260, true), author: str(60), source: str(100) },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: (ctx.u * 9) + 'px', display: 'flex', flexDirection: 'column', justifyContent: 'center' } }, root);
      const mark = VM.el('div', { style: { color: ctx.theme.accent, fontSize: (ctx.u * 22) + 'px', fontWeight: '900', lineHeight: '0.7', height: (ctx.u * 10) + 'px' } }, wrap, '“');
      const q = VM.el('div', { style: { fontWeight: '700', lineHeight: '1.25', letterSpacing: '-0.015em' } }, wrap);
      VM.rich(q, props.quote, { stressColor: ctx.theme.accent });
      VM.fit(q, ctx.w - ctx.u * 18, ctx.u * 8.5, ctx.u * 3, ctx.h * 0.55);
      const by = props.author || props.source ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 4) + 'px', marginTop: (ctx.u * 3) + 'px' } }, wrap,
        '— ' + [props.author, props.source].filter(Boolean).join(', ')) : null;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        VM.set(mark, { opacity: VM.r(VM.tw(t, 0, 0.4, 0, 1)), transform: 'scale(' + VM.r(VM.tw(t, 0, 0.6, 1.4, 1, 'back')) + ')' });
        VM.set(q, { opacity: VM.r(VM.tw(t, 0.2, 0.6, 0, 1)), transform: 'translateY(' + VM.r(VM.tw(t, 0.2, 0.7, ctx.u * 3, 0, 'expo')) + 'px)' });
        if (by) by.style.opacity = VM.r(VM.tw(t, 0.7, 0.5, 0, 1));
      };
    }
  },

  code: {
    description: 'Editor window with syntax-highlighted code typed on, optional highlighted lines.',
    schema: { filename: str(60), code: { type: 'string', max: 1600, required: true, multiline: true },
      highlight: { type: 'array', maxItems: 20, items: num(true, 1, 200) }, typing: { type: 'boolean' } },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 5;
      const lines = props.code.replace(/\t/g, '  ').split('\n');
      const win = VM.el('div', { style: { position: 'absolute', inset: pad + 'px', background: '#0d1117', borderRadius: (ctx.u * 1.6) + 'px', border: '1px solid rgba(255,255,255,0.12)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 ' + ctx.u + 'px ' + (ctx.u * 5) + 'px rgba(0,0,0,0.5)' } }, root);
      const bar = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: ctx.u + 'px', padding: (ctx.u * 1.4) + 'px ' + (ctx.u * 2) + 'px', background: 'rgba(255,255,255,0.05)' } }, win);
      ['#ff5f57', '#febc2e', '#28c840'].forEach(c => VM.el('span', { style: { width: (ctx.u * 1.4) + 'px', height: (ctx.u * 1.4) + 'px', borderRadius: '99px', background: c } }, bar));
      if (props.filename) VM.el('span', { style: { color: '#8b949e', fontSize: (ctx.u * 2.8) + 'px', marginLeft: (ctx.u * 1.5) + 'px' } }, bar, props.filename);
      const body = VM.el('pre', { style: { margin: '0', padding: (ctx.u * 2.4) + 'px', flex: '1', fontFamily: "VMMono,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace",
        lineHeight: '1.45', color: '#e6edf3', whiteSpace: 'pre', overflow: 'hidden' } }, win);
      const avail = (ctx.h - pad * 2 - ctx.u * 9);
      const longest = Math.max(...lines.map(l => l.length), 10);
      const fs = Math.min(ctx.u * 4.4, avail / (lines.length * 1.5), (ctx.w - pad * 2 - ctx.u * 12) / ((longest + 4) * 0.62));
      body.style.fontSize = fs + 'px';
      const colors = { comment: '#8b949e', string: '#a5d6ff', number: '#79c0ff', keyword: '#ff7b72', ident: '#e6edf3', punct: '#c9d1d9', space: '' };
      const hl = new Set(props.highlight || []);
      const spans = [];
      let total = 0;
      lines.forEach((line, i) => {
        const row = VM.el('div', { style: { display: 'flex', borderRadius: (ctx.u * 0.4) + 'px' } }, body);
        VM.el('span', { style: { color: '#484f58', width: '2.6em', flex: '0 0 auto', textAlign: 'right', paddingRight: '1em', userSelect: 'none' } }, row, String(i + 1));
        const content = VM.el('span', {}, row);
        for (const tok of VM.tokens(line)) {
          const s = VM.el('span', { style: { color: colors[tok.kind] } }, content, '');
          spans.push({ s, text: tok.text, from: total });
          total += tok.text.length;
        }
        total += 1;
        if (hl.has(i + 1)) row.dataset.hl = '1';
        spans.push({ row, hl: hl.has(i + 1) });
      });
      const typing = props.typing !== false;
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        VM.set(win, { opacity: VM.r(VM.tw(t, 0, 0.35, 0, 1) * out), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 3, 0, 'expo')) + 'px)' });
        const shown = typing ? Math.floor(total * VM.p(t, 0.4, Math.max(0.5, ctx.duration * 0.55))) : total;
        for (const sp of spans) {
          if (sp.row) { sp.row.style.background = sp.hl && shown >= total ? 'rgba(56,139,253,0.18)' : 'transparent'; continue; }
          const n = Math.max(0, Math.min(sp.text.length, shown - sp.from));
          if (sp.s.textContent.length !== n) sp.s.textContent = sp.text.slice(0, n);
        }
      };
    }
  },

  table: {
    description: 'Data table with header and rows revealed in sequence; optional highlighted row.',
    schema: { title: str(70), columns: { type: 'array', required: true, minItems: 2, maxItems: 6, items: str(28) },
      rows: { type: 'array', required: true, minItems: 1, maxItems: 9, items: { type: 'array', minItems: 1, maxItems: 6, items: str(40) } },
      highlight: num(false, 0, 8), citation },
    render(root, props, ctx, VM) {
      const pad = ctx.u * 6;
      const title = props.title ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: pad + 'px', fontWeight: '800' } }, root, props.title) : null;
      if (title) VM.fit(title, ctx.w - pad * 2, ctx.u * 6, ctx.u * 3);
      const tbl = VM.el('div', { style: { position: 'absolute', left: pad + 'px', right: pad + 'px', top: (pad + (title ? ctx.u * 10 : 0)) + 'px',
        display: 'grid', gridTemplateColumns: 'repeat(' + props.columns.length + ', 1fr)', borderRadius: (ctx.u * 1.2) + 'px', overflow: 'hidden',
        fontSize: Math.min(ctx.u * 4.2, (ctx.h - pad * 3 - (title ? ctx.u * 10 : 0)) / ((props.rows.length + 1) * 2.5)) + 'px' } }, root);
      const cell = (text, parent, head, hl, idx) => VM.el('div', { style: { padding: '0.7em 1em', fontWeight: head ? '800' : (idx === 0 ? '700' : '400'),
        background: head ? ctx.theme.accent : hl ? VM.hexToRgba(ctx.theme.accent, 0.22) : VM.hexToRgba(ctx.theme.text, 0.04),
        color: head ? ctx.theme.background : ctx.theme.text, borderBottom: '1px solid ' + VM.hexToRgba(ctx.theme.text, 0.08) } }, parent, text);
      const header = props.columns.map((c, i) => cell(c, tbl, true, false, i));
      const rows = props.rows.map((r, ri) => props.columns.map((_, i) => cell(r[i] ?? '', tbl, false, props.highlight === ri, i)));
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: pad + 'px', bottom: (ctx.u * 3) + 'px', color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px' } }, root, VM.cite(props.citation)) : null;
      const step = Math.min(0.3, (ctx.duration * 0.6) / rows.length);
      return t => {
        const out = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        root.style.opacity = VM.r(out);
        if (title) title.style.opacity = VM.r(VM.tw(t, 0, 0.4, 0, 1));
        header.forEach(h => { h.style.opacity = VM.r(VM.tw(t, 0.15, 0.4, 0, 1)); });
        rows.forEach((r, i) => r.forEach(c => VM.set(c, { opacity: VM.r(VM.tw(t, 0.4 + i * step, 0.35, 0, 1)), transform: 'translateY(' + VM.r(VM.tw(t, 0.4 + i * step, 0.45, ctx.u * 1.5, 0)) + 'px)' })));
        if (cite) cite.style.opacity = VM.r(VM.tw(t, 0.7, 0.5, 0, 1));
      };
    }
  },

  'progress-bar': {
    description: 'Thin progress bar with chapter ticks across the top/bottom edge for the whole video (full-frame overlay).',
    fullFrame: true,
    schema: { ticks: { type: 'array', maxItems: 40, items: num(true, 0, 1) }, position: { type: 'enum', values: ['top', 'bottom'] } },
    render(root, props, ctx, VM) {
      const h = Math.max(4, ctx.u * 0.7);
      const track = VM.el('div', { style: { position: 'absolute', left: '0', right: '0', [props.position === 'top' ? 'top' : 'bottom']: '0', height: h + 'px', background: VM.hexToRgba(ctx.theme.text, 0.15) } }, root);
      const fill = VM.el('div', { style: { position: 'absolute', left: '0', top: '0', bottom: '0', background: ctx.theme.accent } }, track);
      (props.ticks || []).forEach(x => VM.el('div', { style: { position: 'absolute', left: (x * 100) + '%', top: '0', bottom: '0', width: '3px', background: ctx.theme.background } }, track));
      const px = ctx.w;
      return t => { fill.style.width = Math.round(px * VM.clamp(t / ctx.duration)) + 'px'; };
    }
  },

  captions: {
    description: 'Internal: word-timed captions. Generated from a transcript; do not author directly.',
    internal: true,
    fullFrame: true,
    schema: {},
    render(root, props, ctx, VM) {
      const pos = props.position || 'bottom';
      const style = props.style || 'kinetic';
      const wrap = VM.el('div', { style: { position: 'absolute', left: (ctx.w * 0.06) + 'px', right: (ctx.w * 0.06) + 'px', display: 'flex', justifyContent: 'center',
        [pos === 'top' ? 'top' : 'bottom']: (pos === 'center' ? ctx.h * 0.42 : ctx.h * (ctx.portrait ? 0.27 : 0.075)) + 'px' } }, root); // vertical: keep clear of the bottom ~26% that Reels, Shorts and TikTok cover with their own buttons
      const shadow = ctx.theme.text.toLowerCase() === '#0b0b0b' ? '0 0.05em 0.14em rgba(255,255,255,0.85)' : '0 0.06em 0.18em rgba(0,0,0,0.9), 0 0 0.06em rgba(0,0,0,0.9)';
      const box = VM.el('div', { style: { textAlign: 'center', fontWeight: '800', fontSize: (ctx.u * (ctx.portrait ? 6 : 4.6)) + 'px', lineHeight: '1.22',
        letterSpacing: '-0.012em', padding: '0.15em 0.4em', borderRadius: '0.3em', color: style === 'phrase' ? '#fff' : ctx.theme.text,
        background: style === 'phrase' ? 'rgba(0,0,0,0.62)' : 'transparent',
        textShadow: style === 'phrase' ? 'none' : shadow, maxWidth: '100%' } }, wrap);
      const pages = props.pages;
      let current = -2;
      let spans = [];
      const find = t => {
        let lo = 0, hi = pages.length - 1, ans = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (pages[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return ans >= 0 && t < pages[ans].end ? ans : -1;
      };
      return t => {
        const idx = find(t);
        if (idx !== current) {
          current = idx;
          box.textContent = '';
          spans = idx < 0 ? [] : pages[idx].words.map((w, i) => {
            if (i) box.appendChild(document.createTextNode(' '));
            const stressed = style === 'kinetic' && w.stress;
            const s = VM.el('span', { class: stressed ? 'vm-stress' : '', style: { display: 'inline-block', padding: stressed ? '0 0.06em' : '0 0.08em', borderRadius: '0.18em' } }, box, w.text);
            return { w, s, stressed };
          });
          box.style.visibility = idx < 0 ? 'hidden' : 'visible';
        }
        if (idx < 0) return;
        if (style === 'kinetic') {
          // Quantised to 30 steps/s so held frames dedupe in the frame cache.
          const tq = Math.floor(t * 30 + 1e-6) / 30;
          const age = tq - pages[idx].start;
          spans.forEach(({ w, s, stressed }, i) => {
            const enter = VM.ease.expo(VM.p(age, i * 0.03, 0.2));
            const active = tq >= w.start && tq < w.end;
            const pop = active ? VM.ease.out(VM.p(tq, w.start, 0.09)) : 0;
            s.style.opacity = VM.r(enter);
            s.style.transform = 'translateY(' + VM.r((1 - enter) * 0.38) + 'em) scale(' + VM.r(1 + 0.07 * pop) + ')';
            s.style.filter = stressed && enter < 1 ? 'blur(' + VM.r((1 - enter) * 3) + 'px)' : 'none';
            s.style.color = stressed ? ctx.theme.accent : active ? ctx.theme.accent : ctx.theme.text;
          });
        } else if (style === 'karaoke') {
          for (const { w, s } of spans) {
            const active = t >= w.start && t < w.end;
            s.style.background = active ? ctx.theme.accent : 'transparent';
            s.style.color = active ? ctx.theme.background : (t >= w.end ? ctx.theme.text : VM.hexToRgba(ctx.theme.text, 0.92));
          }
        }
      };
    }
  }
};

Object.assign(TEMPLATES, EFFECTS);

// Validate template props against the mini schema. Returns a cleaned copy (unknown fields rejected).
export function validateProps(template, props, location = 'props') {
  const def = TEMPLATES[template];
  if (!def || def.internal) throw new Error(`Motion: unknown template "${template}". Run video-monk templates.`);
  return validateValue({ type: 'object', fields: def.schema }, props ?? {}, location);
}

function validateValue(spec, value, location) {
  const fail = message => { throw new Error(`Motion: ${location} ${message}`); };
  if (value === undefined || value === null) {
    if (spec.required) fail('is required');
    return undefined;
  }
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string' || !value.trim()) fail('must be a nonempty string');
      if (value.length > spec.max) fail(`must be at most ${spec.max} characters`);
      if (spec.multiline ? /[\x00-\x08\x0b-\x1f]/.test(value) : /[\x00-\x1f]/.test(value)) fail('contains control characters');
      return value;
    case 'number':
      if (!Number.isFinite(value) || value < spec.min || value > spec.max) fail(`must be a number from ${spec.min} to ${spec.max}`);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') fail('must be true or false');
      return value;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('must be a #RRGGBB color');
      return value;
    case 'enum':
      if (!spec.values.includes(value)) fail(`must be one of ${spec.values.join(', ')}`);
      return value;
    case 'array':
      if (!Array.isArray(value)) fail('must be an array');
      if (value.length < (spec.minItems || 0) || value.length > spec.maxItems) fail(`needs ${spec.minItems || 0}-${spec.maxItems} items`);
      return value.map((item, i) => validateValue({ ...spec.items, required: true }, item, `${location}[${i}]`));
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
      const unknown = Object.keys(value).filter(k => !Object.hasOwn(spec.fields, k));
      if (unknown.length) fail(`has unsupported field(s): ${unknown.join(', ')}`);
      const out = {};
      for (const [k, s] of Object.entries(spec.fields)) {
        const v = validateValue(s, value[k], `${location}.${k}`);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    default:
      return fail('has an unknown schema type');
  }
}

function describe(spec) {
  if (spec.type === 'array') return `${describe(spec.items)}[] (${spec.minItems || 0}-${spec.maxItems})`;
  if (spec.type === 'object') return `{ ${Object.entries(spec.fields).map(([k, s]) => `${k}${s.required ? '' : '?'}: ${describe(s)}`).join(', ')} }`;
  if (spec.type === 'enum') return spec.values.map(v => `"${v}"`).join('|');
  if (spec.type === 'string') return `string<=${spec.max}`;
  if (spec.type === 'number') return 'number';
  return spec.type;
}

export function templateCatalog() {
  return Object.entries(TEMPLATES).filter(([, d]) => !d.internal).map(([name, d]) => ({
    name, description: d.description, placement: d.fullFrame ? 'full-frame overlay' : 'full screen or boxed overlay',
    props: Object.fromEntries(Object.entries(d.schema).map(([k, s]) => [`${k}${s.required ? '' : '?'}`, describe(s)]))
  }));
}
