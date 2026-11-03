import { h, mount, icon, fmt } from '../ui.js';
import { api } from '../api.js';

export async function renderApprovals(view) {
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Approval ', h('em', { class: 'serif' }, 'history')), h('p', {}, 'Every decision you made in any project: who, when, what and, for the storyboard, a fingerprint of exactly what was approved.'))), h('div', { class: 'skeleton', style: { height: '200px' } }));
  const rows = await api.approvals();
  const good = d => /approved|permitted|continued/.test(d);
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Approval ', h('em', { class: 'serif' }, 'history')), h('p', {}, 'Every decision you made in any project: who, when, what and, for the storyboard, a fingerprint of exactly what was approved.'))),
    rows.length ? h('div', { class: 'card pad' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['When', 'Project', 'Step', 'Decision', 'By', 'What'].map(x => h('th', {}, x)))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', { class: 'nowrap muted' }, new Date(r.at).toLocaleString()), h('td', {}, r.project ? h('a', { href: `#/project/${r.project_id}` }, r.project) : h('span', { class: 'faint' }, 'deleted project')),
        h('td', {}, r.gate.replace(/-/g, ' ')), h('td', {}, h('span', { class: `chip ${good(r.decision) ? 'good' : 'warn'}` }, r.decision)), h('td', { class: 'muted' }, r.by || ''),
        h('td', { class: 'muted small' }, r.summary || '', r.note ? h('div', { class: 'faint' }, `“${r.note}”`) : null, r.fingerprint ? h('div', { class: 'faint mono tiny' }, `fingerprint ${r.fingerprint}`) : null)))))) :
      h('div', { class: 'empty card' }, icon('shield', 40), h('h3', {}, 'No approvals yet'), h('p', {}, 'When a project pauses for your decision and you answer, it is recorded here.')));
}
