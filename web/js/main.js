import { h, mount, icon, toast, $ } from './ui.js';
import { api } from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderWizard } from './views/wizard.js';
import { renderProject } from './views/project.js';
import { renderLibrary } from './views/library.js';
import { renderSystem } from './views/system.js';
import { renderApprovals } from './views/approvals.js';
import { renderMotion } from './views/motion.js';

const app = document.getElementById('app');
let cleanup = null, session = null, pollTimer = null;
const ctx = { get session() { return session; }, refreshBadge: () => badge(), navigate: to => { location.hash = to; } };

const NAV = [['#/', 'Projects', 'grid'], ['#/new', 'New project', 'plus'], ['#/motion', 'Motion studio', 'sparkle'], ['#/library', 'Asset library', 'library'], ['#/approvals', 'Approvals', 'shield'], ['#/system', 'System', 'gear']];

function shell() {
  const theme = () => document.documentElement.dataset.theme;
  const toggle = h('button', { class: 'btn ghost sm', title: 'Switch light and dark', onclick: () => { const next = theme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('vm-theme', next); } catch { /* private mode */ } draw(); } });
  const draw = () => mount(toggle, icon(theme() === 'dark' ? 'sun' : 'moon', 16), theme() === 'dark' ? 'Light' : 'Dark');
  draw();
  const nav = h('nav', { class: 'nav', id: 'nav' }, NAV.map(([href, label, ic]) => h('a', { href, 'data-href': href }, icon(ic, 18), label, href === '#/' ? h('span', { class: 'badge', id: 'approval-badge', style: { display: 'none' } }) : null)));
  return h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('div', { class: 'mark' }, icon('play', 16)), h('div', {}, 'Video Monk', h('small', {}, 'Automated editing studio'))), nav,
      h('div', { class: 'grow' }),
      h('div', { class: 'foot' }, h('span', { class: 'dot on', id: 'conn' }), h('span', { id: 'ver' }, 'connected'), h('span', { style: { marginLeft: 'auto' } }, toggle))),
    h('main', { class: 'main', id: 'view' }));
}

async function badge() {
  try {
    const list = await api.projects();
    const n = list.filter(p => p.status === 'waiting').length;
    const el = $('#approval-badge');
    if (el) { el.style.display = n ? '' : 'none'; el.textContent = n; el.title = `${n} project(s) waiting for your approval`; }
    const conn = $('#conn'); if (conn) conn.className = 'dot on';
  } catch { const conn = $('#conn'); if (conn) conn.className = 'dot off'; }
}

async function route() {
  cleanup?.(); cleanup = null;
  const hash = location.hash || '#/';
  document.querySelectorAll('#nav a').forEach(a => { const href = a.dataset.href; a.classList.toggle('on', href === '#/' ? (hash === '#/' || hash.startsWith('#/project')) : hash.startsWith(href)); });
  const view = $('#view');
  window.scrollTo(0, 0);
  const parts = hash.replace(/^#\//, '').split('/');
  try {
    if (parts[0] === '' ) cleanup = await renderDashboard(view, ctx);
    else if (parts[0] === 'new') cleanup = await renderWizard(view, ctx);
    else if (parts[0] === 'project' && parts[1]) cleanup = await renderProject(view, ctx, parts[1], parts[2]);
    else if (parts[0] === 'motion') cleanup = await renderMotion(view, ctx, parts[1]);
    else if (parts[0] === 'library') cleanup = await renderLibrary(view, ctx);
    else if (parts[0] === 'approvals') cleanup = await renderApprovals(view, ctx);
    else if (parts[0] === 'system') cleanup = await renderSystem(view, ctx);
    else mount(view, h('div', { class: 'empty' }, h('h3', {}, 'Page not found'), h('a', { href: '#/' }, 'Back to projects')));
  } catch (error) {
    mount(view, h('div', { class: 'empty card' }, h('h3', {}, 'Could not load this page'), h('p', {}, error.message), h('a', { class: 'btn', href: '#/' }, 'Back to projects')));
  }
}

async function boot() {
  mount(app, shell());
  try { session = await api.session(); const v = $('#ver'); if (v) v.textContent = `v${session.version}`; } catch (error) { toast(error.message, 'bad'); }
  window.addEventListener('hashchange', route);
  await route();
  badge();
  pollTimer = setInterval(badge, 6000);
}
boot();
