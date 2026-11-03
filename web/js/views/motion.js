import { h, mount, icon, toast } from '../ui.js';
import { api } from '../api.js';

// Motion studio: preview any built-in template, plan a standalone video from beats, and manage the 3D/animation libraries.
// The studio plans and previews; building and approving stay explicit steps (shown as commands to copy).
const TABS = [['templates', 'Templates and effects'], ['video', 'Standalone video'], ['libs', 'Libraries and 3D']];
const SAFE_BEATS = ['title', 'bullets', 'spring-stack', 'glass-focus', 'quote', 'search-results', 'tabs-panels', 'perspective-layers'];
const pretty = value => JSON.stringify(value, null, 2);

export async function renderMotion(view, ctx, tab = 'templates') {
  if (!TABS.some(([k]) => k === tab)) tab = 'templates';
  const data = await api.motion();
  const body = h('div', { class: 'mt' });
  const tabs = h('div', { class: 'seg' }, TABS.map(([k, label]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { location.hash = `#/motion/${k}`; } }, label)));
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Motion ', h('em', { class: 'serif' }, 'studio')),
    h('p', {}, 'Preview the built-in graphics, plan a standalone video from a brief, and add 3D and animation libraries on request. Nothing is built, approved or downloaded without your say-so.'))), tabs, body);
  const urls = [];
  const track = u => { urls.push(u); return u; };
  if (tab === 'templates') templatesTab(body, data, track);
  else if (tab === 'video') videoTab(body, data);
  else libsTab(body, data, track, () => renderMotion(view, ctx, 'libs'));
  return () => urls.forEach(u => URL.revokeObjectURL(u));
}

