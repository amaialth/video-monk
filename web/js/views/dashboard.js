import { h, mount, icon, fmt, statusChip, toast, modal, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { folderPicker } from '../components/filebrowser.js';

const FORMAT = { long: 'Long-form', short: 'Short', both: 'Long + Short', feed: 'Feed' };

export async function renderDashboard(view, ctx) {
  let alive = true, timer = null;
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Your ', h('em', { class: 'serif' }, 'projects')), h('p', {}, 'Every edit you start is tracked here: each step visible, each approval recorded.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => importExisting() }, icon('folder', 16), 'Open an existing output'), h('a', { class: 'btn primary', href: '#/new' }, icon('plus', 16), 'New project')));
  const body = h('div', {});
  mount(view, head, body);

  const card = p => {
    const steps = Object.entries(p.steps || {});
    const waiting = p.status === 'waiting';
    const thumb = p.media?.path ? api.thumb(p.media.path) : null;
    return h('a', { class: 'pcard card rise', href: `#/project/${p.id}` },
      h('div', { class: 'thumb', style: thumb ? { backgroundImage: `url("${thumb}")` } : {} },
        waiting ? h('div', { class: 'ribbon' }, h('span', { class: 'chip warn' }, h('i', { class: 'pulse' }), 'Needs your approval')) : null,
        h('div', { class: 'tags' }, p.options?.deliverable ? h('span', { class: 'chip' }, FORMAT[p.options.deliverable]) : null, p.media?.duration ? h('span', { class: 'chip' }, fmt.dur(p.media.duration)) : null)),
      h('div', { class: 'body' },
        h('div', { class: 'row between' }, h('h3', {}, p.name), statusChip(p.status)),
        h('div', { class: 'faint small mt-s' }, p.media?.name || '', ' · ', fmt.ago(p.updatedAt)),
        steps.length ? h('div', { class: 'dots' }, steps.map(([k, s]) => h('i', { class: s.status, title: `${s.label || k}: ${s.status}` }))) : null));
  };

  async function load() {
    let list;
    try { list = await api.projects(); } catch (error) { mount(body, h('div', { class: 'hint bad' }, error.message)); return; }
    if (!alive) return;
    if (!list.length) {
      mount(body, h('div', { class: 'empty card' }, icon('film', 44), h('h3', {}, 'No projects yet'), h('p', {}, 'Pick a recording and the toolkit will analyze, transcribe, cut, add graphics, render and deliver it, pausing for your approval along the way.'),
        h('a', { class: 'btn primary', href: '#/new' }, icon('plus', 16), 'Start your first project')));
      return;
    }
    const attention = list.filter(p => p.status === 'waiting');
    mount(body,
      attention.length ? h('div', { class: 'banner' }, icon('alert', 22), h('div', { class: 'grow' }, h('b', {}, `${attention.length} project${attention.length > 1 ? 's are' : ' is'} waiting for you`), h('div', { class: 'muted small' }, attention.map(p => p.name).join(', '))), h('a', { class: 'btn primary', href: `#/project/${attention[0].id}` }, 'Review now')) : null,
      h('div', { class: 'pgrid' }, list.map(card)));
    ctx.refreshBadge();
  }

  async function importExisting() {
    const root = await folderPicker('Choose a Video Monk output folder', 'Pick the folder that contains edit/, render/ or REVIEW-LOOP.md (for example the folder you gave --output).');
    if (!root) return;
    try { const p = await api.importProject({ root }); toast('Opened for viewing', 'good'); ctx.navigate(`#/project/${p.id}`); } catch (error) { toast(error.message, 'bad'); }
  }

  await load();
  timer = setInterval(load, 5000);
  return () => { alive = false; clearInterval(timer); };
}
