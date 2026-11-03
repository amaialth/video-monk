import { h, mount, icon, toast, fmt } from '../ui.js';
import { api } from '../api.js';

// What the studio has learned from its reviewers and from you. A lesson is a short rule that is put in front of the producing agent the next time it works on that stage.
// Rules written by a model reviewer wait here for your approval; rules from this toolkit's own checks activate after the same problem is seen twice; your own feedback is active at once.
const STATUS = { proposed: ['Needs your approval', 'warn'], active: ['Active', 'good'], candidate: ['Seen once', ''], ineffective: ['Not working: rewrite it', 'bad'], disabled: ['Off', ''], retired: ['Retired', ''] };
const SOURCE = { code: 'toolkit check', claude: 'model reviewer', human: 'you' };

export async function renderLessons(view) {
  const draw = async () => {
    const { lessons, stages } = await api.get('/api/lessons');
    const act = async (fn, msg) => { try { await fn(); toast(msg, 'good'); await draw(); } catch (e) { toast(e.message, 'bad'); } };
    const row = l => {
      const [label, tone] = STATUS[l.status] || [l.status, ''];
      const rule = h('textarea', { class: 'textarea', rows: 2, style: { width: '100%' } }, l.rule);
      return h('div', { class: 'card pad mt-s' },
        h('div', { class: 'row between wrap' }, h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: `chip ${tone}` }, label), h('span', { class: 'chip' }, l.stage), h('span', { class: 'faint small' }, l.code)),
          h('div', { class: 'faint tiny' }, `${SOURCE[l.source] || l.source} · seen ${l.occurrences}× · applied ${l.applied}× · held ${l.held}× · came back ${l.recurred}× · ${fmt.ago(new Date(l.last_seen).toISOString())}`)),
        h('div', { class: 'mt-s' }, rule),
        h('div', { class: 'row mt-s', style: { gap: '8px' } },
          l.status === 'proposed' ? h('button', { class: 'btn sm', onclick: () => act(() => api.put(`/api/lessons/${l.id}`, { rule: rule.value, status: 'active' }), 'Lesson approved') }, icon('check', 14), 'Approve') : null,
          h('button', { class: 'btn ghost sm', onclick: () => act(() => api.put(`/api/lessons/${l.id}`, { rule: rule.value }), 'Saved') }, 'Save the wording'),
          l.status === 'active' ? h('button', { class: 'btn ghost sm', onclick: () => act(() => api.put(`/api/lessons/${l.id}`, { status: 'disabled' }), 'Turned off') }, 'Turn off') : null,
          ['disabled', 'candidate', 'retired'].includes(l.status) ? h('button', { class: 'btn ghost sm', onclick: () => act(() => api.put(`/api/lessons/${l.id}`, { status: 'active' }), 'Turned on') }, 'Turn on') : null,
          h('button', { class: 'btn ghost sm', onclick: () => { if (confirm('Delete this lesson?')) act(() => api.del(`/api/lessons/${l.id}`), 'Deleted'); } }, icon('trash', 14))));
    };
    const needs = lessons.filter(l => l.status === 'proposed');
    mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'What the studio has ', h('em', { class: 'serif' }, 'learned')), h('p', {}, 'Every review is kept. A problem seen again becomes a rule that the producing agent reads before it works the next time, and each rule is measured: did the problem stay away? Nothing a model wrote applies until you approve it.'))),
      needs.length ? h('div', { class: 'hint warn' }, icon('alert', 18), `${needs.length} rule${needs.length === 1 ? '' : 's'} proposed by a model reviewer are waiting for your approval. They are not used until you approve them.`) : null,
      lessons.length ? stages.map(stage => { const mine = lessons.filter(l => l.stage === stage); return mine.length ? h('div', { class: 'mt' }, h('h2', {}, stage), mine.map(row)) : null; }) : h('div', { class: 'card pad mt muted' }, 'Nothing learned yet. Run a short through the pipeline: the reviewers\' findings will appear here as they recur.'));
  };
  await draw();
  return () => {};
}
