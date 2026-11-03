import { h, mount, icon, fmt } from '../ui.js';
import { api } from '../api.js';

const KINDS = ['', 'graphic', 'audio', 'image', 'video', 'transcript', 'storyboard', 'font', 'thumbnail', 'other'];
const KIND_ICON = { graphic: 'layers', audio: 'music', image: 'image', video: 'film', transcript: 'text', storyboard: 'layers', font: 'text', thumbnail: 'image', other: 'folder' };

export async function renderLibrary(view) {
  let kind = '', q = '', timer;
  const grid = h('div', {});
  const stats = h('div', { class: 'row gap-l wrap muted small' });
  const search = h('input', { class: 'input', placeholder: 'Search graphics, sounds, stock, transcripts…', style: { maxWidth: '380px' }, oninput: e => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250); } });
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => mount(seg, KINDS.map(k => h('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; drawSeg(); load(); } }, k || 'All')));
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Asset ', h('em', { class: 'serif' }, 'library')), h('p', {}, 'Everything the toolkit generated or downloaded is indexed here with its licence, so other projects reuse it instead of making or fetching it again.'))), h('div', { class: 'row between wrap', style: { marginBottom: '16px' } }, search, seg), stats, h('div', { class: 'mt' }, grid));
  drawSeg();
  async function load() {
    try {
      const r = await api.library(q, kind);
      if (!r.enabled) return mount(grid, h('div', { class: 'empty card' }, h('h3', {}, 'The asset library is turned off'), h('p', {}, 'VIDEO_MONK_LIBRARY is set to off.')));
      const s = r.stats || {};
      mount(stats, h('span', {}, `${s.entries ?? r.entries.length} assets`), h('span', {}, fmt.size(s.bytes)), h('span', { class: 'mono faint' }, r.root));
      mount(grid, r.entries.length ? h('div', { class: 'pgrid' }, r.entries.map(e => h('div', { class: 'card pad rise' },
        h('div', { class: 'row between' }, h('span', { class: 'chip' }, icon(KIND_ICON[e.kind] || 'folder', 13), e.kind), h('span', { class: 'faint tiny' }, `used ${e.uses || 0}×`)),
        h('h3', { style: { marginTop: '10px', fontSize: '14.5px' } }, e.name), h('div', { class: 'muted small mt-s', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, e.description),
        h('div', { class: 'row wrap mt-s' }, (e.tags || []).slice(0, 5).map(t => h('span', { class: 'chip' }, t))), e.rights ? h('div', { class: 'faint tiny mt-s' }, `Licence: ${e.rights.slice(0, 90)}`) : null, h('div', { class: 'faint tiny' }, fmt.size(e.bytes))))) : h('div', { class: 'empty card' }, icon('library', 40), h('h3', {}, 'Nothing here yet'), h('p', {}, 'Graphics, transcripts, stock clips and sounds appear here as projects create them.')));
    } catch (error) { mount(grid, h('div', { class: 'hint bad' }, error.message)); }
  }
  await load();
  return () => clearTimeout(timer);
}