// ---------------------------------------------------------------- templates
function templatesTab(body, data, track) {
  let current = data.templates.find(t => t.effect) || data.templates[0];
  let at = 2.5, theme = 'night';
  const img = h('img', { alt: 'Template preview', style: { width: '100%', borderRadius: '12px', background: 'var(--bg2)', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' } });
  const status = h('div', { class: 'muted small mt-s' });
  const props = h('textarea', { class: 'textarea', rows: 14, spellcheck: false, style: { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '12.5px' } });
  const info = h('div', {});
  const list = h('div', { class: 'col', style: { gap: '4px' } });
  let busy = 0;
  const draw = () => {
    mount(list, h('div', { class: 'faint tiny' }, 'EFFECTS'), data.templates.filter(t => t.effect).map(item), h('div', { class: 'faint tiny mt-s' }, 'CORE TEMPLATES'), data.templates.filter(t => !t.effect).map(item));
    mount(info, h('h3', {}, current.name), h('p', { class: 'muted small' }, current.description), h('div', { class: 'faint tiny' }, 'Props'), h('div', { class: 'small mono', style: { lineHeight: 1.6 } }, Object.entries(current.props).map(([k, v]) => h('div', {}, `${k}: ${v}`))));
    props.value = current.example ? pretty(current.example) : '{}';
  };
  const item = t => h('button', { class: `btn sm ${t.name === current.name ? '' : 'ghost'}`, style: { justifyContent: 'flex-start' }, onclick: () => { current = t; draw(); preview(); } }, t.name);
  async function preview() {
    const mine = ++busy;
    let parsed;
    try { parsed = JSON.parse(props.value || '{}'); } catch { status.textContent = 'The props are not valid JSON.'; status.className = 'small mt-s'; status.style.color = 'var(--bad, #e5484d)'; return; }
    status.textContent = 'Rendering…'; status.style.color = '';
    try {
      const url = await api.still(`/api/motion/preview?template=${encodeURIComponent(current.name)}&props=${encodeURIComponent(JSON.stringify(parsed))}&at=${at}&theme=${theme}`);
      if (mine !== busy) return URL.revokeObjectURL(url);
      img.src = track(url); status.textContent = `${current.name} at ${at.toFixed(1)} s`;
    } catch (error) { if (mine === busy) { status.textContent = error.message; status.style.color = 'var(--bad, #e5484d)'; } }
  }
  const slider = h('input', { type: 'range', min: 0, max: 8, step: 0.1, value: at, style: { width: '100%' }, onchange: e => { at = Number(e.target.value); preview(); } });
  const themeSeg = h('div', { class: 'seg' });
  const drawTheme = () => mount(themeSeg, ['night', 'paper'].map(k => h('button', { class: k === theme ? 'on' : '', onclick: () => { theme = k; drawTheme(); preview(); } }, k)));
  drawTheme(); draw();
  mount(body, h('div', { class: 'grid', style: { gridTemplateColumns: '200px minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' } },
    h('div', { class: 'card pad' }, list),
    h('div', { class: 'col' }, h('div', { class: 'card pad' }, img, status, h('div', { class: 'row between mt-s' }, h('span', { class: 'small muted' }, 'Moment in the animation'), themeSeg), slider)),
    h('div', { class: 'col' }, h('div', { class: 'card pad' }, info), h('div', { class: 'card pad' }, h('label', { class: 'field' }, h('span', {}, 'Props (JSON)'), props),
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', onclick: preview }, icon('render', 16), 'Preview'),
        h('button', { class: 'btn ghost', onclick: () => { props.value = current.example ? pretty(current.example) : '{}'; preview(); } }, 'Reset to example'))))));
  preview();
}

// ---------------------------------------------------------------- standalone video
function videoTab(body, data) {
  const state = { type: 'milestone', title: '', aspect: '16:9', sfx: 'subtle', beats: [], music: { file: '', rights: '', attribution: '', gainDb: -18 }, facts: '', output: '' };
  const usable = data.templates.filter(t => !['captions', 'progress-bar', 'callout'].includes(t.name));
  const exampleOf = name => (data.templates.find(t => t.name === name)?.example) || {};
  const starter = type => {
    const spec = data.types[type], n = spec.beats[0], beats = [];
    if (type === 'chart') return [{ say: 'The change, then the number.', show: 'chart-morph', props: exampleOf('chart-morph'), seconds: 6 }];
    for (let i = 0; i < n; i++) { const name = i === 0 ? 'title' : i === n - 1 ? 'quote' : SAFE_BEATS[(i * 3) % SAFE_BEATS.length]; beats.push({ say: i === 0 ? 'The one-line promise.' : i === n - 1 ? 'The close.' : `Beat ${i + 1}.`, show: name, props: exampleOf(name), seconds: i === n - 1 ? 3.5 : 4 }); }
    return beats;
  };
  state.beats = starter(state.type);
  const result = h('div', {});
  const form = h('div', { class: 'col' });
  const draw = () => {
    const spec = data.types[state.type];
    mount(form,
      h('div', { class: 'card pad' }, h('h3', {}, 'The piece'),
        h('div', { class: 'grid g2 mt-s' },
          h('label', { class: 'field' }, h('span', {}, 'Format'), h('select', { class: 'select', onchange: e => { state.type = e.target.value; state.beats = starter(state.type); draw(); } }, Object.keys(data.types).map(k => h('option', { value: k, selected: k === state.type }, k)))),
          h('label', { class: 'field' }, h('span', {}, 'Title'), h('input', { class: 'input', value: state.title, placeholder: 'Shown in the manifest and credits', oninput: e => { state.title = e.target.value; } })),
          h('label', { class: 'field' }, h('span', {}, 'Shape'), h('select', { class: 'select', onchange: e => { state.aspect = e.target.value; } }, [['16:9', 'Landscape 1920x1080'], ['9:16', 'Reel 1080x1920'], ['1:1', 'Square 1080x1080'], ['4:5', 'Feed 1080x1350']].map(([v, l]) => h('option', { value: v, selected: v === state.aspect }, l)))),
          h('label', { class: 'field' }, h('span', {}, 'Sound effects'), h('select', { class: 'select', onchange: e => { state.sfx = e.target.value; } }, ['subtle', 'off', 'full'].map(v => h('option', { value: v, selected: v === state.sfx }, v))))),
        h('div', { class: 'hint mt-s' }, icon('info', 16), `${spec.about[0].toUpperCase()}${spec.about.slice(1)}. ${spec.beats[0]}-${spec.beats[1]} beats, ${spec.seconds[0]}-${spec.seconds[1]} s, last beat held at least ${spec.hold} s. ${spec.hook}.`)),
      h('div', { class: 'card pad' }, h('div', { class: 'row between' }, h('h3', {}, 'Beats'), h('button', { class: 'btn sm', onclick: () => { state.beats.push({ say: '', show: 'bullets', props: exampleOf('bullets'), seconds: 4 }); draw(); } }, icon('plus', 14), 'Add beat')),
        state.beats.map((b, i) => beatCard(b, i))),
      h('div', { class: 'card pad' }, h('h3', {}, 'Facts and music'),
        h('p', { class: 'muted small' }, 'Numbers on screen need a fact list with a source for each fact. Without one the plan is refused (sample data: use chart-morph with "illustrative": true).'),
        h('label', { class: 'field' }, h('span', {}, 'Fact list (JSON)'), h('textarea', { class: 'textarea', rows: 5, spellcheck: false, placeholder: '{ "facts": [ { "text": "The community reached 10,000 members", "source": "membership count, 2026-11-01" } ] }', oninput: e => { state.facts = e.target.value; } }, state.facts)),
        h('div', { class: 'grid g2 mt-s' }, ['file', 'rights', 'attribution'].map(k => h('label', { class: 'field' }, h('span', {}, `Music ${k}`), h('input', { class: 'input', value: state.music[k], placeholder: k === 'file' ? 'Full path to licensed audio (optional)' : 'Required if a music file is given', oninput: e => { state.music[k] = e.target.value; } }))))),
      h('div', { class: 'card pad' }, h('h3', {}, 'Create the plan'),
        h('label', { class: 'field' }, h('span', {}, 'New folder (full path)'), h('input', { class: 'input', placeholder: '/Users/you/Videos/ten-thousand', value: state.output, oninput: e => { state.output = e.target.value; } })),
        h('div', { class: 'row mt-s' }, h('button', { class: 'btn ghost', onclick: check }, 'Check the brief'), h('button', { class: 'btn', onclick: plan }, icon('film', 16), 'Create plan'))));
  };
  const beatCard = (b, i) => {
    const propsBox = h('textarea', { class: 'textarea', rows: 6, spellcheck: false, style: { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '12px' }, oninput: e => { try { b.props = JSON.parse(e.target.value); e.target.style.borderColor = ''; } catch { e.target.style.borderColor = 'var(--bad, #e5484d)'; } } }, pretty(b.props || {}));
    return h('div', { class: 'card pad mt-s', style: { background: 'var(--bg2)' } },
      h('div', { class: 'row between' }, h('b', {}, `Beat ${i + 1}`), h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', title: 'Move up', disabled: i === 0, onclick: () => { [state.beats[i - 1], state.beats[i]] = [state.beats[i], state.beats[i - 1]]; draw(); } }, icon('up', 14)),
        h('button', { class: 'btn ghost sm', title: 'Remove', onclick: () => { state.beats.splice(i, 1); draw(); } }, icon('trash', 14)))),
      h('div', { class: 'grid g2 mt-s' },
        h('label', { class: 'field' }, h('span', {}, 'What is said or meant'), h('input', { class: 'input', value: b.say || '', oninput: e => { b.say = e.target.value; } })),
        h('div', { class: 'grid g2' },
          h('label', { class: 'field' }, h('span', {}, 'Template'), h('select', { class: 'select', onchange: e => { b.show = e.target.value; b.props = exampleOf(b.show); draw(); } }, usable.map(t => h('option', { value: t.name, selected: t.name === b.show }, t.name)))),
          h('label', { class: 'field' }, h('span', {}, 'Seconds'), h('input', { class: 'input', type: 'number', min: 1.5, max: 20, step: 0.5, value: b.seconds, oninput: e => { b.seconds = Number(e.target.value); } })))),
      h('label', { class: 'field mt-s' }, h('span', {}, 'Props (JSON)'), propsBox));
  };
  const brief = () => {
    const out = { type: state.type, title: state.title || 'Untitled', aspect: state.aspect, beats: state.beats.map(b => ({ say: b.say || undefined, show: b.show, props: b.props, seconds: b.seconds })) };
    if (state.music.file) out.music = { ...state.music, gainDb: Number(state.music.gainDb) };
    return out;
  };
  async function check() {
    try {
      const r = await api.checkBrief(brief());
      mount(result, h('div', { class: `card pad ${r.errors.length ? '' : ''}` }, h('h3', {}, r.errors.length ? 'The brief needs changes' : `The brief passes (${r.total} s)`),
        r.errors.map(e => h('div', { class: 'row small', style: { color: 'var(--bad, #e5484d)', gap: '8px' } }, icon('alert', 14), e)), r.warnings.map(w => h('div', { class: 'row small muted', style: { gap: '8px' } }, icon('info', 14), w))));
    } catch (error) { toast(error.message, 'bad'); }
  }
  async function plan() {
    try {
      const r = await api.planVideo({ brief: brief(), output: state.output.trim(), facts: state.facts.trim() || undefined, sfx: state.sfx });
      mount(result, h('div', { class: 'card pad' }, h('h3', {}, 'Plan created'),
        h('p', { class: 'small' }, `${r.scenes} graphic scenes, ${r.seconds} s, ${r.width}x${r.height}${r.sfx ? `, ${r.sfx} sound cues` : ''}${r.facts ? `, facts-check OK (${r.facts.checked} numbers)` : ''}.`),
        h('div', { class: 'mono small', style: { wordBreak: 'break-all' } }, r.output), (r.warnings || []).map(w => h('div', { class: 'small muted' }, `warning: ${w}`)),
        h('p', { class: 'muted small mt-s' }, 'Nothing is built or approved yet. Read the plan, then run these (the first one records your approval):'),
        r.next.map(c => h('div', { class: 'row mt-s' }, h('code', { class: 'mono small', style: { flex: 1, wordBreak: 'break-all' } }, c), h('button', { class: 'btn ghost sm', onclick: async () => { try { await navigator.clipboard.writeText(c); toast('Copied', 'good'); } catch { toast('Copy failed', 'bad'); } } }, icon('copy', 14))))));
      toast('Plan created', 'good');
    } catch (error) { toast(error.message, 'bad'); mount(result, h('div', { class: 'hint bad' }, error.message)); }
  }
  draw();
  mount(body, h('div', { class: 'col' }, form, result));
}

// ---------------------------------------------------------------- libraries
function libsTab(body, data, track, reload) {
  const card = lib => {
    const have = lib.installed.length > 0;
    return h('div', { class: 'card pad rise' },
      h('div', { class: 'row between' }, h('h3', {}, lib.id), h('span', { class: `chip ${have ? 'good' : ''}` }, have ? `Installed ${lib.installed.map(i => i.version).join(', ')}` : 'Not installed')),
      h('div', { class: 'muted small mt-s' }, lib.use), h('div', { class: 'faint tiny mt-s' }, `Licence: ${lib.license}`),
      h('div', { class: 'row mt-s' }, have
        ? h('button', { class: 'btn ghost sm', onclick: async () => { if (!confirm(`Remove ${lib.id} from this computer? You can add it again later.`)) return; try { await api.removeLib(lib.id); toast(`${lib.id} removed`, 'good'); reload(); } catch (e) { toast(e.message, 'bad'); } } }, icon('trash', 14), 'Remove')
        : h('button', { class: 'btn sm', onclick: async ev => {
          if (!confirm(`Download ${lib.id} once from registry.npmjs.org?\n\nIt is checked against the registry's integrity hash and stored on this computer under its own licence (${lib.license}). Rendering stays offline.${lib.id === 'babylonjs' ? '\n\nThis one is large (about 8 MB).' : ''}`)) return;
          ev.target.disabled = true;
          try { const r = await api.addLib(lib.id, true); toast(`${r.id} ${r.version} installed`, 'good'); reload(); } catch (e) { toast(e.message, 'bad'); ev.target.disabled = false; } } }, icon('download', 14), 'Download')));
  };
  const starterCard = s => {
    const img = h('img', { alt: '', style: { width: '100%', borderRadius: '10px', display: 'none', aspectRatio: '16 / 9', objectFit: 'cover', marginTop: '10px' } });
    const msg = h('div', { class: 'small muted mt-s' });
    return h('div', { class: 'card pad rise' }, h('div', { class: 'row between' }, h('h3', {}, s.name), s.untested ? h('span', { class: 'chip warn' }, 'untested') : null),
      h('div', { class: 'muted small mt-s' }, s.description || 'A working starting point.'), h('div', { class: 'row wrap mt-s' }, s.libs.map(l => h('span', { class: 'chip' }, l))), img, msg,
      h('button', { class: 'btn ghost sm mt-s', onclick: async ev => { ev.target.disabled = true; msg.textContent = 'Rendering…'; try { img.src = track(await api.still(`/api/motion/starter-preview?name=${encodeURIComponent(s.name)}&at=3`)); img.style.display = 'block'; msg.textContent = ''; } catch (e) { msg.textContent = e.message; } ev.target.disabled = false; } }, icon('eye', 14), 'Preview'),
      h('div', { class: 'faint tiny mt-s mono' }, `assets/motion-starters/${s.name}.html`));
  };
  mount(body,
    h('div', { class: 'hint' }, icon('shield', 18), 'Nothing here is bundled with Video Monk. A library is downloaded only when you press Download, once, from registry.npmjs.org; it is verified against the registry hash and kept on your computer with its own licence.'),
    h('h2', { class: 'mt' }, 'Libraries'), h('div', { class: 'pgrid mt-s' }, data.libs.map(card)),
    h('h2', { class: 'mt' }, 'Starters'), h('p', { class: 'muted small' }, 'Working pages to copy and edit. Preview needs the library they use. Use one with `video-monk graphic --html` or as a beat in a standalone video.'),
    h('div', { class: 'pgrid mt-s' }, data.starters.map(starterCard)),
    h('h2', { class: 'mt' }, 'Researched, not included'),
    h('div', { class: 'card pad' }, Object.entries(data.unsupported).map(([k, v]) => h('div', { style: { padding: '9px 0', borderBottom: '1px solid var(--line)' } }, h('b', {}, k), h('div', { class: 'muted small' }, v)))));
}
