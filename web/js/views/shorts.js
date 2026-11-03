import { h, mount, icon, toast, fmt } from '../ui.js';
import { api } from '../api.js';

// Shorts: an educational explainer short from a blog or a concept. Script by Claude, narration by ElevenLabs, a vertical video of graphic scenes.
// Each step that sends text out, spends credits or approves a build asks first. The ElevenLabs key lives on the server; this page never sees it.
const STAGE = { draft: ['Needs a script', ''], script: ['Script ready', 'info'], planned: ['Voice recorded, plan ready', 'warn'], built: ['Video built', 'good'] };
const field = (label, node, hint) => h('label', { class: 'field' }, h('span', {}, label), node, hint ? h('small', {}, hint) : null);
const select = (values, value, onchange) => h('select', { class: 'select', onchange: e => onchange(e.target.value) }, values.map(v => h('option', { value: v, selected: String(v) === String(value) }, v)));
const pretty = v => JSON.stringify(v, null, 2);

export async function renderShorts(view, ctx, id) {
  const timers = [];
  const cleanup = () => timers.forEach(clearTimeout);
  if (id) await detail(view, id, timers); else await list(view);
  return cleanup;
}

// ---------------------------------------------------------------- list and create
async function list(view) {
  const [cfg, shorts] = await Promise.all([api.get('/api/shorts/config'), api.get('/api/shorts')]);
  const o = { ...cfg.defaults };
  const text = h('textarea', { class: 'textarea', rows: 10, placeholder: 'Paste the blog post (or the part you want explained), or describe a concept in a sentence or two.', style: { width: '100%' } });
  let kind = 'source';
  const kinds = h('div', { class: 'seg' });
  const drawKinds = () => mount(kinds, [['source', 'A blog or article'], ['concept', 'A concept']].map(([k, label]) => h('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; drawKinds(); } }, label)));
  drawKinds();
  const title = h('input', { class: 'input', placeholder: 'Optional: a name for this short' });
  const opt = cfg.options;
  const form = h('div', { class: 'grid g3 mt-s' },
    field('Length', select(opt.lengths.map(n => `${n}`), o.length, v => { o.length = Number(v); }), 'Seconds. The script is written to fit.'),
    field('Tone', select(opt.tones, o.tone, v => { o.tone = v; })), field('Audience', select(opt.audiences, o.audience, v => { o.audience = v; })),
    field('Language', h('input', { class: 'input', value: o.language, oninput: e => { o.language = e.target.value.trim() || 'en'; } }), 'A code such as en, es, fr.'),
    field('Visual theme', select(opt.themes, o.theme, v => { o.theme = v; })), field('Captions', select(opt.captions, o.captions, v => { o.captions = v; })),
    field('Sound effects', select(opt.sfx, o.sfx, v => { o.sfx = v; })), field('Direction of travel', select(opt.currents, o.current, v => { o.current = v; }), 'How scenes move into each other.'),
    field('Call to action', h('input', { class: 'input', placeholder: 'Optional, e.g. Follow for more', oninput: e => { o.cta = e.target.value; } })));
  const extras = h('div', { class: 'row wrap mt-s', style: { gap: '20px' } },
    h('label', { class: 'row small', style: { gap: '6px' } }, h('input', { type: 'checkbox', onchange: e => { o.calm = e.target.checked; } }), 'Calm motion (no overshoot)'),
    h('label', { class: 'row small', style: { gap: '6px' } }, h('input', { type: 'checkbox', onchange: e => { o.onTwos = e.target.checked; } }), 'Stepped, hand-made motion'));
  const focus = field('Focus (optional)', h('input', { class: 'input', placeholder: 'What the short should concentrate on', oninput: e => { o.topic = e.target.value; } }));
  const create = async ev => {
    ev.target.disabled = true;
    try {
      const r = await api.post('/api/shorts', { [kind]: text.value, title: title.value, options: { ...o, cta: o.cta || undefined, topic: o.topic || undefined } });
      location.hash = `#/shorts/${r.id}`;
    } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; }
  };
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Educational ', h('em', { class: 'serif' }, 'shorts')), h('p', {}, 'Turn a blog post or a concept into a short explainer video: Claude writes the script from your text, ElevenLabs reads it, and Video Monk builds a vertical video with captions. You approve each step.'))),
    !cfg.elevenlabs.hasKey ? h('div', { class: 'hint bad' }, icon('alert', 18), 'ELEVENLABS_API_KEY is not set. Put it in your environment (or a .env file) and restart the studio. You can still write and edit scripts; recording needs the key.') : null,
    !cfg.canUseClaude ? h('div', { class: 'hint bad mt-s' }, icon('alert', 18), 'The Claude command-line tool was not found, so scripts cannot be written here. Install Claude Code, or write the script yourself.') : null,
    h('div', { class: 'card pad mt' }, h('h3', {}, 'New short'), h('div', { class: 'mt-s' }, kinds), h('div', { class: 'mt-s' }, text), field('Name', title), form, extras, focus,
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', onclick: create }, icon('plus', 16), 'Create short'), h('span', { class: 'muted small' }, 'Nothing is sent anywhere yet.'))),
    shorts.length ? h('div', { class: 'mt' }, h('h2', {}, 'Your shorts'), h('div', { class: 'pgrid mt-s' }, shorts.map(s => h('div', { class: 'card pad rise' },
      h('div', { class: 'row between' }, h('span', { class: `chip ${STAGE[s.stage]?.[1] || ''}` }, STAGE[s.stage]?.[0] || s.stage), h('span', { class: 'faint tiny' }, s.length ? `${s.length} s` : '')),
      h('h3', { style: { marginTop: '10px', fontSize: '15px' } }, s.title), h('div', { class: 'faint small mt-s' }, fmt.ago(s.updatedAt || s.createdAt)),
      h('div', { class: 'row mt-s' }, h('a', { class: 'btn sm', href: `#/shorts/${s.id}` }, 'Open'),
        h('button', { class: 'btn ghost sm', onclick: async () => { if (!confirm(`Delete "${s.title}" and its files?`)) return; try { await api.del(`/api/shorts/${s.id}`); renderShorts(view, null); } catch (e) { toast(e.message, 'bad'); } } }, icon('trash', 14)))))) ) : null);
}

// ---------------------------------------------------------------- one short
async function detail(view, id, timers) {
  const [cfg, state] = await Promise.all([api.get('/api/shorts/config'), api.get(`/api/shorts/${id}`)]);
  let st = state, voices = null, models = null;
  let scriptDraft = st.script ? structuredClone(st.script) : null;
  const root = h('div', {}), jobBox = h('div', {});

  const reload = async () => { st = await api.get(`/api/shorts/${id}`); scriptDraft = st.script ? structuredClone(st.script) : null; draw(); };
  // poll a background job until it ends, showing its log
  const watch = jobId => new Promise(resolve => {
    const tick = async () => {
      let j; try { j = await api.get(`/api/shorts/jobs/${jobId}`); } catch (e) { mount(jobBox, h('div', { class: 'hint bad' }, e.message)); return resolve(null); }
      mount(jobBox, h('div', { class: 'card pad' }, h('div', { class: 'row', style: { gap: '10px' } }, j.status === 'running' ? h('span', { class: 'spinner' }) : icon(j.status === 'done' ? 'check' : 'alert', 16), h('b', {}, j.status === 'running' ? `Working: ${j.kind}…` : j.status === 'done' ? 'Done' : 'It did not finish')),
        h('div', { class: 'mono small muted mt-s', style: { whiteSpace: 'pre-wrap' } }, j.log.join('\n')), j.error ? h('div', { class: 'small mt-s', style: { color: 'var(--bad, #e5484d)', whiteSpace: 'pre-wrap' } }, j.error) : null));
      if (j.status === 'running') timers.push(setTimeout(tick, 1200)); else resolve(j);
    };
    tick();
  });
  const run = async (promise, after) => { try { const { jobId } = await promise; const j = await watch(jobId); if (j?.status === 'done') { await reload(); after?.(j); } } catch (e) { toast(e.message, 'bad'); } };

  const sourceCard = () => h('div', { class: 'card pad' }, h('div', { class: 'row between' }, h('h3', {}, st.title), h('a', { class: 'btn ghost sm', href: '#/shorts' }, icon('back', 14), 'All shorts')),
    h('div', { class: 'row wrap small muted mt-s', style: { gap: '14px' } }, [`${st.options.length} s`, st.options.tone, st.options.audience, st.options.language, st.options.theme, `captions: ${st.options.captions}`, `sfx: ${st.options.sfx}`].map(x => h('span', { class: 'chip' }, x))),
    h('details', { class: 'mt-s' }, h('summary', { class: 'small muted' }, `The ${st.kind === 'concept' ? 'concept' : 'source text'} (${st.source.length} characters)`), h('div', { class: 'small mt-s', style: { whiteSpace: 'pre-wrap', maxHeight: '220px', overflow: 'auto' } }, st.source)));

  const scriptCard = () => {
    const body = h('div', { class: 'card pad' }, h('h3', {}, '1. Script'));
    if (!scriptDraft) {
      mount(body, h('h3', {}, '1. Script'), h('p', { class: 'muted small' }, 'Claude writes a script from your text: a hook, one idea per beat, and a takeaway. Every number on screen has to come from your text. This sends your text to Claude (the claude command-line tool on this computer).'),
        h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !cfg.canUseClaude, onclick: ev => { if (!confirm('Send your text to Claude to write the script? Claude then also chooses the voice and look for you to approve, which sends it the names of your ElevenLabs voices.')) return; ev.target.disabled = true; run(api.post(`/api/shorts/${id}/script`, { confirmLlm: true })); } }, icon('sparkle', 16), 'Write the script'),
          !cfg.canUseClaude ? h('span', { class: 'muted small' }, 'Claude Code is not installed.') : null));
      return body;
    }
    const check = st.check, status = h('div', { class: 'mt-s' });
    const drawStatus = () => mount(status, check.errors.map(e => h('div', { class: 'row small', style: { gap: '8px', color: 'var(--bad, #e5484d)' } }, icon('alert', 14), e)), check.warnings.slice(0, 6).map(w => h('div', { class: 'row small muted', style: { gap: '8px' } }, icon('info', 14), w)), check.warnings.length > 6 ? h('div', { class: 'small faint' }, `and ${check.warnings.length - 6} more`) : null,
      h('div', { class: 'small muted mt-s' }, `${check.words} spoken words, about ${check.seconds} s; ${st.estimate.characters} characters to record.`));
    drawStatus();
    const beats = scriptDraft.beats.map((b, i) => {
      const props = h('textarea', { class: 'textarea', rows: 4, spellcheck: false, style: { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '12px' }, oninput: e => { try { b.props = JSON.parse(e.target.value); e.target.style.borderColor = ''; } catch { e.target.style.borderColor = 'var(--bad, #e5484d)'; } } }, pretty(b.props));
      const count = h('span', { class: 'faint tiny' }, `${b.say.trim().split(/\s+/).length} words`);
      return h('div', { class: 'card pad mt-s', style: { background: 'var(--bg2)' } },
        h('div', { class: 'row between' }, h('b', {}, `Beat ${i + 1}`), h('div', { class: 'row' }, count,
          h('button', { class: 'btn ghost sm', title: 'Remove', disabled: scriptDraft.beats.length <= 5, onclick: () => { scriptDraft.beats.splice(i, 1); redraw(); } }, icon('trash', 14)))),
        h('label', { class: 'field mt-s' }, h('span', {}, 'What the voice says'), h('textarea', { class: 'textarea', rows: 3, oninput: e => { b.say = e.target.value; count.textContent = `${b.say.trim().split(/\s+/).filter(Boolean).length} words`; } }, b.say)),
        h('div', { class: 'grid g2 mt-s' }, field('Shown as', select(cfg.templates, b.show, v => { b.show = v; })), field('On screen (props, JSON)', props)));
    });
    const redraw = () => { mount(body, ...parts()); };
    const parts = () => [h('h3', {}, '1. Script'), h('p', { class: 'muted small' }, 'Edit anything. The voice reads the left box; the right side is what is shown. Numbers on screen must be in your source text.'), ...beats, status,
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', onclick: async ev => { ev.target.disabled = true; try { await api.put(`/api/shorts/${id}/script`, { script: scriptDraft }); toast('Script saved', 'good'); await reload(); } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; } } }, icon('check', 16), 'Save script'),
        h('button', { class: 'btn ghost', onclick: () => { if (confirm('Write a new script with Claude? The current one is replaced.')) run(api.post(`/api/shorts/${id}/script`, { confirmLlm: true })); } }, 'Write again'))];
    mount(body, ...parts());
    return body;
  };

  // 2. the direction: Claude chooses the voice, delivery and look from the script; every choice can be changed, and the person approves it before anything is recorded.
  const MODELS = ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];
  const directionCard = () => {
    const box = h('div', { class: 'card pad' });
    if (!scriptDraft) { mount(box, h('h3', {}, '2. Direction'), h('p', { class: 'muted small' }, 'Write the script first. Then Claude chooses the voice, delivery and look, and you approve them.')); return box; }
    const d = structuredClone(st.direction || { voiceId: cfg.elevenlabs.voiceId || '', voiceName: '', modelId: cfg.elevenlabs.shortsModel, voiceSettings: { stability: 0.4, similarity_boost: 0.75 }, captions: st.options.captions, theme: st.options.theme, sfx: st.options.sfx, calm: Boolean(st.options.calm), onTwos: Boolean(st.options.onTwos), current: st.options.current, reasons: {}, by: 'default', approved: false });
    d.voiceSettings = d.voiceSettings || {};
    const who = { claude: ['Chosen by Claude', 'info'], 'claude+you': ['Chosen by Claude, edited by you', 'info'], you: ['Set by you', ''], default: ['Defaults (no recommendation made)', 'warn'] }[d.by] || ['', ''];
    const status = h('span', { class: `chip ${d.approved ? 'good' : 'warn'}` }, d.approved ? 'Approved' : 'Needs your approval');
    const note = key => (d.reasons?.[key] ? h('small', { class: 'faint' }, `Why: ${d.reasons[key]}`) : null);
    const dirty = () => { status.textContent = 'Changed: approve again'; status.className = 'chip warn'; d.approved = false; };
    const voiceSel = h('select', { class: 'select', onchange: e => { d.voiceId = e.target.value; d.voiceName = e.target.selectedOptions[0]?.dataset.name || ''; dirty(); } });
    const fillVoices = () => mount(voiceSel, h('option', { value: d.voiceId || '' }, d.voiceId ? (d.voiceName || d.voiceId) : 'Load your voices'), (voices || []).filter(v => v.id !== d.voiceId).map(v => h('option', { value: v.id, 'data-name': v.name }, `${v.name}${v.category ? ` (${v.category})` : ''}${Object.values(v.labels || {}).length ? `: ${Object.values(v.labels).slice(0, 3).join(', ')}` : ''}`)));
    fillVoices();
    const modelSel = h('select', { class: 'select', onchange: e => { d.modelId = e.target.value; dirty(); } }, [...new Set([d.modelId, ...MODELS, ...(models || []).map(m => m.id)])].filter(Boolean).map(m => h('option', { value: m, selected: m === d.modelId }, m)));
    const slider = (label, key, hint) => h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'row', style: { gap: '10px' } }, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: d.voiceSettings[key] ?? (key === 'stability' ? 0.4 : 0.75), style: { flex: 1 }, oninput: e => { d.voiceSettings[key] = Number(e.target.value); e.target.nextSibling.textContent = d.voiceSettings[key]; dirty(); } }), h('b', {}, d.voiceSettings[key] ?? (key === 'stability' ? 0.4 : 0.75))), hint ? h('small', {}, hint) : null);
    const loadVoices = async ev => {
      ev.target.disabled = true;
      try { voices = await api.get('/api/shorts/voices'); try { models = await api.get('/api/shorts/models'); } catch { /* optional */ } fillVoices(); toast(`${voices.length} voice(s)`, 'good'); } catch (e) { toast(e.message, 'bad'); }
      ev.target.disabled = false;
    };
    const o = cfg.options;
    const pick = (key, values) => select(values, d[key], v => { d[key] = v; dirty(); });
    const save = async approve => {
      if (!d.voiceId) return toast('Choose a voice first', 'bad');
      try { const r = await api.put(`/api/shorts/${id}/direction`, { direction: d, approve }); toast(approve ? 'Direction approved' : 'Direction saved', 'good'); await reload(); return r; } catch (e) { toast(e.message, 'bad'); }
    };
    mount(box, h('div', { class: 'row between' }, h('h3', {}, '2. Direction'), h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: `chip ${who[1]}` }, who[0]), status)),
      h('p', { class: 'muted small' }, 'Claude chose the voice, how it delivers the lines and how the video looks, from your script, tone and audience. Change anything you like, then approve. Nothing is recorded until you do.'),
      h('div', { class: 'grid g2 mt-s' }, field('Voice', h('div', { class: 'row', style: { gap: '8px' } }, voiceSel, h('button', { class: 'btn ghost sm', disabled: !cfg.elevenlabs.hasKey, onclick: loadVoices }, 'Load voices')), d.reasons?.voice ? `Why: ${d.reasons.voice}` : null),
        field('Model', modelSel, 'v4 is the most expressive; v3 also reads audio tags. Others read the script without them.')),
      h('div', { class: 'grid g2 mt-s' }, slider('Stability', 'stability', d.reasons?.delivery ? `Why: ${d.reasons.delivery}` : 'Lower is livelier and more varied.'), slider('Similarity', 'similarity_boost', 'Higher keeps closer to the voice.')),
      h('div', { class: 'grid g3 mt-s' }, field('Captions', pick('captions', o.captions), d.reasons?.captions ? `Why: ${d.reasons.captions}` : null), field('Visual theme', pick('theme', o.themes), d.reasons?.look ? `Why: ${d.reasons.look}` : null), field('Sound effects', pick('sfx', o.sfx)),
        field('Direction of travel', pick('current', o.currents), d.reasons?.motion ? `Why: ${d.reasons.motion}` : null),
        field('Calm motion', h('input', { type: 'checkbox', checked: d.calm, onchange: e => { d.calm = e.target.checked; dirty(); } })), field('Stepped motion', h('input', { type: 'checkbox', checked: d.onTwos, onchange: e => { d.onTwos = e.target.checked; dirty(); } })), field('Ambient music bed', h('input', { type: 'checkbox', checked: d.bed !== false, onchange: e => { d.bed = e.target.checked; dirty(); } }), 'An original generated pad under the voice (no licence to check).')),
      h('div', { class: 'row mt-s', style: { gap: '10px' } }, h('button', { class: 'btn', onclick: ev => { ev.target.disabled = true; save(true).finally(() => { ev.target.disabled = false; }); } }, icon('check', 16), 'Approve direction'),
        h('button', { class: 'btn ghost', onclick: ev => { ev.target.disabled = true; save(false).finally(() => { ev.target.disabled = false; }); } }, 'Save without approving'),
        h('button', { class: 'btn ghost', disabled: !cfg.canUseClaude, onclick: () => { if (!confirm('Ask Claude to choose again? This sends the script and the names of your voices to Claude, and replaces the choices above.')) return; run(api.post(`/api/shorts/${id}/direction`, { confirmLlm: true, modelId: d.modelId })); } }, icon('sparkle', 14), 'Ask Claude again')));
    return box;
  };

  // 3. pictures: logos fetched from each company's own website by a browser, and stock footage. Candidates only: the person approves each one.
  const visualsCard = () => {
    const box = h('div', { class: 'card pad' });
    if (!scriptDraft) { mount(box, h('h3', {}, '3. Pictures'), h('p', { class: 'muted small' }, 'Write the script first.')); return box; }
    const v = st.visuals;
    let browse = true, stock = true, rights = false;
    const find = h('div', { class: 'col mt-s', style: { gap: '8px' } },
      h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: e => { browse = e.target.checked; } }), 'Logos: a browser visits each named company\'s own website and takes its logo (read-only; nothing is typed or submitted)'),
      h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: e => { stock = e.target.checked; } }), 'Stock footage (Pixabay or Unsplash, with the keys in your environment)'),
      h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', onchange: e => { rights = e.target.checked; } }), 'I accept the stock provider\'s licence for the footage that is downloaded'),
      h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !cfg.canUseClaude, onclick: ev => {
        if (!confirm('Look for pictures?\n\nThis sends the script and your source text to Claude to decide where pictures help, then visits the websites of the companies it names. Nothing appears in the video until you approve it.')) return;
        ev.target.disabled = true; run(api.post(`/api/shorts/${id}/visuals`, { confirmLlm: true, confirmBrowse: browse, confirmStock: stock, confirmRights: rights }));
      } }, icon('search', 16), v ? 'Look again' : 'Look for logos and footage')));
    const approve = async (beat, kind, index, approved) => { try { await api.put(`/api/shorts/${id}/visuals`, { approvals: [{ beat, kind, index, approved }] }); await reload(); } catch (e) { toast(e.message, 'bad'); } };
    const tile = (src, caption, checked, status, onchange, warn) => h('div', { class: 'card pad', style: { width: '210px', background: 'var(--bg2)' } },
      src ? h('div', { style: { background: 'repeating-conic-gradient(#8884 0 25%, #0000 0 50%) 50% / 16px 16px', borderRadius: '8px', height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h('img', { src, style: { maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' } })) : h('div', { class: 'muted small', style: { height: '110px', display: 'flex', alignItems: 'center' } }, status),
      h('div', { class: 'small mt-s' }, caption), warn ? h('div', { class: 'tiny', style: { color: 'var(--warn, #d99a00)' } }, warn) : null,
      src ? h('label', { class: 'row small mt-s', style: { gap: '6px' } }, h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }), 'Use in the video') : null);
    const KIND = { hero: 'A glossy 3D card carrying the logo flies in from the depth, with orbiting rings, and the hook line builds below it.', layers: 'The items stack as 3D layers that float apart, each labelled with the beat\'s own words.', ring: 'The percentage is drawn as a 3D gauge that fills while the number counts up.' };
    const three = v?.scene3d ? [].concat(v.scene3d).map(s3 => h('div', { class: 'card pad mt-s', style: { background: 'var(--bg2)' } }, h('b', { class: 'small' }, `True 3D ${s3.kind} scene (three.js) · beat ${s3.beat}${s3.entity ? ` · ${s3.entity}` : ''}`), h('div', { class: 'small muted mt-s' }, `Chosen by the planner. ${KIND[s3.kind] || ''}`),
      s3.available ? h('label', { class: 'row small mt-s', style: { gap: '6px' } }, h('input', { type: 'checkbox', checked: s3.approved, onchange: e => approve(s3.beat, 'scene3d', 0, e.target.checked) }), `Use this 3D scene${s3.kind === 'hero' ? ' (the logo above must be approved too)' : ''}`) : h('div', { class: 'small', style: { color: 'var(--warn, #d99a00)' } }, s3.reason))) : null;
    const list = v ? h('div', { class: 'mt' }, ...(three || []), v.beats.length ? v.beats.map(b => h('div', { class: 'mt-s' }, h('div', { class: 'small muted' }, `Beat ${b.beat}: ${st.script.beats[b.beat - 1]?.say.replace(/\[[^\]]*\]/g, '').trim().slice(0, 70) || ''}`),
      h('div', { class: 'row wrap mt-s', style: { gap: '10px' } },
        b.logos.map((l, i) => tile(l.file ? `/api/shorts/${id}/file?p=${encodeURIComponent(l.file)}` : null, `${l.name} logo · ${l.domain}`, l.approved, l.reason || l.status, ok => approve(b.beat, 'logo', i, ok), l.provenance?.warning)),
        b.broll ? tile(b.broll.preview ? `/api/shorts/${id}/file?p=${encodeURIComponent(b.broll.preview)}` : null, `Footage "${b.broll.query}"${b.broll.source ? ` · ${b.broll.source}` : ''}${b.broll.creator ? ` · ${b.broll.creator}` : ''}`, b.broll.approved, b.broll.status === 'not-searched' ? 'Not searched' : b.broll.status === 'no-result' ? 'No footage found' : b.broll.error || b.broll.status, ok => approve(b.beat, 'broll', 0, ok)) : null))) : h('div', { class: 'muted small' }, 'Nothing in the script called for a logo or footage.'),
      h('div', { class: 'small faint mt-s' }, 'Logos are trademarks of their owners: they are shown only to identify the company, and you should check the brand\'s usage guidelines before publishing. Stock footage keeps its credit in the production notes. Re-record or re-plan after changing approvals.'),
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn ghost sm', onclick: async () => { try { await api.put(`/api/shorts/${id}/visuals`, { approveAll: true }); await reload(); } catch (e) { toast(e.message, 'bad'); } } }, 'Approve everything fetched'))) : null;
    mount(box, h('h3', {}, '3. Pictures (logos, footage, depth)'), h('p', { class: 'muted small' }, 'A researcher finds the logos of the companies your script names (taken from their own websites with a browser) and, if you ask, stock footage for scenes that benefit. The planner also decides where a true 3D scene explains an idea better (a logo card, a stack of layers, a gauge). Approved logos fly in as 3D badges; approved footage becomes the scene\'s background with the graphic on a panel above it.'), find, list);
    return box;
  };

  const voiceCard = () => {
    const box = h('div', { class: 'card pad' });
    const d = st.direction;
    if (!scriptDraft || !d) { mount(box, h('h3', {}, '4. Record the voice'), h('p', { class: 'muted small' }, 'Approve the direction first.')); return box; }
    const rec = h('button', { class: 'btn', disabled: !cfg.elevenlabs.hasKey || !d.approved, onclick: ev => {
      if (!confirm(`Record the voice with ElevenLabs?\n\nVoice: ${d.voiceName || d.voiceId}, model ${d.modelId}.\nThis uses about ${st.estimate.characters} characters of your ElevenLabs credits (recordings you have already made are reused and cost nothing).`)) return;
      ev.target.disabled = true; run(api.post(`/api/shorts/${id}/audio`, { confirmSpend: true }));
    } }, icon('music', 16), 'Record the voice and plan the video');
    const players = st.beatAudio ? h('div', { class: 'col mt-s', style: { gap: '8px' } }, h('div', { class: 'small muted' }, 'Listen to each beat before you build:'), st.script.beats.map((b, i) => h('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } }, h('span', { class: 'faint tiny', style: { width: '58px' } }, `Beat ${i + 1}`), h('audio', { controls: true, preload: 'none', style: { height: '32px' }, src: `/api/shorts/${id}/file?p=${encodeURIComponent(st.beatAudio[i])}` }), h('span', { class: 'small muted', style: { flex: 1 } }, b.say.slice(0, 80))))) : null;
    mount(box, h('h3', {}, '4. Record the voice'),
      h('p', { class: 'muted small' }, cfg.elevenlabs.hasKey ? 'Recording uses your ElevenLabs credits. Each beat is recorded once and kept, so editing one beat only re-records that beat.' : 'ELEVENLABS_API_KEY is not set, so recording is not available.'),
      h('div', { class: 'row mt-s' }, rec, h('span', { class: 'small muted' }, `${d.voiceName || d.voiceId} · ${d.modelId} · ${st.estimate.characters} characters, about ${st.estimate.seconds} s of speech${d.approved ? '' : ' · approve the direction first'}`)), players);
    return box;
  };

  const buildCard = () => {
    const box = h('div', { class: 'card pad' }, h('h3', {}, '5. Build the video'));
    if (!st.files.plan) { mount(box, h('h3', {}, '5. Build the video'), h('p', { class: 'muted small' }, 'Record the voice first: the plan is made from the recording so every scene lasts as long as its narration.')); return box; }
    let quality = 'draft', ok = false;
    const btn = h('button', { class: 'btn', disabled: true, onclick: ev => { ev.target.disabled = true; run(api.post(`/api/shorts/${id}/build`, { approve: true, quality })); } }, icon('film', 16), 'Build the video');
    const video = st.files.video ? h('div', { class: 'mt' }, h('video', { controls: true, style: { maxHeight: '560px', borderRadius: '12px', background: '#000' }, src: `/api/shorts/${id}/file?p=build/final.mp4&t=${Date.now()}` }),
      h('div', { class: 'row mt-s' }, h('a', { class: 'btn ghost sm', href: `/api/shorts/${id}/file?p=build/final.mp4`, download: `${st.title}.mp4` }, icon('download', 14), 'Download the video'), st.files.contactSheet ? h('a', { class: 'btn ghost sm', href: `/api/shorts/${id}/file?p=build/contact-sheet.png`, target: '_blank', rel: 'noopener' }, 'Contact sheet') : null,
        h('a', { class: 'btn ghost sm', href: `/api/shorts/${id}/file?p=build/REVIEW.txt`, target: '_blank', rel: 'noopener' }, 'Review notes')), h('div', { class: 'muted small mt-s' }, 'Watch it end to end before you publish. The narration is ElevenLabs text to speech: commercial use needs a paid ElevenLabs plan.')) : null;
    mount(box, h('h3', {}, '5. Build the video'),
      h('p', { class: 'muted small' }, 'A vertical 1080x1920 video: one scene per beat, timed to the narration, with word-timed captions, music-ready ducking and quiet sound effects. Your approval is recorded in the Approvals history.'),
      h('div', { class: 'row', style: { gap: '14px' } }, field('Quality', select(['draft', 'final'], quality, v => { quality = v; }), 'Draft is faster; final is the full quality encode.')),
      h('label', { class: 'row small mt-s', style: { gap: '8px' } }, h('input', { type: 'checkbox', onchange: e => { ok = e.target.checked; btn.disabled = !ok; } }), 'I have read the script, listened to the voice and checked the plan.'),
      h('div', { class: 'row mt-s' }, btn), video);
    return box;
  };

  // The pipeline: agents that react to events through a queue, a reviewer for every stage, the go-aheads they wait for, and your feedback.
  const pipelineBox = h('div', {});
  let pl = null, pollTimer = null;
  const STAGES = [['script', 'Script'], ['direction', 'Direction'], ['visuals', 'Pictures'], ['audio', 'Narration'], ['plan', 'Plan'], ['render', 'Finished video']];
  const GATE_TEXT = { llm: 'Send text to Claude (scripts, reviews, planning)', browse: 'Let a browser visit company websites for logos', stock: 'Search and download stock footage (accept the provider licence)', spend: 'Spend ElevenLabs credits to record the voice', direction: 'Approve the direction (voice, delivery, look)', visuals: 'Approve the pictures', audio: 'I have listened to the narration', plan: 'Approve the plan and build' };
  const loadPipeline = async () => { try { pl = await api.get(`/api/shorts/${id}/pipeline`); } catch { pl = null; } drawPipeline(); if (pl?.status === 'working') { clearTimeout(pollTimer); pollTimer = setTimeout(async () => { await loadPipeline(); if (pl?.status !== 'working') await reload(); }, 3000); timers.push(pollTimer); } };
  const drawPipeline = () => {
    if (!pl) return mount(pipelineBox, h('div', { class: 'card pad' }, h('h3', {}, 'Pipeline'), h('p', { class: 'muted small' }, 'Not available.')));
    const started = pl.jobs.length > 0;
    const who = handler => (pl.agents?.[handler] ? `${pl.agents[handler].person} · ${pl.agents[handler].role}` : handler || '(recorded)');
    const team = h('details', { class: 'mt-s' }, h('summary', { class: 'small muted' }, `The team: ${Object.keys(pl.agents || {}).length} agents on ${pl.model || 'Claude'}`),
      h('div', { class: 'row wrap mt-s', style: { gap: '8px' } }, Object.entries(pl.agents || {}).map(([k, a]) => { const busy = pl.jobs.some(j => j.handler === k && j.status === 'running'), wait = pl.waiting.some(w => w.handler === k); return h('span', { class: `chip ${busy ? 'info' : wait ? 'warn' : ''}`, title: `${a.role}: named for ${a.person}, who ${a.craft}` }, h('b', {}, a.person), ` · ${a.role}${busy ? ' (working)' : wait ? ' (waiting for you)' : ''}`); })));
    const stat = { idle: ['Not started', ''], working: ['Working…', 'info'], waiting: ['Waiting for you', 'warn'], failed: ['A step failed', 'bad'], 'needs-you': ['Needs your decision', 'warn'], complete: ['Complete', 'good'] }[pl.status] || [pl.status, ''];
    const head = h('div', { class: 'row between' }, h('h3', {}, 'Pipeline: agents, reviewers and what they learn'), h('span', { class: `chip ${stat[1]}` }, stat[0]));
    let allowLlm = true, allowBrowse = true, allowStock = false, rights = false, allowSpend = false, maxChars = 3000;
    const startPanel = !started ? h('div', { class: 'mt-s' },
      h('p', { class: 'muted small' }, 'Each agent reacts to the one before it, and an independent reviewer checks every stage (script, direction, pictures, narration, plan, finished video). A reviewer that finds a problem sends it back to the agent that made it with exactly what to fix; after three rounds it comes to you. Recurring problems become lessons the agents read next time (see Lessons). It is slow on purpose: nothing is rushed, and 3D pages take as long as they take. Choose what it may do; it asks again for anything you leave out.'),
      h('div', { class: 'col', style: { gap: '8px' } },
        h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: e => { allowLlm = e.target.checked; } }), GATE_TEXT.llm),
        h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: e => { allowBrowse = e.target.checked; } }), GATE_TEXT.browse),
        h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', onchange: e => { allowStock = e.target.checked; } }), GATE_TEXT.stock.split(' (')[0]),
        h('label', { class: 'row small', style: { gap: '8px', marginLeft: '24px' } }, h('input', { type: 'checkbox', onchange: e => { rights = e.target.checked; } }), 'I accept the stock provider\'s licence for the footage that is downloaded'),
        h('label', { class: 'row small', style: { gap: '8px' } }, h('input', { type: 'checkbox', onchange: e => { allowSpend = e.target.checked; } }), `${GATE_TEXT.spend}, at most `, h('input', { class: 'input', type: 'number', value: 3000, min: 100, max: 20000, style: { width: '90px' }, oninput: e => { maxChars = Number(e.target.value) || 3000; } }), ' characters')),
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', disabled: !cfg.canUseClaude, onclick: async ev => { ev.target.disabled = true; try { pl = await api.post(`/api/shorts/${id}/pipeline/start`, { confirmLlm: allowLlm, confirmBrowse: allowBrowse, confirmStock: allowStock, confirmRights: rights, confirmSpend: allowSpend, maxChars }); toast('Pipeline started', 'good'); await loadPipeline(); } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; } } }, icon('play', 16), 'Start the pipeline'))) : null;
    const waiting = pl.waiting.length ? h('div', { class: 'mt-s' }, h('div', { class: 'hint warn' }, icon('alert', 18), 'Waiting for you:'), pl.waiting.map(w => h('div', { class: 'row mt-s', style: { gap: '10px', flexWrap: 'wrap' } }, h('b', { class: 'small' }, `${who(w.handler)} is waiting: ${GATE_TEXT[w.wait_gate] || w.wait_gate}`), w.wait_note ? h('span', { class: 'faint small' }, w.wait_note) : null,
      h('button', { class: 'btn sm', onclick: async ev => {
        const gate = w.wait_gate; const body = { gate };
        if (gate === 'llm') { if (!confirm('Send your text to Claude?')) return; body.confirm = true; }
        else if (gate === 'browse') { if (!confirm('Let a browser visit the websites of the companies named in the script?')) return; body.confirm = true; }
        else if (gate === 'stock') { if (!confirm('Search and download stock footage, and accept the provider\'s licence for it?')) return; body.confirm = true; body.confirmRights = true; }
        else if (gate === 'spend') { const n = prompt('Allow ElevenLabs credits to be spent. At most how many characters?', '3000'); if (!n) return; body.confirm = true; body.maxChars = Number(n); }
        else if (gate === 'plan') { body.quality = confirm('Build the final quality? (Cancel builds a faster draft.)') ? 'final' : 'draft'; }
        ev.target.disabled = true; try { pl = await api.post(`/api/shorts/${id}/pipeline/gate`, body); await reload(); await loadPipeline(); } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; }
      } }, 'Go ahead')))) : null;
    const resumeNote = h('textarea', { class: 'textarea', rows: 2, style: { width: '100%' }, placeholder: 'Optional: what should the agents do now? (sent with the findings)' });
    const needs = pl.needsYou ? h('div', { class: 'mt-s' }, h('div', { class: 'hint bad' }, icon('alert', 18), `${pl.needsYou.stage}: ${pl.needsYou.reason || 'needs your decision'}. ${(pl.needsYou.findings || []).slice(0, 4).map(f => f.message).join(' · ')}`),
      h('div', { class: 'mt-s' }, resumeNote, h('div', { class: 'row mt-s' }, h('button', { class: 'btn sm', onclick: async ev => { ev.target.disabled = true; try { await api.post(`/api/shorts/${id}/pipeline/resume`, { note: resumeNote.value }); toast('The agents are trying again', 'good'); await loadPipeline(); } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; } } }, 'Let them try again with these findings')))) : null;
    const stageRows = pl.reviews.length ? h('div', { class: 'mt-s' }, STAGES.map(([key, label]) => {
      const rs = pl.reviews.filter(r => r.stage === key); if (!rs.length) return null;
      const last = rs.at(-1), tone = last.verdict === 'approve' ? 'good' : 'warn';
      const fb = h('textarea', { class: 'textarea', rows: 2, style: { width: '100%' }, placeholder: 'What should this agent do differently next time? (it becomes a lesson)' });
      return h('details', { class: 'card pad mt-s', open: last.verdict !== 'approve' }, h('summary', {}, h('span', { class: 'row', style: { gap: '8px', display: 'inline-flex' } }, h('b', {}, label), h('span', { class: `chip ${tone}` }, `${last.verdict === 'approve' ? 'Approved' : 'Sent back'} · round ${last.round}`), h('span', { class: 'faint small' }, `${rs.length} review${rs.length === 1 ? '' : 's'} by ${who(pl.reviewerOf?.[key])}`))),
        rs.map(r => h('div', { class: 'mt-s' }, h('div', { class: 'small muted' }, `Round ${r.round} · ${pl.agents?.[pl.reviewerOf?.[key]]?.person || r.reviewer} (${r.reviewer === 'code+claude' ? 'checks and Claude' : 'checks'}) · ${r.verdict === 'approve' ? 'approved' : 'sent back'}${r.metrics?.lufs != null ? ` · ${r.metrics.lufs} LUFS` : ''}`),
          r.findings.length ? r.findings.map(f => h('div', { class: 'row small', style: { gap: '8px', alignItems: 'flex-start' } }, h('span', { class: `chip ${f.severity === 'minor' ? '' : 'warn'}` }, f.severity), h('span', { style: { flex: 1 } }, f.message, f.suggestion ? h('span', { class: 'faint' }, ` — ${f.suggestion}`) : null),
            h('button', { class: 'btn ghost sm', title: 'The reviewer was wrong about this', onclick: async () => { try { await api.post(`/api/shorts/${id}/pipeline/feedback`, { stage: key, kind: 'dispute', code: f.code }); toast('Noted: the reviewer will weigh this less', 'good'); } catch (e) { toast(e.message, 'bad'); } } }, 'Wrong?'))) : h('div', { class: 'small faint' }, 'No problems found.'))),
        h('div', { class: 'mt-s' }, fb, h('div', { class: 'row mt-s' }, h('button', { class: 'btn ghost sm', onclick: async () => { try { const r = await api.post(`/api/shorts/${id}/pipeline/feedback`, { stage: key, kind: 'note', text: fb.value }); toast(r.lesson ? 'Saved as a lesson' : 'Saved as feedback', 'good'); fb.value = ''; } catch (e) { toast(e.message, 'bad'); } } }, 'Send feedback'))));
    })) : null;
    const queueLines = started ? h('details', { class: 'mt-s' }, h('summary', { class: 'small muted' }, `The queue (${pl.jobs.length} events; ${Object.entries(pl.counts).map(([k, v]) => `${v} ${k}`).join(', ')})`),
      h('div', { class: 'mono small mt-s', style: { maxHeight: '260px', overflow: 'auto' } }, pl.jobs.map(j => h('div', {}, `#${j.id} ${j.status.padEnd(8)} ${who(j.handler)} ← ${j.type}${j.gate ? ` [waiting: ${j.gate}]` : ''}${j.attempts > 1 ? ` (attempt ${j.attempts})` : ''}${j.error ? ` ! ${String(j.error).slice(0, 120)}` : ''}`))),
      pl.counts.dead ? h('div', { class: 'row mt-s' }, h('button', { class: 'btn ghost sm', onclick: async () => { await api.post(`/api/shorts/${id}/pipeline/retry`, {}); await loadPipeline(); } }, 'Retry the failed steps')) : null) : null;
    mount(pipelineBox, h('div', { class: 'card pad' }, head, team, startPanel, waiting, needs, stageRows, queueLines, h('div', { class: 'small faint mt-s' }, h('a', { href: '#/lessons' }, 'See what the studio has learned'))));
  };

  const draw = () => mount(root, sourceCard(), h('div', { class: 'mt' }, pipelineBox), h('div', { class: 'mt' }, scriptCard()), h('div', { class: 'mt' }, directionCard()), h('div', { class: 'mt' }, visualsCard()), h('div', { class: 'mt' }, voiceCard()), h('div', { class: 'mt' }, buildCard()), jobBox);
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Short ', h('em', { class: 'serif' }, 'studio')), h('p', {}, 'Script, voice, video. Nothing is sent, spent or approved until you say so.'))), root);
  draw();
  await loadPipeline();
  if (st.job?.status === 'running') run(Promise.resolve({ jobId: st.job.id }));
}
