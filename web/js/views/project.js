import { h, mount, icon, fmt, statusChip, toast, confirmDialog, $ } from '../ui.js';
import { api, subscribe } from '../api.js';
import { viewInspect, viewTranscript, viewScript, viewCut, viewStoryboard, viewRender, viewFinal } from './stages.js';

const ICONS = { inspect: 'film', transcript: 'mic', script: 'book', cut: 'scissors', storyboard: 'layers', render: 'render', short: 'phone', final: 'shield' };
const VIEWS = { inspect: viewInspect, transcript: viewTranscript, script: viewScript, cut: viewCut, storyboard: viewStoryboard, render: p => viewRender(p, 'render'), short: p => viewRender(p, 'short'), final: viewFinal };

function stepLine(step, s) {
  const sum = s.summary || {};
  switch (step) {
    case 'inspect': return sum.duration ? `${fmt.dur(sum.duration)} · ${fmt.num(sum.lufs)} LUFS · ${fmt.pct(sum.speechRatio)} speech` : '';
    case 'transcript': return sum.words ? `${sum.words} words${sum.cached ? ' (cached)' : ''}` : sum.source || '';
    case 'script': return sum.note || (sum.candidates !== undefined ? `${sum.applied} corrected of ${sum.candidates} found` : '');
    case 'cut': return sum.editedDuration ? `${fmt.dur(sum.sourceDuration)} → ${fmt.dur(sum.editedDuration)} · ${sum.cuts} cuts` : '';
    case 'storyboard': return sum.graphics !== undefined ? `${sum.graphics} graphic${sum.graphics === 1 ? '' : 's'} · ${fmt.num(sum.perMinute)}/min` : '';
    case 'render': return sum.duration ? `${fmt.dur(sum.duration)} · ${fmt.num(sum.lufs)} LUFS · ${fmt.dur(sum.renderSeconds)} to render` : '';
    case 'short': return sum.duration ? `${fmt.dur(sum.duration)} vertical` : '';
    case 'final': return sum.decision || '';
    default: return '';
  }
}

