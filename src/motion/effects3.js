// The rest of the first "build next" list from the HyperFrames catalog review, written from scratch for this toolkit:
// code morph, push-in, pull-back reveal, logo outro, CTA close and a chat thread (typing indicator and streamed reply).
// Same contract as every template: render(root, props, ctx, VM) builds the DOM once and returns update(t), a pure function of time.

const str = (max, required = false) => ({ type: 'string', max, required });
const num = (required = false, min = -1e12, max = 1e12) => ({ type: 'number', required, min, max });

export const EFFECTS3 = {
  'code-morph': {
    description: 'One code snippet turns into another: the tokens both versions share glide to their new places, the rest fade out and in.',
    schema: { filename: str(60), before: { type: 'string', max: 900, required: true, multiline: true }, after: { type: 'string', max: 900, required: true, multiline: true } },
    render(root, props, ctx, VM) {
      const A = props.before.replace(/\t/g, '  ').split('\n'), B = props.after.replace(/\t/g, '  ').split('\n');
      const pad = ctx.u * 5;
      const win = VM.el('div', { style: { position: 'absolute', inset: pad + 'px', background: '#0d1117', borderRadius: (ctx.u * 1.6) + 'px', border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 ' + ctx.u + 'px ' + (ctx.u * 5) + 'px rgba(0,0,0,0.5)' } }, root);
      const bar = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: ctx.u + 'px', padding: (ctx.u * 1.4) + 'px ' + (ctx.u * 2) + 'px', background: 'rgba(255,255,255,0.05)' } }, win);
      ['#ff5f57', '#febc2e', '#28c840'].forEach(c => VM.el('span', { style: { width: (ctx.u * 1.4) + 'px', height: (ctx.u * 1.4) + 'px', borderRadius: '99px', background: c } }, bar));
      if (props.filename) VM.el('span', { style: { color: '#8b949e', fontSize: (ctx.u * 2.8) + 'px', marginLeft: (ctx.u * 1.5) + 'px' } }, bar, props.filename);
      const body = VM.el('div', { style: { padding: (ctx.u * 2.4) + 'px', flex: '1', position: 'relative', fontFamily: "VMMono,'SF Mono',Menlo,Consolas,monospace", color: '#e6edf3', overflow: 'hidden' } }, win);
      const rows = Math.max(A.length, B.length), longest = Math.max(...A.map(l => l.length), ...B.map(l => l.length), 10);
      const fs = Math.min(ctx.u * 4.4, (ctx.h - pad * 2 - ctx.u * 12) / (rows * 1.5), (ctx.w - pad * 2 - ctx.u * 10) / ((longest + 2) * 0.62));
      body.style.fontSize = fs + 'px';
      const colors = { comment: '#8b949e', string: '#a5d6ff', number: '#79c0ff', keyword: '#ff7b72', ident: '#e6edf3', punct: '#c9d1d9', space: '' };
      // lay each version out as plain text once (hidden), measure every token's place, then build absolutely positioned tokens that travel between places
      const lay = lines => {
        const probe = VM.el('div', { style: { position: 'absolute', left: (ctx.u * 2.4) + 'px', top: (ctx.u * 2.4) + 'px', visibility: 'hidden', whiteSpace: 'pre', lineHeight: '1.5' } }, body);
        const out = [];
        lines.forEach((line, li) => {
          const row = VM.el('div', {}, probe);
          for (const tok of VM.tokens(line)) { const s = VM.el('span', {}, row, tok.text); out.push({ s, text: tok.text, kind: tok.kind, line: li }); }
          if (!line) row.textContent = ' ';
        });
        const base = probe.getBoundingClientRect();
        for (const o of out) { const r = o.s.getBoundingClientRect(); o.x = r.left - base.left; o.y = r.top - base.top; o.w = r.width; }
        probe.remove();
        return out.filter(o => o.kind !== 'space');
      };
      const ta = lay(A), tb = lay(B);
      // match tokens common to both versions with a longest common subsequence over the token text
      const m = ta.length, n = tb.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = ta[i].text === tb[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const pairs = new Map(), usedB = new Set();
      for (let i = 0, j = 0; i < m && j < n;) { if (ta[i].text === tb[j].text) { pairs.set(i, j); usedB.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
      const pad0 = ctx.u * 2.4;
      const mk = (o, extra) => VM.el('span', { style: { position: 'absolute', left: pad0 + 'px', top: pad0 + 'px', whiteSpace: 'pre', lineHeight: '1.5', color: colors[o.kind] || '#e6edf3', ...extra } }, body, o.text);
      const toks = [];
      ta.forEach((o, i) => { const j = pairs.get(i); toks.push({ el: mk(o), from: o, to: j !== undefined ? tb[j] : null }); });
      tb.forEach((o, j) => { if (!usedB.has(j)) toks.push({ el: mk(o), from: null, to: o }); });
      const t0 = 0.9, dur = Math.min(1.2, Math.max(0.6, ctx.duration * 0.3));
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.3, 0.3)) : 1;
        VM.set(win, { opacity: VM.r(VM.tw(t, 0, 0.35, 0, 1) * o), transform: 'translateY(' + VM.r(VM.tw(t, 0, 0.5, ctx.u * 3, 0, 'expo')) + 'px)' });
        const k = VM.ease.inOut(VM.p(t, t0, dur));
        toks.forEach(({ el, from, to }) => {
          if (from && to) { el.style.transform = 'translate(' + VM.r(from.x + (to.x - from.x) * k) + 'px,' + VM.r(from.y + (to.y - from.y) * k) + 'px)'; el.style.opacity = '1'; }
          else if (from) { el.style.transform = 'translate(' + VM.r(from.x) + 'px,' + VM.r(from.y) + 'px)'; el.style.opacity = VM.r(1 - VM.clamp(k * 2.2)); }
          else { el.style.transform = 'translate(' + VM.r(to.x) + 'px,' + VM.r(to.y) + 'px)'; el.style.opacity = VM.r(VM.clamp((k - 0.45) * 2.2)); }
        });
      };
    }
  },

  'push-in': {
    description: 'A slow push-in on a headline: the whole composition drifts toward the viewer while the text settles, for a calm, weighty opening.',
    schema: { text: str(110, true), kicker: str(60), subtitle: str(120), amount: num(false, 0.02, 0.4) },
    render(root, props, ctx, VM) {
      const a = props.amount ?? 0.12;
      const stage = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: (ctx.u * 8) + 'px', transformOrigin: '50% 50%' } }, root);
      const kicker = props.kicker ? VM.el('div', { style: { color: ctx.theme.accent, fontWeight: '700', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: (ctx.u * 3) + 'px', marginBottom: (ctx.u * 2.4) + 'px' } }, stage, props.kicker) : null;
      const head = VM.el('div', { style: { fontWeight: '800', lineHeight: '1.06', letterSpacing: '-0.03em', maxWidth: (ctx.w - ctx.u * 16) + 'px' } }, stage);
      VM.rich(head, props.text, { stressColor: ctx.theme.accent });
      VM.fit(head, ctx.w - ctx.u * 16, ctx.u * 11, ctx.u * 4, ctx.h * 0.5);
      const sub = props.subtitle ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.6) + 'px', marginTop: (ctx.u * 2.8) + 'px', maxWidth: (ctx.w * 0.75) + 'px' } }, stage, props.subtitle) : null;
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        const push = VM.p(t, 0, Math.max(1, ctx.duration));                                   // one slow, continuous move across the whole piece
        stage.style.transform = 'scale(' + VM.r(1 + a * (1 - Math.pow(1 - push, 2))) + ')';
        if (kicker) VM.set(kicker, { opacity: VM.r(VM.p(t, 0.1, 0.6) * o) });
        VM.set(head, { opacity: VM.r(VM.p(t, 0.25, 0.8) * o), filter: 'blur(' + VM.r((1 - VM.ease.out(VM.p(t, 0.25, 0.9))) * ctx.u * 0.9) + 'px)', transform: 'translateY(' + VM.r((1 - VM.ease.out(VM.p(t, 0.25, 0.9))) * ctx.u * 1.2) + 'px)' });
        if (sub) VM.set(sub, { opacity: VM.r(VM.p(t, 0.9, 0.7) * o) });
      };
    }
  },

  'pull-back-reveal': {
    description: 'A big stat holds the frame, then the camera pulls back to reveal the context around it (up to four supporting facts).',
    schema: { value: str(24, true), label: str(60, true), context: { type: 'array', required: true, minItems: 2, maxItems: 4, items: { type: 'object', fields: { value: str(24, true), label: str(40, true) } } }, citation: str(140) },
    render(root, props, ctx, VM) {
      const n = props.context.length;
      const cam = VM.el('div', { style: { position: 'absolute', inset: '0', transformOrigin: '50% 50%' } }, root);
      const center = VM.el('div', { style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', width: (ctx.w * 0.5) + 'px' } }, cam);
      const big = VM.el('div', { style: { fontWeight: '900', fontSize: (ctx.u * 17) + 'px', lineHeight: '1', letterSpacing: '-0.04em', color: ctx.theme.accent, fontVariantNumeric: 'tabular-nums' } }, center, props.value);
      VM.fit(big, ctx.w * 0.5, ctx.u * 17, ctx.u * 6);
      VM.el('div', { style: { fontWeight: '700', fontSize: (ctx.u * 3.8) + 'px', marginTop: (ctx.u * 1.4) + 'px' } }, center, props.label);
      const R = Math.min(ctx.w, ctx.h) * 0.36;
      const chips = props.context.map((c, i) => {
        const ang = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0), x = Math.cos(ang) * R * 1.35, y = Math.sin(ang) * R * 0.95;
        const chip = VM.el('div', { style: { position: 'absolute', left: (ctx.w / 2 + x) + 'px', top: (ctx.h / 2 + y) + 'px', transform: 'translate(-50%,-50%)', background: ctx.theme.surface, borderRadius: (ctx.u * 2) + 'px', padding: (ctx.u * 1.8) + 'px ' + (ctx.u * 3) + 'px', textAlign: 'center', boxShadow: '0 ' + ctx.u + 'px ' + ctx.u * 3.5 + 'px rgba(0,0,0,.35)' } }, cam);
        VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 5) + 'px' } }, chip, c.value);
        VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px', marginTop: (ctx.u * 0.4) + 'px' } }, chip, c.label);
        return chip;
      });
      const cite = props.citation ? VM.el('div', { style: { position: 'absolute', left: '0', right: '0', bottom: (ctx.u * 2.4) + 'px', textAlign: 'center', color: ctx.theme.muted, fontSize: (ctx.u * 2.2) + 'px' } }, root, props.citation) : null;
      const pullAt = Math.min(2.2, ctx.duration * 0.42);
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        const k = VM.ease.inOut(VM.p(t, pullAt, 1.1));
        cam.style.transform = 'scale(' + VM.r(1.55 - 0.55 * k) + ')'; cam.style.opacity = VM.r(VM.p(t, 0, 0.3) * o);
        chips.forEach((c, i) => VM.set(c, { opacity: VM.r(VM.p(t, pullAt + 0.35 + i * 0.12, 0.45)), transform: 'translate(-50%,-50%) scale(' + VM.r(0.85 + 0.15 * VM.ease.back(VM.p(t, pullAt + 0.35 + i * 0.12, 0.5))) + ')' }));
        if (cite) cite.style.opacity = VM.r(VM.p(t, pullAt + 1.1, 0.5) * o);
      };
    }
  },

  'logo-outro': {
    description: 'A closing wordmark: a mark tile and the name resolve with a soft glow, then a tagline and URL. Pass the name and an optional one-character mark; no logo file is needed.',
    schema: { name: str(30, true), mark: str(2), tagline: str(80), url: str(60) },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: (ctx.u * 2.4) + 'px' } }, root);
      const glow = VM.el('div', { style: { position: 'absolute', left: '50%', top: '46%', width: (ctx.u * 60) + 'px', height: (ctx.u * 60) + 'px', marginLeft: (-ctx.u * 30) + 'px', marginTop: (-ctx.u * 30) + 'px', borderRadius: '50%', background: 'radial-gradient(closest-side,' + VM.hexToRgba(ctx.theme.accent, 0.32) + ',transparent)' } }, root);
      const row = VM.el('div', { style: { display: 'flex', alignItems: 'center', gap: (ctx.u * 2.4) + 'px', position: 'relative' } }, wrap);
      const tile = VM.el('div', { style: { width: (ctx.u * 11) + 'px', height: (ctx.u * 11) + 'px', borderRadius: (ctx.u * 2.6) + 'px', background: ctx.theme.accent, color: ctx.theme.background, display: 'grid', placeItems: 'center', fontWeight: '900', fontSize: (ctx.u * 6.4) + 'px' } }, row, (props.mark || props.name[0] || '').toUpperCase());
      const name = VM.el('div', { style: { fontWeight: '800', fontSize: (ctx.u * 9) + 'px', letterSpacing: '-0.03em', position: 'relative' } }, row, props.name);
      const tag = props.tagline ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 3.6) + 'px', position: 'relative' } }, wrap, props.tagline) : null;
      const url = props.url ? VM.el('div', { style: { color: ctx.theme.accent, fontWeight: '700', fontSize: (ctx.u * 3.4) + 'px', letterSpacing: '0.04em', position: 'relative' } }, wrap, props.url) : null;
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.4, 0.4)) : 1;
        VM.set(glow, { opacity: VM.r(VM.p(t, 0.1, 1.0) * o), transform: 'scale(' + VM.r(0.7 + 0.3 * VM.ease.out(VM.p(t, 0.1, 1.4))) + ')' });
        VM.set(tile, { opacity: VM.r(VM.p(t, 0.1, 0.3) * o), transform: 'scale(' + VM.r(0.5 + 0.5 * VM.ease.back(VM.p(t, 0.1, 0.6))) + ') rotate(' + VM.r((1 - VM.ease.out(VM.p(t, 0.1, 0.7))) * -14) + 'deg)' });
        VM.set(name, { opacity: VM.r(VM.p(t, 0.35, 0.5) * o), transform: 'translateX(' + VM.r((1 - VM.ease.expo(VM.p(t, 0.35, 0.7))) * ctx.u * 4) + 'px)', filter: 'blur(' + VM.r((1 - VM.ease.out(VM.p(t, 0.35, 0.6))) * ctx.u * 0.6) + 'px)' });
        if (tag) tag.style.opacity = VM.r(VM.p(t, 0.95, 0.5) * o);
        if (url) url.style.opacity = VM.r(VM.p(t, 1.25, 0.5) * o);
      };
    }
  },

  'cta-close': {
    description: 'A call-to-action close: a headline, one clear action in a button and a URL. Holds still so it can be read.',
    schema: { headline: str(90, true), action: str(40, true), url: str(70), note: str(100) },
    render(root, props, ctx, VM) {
      const wrap = VM.el('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: (ctx.u * 3.2) + 'px', padding: (ctx.u * 8) + 'px' } }, root);
      const head = VM.el('div', { style: { fontWeight: '800', lineHeight: '1.08', letterSpacing: '-0.025em', maxWidth: (ctx.w - ctx.u * 16) + 'px' } }, wrap);
      VM.rich(head, props.headline, { stressColor: ctx.theme.accent });
      VM.fit(head, ctx.w - ctx.u * 16, ctx.u * 9, ctx.u * 4, ctx.h * 0.36);
      const btn = VM.el('div', { style: { background: ctx.theme.accent, color: ctx.theme.background, fontWeight: '800', fontSize: (ctx.u * 4.4) + 'px', padding: (ctx.u * 2) + 'px ' + (ctx.u * 5.5) + 'px', borderRadius: '99px', boxShadow: '0 ' + ctx.u + 'px ' + ctx.u * 4 + 'px ' + VM.hexToRgba(ctx.theme.accent, 0.4) } }, wrap, props.action);
      const url = props.url ? VM.el('div', { style: { fontWeight: '700', fontSize: (ctx.u * 3.6) + 'px', letterSpacing: '0.03em' } }, wrap, props.url) : null;
      const note = props.note ? VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.8) + 'px', maxWidth: (ctx.w * 0.7) + 'px' } }, wrap, props.note) : null;
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        VM.set(head, { opacity: VM.r(VM.p(t, 0, 0.5) * o), transform: 'translateY(' + VM.r((1 - VM.ease.expo(VM.p(t, 0, 0.7))) * ctx.u * 3) + 'px)' });
        const pop = VM.ease.back(VM.p(t, 0.45, 0.5)), press = Math.sin(Math.PI * VM.p(t, 1.4, 0.35));   // one small press, once the button is on screen
        VM.set(btn, { opacity: VM.r(VM.p(t, 0.45, 0.25) * o), transform: 'scale(' + VM.r((0.8 + 0.2 * pop) * (1 - 0.05 * press)) + ')' });
        if (url) url.style.opacity = VM.r(VM.p(t, 0.8, 0.5) * o);
        if (note) note.style.opacity = VM.r(VM.p(t, 1.0, 0.5) * o);
      };
    }
  },

  'chat-thread': {
    description: 'A chat: messages arrive one by one, with a typing indicator before each reply and the assistant\'s answer streamed in word bursts. Names are generic; no real product is imitated.',
    schema: { assistant: str(24), messages: { type: 'array', required: true, minItems: 2, maxItems: 5, items: { type: 'object', fields: { from: { type: 'enum', values: ['user', 'assistant'], required: true }, text: str(220, true) } } } },
    render(root, props, ctx, VM) {
      const msgs = props.messages, w = Math.min(ctx.w * 0.82, ctx.u * 100);
      const col = VM.el('div', { style: { position: 'absolute', left: ((ctx.w - w) / 2) + 'px', top: (ctx.h * 0.08) + 'px', width: w + 'px', display: 'flex', flexDirection: 'column', gap: (ctx.u * 2) + 'px' } }, root);
      if (props.assistant) VM.el('div', { style: { color: ctx.theme.muted, fontSize: (ctx.u * 2.6) + 'px', letterSpacing: '0.12em', textTransform: 'uppercase', textAlign: 'center', marginBottom: (ctx.u * 1) + 'px' } }, col, props.assistant);
      // timeline: a user message appears; an assistant message shows typing dots for 0.8 s, then streams its words
      let at = 0.4;
      const items = msgs.map(m => {
        const words = m.text.split(/\s+/), user = m.from === 'user';
        const bubble = VM.el('div', { style: { alignSelf: user ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: (ctx.u * 1.8) + 'px ' + (ctx.u * 2.6) + 'px', borderRadius: (ctx.u * 2.4) + 'px', fontSize: (ctx.u * 3.3) + 'px', lineHeight: '1.35', background: user ? ctx.theme.accent : ctx.theme.surface, color: user ? ctx.theme.background : ctx.theme.text, fontWeight: user ? '600' : '500' } }, col);
        const text = VM.el('span', {}, bubble);
        const dots = user ? null : VM.el('span', { style: { display: 'inline-flex', gap: (ctx.u * 0.7) + 'px', alignItems: 'center', height: '1.2em' } }, bubble);
        const dotEls = dots ? [0, 1, 2].map(() => VM.el('i', { style: { width: (ctx.u * 1.2) + 'px', height: (ctx.u * 1.2) + 'px', borderRadius: '99px', background: ctx.theme.muted, display: 'inline-block' } }, dots)) : [];
        const start = at, typing = user ? 0 : 0.9, stream = user ? 0 : Math.min(2.6, 0.12 * words.length + 0.4);
        at += (user ? 0.9 : typing + stream + 0.5);
        return { user, words, bubble, text, dots, dotEls, start, typing, stream, full: m.text };
      });
      const seeded = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
      return t => {
        const o = ctx.exit ? 1 - VM.ease.in(VM.p(t, ctx.duration - 0.35, 0.35)) : 1;
        col.style.opacity = VM.r(o);
        items.forEach(it => {
          const appear = VM.ease.out(VM.p(t, it.start, 0.3));
          const show = t >= it.start;
          it.bubble.style.display = show ? 'block' : 'none';
          it.bubble.style.opacity = VM.r(appear); it.bubble.style.transform = 'translateY(' + VM.r((1 - appear) * ctx.u * 2) + 'px) scale(' + VM.r(0.96 + 0.04 * appear) + ')';
          if (it.user) { it.text.textContent = it.full; return; }
          const typingNow = t < it.start + it.typing;
          if (it.dots) it.dots.style.display = typingNow ? 'inline-flex' : 'none';
          it.dotEls.forEach((d, i) => { d.style.opacity = VM.r(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 7 - i * 1.1))); d.style.transform = 'translateY(' + VM.r(-Math.max(0, Math.sin(t * 7 - i * 1.1)) * ctx.u * 0.6) + 'px)'; });
          // streamed in uneven bursts (seeded), the way a model streams a reply
          const p = VM.clamp((t - it.start - it.typing) / Math.max(0.1, it.stream));
          const n = typingNow ? 0 : Math.min(it.words.length, Math.ceil(it.words.length * (p + 0.12 * Math.sin(p * 9 + seeded(it.words.length)) * (1 - p)) ));
          const shown = it.words.slice(0, Math.max(0, p >= 1 ? it.words.length : n)).join(' ');
          if (it.text.textContent !== shown) it.text.textContent = shown;
        });
      };
    }
  }
};
