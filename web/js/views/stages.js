// One renderer per pipeline step, plus the approval gates. Each returns a DOM node; async ones show a skeleton first.
import { h, mount, icon, fmt, toast, confirmDialog, statusChip } from '../ui.js';
import { api } from '../api.js';
import { timeline } from '../components/timeline.js';
import { gauge, donut } from '../components/meters.js';

const lazy = (fn, height = 160) => {
  const box = h('div', {}, h('div', { class: 'skeleton', style: { height: `${height}px` } }));
  fn().then(node => mount(box, node)).catch(error => mount(box, h('div', { class: 'hint bad' }, icon('alert', 18), error.message)));
  return box;
};
const fileUrl = (pc, rel) => `/api/projects/${pc.id}/file?p=${encodeURIComponent(rel)}`;
const tile = (k, v, small) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, small ? h('small', {}, small) : null));
const panelCard = (title, sub, ...kids) => h('div', { class: 'card pad' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, title), sub ? h('div', { class: 'sub' }, sub) : null)), h('div', { class: 'mt-s' }, kids));
const SEV = { blocker: 'Must fix', major: 'Should fix', minor: 'Note' };

// ---- review notes (from the review-loop ledger) for one stage
export function reviewNotes(pc, stage) {
  const entries = (pc.state.ledger || []).filter(e => e.stage === stage);
  if (!entries.length) return null;
  const rounds = entries.filter(e => e.kind === 'review');
  return panelCard('Independent review', 'A separate reviewer checks this step and sends problems back to be fixed.',
    rounds.length ? rounds.map(r => h('div', { class: 'round' },
      h('div', { class: 'row between' }, h('b', {}, `Round ${r.round}`), h('span', { class: `chip ${r.decision === 'approved' ? 'good' : 'warn'}` }, r.decision === 'approved' ? 'Approved' : 'Sent back'), ),
      h('div', { class: 'faint tiny' }, r.reviewer),
      r.findings?.length ? h('div', { class: 'mt-s' }, r.findings.slice(0, 12).map(f => h('div', { class: 'find' }, h('div', { class: `sev ${f.severity}` }), h('div', {}, h('div', {}, h('span', { class: 'tiny faint' }, `${SEV[f.severity]} · `), f.message), f.suggestion ? h('div', { class: 'small muted' }, f.suggestion) : null))),
        r.findings.length > 12 ? h('div', { class: 'faint small' }, `and ${r.findings.length - 12} more`) : null) : h('div', { class: 'small muted mt-s' }, 'Nothing to fix.'))) : h('div', { class: 'muted small' }, 'No review recorded yet.'),
    entries.filter(e => e.kind === 'revise').map(e => h('div', { class: 'small muted mt-s' }, icon('refresh', 13), ` Fixed by the producer: ${e.changed?.length ? e.changed.slice(0, 3).join('; ') : 'no change needed'}`)),
    entries.filter(e => e.kind === 'human-approve').length ? h('div', { class: 'small muted mt-s' }, icon('check', 13), ' You approved this step.') : null);
}

