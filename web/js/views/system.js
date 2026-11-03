import { h, mount, icon, fmt } from '../ui.js';
import { api } from '../api.js';

export async function renderSystem(view) {
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'System ', h('em', { class: 'serif' }, 'check')), h('p', {}, 'What this machine can do. Required tools must be ready to render; the rest unlock extras.'))), h('div', { class: 'skeleton', style: { height: '260px' } }));
  const e = await api.env();
  const row = c => h('div', { class: 'row between', style: { padding: '11px 0', borderBottom: '1px solid var(--line)' } },
    h('div', { class: 'row' }, h('span', { class: `dot ${c.ok ? 'on' : c.optional ? '' : 'off'}` }), h('div', {}, h('div', {}, c.label, c.optional ? h('span', { class: 'faint small' }, ' optional') : null), h('div', { class: 'faint small mono', style: { wordBreak: 'break-all' } }, c.detail), c.fix && !c.ok ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, c.fix) : null)),
    h('span', { class: `chip ${c.ok ? 'good' : c.optional ? '' : 'bad'}` }, c.ok ? 'Ready' : c.optional ? 'Not set up' : 'Missing'));
  const core = e.checks.filter(c => !c.optional), extras = e.checks.filter(c => c.optional && !c.id.startsWith('key-')), keys = e.checks.filter(c => c.id.startsWith('key-'));
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'System ', h('em', { class: 'serif' }, 'check')), h('p', {}, 'What this machine can do. Required tools must be ready to render; the rest unlock extras.')), h('span', { class: `chip ${e.ready ? 'good' : 'bad'}` }, e.ready ? 'Ready to edit' : 'Setup needed')),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card pad' }, h('h3', {}, 'Required'), h('div', { class: 'sub' }, 'Rendering, encoding and graphics.'), core.map(row)),
      h('div', { class: 'col' }, h('div', { class: 'card pad' }, h('h3', {}, 'Speech and AI'), h('div', { class: 'sub' }, 'Local transcription and the optional Claude engine.'), extras.map(row)),
        h('div', { class: 'card pad' }, h('h3', {}, 'Stock and sound services'), h('div', { class: 'sub' }, 'Keys are read from your environment or a .env file. The app never shows or stores their values.'), keys.map(row)))),
    h('div', { class: 'hint mt' }, icon('info', 18), 'Nothing is sent anywhere unless you turn it on for a project: stock searches, Claude and Mirelo each need your explicit permission.'));
}
