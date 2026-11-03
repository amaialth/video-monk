import { h, mount, icon, toast } from '../ui.js';
import { api } from '../api.js';

// Motion studio: preview any built-in template, plan a standalone video from beats, and manage the 3D/animation libraries.
// The studio plans and previews; building and approving stay explicit steps (shown as commands to copy).
const TABS = [['templates', 'Templates and effects'], ['video', 'Standalone video'], ['libs', 'Libraries and 3D'], ['zoom', 'Screen zoom'], ['catalog', 'Catalog']];
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
  else if (tab === 'zoom') zoomTab(body);
  else if (tab === 'catalog') await catalogTab(body, track);
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
  const state = { type: 'milestone', title: '', aspect: '16:9', sfx: 'subtle', current: 'left', beats: [], music: { file: '', rights: '', attribution: '', gainDb: -18 }, facts: '', output: '' };
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
          h('label', { class: 'field' }, h('span', {}, 'Direction of travel between beats'), h('select', { class: 'select', onchange: e => { state.current = e.target.value; } }, ['left', 'right', 'up', 'down'].map(v => h('option', { value: v, selected: v === state.current }, v)))),
          h('label', { class: 'field' }, h('span', {}, 'Sound effects'), h('select', { class: 'select', onchange: e => { state.sfx = e.target.value; } }, ['subtle', 'off', 'full'].map(v => h('option', { value: v, selected: v === state.sfx }, v))))),
        h('div', { class: 'hint mt-s' }, icon('info', 16), `${spec.about[0].toUpperCase()}${spec.about.slice(1)}. ${spec.beats[0]}-${spec.beats[1]} beats, ${spec.seconds[0]}-${spec.seconds[1]} s, last beat held at least ${spec.hold} s. ${spec.hook[0].toUpperCase()}${spec.hook.slice(1)}.`)),
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
          h('label', { class: 'field' }, h('span', {}, 'Template or 3D scene'), h('select', { class: 'select', onchange: e => { const v = e.target.value; if (v.startsWith('catalog:')) { b.catalog = v.slice(8); delete b.show; delete b.starter; delete b.assets; b.props = undefined; b.vars = {}; const c = data.imported.find(x => x.name === b.catalog); if (c?.duration) b.seconds = Math.ceil(c.duration); } else if (v.startsWith('starter:')) { b.starter = v.slice(8); delete b.show; delete b.catalog; delete b.vars; b.props = undefined; b.assets = {}; } else { b.show = v; delete b.starter; delete b.catalog; delete b.vars; delete b.assets; b.props = exampleOf(v); } draw(); } },
            h('optgroup', { label: 'Templates and effects' }, usable.map(t => h('option', { value: t.name, selected: t.name === b.show }, t.name))),
            data.imported?.length ? h('optgroup', { label: 'Imported catalog blocks' }, data.imported.map(c => h('option', { value: `catalog:${c.name}`, selected: c.name === b.catalog }, c.title || c.name))) : null,
            h('optgroup', { label: '3D and library scenes' }, data.starters.map(st => h('option', { value: `starter:${st.name}`, selected: st.name === b.starter && !b.catalog }, st.name))))),
          h('label', { class: 'field' }, h('span', {}, 'Seconds'), h('input', { class: 'input', type: 'number', min: 1.5, max: 20, step: 0.5, value: b.seconds, oninput: e => { b.seconds = Number(e.target.value); } })))),
      b.catalog ? catalogBody(b) : b.starter ? starterBody(b) : h('label', { class: 'field mt-s' }, h('span', {}, 'Props (JSON)'), propsBox));
  };
  const catalogBody = b => {
    const c = data.imported.find(x => x.name === b.catalog);
    const gsap = data.libs.find(l => l.id === 'gsap')?.installed.length > 0;
    return h('div', { class: 'mt-s' },
      h('div', { class: 'muted small' }, `${c?.title || b.catalog}: a HyperFrames catalog block (${c?.license || 'Apache-2.0'}), ${c?.width || '?'}x${c?.height || '?'}, ${c?.duration || '?'} s. It is copied into the plan folder with its licence header.`),
      h('div', { class: 'row wrap mt-s' }, h('span', { class: `chip ${gsap ? 'good' : 'warn'}` }, gsap ? 'gsap installed' : 'gsap: install it on the Libraries tab first')),
      (c?.variables || []).slice(0, 12).map(v => h('label', { class: 'field mt-s' }, h('span', {}, `${v.label || v.id} (${v.id})`), h('input', { class: 'input', value: (b.vars || {})[v.id] ?? '', placeholder: String(v.default ?? ''), oninput: e => { b.vars = { ...(b.vars || {}) }; if (e.target.value === '') delete b.vars[v.id]; else b.vars[v.id] = e.target.value; } }))));
  };
  const starterBody = b => {
    const info = data.starters.find(x => x.name === b.starter);
    const status = id => data.libs.find(l => l.id === id)?.installed.length > 0;
    return h('div', { class: 'mt-s' },
      h('div', { class: 'muted small' }, `${(info?.description || 'A 3D or library scene').replace(/\.$/, '')}. It is copied into the plan folder (scenes/) so you can edit it.`),
      h('div', { class: 'row wrap mt-s' }, (info?.libs || []).map(id => h('span', { class: `chip ${status(id) ? 'good' : 'warn'}` }, status(id) ? `${id} installed` : `${id}: install it on the Libraries tab first`)), info?.untested ? h('span', { class: 'chip warn' }, 'untested') : null),
      (info?.assets || []).map(name => h('label', { class: 'field mt-s' }, h('span', {}, `Your file for ${name} (full path)`), h('input', { class: 'input', value: (b.assets || {})[name] || '', placeholder: `/Users/you/${name}`, oninput: e => { b.assets = { ...(b.assets || {}), [name]: e.target.value }; } }))));
  };
  const brief = () => {
    const out = { type: state.type, title: state.title || 'Untitled', aspect: state.aspect, current: state.current, beats: state.beats.map(b => (b.catalog ? { say: b.say || undefined, catalog: b.catalog, vars: b.vars && Object.keys(b.vars).length ? b.vars : undefined, seconds: b.seconds } : b.starter ? { say: b.say || undefined, starter: b.starter, seconds: b.seconds, assets: b.assets && Object.keys(b.assets).length ? b.assets : undefined } : { say: b.say || undefined, show: b.show, props: b.props, seconds: b.seconds })) };
    if (state.music.file) out.music = { ...state.music, gainDb: Number(state.music.gainDb) };
    return out;
  };
  async function check() {
    try {
      const r = await api.checkBrief(brief());
      mount(result, h('div', { class: `card pad ${r.errors.length ? '' : ''}` }, h('h3', {}, r.errors.length ? 'The brief needs changes' : `The brief passes (${r.total} s)`),
        r.errors.map(e => h('div', { class: 'row small', style: { color: 'var(--bad, #e5484d)', gap: '8px' } }, icon('alert', 14), e)), r.warnings.map(w => h('div', { class: 'row small muted', style: { gap: '8px' } }, icon('info', 14), w)),
        (r.libs || []).map(l => h('div', { class: 'row small', style: { gap: '8px', color: l.installed ? '' : 'var(--bad, #e5484d)' } }, icon(l.installed ? 'check' : 'alert', 14), l.installed ? `Library ${l.id} ${l.version} is installed` : `Library ${l.id} is not installed: open the Libraries tab and download it (one time)`))));
    } catch (error) { toast(error.message, 'bad'); }
  }
  async function plan() {
    try {
      const r = await api.planVideo({ brief: brief(), output: state.output.trim(), facts: state.facts.trim() || undefined, sfx: state.sfx });
      mount(result, h('div', { class: 'card pad' }, h('h3', {}, 'Plan created'),
        h('p', { class: 'small' }, `${r.scenes} graphic scenes, ${r.seconds} s, ${r.width}x${r.height}${r.sfx ? `, ${r.sfx} sound cues` : ''}${r.facts ? `, facts-check OK (${r.facts.checked} numbers)` : ''}.`),
        h('div', { class: 'mono small', style: { wordBreak: 'break-all' } }, r.output), h('div', { class: 'small mt-s' }, r.libs?.length ? `Libraries used: ${r.libs.map(l => `${l.id} ${l.version}`).join(', ')}.` : 'Built-in templates only; no libraries needed.'),
        h('div', { class: 'small muted' }, 'The plan is written to PLAN.md in that folder (beats, libraries, facts, next steps).'), (r.warnings || []).map(w => h('div', { class: 'small muted' }, `warning: ${w}`)),
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

// ---------------------------------------------------------------- catalog
const STATUS_TEXT = { have: ['Built in', 'good'], adapt: ['Portable (untested)', ''], defer: ['Needs WebGPU', 'warn'], skip: ['Skipped', ''] };
// What was measured by importing every item and playing it in the offline renderer (see references/hyperframes-catalog.md)
const offlineKind = i => (i.offline ? (i.offline.import === 'skipped' ? 'skipped' : i.offline.import !== 'ok' ? 'refused' : i.offline.verified ? 'verified' : 'unverified') : 'unknown');
const OFFLINE_TEXT = { verified: ['Runs offline (verified)', 'good'], unverified: ['Imports; did not run cleanly', 'warn'], refused: ['Cannot run offline', ''], skipped: ['Skipped', ''], unknown: ['Not tested', ''] };
async function catalogTab(body, track) {
  const cat = await api.get('/api/motion/catalog');
  const f = { q: '', group: '', status: '', offline: '', top: false, limit: 60 };
  const groups = [...new Set(cat.items.map(i => i.group))].sort();
  const list = h('div', { class: 'col', style: { gap: '8px' } });
  const count = h('div', { class: 'muted small' });
  const imported = new Set(cat.imported || []);
  const importRow = i => {
    if (i.status === 'skip') return null;
    if (i.offline && i.offline.import !== 'ok') return h('div', { class: 'small muted mt-s' }, `Cannot be imported: ${i.offline.reason || 'it needs something that is not available offline'}`);
    const img = h('img', { alt: '', style: { width: '100%', maxWidth: '520px', borderRadius: '10px', display: 'none', marginTop: '10px', background: 'var(--bg2)' } });
    const msg = h('div', { class: 'small muted mt-s' });
    const row = h('div', { class: 'mt-s' });
    const draw1 = () => mount(row, h('div', { class: 'row', style: { gap: '8px' } },
      imported.has(i.name) ? [
        h('span', { class: 'chip good' }, 'Imported'),
        h('button', { class: 'btn ghost sm', onclick: async ev => { ev.target.disabled = true; msg.textContent = 'Rendering…'; try { img.src = track(await api.still(`/api/motion/catalog-preview?name=${encodeURIComponent(i.name)}&at=2`)); img.style.display = 'block'; msg.textContent = ''; } catch (e) { msg.textContent = e.message; } ev.target.disabled = false; } }, icon('eye', 14), 'Preview'),
        h('button', { class: 'btn ghost sm', onclick: async () => { if (!confirm(`Remove ${i.name} from this computer?`)) return; try { await api.post('/api/catalog/remove', { name: i.name }); imported.delete(i.name); img.style.display = 'none'; draw1(); } catch (e) { toast(e.message, 'bad'); } } }, icon('trash', 14), 'Remove')]
      : h('button', { class: 'btn sm', onclick: async ev => {
        if (!confirm(`Import ${i.title} (${i.name})?\n\nThis downloads the block once from github.com/heygen-com/hyperframes (a fixed commit, Apache-2.0), swaps its GSAP for your local copy, embeds its fonts and checks it can run offline. It needs the gsap library (Libraries tab).\n\nIt is third-party code. It runs only inside the offline renderer, but read it before you publish a video that uses it.`)) return;
        ev.target.disabled = true; msg.textContent = 'Downloading…';
        try { const r = await api.post('/api/catalog/import', { name: i.name, confirm: true }); imported.add(i.name); toast(`${r.title} imported`, 'good'); msg.textContent = (r.warnings || []).join(' '); draw1(); } catch (e) { msg.textContent = e.message; ev.target.disabled = false; } } }, icon('download', 14), 'Import'),
      i.type === 'block' ? null : null), img, msg);
    draw1();
    return row;
  };
  const draw = () => {
    const q = f.q.toLowerCase();
    const hits = cat.items.filter(i => (!f.group || i.group === f.group) && (!f.status || i.status === f.status) && (!f.offline || offlineKind(i) === f.offline) && (!f.top || i.top) && (!q || `${i.name} ${i.title} ${(i.tags || []).join(' ')} ${i.description || ''}`.toLowerCase().includes(q)));
    count.textContent = `${hits.length} of ${cat.count} items`;
    mount(list, hits.slice(0, f.limit).map(i => h('div', { class: 'card pad' },
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, i.title), ' ', h('span', { class: 'faint small mono' }, i.name)), h('div', { class: 'row' }, i.top ? h('span', { class: 'chip good' }, 'build next') : null, h('span', { class: `chip ${STATUS_TEXT[i.status][1]}` }, STATUS_TEXT[i.status][0]), h('span', { class: `chip ${OFFLINE_TEXT[offlineKind(i)][1]}`, title: i.offline?.reason || i.offline?.problem || '' }, OFFLINE_TEXT[offlineKind(i)][0]), h('span', { class: 'chip' }, i.group))),
      h('div', { class: 'muted small mt-s' }, i.why || i.description || ''),
      importRow(i),
      h('div', { class: 'row wrap mt-s small faint' }, (i.needs || []).map(n => h('span', { class: 'chip' }, n)), i.ours ? h('span', {}, i.status === 'have' ? `Built in as ${i.ours}` : `A new style for the ${i.ours} template`) : h('span', {}, i.note), h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer', style: { marginLeft: 'auto' } }, 'Catalog page ', icon('external', 12))))),
      hits.length > f.limit ? h('button', { class: 'btn ghost', onclick: () => { f.limit += 60; draw(); } }, `Show more (${hits.length - f.limit} left)`) : null);
  };
  mount(body,
    h('div', { class: 'hint' }, icon('info', 18), 'The HyperFrames catalog (HeyGen, Apache-2.0). Nothing is bundled: Import downloads one standalone block, once, after you confirm, and plays it offline. It is third-party code, so read it before you publish. "Build next" marks the highest-value gaps; see references/hyperframes-catalog.md.'),
    h('div', { class: 'row wrap mt', style: { gap: '10px' } },
      h('input', { class: 'input', placeholder: 'Search names, tags, descriptions', style: { maxWidth: '320px' }, oninput: e => { f.q = e.target.value; f.limit = 60; draw(); } }),
      h('select', { class: 'select', style: { maxWidth: '230px' }, onchange: e => { f.group = e.target.value; f.limit = 60; draw(); } }, h('option', { value: '' }, 'All groups'), groups.map(g => h('option', { value: g }, g))),
      h('select', { class: 'select', style: { maxWidth: '200px' }, onchange: e => { f.status = e.target.value; f.limit = 60; draw(); } }, h('option', { value: '' }, 'Any status'), Object.entries(STATUS_TEXT).map(([k, [t]]) => h('option', { value: k }, t))),
      h('select', { class: 'select', style: { maxWidth: '230px' }, onchange: e => { f.offline = e.target.value; f.limit = 60; draw(); } }, h('option', { value: '' }, 'Any offline result'), Object.entries(OFFLINE_TEXT).map(([k, [t]]) => h('option', { value: k }, t))),
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', onchange: e => { f.top = e.target.checked; f.limit = 60; draw(); } }), 'Build next only')),
    h('div', { class: 'mt-s' }, count), h('div', { class: 'mt-s' }, list));
  draw();
}

// ---------------------------------------------------------------- screen zoom
function zoomTab(body) {
  const st = { media: '', manifest: '', sensitivity: 1, found: null, keep: [], amount: 0.5, hold: 1.4 };
  const list = h('div', { class: 'col mt-s', style: { gap: '10px' } });
  const result = h('div', {});
  const status = h('div', { class: 'muted small mt-s' });
  const drawList = () => {
    if (!st.found) return mount(list);
    mount(list, st.found.length ? st.found.map((c, i) => h('div', { class: 'card pad', style: { opacity: st.keep[i] ? 1 : 0.45 } },
      h('div', { class: 'row between' }, h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: st.keep[i], onchange: e => { st.keep[i] = e.target.checked; drawList(); } }), h('b', {}, `${c.at.toFixed(1)} s`)), h('span', { class: 'faint small' }, `strength ${(c.strength * 100).toFixed(2)}%`)),
      h('div', { style: { position: 'relative', maxWidth: '480px', marginTop: '10px' } },
        h('img', { src: `/api/fs/thumb?path=${encodeURIComponent(st.media)}&t=${c.at}`, alt: '', style: { width: '100%', borderRadius: '10px', display: 'block', background: 'var(--bg2)' } }),
        h('div', { style: { position: 'absolute', left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: '34px', height: '34px', marginLeft: '-17px', marginTop: '-17px', border: '3px solid #ff3b6b', borderRadius: '50%', boxShadow: '0 0 0 2px rgba(255,255,255,.7)', pointerEvents: 'none' } })),
      h('div', { class: 'row mt-s', style: { gap: '8px' } }, ['x', 'y'].map(k => h('label', { class: 'row small', style: { gap: '6px' } }, k, h('input', { class: 'input', type: 'number', min: 0, max: 1, step: 0.01, value: c[k], style: { width: '84px' }, onchange: e => { c[k] = Math.min(1, Math.max(0, Number(e.target.value))); drawList(); } })))))) :
      h('div', { class: 'hint' }, icon('info', 16), 'Nothing started changing in a way worth zooming on. Try a higher sensitivity (up to about 1.3).'));
  };
  const detect = async ev => {
    ev.target.disabled = true; status.textContent = 'Looking at the recording…'; mount(result);
    try {
      const r = await api.post('/api/motion/focus/detect', { media: st.media.trim(), sensitivity: st.sensitivity });
      st.media = st.media.trim(); st.found = r.clicks; st.keep = r.clicks.map(() => true);
      status.textContent = `${r.clicks.length} candidate moment(s) in ${Math.round(r.seconds)} s. These come from screen activity, not recorded clicks.`;
      drawList();
    } catch (e) { status.textContent = e.message; st.found = null; drawList(); }
    ev.target.disabled = false;
  };
  const apply = async ev => {
    const chosen = (st.found || []).filter((_, i) => st.keep[i]);
    ev.target.disabled = true;
    try {
      const r = await api.post('/api/motion/focus/apply', { manifest: st.manifest.trim(), clicks: chosen, amount: st.amount, hold: st.hold });
      mount(result, h('div', { class: 'card pad' }, h('h3', {}, 'Zoom added to a new plan'), h('p', { class: 'small' }, `${r.points} zoom point(s) in ${r.scenes} scene(s)${r.dropped ? `, ${r.dropped} dropped (too close to the one before)` : ''}.`),
        h('div', { class: 'mono small', style: { wordBreak: 'break-all' } }, r.output), (r.skipped || []).map(x => h('div', { class: 'small muted' }, `skipped: ${x}`)),
        h('p', { class: 'muted small mt-s' }, 'The original plan is unchanged and nothing is built or approved. Review the new plan, then run:'),
        r.next.map(c => h('div', { class: 'row mt-s' }, h('code', { class: 'mono small', style: { flex: 1, wordBreak: 'break-all' } }, c), h('button', { class: 'btn ghost sm', onclick: async () => { try { await navigator.clipboard.writeText(c); toast('Copied', 'good'); } catch { toast('Copy failed', 'bad'); } } }, icon('copy', 14))))));
      toast('Zoom added', 'good');
    } catch (e) { mount(result, h('div', { class: 'hint bad' }, e.message)); }
    ev.target.disabled = false;
  };
  mount(body, h('div', { class: 'col' },
    h('div', { class: 'hint' }, icon('info', 18), 'Auto-zoom for screen recordings. Video Monk looks at the recording (it records no clicks or keystrokes) and proposes the moments where something new starts changing: a toast, a dialog, typing, a highlight. Keep the ones that matter; each becomes a smooth zoom that eases in, holds and eases out.'),
    h('div', { class: 'card pad' }, h('h3', {}, '1. Find the moments'),
      h('label', { class: 'field mt-s' }, h('span', {}, 'Recording (full path)'), h('input', { class: 'input', placeholder: '/Users/you/Movies/screen-recording.mp4', oninput: e => { st.media = e.target.value; } })),
      h('label', { class: 'field mt-s' }, h('span', {}, 'Sensitivity'), h('div', { class: 'row', style: { gap: '12px' } }, h('input', { type: 'range', min: 0.6, max: 1.5, step: 0.1, value: 1, style: { flex: 1 }, oninput: e => { st.sensitivity = Number(e.target.value); e.target.nextSibling.textContent = st.sensitivity.toFixed(1); } }), h('b', {}, '1.0')),
        h('small', {}, '0.8 to 1.3 is the reliable range; above about 1.5 it starts to invent moments.')),
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', onclick: detect }, icon('eye', 16), 'Find moments')), status, list),
    h('div', { class: 'card pad' }, h('h3', {}, '2. Add them to a plan'),
      h('label', { class: 'field mt-s' }, h('span', {}, 'Plan to add the zoom to (full path to its production.json)'), h('input', { class: 'input', placeholder: '/Users/you/Videos/talk/production.json', oninput: e => { st.manifest = e.target.value; } })),
      h('div', { class: 'grid g2 mt-s' },
        h('label', { class: 'field' }, h('span', {}, 'Zoom amount'), h('input', { class: 'input', type: 'number', min: 0.1, max: 1, step: 0.1, value: st.amount, oninput: e => { st.amount = Number(e.target.value); } }), h('small', {}, '0.5 is a 1.5x zoom; 1 is 2x.')),
        h('label', { class: 'field' }, h('span', {}, 'Hold (seconds)'), h('input', { class: 'input', type: 'number', min: 0, max: 10, step: 0.2, value: st.hold, oninput: e => { st.hold = Number(e.target.value); } }))),
      h('div', { class: 'row mt-s' }, h('button', { class: 'btn', onclick: apply }, icon('film', 16), 'Add zoom to a new plan'))),
    result));
}
