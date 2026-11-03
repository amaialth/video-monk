import { h, mount, icon, fmt, modal } from '../ui.js';
import { api } from '../api.js';

// A server-side file browser (the browser cannot hand us a local path). mode 'file' picks a video, 'folder' picks the current folder.
export function fileBrowser({ mode = 'file', initial = null, onSelect = () => {}, selected = null }) {
  let current = initial, sel = selected, entries = [], parent = null;
  const roots = h('div', { class: 'roots' });
  const path = h('div', { class: 'path' });
  const pane = h('div', { class: 'files' });
  const typed = h('input', { class: 'input', placeholder: 'Paste a path and press Enter', onkeydown: e => { if (e.key === 'Enter') go(e.target.value.trim()); } });
  const observer = new IntersectionObserver(items => { for (const it of items) if (it.isIntersecting) { const el = it.target; observer.unobserve(el); el.style.backgroundImage = `url("${api.thumb(el.dataset.path)}")`; el.textContent = ''; } }, { rootMargin: '200px' });

  const crumbs = () => {
    const parts = current.split('/').filter(Boolean);
    const out = [h('button', { onclick: () => go('/') }, '/')];
    let acc = '';
    for (const part of parts) { acc += `/${part}`; const target = acc; out.push(h('span', { class: 'faint' }, '›'), h('button', { onclick: () => go(target) }, part)); }
    mount(path, out);
  };

  async function go(dir) {
    mount(pane, h('div', { class: 'skeleton', style: { height: '140px', gridColumn: '1/-1' } }));
    try {
      const r = await api.list(dir);
      current = r.path; parent = r.parent; entries = r.entries; typed.value = current;
      crumbs(); draw();
    } catch (error) { mount(pane, h('div', { class: 'hint bad', style: { gridColumn: '1/-1' } }, error.message)); }
  }

  function draw() {
    const nodes = [];
    if (parent) nodes.push(h('button', { class: 'file', onclick: () => go(parent) }, h('div', { class: 'ph' }, icon('up', 26)), h('div', { class: 'nm' }, 'Up one folder')));
    for (const e of entries) {
      if (e.type === 'dir') nodes.push(h('button', { class: 'file', ondblclick: () => go(e.path), onclick: () => go(e.path) }, h('div', { class: 'ph' }, icon('folder', 30)), h('div', { class: 'nm', title: e.name }, e.name)));
      else if (mode === 'file') {
        const ph = h('div', { class: 'ph', 'data-path': e.path }, icon('film', 26));
        const node = h('button', { class: `file ${sel === e.path ? 'sel' : ''}`, onclick: () => { sel = e.path; draw(); onSelect(e); }, title: e.name }, ph, h('div', { class: 'nm' }, e.name), h('div', { class: 'mt2' }, fmt.size(e.size), ' · ', new Date(e.mtime).toLocaleDateString()));
        nodes.push(node); queueMicrotask(() => observer.observe(ph));
      }
    }
    if (!entries.length) nodes.push(h('div', { class: 'muted', style: { gridColumn: '1/-1', padding: '26px', textAlign: 'center' } }, mode === 'file' ? 'No folders or videos here.' : 'No sub-folders here.'));
    mount(pane, nodes);
  }

  (async () => {
    try {
      const r = await api.roots();
      mount(roots, r.map(x => h('button', { onclick: () => go(x.path) }, icon(x.volume ? 'library' : 'folder', 16), x.label)));
      if (!current) current = (r.find(x => x.label === 'Movies') || r.find(x => x.label === 'Videos') || r[0])?.path;
      if (current) go(current);
    } catch (error) { mount(pane, h('div', { class: 'hint bad' }, error.message)); }
  })();

  const el = h('div', { class: 'card browser' }, roots, h('div', { class: 'pane' }, typed, path, pane));
  return { el, current: () => current, destroy: () => observer.disconnect() };
}

export function folderPicker(title, help) {
  return new Promise(resolve => {
    let picked = null;
    modal(close => {
      const fb = fileBrowser({ mode: 'folder' });
      return h('div', { class: 'col' }, h('h3', {}, title), help ? h('p', { class: 'muted small', style: { margin: 0 } }, help) : null, fb.el,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => { close(); resolve(null); } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => { picked = fb.current(); close(); resolve(picked); } }, icon('check', 16), 'Use this folder')));
    }, { onClose: () => { if (picked === null) resolve(null); } });
  });
}