// ---- 1. footage
export function viewInspect(pc) {
  return lazy(async () => {
    const a = await pc.data('analysis');
    if (!a) return h('div', { class: 'muted' }, 'No analysis yet.');
    const p = pc.project;
    const frames = !p.imported ? [1, 2, 3, 4, 5, 6].map(i => h('img', { src: fileUrl(pc, `media/frame-${i}.jpg`), alt: '', loading: 'lazy', onerror: e => e.target.remove() })) : [];
    return h('div', { class: 'col', style: { gap: '16px' } },
      pc.sourcePlayer(),
      h('div', { class: 'tiles' }, tile('Length', fmt.dur(a.duration)), tile('Picture', a.video ? `${a.video.width}×${a.video.height}` : '–', a.video ? `${a.video.fps} fps` : ''), tile('Loudness', fmt.num(a.audio?.integratedLufs), 'LUFS'), tile('Pauses', a.audio?.pauses ?? '–', a.audio ? `${fmt.dur(a.audio.silenceSeconds)} quiet` : '')),
      h('div', { class: 'grid g2' },
        panelCard('Speech and silence', 'How much of the recording is actual talking.', h('div', { class: 'row gap-l' }, donut(a.audio?.speechRatio ?? 0, { label: 'speech' }), h('div', { class: 'small muted' }, `${fmt.dur(a.audio?.silenceSeconds)} of ${fmt.dur(a.duration)} is quiet. The cut step removes the dead air and filler words and keeps natural rhythm.`))),
        panelCard('Loudness', 'Mastering targets -14 LUFS for YouTube and social.', h('div', { class: 'row gap-l' }, gauge({ value: a.audio?.integratedLufs, min: -40, max: 0, goodFrom: -16, goodTo: -12, label: 'integrated', unit: '', decimals: 1 }), h('div', { class: 'small muted' }, `True peak ${fmt.num(a.audio?.truePeakDb)} dBFS. The final mix is re-balanced for you.`)))),
      !p.imported ? h('div', {}, h('img', { class: 'wave', src: fileUrl(pc, 'media/waveform.png'), alt: 'Waveform', onerror: e => e.target.remove() }), h('div', { class: 'shots mt-s' }, frames)) : null,
      a.suggestions?.length ? panelCard('What the toolkit noticed', null, h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px' } }, a.suggestions.map(x => h('li', {}, x)))) : null);
  }, 320);
}

// ---- 2. transcript
export function viewTranscript(pc) {
  return lazy(async () => {
    const r = await pc.data('words');
    const words = r.words || [];
    const s = pc.project.steps.transcript?.summary || {};
    if (!words.length) return h('div', { class: 'muted' }, 'No transcript yet.');
    const span = words.at(-1).end - words[0].start;
    return h('div', { class: 'col', style: { gap: '16px' } },
      pc.sourcePlayer(),
      h('div', { class: 'tiles' }, tile('Words', words.length), tile('Pace', Math.round(words.length / span * 60), 'words/min'), tile('Model', s.model || '–'), tile('Source', r.corrected ? 'Corrected' : s.cached ? 'Cached' : 'Local')),
      panelCard('Transcript', 'Click any word to jump to it in the video. These words are a draft: names and numbers need a human check.',
        h('div', { class: 'words' }, words.map(w => h('span', { title: fmt.dur(w.start), onclick: () => pc.seek(w.start) }, w.text, ' ')))));
  }, 260);
}

// ---- 3. script check (+ gate)
export function viewScript(pc) {
  const pending = pc.project.pending?.gate === 'script' ? pc.project.pending : null;
  if (pending) return scriptGate(pc, pending.payload);
  return lazy(async () => {
    const d = await pc.data('script');
    const sum = pc.project.steps.script?.summary;
    return h('div', { class: 'col', style: { gap: '16px' } },
      h('div', { class: 'tiles' }, tile('Checked against', d.glossary?.length || 0, 'terms'), tile('Found', sum?.candidates ?? d.candidates?.length ?? 0), tile('Corrected', sum?.applied ?? '–'), tile('Left as heard', sum?.rejected ?? '–')),
      sum?.note ? h('div', { class: 'hint' }, icon('info', 18), sum.note) : null,
      d.fixes && /\|/.test(d.fixes) ? panelCard('Corrections applied', 'Only the captions and graphics use the corrected words; the audio is untouched.', h('pre', { class: 'log', style: { maxHeight: '320px' } }, d.fixes.replace(/^#.*\n/, ''))) : null,
      reviewNotes(pc, 'transcript'));
  }, 120);
}

function scriptGate(pc, payload) {
  const accept = new Set(payload.candidates.map(c => c.id));
  const custom = {};
  const manual = [];
  const list = h('div', {});
  const manualBox = h('div', {});
  const note = h('textarea', { class: 'textarea', style: { minHeight: '64px', fontFamily: 'var(--sans)' }, placeholder: 'Optional note for the approval record' });
  const apply = h('button', { class: 'btn primary' });
  const redraw = () => {
    mount(list, payload.candidates.map(c => h('div', { class: 'cand' },
      h('input', { type: 'checkbox', checked: accept.has(c.id), title: 'Apply this correction', onchange: e => { e.target.checked ? accept.add(c.id) : accept.delete(c.id); redraw(); }, style: { width: '18px', height: '18px', accentColor: 'var(--accent)' } }),
      h('div', {}, h('div', { class: 'faint tiny' }, `${fmt.dur(c.at)} · ${c.kind === 'sound' ? 'sounds like' : 'spelled like'} “${c.term}”`),
        h('div', { style: { lineHeight: 1.8 } }, c.before, ' ', h('mark', {}, c.heard), ' ', h('ins', {}, custom[c.id] || c.to), ' ', c.after)),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', title: 'Play this moment', onclick: () => pc.seek(c.at - 1, true) }, icon('play', 14), 'Hear it'),
        h('input', { class: 'input', style: { width: '150px', padding: '6px 9px' }, value: custom[c.id] || c.to, oninput: e => { custom[c.id] = e.target.value; } })))));
    mount(manualBox, manual.map((m, i) => h('div', { class: 'row mt-s' }, h('input', { class: 'input', placeholder: 'Heard (e.g. a patchy)', value: m.phrase, oninput: e => { m.phrase = e.target.value; } }), icon('chev', 16), h('input', { class: 'input', placeholder: 'Should be (e.g. Apache)', value: m.to, oninput: e => { m.to = e.target.value; } }), h('button', { class: 'btn ghost sm', onclick: () => { manual.splice(i, 1); redraw(); } }, icon('x', 14)))));
    mount(apply, icon('check', 16), `Apply ${accept.size + manual.filter(m => m.phrase && m.to).length} correction(s) and continue`);
  };
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try { await api.gate(pc.id, 'script', { accept: [...accept], custom, manual: manual.filter(m => m.phrase && m.to), note: note.value }); toast('Corrections applied', 'good'); } catch (error) { toast(error.message, 'bad'); apply.disabled = false; }
  });
  redraw();
  return h('div', { class: 'col', style: { gap: '16px' } },
    pc.sourcePlayer(),
    h('div', { class: 'gate' }, h('div', { class: 'gh' }, h('span', { class: 'badge' }, 'Your approval'), h('h3', {}, 'Check the script')),
      h('p', { class: 'muted', style: { marginTop: 0 } }, payload.candidates.length ? `The recogniser may have mis-heard ${payload.candidates.length} term(s) from your glossary. Listen to each moment and keep only the corrections that are right. The audio is never changed; only the words used for captions and graphics.` : 'Nothing from your glossary was mis-heard. Add a manual correction if you spotted something, or continue.'),
      list, h('div', { class: 'row between mt' }, h('b', {}, 'Add a correction yourself'), h('button', { class: 'btn sm', onclick: () => { manual.push({ phrase: '', to: '' }); redraw(); } }, icon('plus', 14), 'Add')), manualBox,
      h('div', { class: 'mt' }, note), h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, apply)));
}

// ---- 4. cut (+ optional gate)
export function viewCut(pc) {
  const pending = pc.project.pending?.gate === 'cut' ? pc.project.pending : null;
  return lazy(async () => {
    const r = await pc.data('cut');
    const tl = await pc.data('timeline').catch(() => null);
    const sum = pc.project.steps.cut?.summary || {};
    const src = r?.sourceDuration ?? sum.sourceDuration, out = r?.editedDuration ?? sum.editedDuration;
    const gateBox = pending ? h('div', { class: 'gate' }, h('div', { class: 'gh' }, h('span', { class: 'badge' }, 'Your approval'), h('h3', {}, 'Check the cut')), h('p', { class: 'muted' }, 'Pauses, breaths and filler words are removed. Continue to plan graphics, or stop and adjust the pace in a new project.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: async e => { e.target.disabled = true; try { await api.gate(pc.id, 'cut', {}); } catch (error) { toast(error.message, 'bad'); e.target.disabled = false; } } }, icon('check', 16), 'Looks good, continue'))) : null;
    return h('div', { class: 'col', style: { gap: '16px' } }, gateBox,
      h('div', { class: 'tiles' }, tile('Before', fmt.dur(src)), tile('After', fmt.dur(out)), tile('Removed', fmt.dur(r?.removedSeconds ?? sum.removedSeconds), src ? `${Math.round((src - out) / src * 100)}%` : ''), tile('Cuts', r?.cuts ?? sum.cuts ?? '–'), tile('Fillers out', r?.fillersRemoved ?? sum.fillersRemoved ?? '–')),
      src ? panelCard('Before and after', null, h('div', { class: 'bars' }, h('div', { class: 'bar' }, h('i', { style: { width: '100%', background: 'color-mix(in srgb, var(--faint) 45%, transparent)' } }), h('span', {}, `Original ${fmt.dur(src)}`)), h('div', { class: 'bar' }, h('i', { style: { width: `${out / src * 100}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent2))' } }), h('span', { style: { color: '#04222c' } }, `Edited ${fmt.dur(out)}`)))) : null,
      tl ? panelCard('The cuts on the timeline', 'Each block is a stretch of speech that was kept.', timeline({ ...tl, graphics: [], broll: [], sfx: [], music: [] }, { onSeek: t => pc.seek(t) })) : null,
      r?.settings ? panelCard('How the cut was decided', null, h('dl', { class: 'kvs' }, h('dt', {}, 'Pace'), h('dd', {}, r.settings.pace), h('dt', {}, 'Noise floor'), h('dd', {}, `${fmt.num(r.settings.measured?.floorDb)} dB (measured from this recording)`), h('dt', {}, 'Quiet stretches removed'), h('dd', {}, `${r.quietStretches ?? 0} (${fmt.dur(r.quietSeconds)})`))) : null,
      reviewNotes(pc, 'cut'));
  }, 260);
}

// ---- 5. storyboard (+ gate)
export function viewStoryboard(pc) {
  const pending = pc.project.pending?.gate === 'storyboard' ? pc.project.pending : null;
  if (pending) return storyboardGate(pc, pending.payload);
  return lazy(async () => {
    const [sb, tl, plan] = await Promise.all([pc.data('storyboard'), pc.data('timeline').catch(() => null), pc.data('broll-plan').catch(() => null)]);
    if (!sb) return h('div', { class: 'muted' }, 'No storyboard yet.');
    return h('div', { class: 'col', style: { gap: '16px' } }, storyboardSummary(sb, tl, plan, pc, null), reviewNotes(pc, 'storyboard'));
  }, 320);
}

function graphicCard(pc, it, { off, onToggle } = {}) {
  const alts = (it.alternatives || []).length > 1;
  return h('div', { class: `gcard ${off ? 'off' : ''}` },
    h('div', { class: 'pv' }, h('img', { src: it.previewUrl || `/api/projects/${pc.id}/preview?item=${encodeURIComponent(it.id)}`, alt: '', loading: 'lazy', onload: e => e.target.classList.add('ok'), onerror: e => { e.target.replaceWith(h('div', { class: 'faint small' }, 'Preview unavailable')); } }),
      onToggle ? h('div', { class: 'rm' }, h('button', { class: `btn sm ${off ? '' : 'ghost'}`, style: { background: 'rgba(8,10,16,.72)', color: '#fff', backdropFilter: 'blur(4px)' }, onclick: onToggle }, off ? 'Keep' : icon('x', 14), off ? '' : 'Remove')) : null),
    h('div', { class: 'pb' }, h('div', { class: 'row between' }, h('b', { class: 'small' }, it.template), h('span', { class: 'chip' }, it.mode === 'cutaway' ? 'Full frame' : it.mode === 'panel' ? 'Side panel' : 'Top bar')),
      h('div', { class: 'faint tiny mt-s' }, `${fmt.dur(it.start)} for ${it.duration.toFixed(1)} s${alts ? ` · design ${it.chosen + 1} of ${it.alternatives.length}` : ''}`),
      it.line ? h('div', { class: 'small muted mt-s', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, `“${it.line}”`) : null,
      it.why ? h('div', { class: 'tiny faint mt-s' }, it.why) : null));
}

function storyboardSummary(sb, tl, plan, pc, gate) {
  const removed = gate?.removed || new Set();
  const tabs = ['Graphics', 'B-roll', 'Sound', 'Notes'];
  let tab = 'Graphics';
  const holder = h('div', {});
  const tabBar = h('div', { class: 'tabs' });
  const sfx = tl?.sfx || [];
  const draw = () => {
    mount(tabBar, tabs.map(t => h('button', { class: t === tab ? 'on' : '', onclick: () => { tab = t; draw(); } }, t, t === 'Graphics' ? ` (${sb.items.length})` : t === 'B-roll' ? ` (${(gate?.broll?.placed ?? tl?.broll?.length) ?? 0})` : t === 'Sound' ? ` (${sfx.length})` : '')));
    if (tab === 'Graphics') mount(holder, sb.items.length ? h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } }, sb.items.map(it => graphicCard(pc, it, gate ? { off: removed.has(it.id), onToggle: () => { removed.has(it.id) ? removed.delete(it.id) : removed.add(it.id); gate.onChange?.(); draw(); } } : {}))) : h('div', { class: 'muted' }, 'No graphics were planned.'));
    else if (tab === 'B-roll') mount(holder, gate ? gate.brollPanel() : brollSummary(plan, tl));
    else if (tab === 'Sound') mount(holder, sfx.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Sound'), h('th', {}, 'Level'))), h('tbody', {}, sfx.map(f => h('tr', {}, h('td', { class: 'mono' }, fmt.dur(f.at)), h('td', {}, f.kind), h('td', { class: 'muted' }, `${f.gainDb} dB`))))) : h('div', { class: 'muted' }, 'No sound effects. Turn them on in the project settings for a new project.'));
    else mount(holder, h('div', { class: 'col' }, (sb.notes || []).map(n => h('div', { class: 'hint' }, icon('info', 18), n)), h('dl', { class: 'kvs' }, h('dt', {}, 'Designer'), h('dd', {}, sb.engine), h('dt', {}, 'Density'), h('dd', {}, `${sb.density}, ${sb.stats.perMinute} per minute`), h('dt', {}, 'Full-frame time'), h('dd', {}, `${sb.stats.cutawaySeconds} s`), h('dt', {}, 'Theme'), h('dd', {}, sb.theme))));
  };
  draw();
  return h('div', { class: 'col', style: { gap: '16px' } },
    tl ? panelCard('Everything on the timeline', 'Violet and cyan are graphics, green is B-roll, pink dots are sound effects. Click to jump in the video.', timeline({ ...tl, graphics: tl.graphics.map((g, i) => ({ ...g, id: sb.items[i]?.id })) }, { onSeek: t => pc.seek(t), removed })) : null,
    h('div', { class: 'card pad' }, tabBar, holder));
}

function brollSummary(plan, tl) {
  if (!plan?.moments?.length) return h('div', { class: 'muted' }, plan ? 'No B-roll was needed for this video.' : 'No B-roll plan.');
  return h('div', { class: 'col' }, h('div', { class: 'muted small' }, `${plan.moments.length} moment(s) where B-roll helps, with draft search words. ${tl?.broll?.length ? `${tl.broll.length} clip(s) are placed.` : 'None are placed yet.'}`),
    h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'At'), h('th', {}, 'Line'), h('th', {}, 'Search'), h('th', {}, 'Confidence'))), h('tbody', {}, plan.moments.map(m => h('tr', {}, h('td', { class: 'mono nowrap' }, `${fmt.dur(m.at)} +${m.duration}s`), h('td', { class: 'muted' }, m.line), h('td', {}, h('code', {}, m.query)), h('td', {}, h('span', { class: `chip ${m.confidence === 'high' ? 'good' : m.confidence === 'low' ? 'warn' : ''}` }, m.confidence)))))));
}

function storyboardGate(pc, payload) {
  const removed = new Set();
  const note = h('textarea', { class: 'textarea', style: { minHeight: '64px', fontFamily: 'var(--sans)' }, placeholder: 'Optional note for the approval record' });
  const approve = h('button', { class: 'btn primary' });
  const info = { removed, broll: payload.broll, onChange: () => updateBtn() };
  const sb = { items: payload.items, notes: payload.notes, engine: payload.engine, density: payload.density, stats: payload.stats, theme: payload.theme };
  const keep = new Set();
  const dropB = new Set();
  info.brollPanel = () => brollGate(pc, payload, dropB, () => { payload = pc.project.pending?.payload || payload; });
  const updateBtn = () => { mount(approve, removed.size ? [icon('refresh', 16), `Remove ${removed.size} and re-check`] : [icon('check', 16), 'Approve and render']); };
  approve.addEventListener('click', async () => {
    if (!removed.size && !(await confirmDialog('Approve this plan?', `The toolkit will render ${payload.items.length} graphic(s), ${payload.broll?.placed || 0} B-roll clip(s) and ${payload.sfx.length} sound cue(s). Your approval is recorded.`, 'Approve and render'))) return;
    approve.disabled = true;
    try { await api.gate(pc.id, 'storyboard', { drop: [...removed], note: note.value }); toast(removed.size ? 'Removed. Re-checking the plan…' : 'Approved. Rendering…', 'good'); } catch (error) { toast(error.message, 'bad'); approve.disabled = false; }
  });
  updateBtn();
  return h('div', { class: 'col', style: { gap: '16px' } },
    h('div', { class: 'gate' }, h('div', { class: 'gh' }, h('span', { class: 'badge' }, 'Your approval'), h('h3', {}, 'Approve the plan before rendering')),
      h('p', { class: 'muted', style: { margin: 0 } }, `${payload.items.length} graphic(s) planned from your transcript${payload.captionsOn ? ', with captions on' : ''}. Remove any you do not want, check the B-roll and sound, then approve. Rendering starts only after you do.`)),
    storyboardSummary(sb, payload.timeline, payload.broll?.plan, pc, info),
    h('div', { class: 'card pad col' }, note, h('div', { class: 'row between' }, h('div', { class: 'muted small' }, 'Facts and wording in the graphics come from your transcript. Check them before publishing.'), approve)));
}

// B-roll inside the storyboard gate: consent, fetch, preview, keep or drop, place.
function brollGate(pc, payload, dropB, refresh) {
  const plan = payload.broll?.plan;
  const box = h('div', { class: 'col' });
  const consent = { allowSearch: false, allowDownload: false, rightsConfirmed: false };
  const draw = () => {
    const placements = pc.project.pending?.payload?.broll?.placements || payload.broll?.placements;
    if (!plan?.moments?.length) return mount(box, h('div', { class: 'muted' }, 'No B-roll moments were planned for this video.'));
    mount(box, brollSummary(plan),
      !placements ? h('div', { class: 'card pad col', style: { background: 'var(--panel2)' } }, h('b', {}, 'Fetch clips for these moments'),
        h('div', { class: 'muted small' }, 'Searches Pixabay or Unsplash (whichever keys you have), downloads one clip per moment and shows you a preview of each. Nothing is placed until you choose.'),
        ...[['allowSearch', 'Send the search words to the stock site'], ['allowDownload', 'Download the clips I select'], ['rightsConfirmed', 'I accept the licence for the selected clips (credits are added automatically)']].map(([k, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { consent[k] = e.target.checked; fetchBtn.disabled = !(consent.allowSearch && consent.allowDownload && consent.rightsConfirmed); } }), l)),
        h('div', {}, fetchBtn))
      : h('div', { class: 'col' }, h('b', {}, 'Choose which clips to use'),
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } }, placements.map(p => h('div', { class: `gcard ${dropB.has(p.id) || p.status !== 'downloaded' ? 'off' : ''}` },
          h('div', { class: 'pv' }, p.previewUrl ? h('img', { src: p.previewUrl, alt: '' }) : h('div', { class: 'faint small' }, p.status === 'no-result' ? 'Nothing found' : p.error || 'No preview')),
          h('div', { class: 'pb' }, h('div', { class: 'row between' }, h('b', { class: 'small' }, p.query), h('span', { class: 'chip' }, p.source || p.status)), h('div', { class: 'faint tiny mt-s' }, `${fmt.dur(p.at)} for ${p.duration}s${p.size ? ` · ${p.size}` : ''}`), p.creator ? h('div', { class: 'tiny faint' }, `by ${p.creator}`) : null,
            p.status === 'downloaded' ? h('label', { class: 'check mt-s' }, h('input', { type: 'checkbox', checked: !dropB.has(p.id), onchange: e => { e.target.checked ? dropB.delete(p.id) : dropB.add(p.id); draw(); } }), 'Use this clip') : null)))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: applyBroll }, icon('check', 16), 'Place the selected clips'), h('span', { class: 'muted small' }, payload.broll?.placed ? `${pc.project.pending?.payload?.broll?.placed || payload.broll.placed} clip(s) placed so far.` : 'Nothing placed yet.'))));
  };
  const fetchBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    mount(fetchBtn, h('span', { class: 'spinner' }), 'Fetching…'); fetchBtn.disabled = true;
    try { await api.action(pc.id, 'broll-fetch', consent); await pc.reload(); draw(); } catch (error) { toast(error.message, 'bad'); mount(fetchBtn, 'Fetch clips'); fetchBtn.disabled = false; }
  } }, 'Fetch clips');
  async function applyBroll() {
    try { const r = await api.action(pc.id, 'broll-apply', { drop: [...dropB] }); toast(`${r.placed} B-roll clip(s) placed`, 'good'); await pc.reload(); draw(); } catch (error) { toast(error.message, 'bad'); }
  }
  draw();
  return box;
}

// ---- 6/7. render and short
const PHASES = [['graphics', 'Rendering motion graphics'], ['compositing', 'Compositing scenes'], ['audio', 'Mixing and mastering audio'], ['encoding', 'Encoding the final video'], ['deliverables', 'Captions, thumbnail and checks']];
export function viewRender(pc, which = 'render') {
  const step = pc.project.steps[which];
  if (step?.status === 'running' || step?.status === 'pending' || step?.status === 'waiting') return renderProgress(pc, which);
  return lazy(async () => {
    const d = await pc.data(which);
    if (!d) return step?.status === 'failed' ? h('div', { class: 'hint bad' }, icon('alert', 18), step.error || 'This step failed.') : h('div', { class: 'muted' }, 'Not rendered yet.');
    return finishedRender(pc, d, which);
  }, 360);
}

function renderProgress(pc, which) {
  const pr = pc.state.progress || {};
  const order = PHASES.map(p => p[0]);
  const at = order.indexOf(pr.phase);
  const g = pr.graphics;
  return h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'card pad' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, which === 'short' ? 'Cutting the vertical short' : 'Rendering your video'), h('div', { class: 'sub' }, 'The toolkit renders each graphic in a headless browser, composites everything, masters the sound and checks the result.')), h('span', { class: 'spinner' }))),
    PHASES.map(([k, label], i) => h('div', { class: `phase ${i < at ? 'done' : i === at ? 'on' : ''}` }, h('div', { class: 'pi' }, i < at ? icon('check', 13) : i === at ? h('span', { class: 'spinner', style: { width: '13px', height: '13px' } }) : i + 1),
      h('div', { style: { flex: 1 } }, h('div', {}, label), k === 'graphics' && g?.total ? h('div', { class: 'progressbar mt-s' }, h('i', { style: { width: `${Math.min(100, g.done / g.total * 100)}%` } })) : null), k === 'graphics' && g?.total ? h('span', { class: 'faint small mono' }, `${g.done}/${g.total}`) : null)));
}

function finishedRender(pc, d, which) {
  const r = d.report, m = r.verification?.measured || {};
  const vertical = m.height > m.width;
  const checks = Object.entries(r.verification?.checks || {});
  const lufs = m.integratedLufs, peak = m.truePeakDb;
  const copy = text => navigator.clipboard?.writeText(text).then(() => toast('Copied', 'good'));
  return h('div', { class: 'col', style: { gap: '16px' } },
    h('div', { class: 'grid', style: { gridTemplateColumns: vertical ? '300px minmax(0,1fr)' : 'minmax(0,1.5fr) minmax(0,1fr)', alignItems: 'start' } },
      h('div', {}, h('div', { class: `player ${vertical ? 'vertical' : ''}` }, h('video', { controls: true, preload: 'metadata', src: d.files.video, poster: d.files.thumbnail })),
        h('div', { class: 'row mt-s wrap' }, h('a', { class: 'btn sm', href: d.files.video, download: 'final.mp4' }, icon('download', 14), 'final.mp4'), d.files.captionsSrt ? h('a', { class: 'btn sm', href: d.files.captionsSrt, download: 'captions.srt' }, icon('download', 14), 'captions.srt') : null, d.files.captionsVtt ? h('a', { class: 'btn sm', href: d.files.captionsVtt, download: 'captions.vtt' }, icon('download', 14), 'captions.vtt') : null)),
      h('div', { class: 'col' },
        h('div', { class: 'tiles' }, tile('Length', fmt.dur(r.timeline?.duration)), tile('Graphics', r.timeline?.motionGraphics ?? 0), tile('Resolution', `${m.width}×${m.height}`), tile('Rendered in', fmt.dur(r.renderSeconds))),
        panelCard('Sound', 'Mastered to the target loudness with a safe true peak.', h('div', { class: 'row gap-l', style: { justifyContent: 'space-around', paddingBottom: '14px' } }, gauge({ value: lufs, min: -24, max: -6, goodFrom: -15, goodTo: -13, label: 'LUFS (target -14)', decimals: 1 }), gauge({ value: peak, min: -6, max: 1, goodFrom: -6, goodTo: -0.9, label: 'true peak dBTP (max -1)', decimals: 1 }))))),
    panelCard('Technical checks', 'These checks read the real file. They do not judge the story, wording or facts.', h('div', { class: 'checks' }, checks.map(([k, v]) => h('div', { class: 'c' }, h('span', {}, k.replace(/([A-Z])/g, ' $1').toLowerCase()), h('span', { class: `chip ${v === 'PASS' ? 'good' : v === 'FAIL' ? 'bad' : 'warn'}` }, v))))),
    r.warnings?.length ? h('div', { class: 'hint warn' }, icon('alert', 18), h('div', {}, r.warnings.map(w => h('div', {}, w)))) : null,
    h('div', { class: 'grid g2' }, d.files.contactSheet ? panelCard('Contact sheet', 'Frames across the whole video, to spot problems at a glance.', h('img', { src: d.files.contactSheet, alt: '', style: { width: '100%', borderRadius: '8px', border: '1px solid var(--line)' } })) : null,
      d.youtube ? panelCard('Publishing draft (YOUTUBE.md)', 'Title options, description, chapters, credits and tags drafted from the video. Edit before use.', h('pre', { class: 'log', style: { maxHeight: '300px', whiteSpace: 'pre-wrap' } }, d.youtube), h('div', { class: 'mt-s' }, h('button', { class: 'btn sm', onclick: () => copy(d.youtube) }, icon('copy', 14), 'Copy'))) : null),
    d.credits ? panelCard('Credits', 'Stock and generated material used in this video. Paste into the description.', h('pre', { class: 'log', style: { maxHeight: '160px' } }, d.credits)) : null,
    reviewNotes(pc, which === 'render' ? 'render' : 'short'));
}

// ---- 8. final approval
export function viewFinal(pc) {
  const pending = pc.project.pending?.gate === 'final' ? pc.project.pending : null;
  return lazy(async () => {
    const [long, short] = await Promise.all([pc.data('render').catch(() => null), pc.data('short').catch(() => null)]);
    const approvals = pc.project.approvals || [];
    const history = panelCard('Approval record', 'Every decision, who made it and when. Saved as APPROVALS.md in the project.', approvals.length ? h('div', { class: 'tl' }, approvals.map(a => h('div', {}, h('div', { class: 'row between' }, h('b', {}, a.gate.replace(/-/g, ' ')), h('span', { class: `chip ${/approved|permitted|continued/.test(a.decision) ? 'good' : 'warn'}` }, a.decision)), h('div', { class: 'small muted' }, a.summary), a.note ? h('div', { class: 'small' }, `“${a.note}”`) : null, h('div', { class: 'faint tiny' }, `${a.by} · ${new Date(a.at).toLocaleString()}${a.fingerprint ? ` · fingerprint ${a.fingerprint}` : ''}`)))) : h('div', { class: 'muted' }, 'No approvals recorded yet.'));
    if (!pending) return h('div', { class: 'col', style: { gap: '16px' } }, pc.project.status === 'done' ? h('div', { class: 'banner ok' }, icon('check', 22), h('div', {}, h('b', {}, 'Approved for delivery'), h('div', { class: 'small muted' }, 'You signed off on the final video. Publishing remains your action.'))) : null, history);
    const checklist = { watched: false, facts: false, rights: false };
    const note = h('textarea', { class: 'textarea', style: { minHeight: '64px', fontFamily: 'var(--sans)' }, placeholder: 'Notes for the record, or what should change' });
    const approve = h('button', { class: 'btn primary', disabled: true, onclick: () => decide(true) }, icon('check', 16), 'Approve for delivery');
    const changes = h('button', { class: 'btn', onclick: () => decide(false) }, 'Request changes');
    async function decide(ok) { approve.disabled = changes.disabled = true; try { await api.gate(pc.id, 'final', { approved: ok, checklist, note: note.value }); toast(ok ? 'Approved' : 'Changes requested', ok ? 'good' : ''); } catch (error) { toast(error.message, 'bad'); approve.disabled = !Object.values(checklist).every(Boolean); changes.disabled = false; } }
    const box = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { checklist[k] = e.target.checked; approve.disabled = !Object.values(checklist).every(Boolean); } }), label);
    return h('div', { class: 'col', style: { gap: '16px' } },
      h('div', { class: 'gate' }, h('div', { class: 'gh' }, h('span', { class: 'badge' }, 'Your approval'), h('h3', {}, 'Watch it, then sign off')), h('p', { class: 'muted', style: { margin: 0 } }, 'The technical checks passed, but they cannot judge the story, the facts or the feel. Watch the video from start to end.')),
      h('div', { class: 'grid', style: { gridTemplateColumns: short ? 'minmax(0,1.6fr) 300px' : '1fr', alignItems: 'start' } },
        long ? h('div', { class: 'player' }, h('video', { controls: true, preload: 'metadata', src: long.files.video, poster: long.files.thumbnail })) : null,
        short ? h('div', {}, h('div', { class: 'player vertical' }, h('video', { controls: true, preload: 'metadata', src: short.files.video, poster: short.files.thumbnail })), h('div', { class: 'tiny faint', style: { textAlign: 'center' }, }, 'Vertical short')) : null),
      h('div', { class: 'card pad col' }, box('watched', 'I watched the whole video, including every graphic, and listened to the sound'), box('facts', 'I checked the facts, numbers and caption wording'), box('rights', 'I confirm the rights and licences for everything in it (footage, stock, music, sound)'), note,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, changes, approve)), history);
  }, 300);
}