export async function renderProject(view, ctx, id, stepParam) {
  let project;
  try { project = await api.project(id); } catch (error) { mount(view, h('div', { class: 'empty card' }, h('h3', {}, 'Project not found'), h('p', {}, error.message), h('a', { class: 'btn', href: '#/' }, 'Back to projects'))); return null; }
  const state = { logs: [], ledger: [], progress: {}, selected: null, follow: true, cache: {}, connected: true, hasGateSeen: null };
  let unsubscribe = null, stageToken = 0, sourceVideo = null, destroyed = false;

  const railEl = h('div', { class: 'card rail' });
  const stageEl = h('div', {});
  const activityEl = h('div', { class: 'col activity', style: { gap: '14px' } });
  const bannerEl = h('div', {});
  const headEl = h('div', {});

  const pc = {
    id, get project() { return project; }, state,
    data(name) { return state.cache[name] ??= api.data(id, name).catch(error => { delete state.cache[name]; throw error; }); },
    invalidate(...names) { for (const n of names) delete state.cache[n]; },
    async reload() { project = await api.project(id); drawAll(); },
    seek(t, play = false) { if (sourceVideo) { sourceVideo.currentTime = Math.max(0, t); if (play) { sourceVideo.play().catch(() => {}); setTimeout(() => sourceVideo.pause(), 3500); } sourceVideo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
    sourcePlayer() {
      if (!project.media?.path) return h('div', { class: 'hint' }, icon('info', 18), 'The original recording is not available for this project.');
      sourceVideo = h('video', { controls: true, preload: 'metadata', src: api.source(id), poster: api.thumb(project.media.path) });
      return h('div', { class: 'player' }, sourceVideo);
    }
  };

  const stepsOf = () => Object.entries(project.steps || {});
  const autoSelect = () => {
    const entries = stepsOf();
    if (!entries.length) return null;
    const waiting = entries.find(([, s]) => s.status === 'waiting');
    if (waiting) return waiting[0];
    const running = entries.find(([, s]) => s.status === 'running');
    if (running) return running[0];
    const failed = entries.find(([, s]) => ['failed', 'interrupted', 'cancelled'].includes(s.status));
    if (failed) return failed[0];
    return [...entries].reverse().find(([, s]) => s.status === 'done')?.[0] || entries[0][0];
  };

  function drawHead() {
    const running = project.active || ['running', 'waiting'].includes(project.status);
    const doneCount = stepsOf().filter(([, s]) => ['done', 'skipped'].includes(s.status)).length, total = stepsOf().length || 1;
    mount(headEl, h('div', { class: 'page-head', style: { marginBottom: '14px' } },
      h('div', {}, h('div', { class: 'crumb' }, h('a', { href: '#/' }, 'Projects'), ' / ', project.name), h('div', { class: 'row' }, h('h1', {}, project.name), statusChip(project.status)),
        h('p', { class: 'small' }, project.media?.name ? `${project.media.name}${project.media.duration ? ` · ${fmt.dur(project.media.duration)}` : ''}` : '', project.imported ? ' · opened read-only from an existing folder' : '')),
      h('div', { class: 'row' },
        project.status === 'draft' ? h('button', { class: 'btn primary', onclick: startRun }, icon('play', 16), 'Start editing') : null,
        running ? h('button', { class: 'btn danger', onclick: cancel }, icon('stop', 15), 'Cancel') : null,
        !project.imported && !running ? h('button', { class: 'btn', onclick: again }, icon('copy', 15), 'Run again') : null,
        !running ? h('button', { class: 'btn ghost', title: 'Delete this project', onclick: remove }, icon('trash', 16)) : null)),
      stepsOf().length ? h('div', { class: 'progressbar', style: { marginBottom: '16px' } }, h('i', { style: { width: `${doneCount / total * 100}%` } })) : null);
  }

  function drawBanner() {
    const p = project;
    if (p.status === 'waiting' && p.pending) {
      const names = { script: 'Check the script', storyboard: 'Approve the plan before rendering', cut: 'Check the cut', final: 'Watch it, then sign off' };
      mount(bannerEl, h('div', { class: 'banner rise' }, icon('alert', 24), h('div', { class: 'grow' }, h('b', {}, 'Waiting for you: ', names[p.pending.gate] || 'a decision'), h('div', { class: 'small muted' }, 'The toolkit has paused and will continue as soon as you decide.')), h('button', { class: 'btn primary', onclick: () => { state.selected = p.pending.step; state.follow = true; drawRail(); drawStage(); } }, 'Review now')));
    } else if (p.status === 'failed' || p.status === 'needs-attention') {
      mount(bannerEl, h('div', { class: 'banner fail' }, icon('alert', 24), h('div', { class: 'grow' }, h('b', {}, p.status === 'failed' ? 'Something went wrong' : 'The review loop needs you'), h('div', { class: 'small muted' }, p.error || '')), h('button', { class: 'btn', onclick: again }, 'Run again')));
    } else if (p.status === 'interrupted') mount(bannerEl, h('div', { class: 'banner fail' }, icon('alert', 24), h('div', { class: 'grow' }, h('b', {}, 'The app was closed while this was running'), h('div', { class: 'small muted' }, 'Runs cannot be resumed. Start it again; transcripts and stock clips already in the library are reused.')), h('button', { class: 'btn primary', onclick: again }, 'Run again')));
    else if (p.status === 'done') mount(bannerEl, h('div', { class: 'banner ok' }, icon('check', 24), h('div', { class: 'grow' }, h('b', {}, 'Approved for delivery'), h('div', { class: 'small muted' }, 'Everything below is recorded. Publishing is still your action.'))));
    else if (p.status === 'changes-requested') mount(bannerEl, h('div', { class: 'banner' }, icon('info', 24), h('div', { class: 'grow' }, h('b', {}, 'You requested changes'), h('div', { class: 'small muted' }, 'Run again with different settings. The approval record is kept.')), h('button', { class: 'btn', onclick: again }, 'Run again')));
    else mount(bannerEl);
  }

  function drawRail() {
    const entries = stepsOf();
    mount(railEl, h('h4', {}, 'Pipeline'), entries.length ? entries.map(([k, s]) => {
      const line = stepLine(k, s);
      return h('div', { class: `step ${s.status} ${state.selected === k ? 'sel' : ''}`, onclick: () => { state.selected = k; state.follow = false; drawRail(); drawStage(); } },
        h('div', { class: 'ico' }, s.status === 'done' ? icon('check', 15) : s.status === 'running' ? h('span', { class: 'spinner', style: { width: '14px', height: '14px' } }) : s.status === 'waiting' ? icon('alert', 15) : icon(ICONS[k] || 'info', 15)),
        h('div', {}, h('div', { class: 't' }, s.label || k, s.status === 'waiting' ? h('span', { class: 'chip warn' }, 'You') : null), h('div', { class: 's' }, s.status === 'running' ? 'Working…' : s.status === 'waiting' ? 'Waiting for your approval' : s.status === 'pending' ? 'Waiting its turn' : s.status === 'skipped' ? 'Skipped' : line || (s.status === 'failed' ? (s.error || 'Failed').slice(0, 90) : ''))));
    }) : h('div', { class: 'muted small', style: { padding: '8px' } }, 'Press Start editing to begin.'));
  }

  async function drawStage() {
    const token = ++stageToken;
    const k = state.selected;
    if (!k) return mount(stageEl, h('div', { class: 'card pad empty' }, icon('film', 40), h('h3', {}, project.status === 'draft' ? 'Ready when you are' : 'No steps yet'), h('p', {}, project.status === 'draft' ? 'Review the settings, then start. Each step will appear here as it happens.' : '')));
    const s = project.steps[k] || {};
    const node = VIEWS[k]?.(pc) || h('div', { class: 'muted' }, 'Nothing to show.');
    if (token !== stageToken) return;
    mount(stageEl, h('div', { class: 'row between', style: { marginBottom: '14px' } }, h('div', { class: 'row' }, h('div', { class: 'brand', style: { padding: 0 } }, h('div', { class: 'mark', style: { width: '34px', height: '34px', borderRadius: '10px' } }, icon(ICONS[k] || 'info', 18))), h('div', {}, h('h2', {}, s.label || k), s.startedAt && s.endedAt ? h('div', { class: 'faint small' }, `Took ${fmt.dur((new Date(s.endedAt) - new Date(s.startedAt)) / 1000)}`) : null)), statusChip(s.status, s.status === 'done' ? 'Done' : undefined)),
      s.status === 'failed' && s.error ? h('div', { class: 'hint bad', style: { marginBottom: '14px' } }, icon('alert', 18), s.error) : null, node);
  }

  function drawActivity() {
    const a = project.approvals || [];
    mount(activityEl,
      h('div', { class: 'card pad' }, h('div', { class: 'row between' }, h('h3', {}, 'Live activity'), h('span', { class: 'row gap-s faint small' }, h('span', { class: `dot ${state.connected ? 'on' : 'off'}` }), state.connected ? 'live' : 'reconnecting')),
        h('div', { class: 'log mt-s', id: 'logbox' }, state.logs.length ? state.logs.slice(-200).map(l => h('div', {}, h('span', { class: 't' }, `${fmt.time(l.at)} `), l.line)) : h('div', {}, project.imported ? 'Opened from an existing folder: no live log.' : 'Waiting for activity…'))),
      h('div', { class: 'card pad' }, h('h3', {}, 'Your approvals'), a.length ? h('div', { class: 'col mt-s', style: { gap: '8px' } }, a.slice(-6).reverse().map(x => h('div', { class: 'small' }, h('div', { class: 'row between' }, h('b', {}, x.gate.replace(/-/g, ' ')), h('span', { class: `chip ${/approved|permitted|continued/.test(x.decision) ? 'good' : 'warn'}` }, x.decision)), h('div', { class: 'faint tiny' }, `${x.by} · ${fmt.ago(x.at)}`)))) : h('div', { class: 'muted small mt-s' }, 'Decisions you make are recorded here with your name and the time.')),
      h('div', { class: 'card pad' }, h('h3', {}, 'About this project'), h('dl', { class: 'kvs mt-s' }, h('dt', {}, 'Created'), h('dd', {}, fmt.ago(project.createdAt)), project.options?.deliverable ? [h('dt', {}, 'Making'), h('dd', {}, { long: 'Long-form', short: 'Short', both: 'Long-form + Short', feed: 'Feed post' }[project.options.deliverable])] : null, project.options?.engine ? [h('dt', {}, 'Designer'), h('dd', {}, project.options.engine)] : null, project.root ? [h('dt', {}, 'Folder'), h('dd', { class: 'mono small', style: { wordBreak: 'break-all' } }, project.root)] : null)));
    const box = $('#logbox'); if (box) box.scrollTop = box.scrollHeight;
  }

  const drawAll = () => { if (destroyed) return; if (state.follow || !state.selected) state.selected = autoSelect(); drawHead(); drawBanner(); drawRail(); drawStage(); drawActivity(); };

  async function startRun() { try { await api.start(id); await pc.reload(); } catch (error) { toast(error.message, 'bad'); } }
  async function cancel() { if (!(await confirmDialog('Cancel this run?', 'Work in progress stops. What was already produced stays in the project folder.', 'Cancel the run', true))) return; try { await api.cancel(id); } catch (error) { toast(error.message, 'bad'); } }
  async function again() { try { const p = await api.duplicate(id); ctx.navigate(`#/project/${p.id}`); } catch (error) { toast(error.message, 'bad'); } }
  async function remove() { if (!(await confirmDialog('Delete this project?', 'The project record and its working files are removed. Your original video is never touched.', 'Delete', true))) return; try { await api.remove(id); ctx.navigate('#/'); } catch (error) { toast(error.message, 'bad'); } }

  // live events
  const handle = async e => {
    if (e.type === 'log') { state.logs.push(e); const box = $('#logbox'); if (box && !project.imported) { drawActivity(); } }
    else if (e.type === 'progress') { state.progress = { ...state.progress, phase: e.phase, ...(e.phase === 'graphics' ? { graphics: { total: e.total, done: e.done } } : {}) }; if (state.selected === e.step && project.steps[e.step]?.status === 'running') drawStage(); }
    else if (e.type === 'ledger') { state.ledger.push({ ...e.entry }); state.cache.ledger = null; }
    else if (e.type === 'step') {
      if (project.steps[e.step]) { const { type, seq, at, ...rest } = e; project.steps[e.step] = { ...project.steps[e.step], ...rest }; }
      if (['done', 'failed'].includes(e.status)) pc.invalidate('analysis', 'words', 'cut', 'timeline', 'storyboard', 'broll-plan', 'render', 'short', 'script');
      drawRail(); if (state.follow) { state.selected = autoSelect(); drawRail(); } drawHead(); if (state.selected === e.step || state.follow) drawStage();
    } else if (['gate', 'gate-resolved', 'done', 'failed', 'cancelled', 'needs-attention', 'broll', 'broll-applied'].includes(e.type)) {
      pc.invalidate('timeline', 'storyboard', 'render', 'short', 'script');
      try { project = await api.project(id); } catch { /* keep */ }
      if (e.type === 'gate') state.follow = true;
      drawAll();
    }
  };
  if (!project.imported) unsubscribe = subscribe(id, handle, ok => { state.connected = ok; if (!destroyed) drawActivity(); });
  if (project.imported) { try { const l = await pc.data('ledger'); state.ledger = l?.entries || []; } catch { /* none */ } }

  mount(view, headEl, bannerEl, h('div', { class: 'proj' }, railEl, stageEl, activityEl));
  if (stepParam && project.steps[stepParam]) { state.selected = stepParam; state.follow = false; }
  drawAll();
  return () => { destroyed = true; unsubscribe?.(); };
}
