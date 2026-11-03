import { h, mount, icon, fmt } from '../ui.js';
import { api } from '../api.js';

const meter = (label, used, limit, unit) => h('div', {}, h('div', { class: 'row between small' }, h('span', {}, label), h('span', { class: 'muted' }, `${used} of ${limit} ${unit}`)), h('div', { class: 'progressbar', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.min(100, used / limit * 100)}%`, background: used / limit > 0.8 ? 'var(--warn)' : undefined } })));

export async function renderSystem(view) {
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'System ', h('em', { class: 'serif' }, 'check')), h('p', {}, 'What this machine can do. Required tools must be ready to render; the rest unlock extras.'))), h('div', { class: 'skeleton', style: { height: '260px' } }));
  const [e, db] = await Promise.all([api.env(), api.db().catch(() => null)]);
  const row = c => h('div', { class: 'row between', style: { padding: '11px 0', borderBottom: '1px solid var(--line)' } },
    h('div', { class: 'row' }, h('span', { class: `dot ${c.ok ? 'on' : c.optional ? '' : 'off'}` }), h('div', {}, h('div', {}, c.label, c.optional ? h('span', { class: 'faint small' }, ' optional') : null), h('div', { class: 'faint small mono', style: { wordBreak: 'break-all' } }, c.detail), c.fix && !c.ok ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, c.fix) : null)),
    h('span', { class: `chip ${c.ok ? 'good' : c.optional ? '' : 'bad'}` }, c.ok ? 'Ready' : c.optional ? 'Not set up' : 'Missing'));
  const core = e.checks.filter(c => !c.optional), extras = e.checks.filter(c => c.optional && !c.id.startsWith('key-')), keys = e.checks.filter(c => c.id.startsWith('key-'));
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'System ', h('em', { class: 'serif' }, 'check')), h('p', {}, 'What this machine can do. Required tools must be ready to render; the rest unlock extras.')), h('span', { class: `chip ${e.ready ? 'good' : 'bad'}` }, e.ready ? 'Ready to edit' : 'Setup needed')),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card pad' }, h('h3', {}, 'Required'), h('div', { class: 'sub' }, 'Rendering, encoding and graphics.'), core.map(row)),
      h('div', { class: 'col' }, h('div', { class: 'card pad' }, h('h3', {}, 'Speech and AI'), h('div', { class: 'sub' }, 'Local transcription and the optional Claude engine.'), extras.map(row)),
        h('div', { class: 'card pad' }, h('h3', {}, 'Stock and sound services'), h('div', { class: 'sub' }, 'Keys are read from your environment or a .env file. The app never shows or stores their values.'), keys.map(row)))),
    db ? h('div', { class: 'grid g2 mt' },
      h('div', { class: 'card pad' }, h('h3', {}, 'Local database'), h('div', { class: 'sub' }, 'Projects, progress, approvals and what is remembered between projects live in one SQLite file, so a run can resume after a restart.'),
        h('dl', { class: 'kvs mt-s' }, h('dt', {}, 'File'), h('dd', { class: 'mono small', style: { wordBreak: 'break-all' } }, db.file), h('dt', {}, 'Size'), h('dd', {}, fmt.size(db.bytes)),
          h('dt', {}, 'Projects'), h('dd', {}, `${db.projects} (${db.runs} runs, ${db.checkpoints} checkpoints)`), h('dt', {}, 'Events and approvals'), h('dd', {}, `${db.events} and ${db.approvals}`),
          h('dt', {}, 'Remembered'), h('dd', {}, `${db.terms} glossary term(s), ${db.presets} preset(s), ${db.recentMedia} recent file(s)`))),
      h('div', { class: 'card pad' }, h('h3', {}, 'Usage'), h('div', { class: 'sub' }, 'Counted across all projects, so limits hold even after a restart.'),
        h('div', { class: 'col mt-s', style: { gap: '12px' } },
          meter('Unsplash this hour', db.usage.unsplashHour.calls, 50, 'requests (demo key limit 50)'), meter('Pixabay this minute', db.usage.pixabayMinute.calls, 100, 'requests (limit 100)'),
          h('div', { class: 'row between' }, h('span', {}, 'Mirelo, last 30 days'), h('b', {}, `${Math.round(db.usage.mireloCredits30d.units)} credits`))))) : null,
    h('div', { class: 'hint mt' }, icon('info', 18), 'Nothing is sent anywhere unless you turn it on for a project: stock searches, Claude and Mirelo each need your explicit permission.'));
}
