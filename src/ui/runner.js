// Runs a project's pipeline for the UI: footage analysis -> transcript -> script check -> cut -> storyboard -> render (-> short) -> final review.
// It reuses the toolkit's own functions and the review loop, adds human approval gates between steps, and records every approval.
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { run, exists } from '../core.js';
import { analyzeFootage } from '../autocut.js';
import { transcribeWhisper } from '../transcribe.js';
import { autoEdit } from '../auto.js';
import { findMisheard, parseGlossary, applyScriptFixes, fixesMarkdown } from '../script.js';
import { resolveBrief, briefToAutoOptions } from '../brief.js';
import { finding } from '../loop.js';
import { Library } from '../library.js';
import { fetchPlan, applyPlacements } from '../broll.js';
import { pickProvider } from '../stock.js';
import { discover, timelineOf } from './artifacts.js';
import { checkpointOf, restoreArtifacts } from '../resume.js';

const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
class Cancelled extends Error {}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export const STEPS = {
  inspect: 'Analyze footage', transcript: 'Transcribe speech', script: 'Verify script', cut: 'Cut pauses and fillers',
  storyboard: 'Plan graphics, B-roll and sound', render: 'Render and master', short: 'Vertical short', final: 'Final approval'
};

export function plannedSteps(o) {
  const hasWords = Boolean(o.wordsFile) || o.transcribe !== false;
  const list = ['inspect'];
  if (hasWords) list.push('transcript', 'script');
  list.push('cut');
  if (hasWords && o.graphics !== 'off') list.push('storyboard');
  list.push('render');
  if (o.deliverable === 'both') list.push('short');
  if (o.gates?.final !== false) list.push('final');
  return list;
}

const defaults = { deliverable: 'long', content: 'talking-head', captions: 'kinetic', quality: 'final', transcribe: true,
  gates: { script: true, cut: false, storyboard: true, final: true }, style: 'bytemonk', target: 'youtube', voice: 'auto' };

export function normalizeOptions(raw = {}) {
  const o = { ...defaults, ...raw, gates: { ...defaults.gates, ...(raw.gates || {}) } };
  if (!['long', 'short', 'both', 'feed'].includes(o.deliverable)) fail('deliverable must be long, short, both or feed');
  if (!['final', 'draft'].includes(o.quality)) fail('quality must be final or draft');
  if (o.variants && (o.engine !== 'claude' || o.allowLlm !== true)) fail('Alternative graphic designs need the Claude engine and permission to use it');
  if (o.engine === 'claude' && o.allowLlm !== true) fail('The Claude engine sends transcript text to Anthropic: confirm permission to use it');
  if (o.sfxEngine === 'mirelo' && o.allowMirelo !== true) fail('Mirelo sends prompts to Mirelo and spends credits: confirm permission to use it');
  return o;
}

export class Runner {
  constructor(store, deps = {}) {
    this.store = store;
    this.active = new Map();
    this.deps = { analyzeFootage, transcribeWhisper, autoEdit, run, ...deps };
  }

  isActive(id) { return this.active.has(id); }

  // Projects left running by a previous server process can't be resumed: mark them so the UI is honest.
  async recover() {
    for (const p of await this.store.list()) {
      if (['running', 'waiting'].includes(p.status) && !this.active.has(p.id)) {
        p.status = 'interrupted'; p.pending = null;
        for (const s of Object.values(p.steps)) if (['running', 'waiting'].includes(s.status)) s.status = 'interrupted';
        const last = this.store.lastRun(p.id);
        if (last?.status === 'running') this.store.endRun(last.id, 'interrupted', 'the app was closed');
        await this.store.save(p);
      }
    }
  }

  async start(id) {
    const project = await this.store.get(id);
    if (this.active.has(id)) fail('This project is already running', 409);
    if (project.imported) fail('Imported projects are read-only', 400);
    if (project.status !== 'draft') fail('Only a new project can be started; resume it or duplicate it to run again', 409);
    const o = normalizeOptions(project.options);
    if (!project.options?.rightsConfirmed) fail('Confirm you have the rights to this footage before starting');
    project.options = o;
    project.status = 'running';
    project.startedAt = new Date().toISOString();
    project.steps = Object.fromEntries(plannedSteps(o).map(s => [s, { status: 'pending', label: STEPS[s] }]));
    project.root = path.join(this.store.dir(id), 'run');
    await this.store.save(project);
    this.#launch(project, o, null);
    return project;
  }

  // Resume an interrupted, failed or cancelled run: steps approved earlier keep their results and are not repeated; the run continues at the first unfinished step.
  async resume(id) {
    const project = await this.store.get(id);
    if (this.active.has(id)) fail('This project is already running', 409);
    if (project.imported) fail('Imported projects are read-only', 400);
    if (!['interrupted', 'failed', 'cancelled'].includes(project.status)) fail('Only an interrupted, failed or cancelled run can be resumed', 409);
    const o = normalizeOptions(project.options);
    const checkpoints = this.store.checkpoints(id);
    const done = Object.entries(project.steps).filter(([k, s]) => s.status === 'done' && (k !== 'final')).map(([k]) => k);
    for (const [k, s] of Object.entries(project.steps)) { if (!done.includes(k)) { project.steps[k] = { status: 'pending', label: STEPS[k] }; } else project.steps[k] = { ...s, restored: true }; }
    project.status = 'running'; project.pending = null; delete project.error; delete project.finishedAt;
    project.resumeCount = (project.resumeCount || 0) + 1;
    await this.store.save(project);
    this.#launch(project, o, { checkpoints });
    return project;
  }

  #launch(project, o, resumeInfo) {
    const id = project.id;
    const ctrl = new AbortController();
    const entry = { ctrl, project, options: o, gates: new Map(), manifestOverride: null, broll: null, current: null, runId: null };
    const previous = this.store.lastRun(id);
    entry.runId = this.store.startRun(id, resumeInfo ? previous?.id ?? null : null);
    this.active.set(id, entry);
    this.#run(entry, resumeInfo).catch(async error => {
      const cancelled = error instanceof Cancelled || ctrl.signal.aborted;
      project.status = cancelled ? 'cancelled' : 'failed';
      project.pending = null;
      if (!cancelled) project.error = String(error.message || error).slice(0, 2000);
      for (const [k, s] of Object.entries(project.steps)) if (['running', 'waiting'].includes(s.status)) project.steps[k] = { ...s, status: cancelled ? 'cancelled' : 'failed', ...(cancelled ? {} : { error: project.error }) };
      this.store.endRun(entry.runId, project.status, project.error || null);
      await this.store.save(project);
      await this.#emit(id, cancelled ? 'cancelled' : 'failed', { error: project.error });
    }).finally(() => this.active.delete(id));
  }

  cancel(id) {
    const entry = this.active.get(id);
    if (!entry) fail('This project is not running', 409);
    entry.ctrl.abort();
    for (const resolve of entry.gates.values()) resolve({ cancelled: true });
    return true;
  }

  async #emit(id, type, data = {}) { return this.store.appendEvent(id, { type, ...data }); }

  async #step(entry, id, patch) {
    const s = entry.project.steps[id];
    if (!s) return;
    Object.assign(s, patch);
    if (patch.status === 'running' && !s.startedAt) s.startedAt = new Date().toISOString();
    if (['done', 'failed', 'skipped'].includes(patch.status)) s.endedAt = new Date().toISOString();
    await this.store.save(entry.project);
    await this.#emit(entry.project.id, 'step', { step: id, ...s });
  }

  // --- approvals -------------------------------------------------------------------------------------------------------------
  async #approval(entry, record) {
    const p = entry.project;
    const full = { id: `a-${p.approvals.length + 1}`, at: new Date().toISOString(), by: os.userInfo().username, ...record };
    p.approvals.push(full);
    this.store.recordApproval(p.id, full);
    await this.store.save(p);
    const dir = this.store.dir(p.id);
    await writeFile(path.join(dir, 'approvals.json'), `${JSON.stringify({ version: 1, project: p.name, media: p.media?.path, approvals: p.approvals }, null, 1)}\n`);
    await writeFile(path.join(dir, 'APPROVALS.md'), approvalsMarkdown(p));
    return full;
  }

  async #gate(entry, name, payload, { step = name } = {}) {
    const p = entry.project;
    p.pending = { gate: name, step, since: new Date().toISOString(), payload };
    p.status = 'waiting';
    if (p.steps[step]) p.steps[step].status = 'waiting';
    await this.store.save(p);
    await this.#emit(p.id, 'gate', { gate: name, step });
    const decision = await new Promise(resolve => {
      entry.gates.set(name, resolve);
      entry.ctrl.signal.addEventListener('abort', () => resolve({ cancelled: true }), { once: true });
    });
    entry.gates.delete(name);
    if (decision.cancelled || entry.ctrl.signal.aborted) throw new Cancelled('cancelled');
    p.pending = null; p.status = 'running';
    if (p.steps[step]) p.steps[step].status = 'running';
    await this.store.save(p);
    await this.#emit(p.id, 'gate-resolved', { gate: name, step });
    return decision;
  }

  // Called by the server when the person answers the pending approval.
  async resolveGate(id, name, body) {
    const entry = this.active.get(id);
    if (!entry || entry.project.pending?.gate !== name) fail('There is nothing to approve here right now', 409);
    const resolve = entry.gates.get(name);
    if (!resolve) fail('That approval is no longer waiting', 409);
    // Validate here, so a mistake is an error the person can correct, not a failed run.
    if (name === 'final' && body.approved === true && !['watched', 'facts', 'rights'].every(k => body.checklist?.[k] === true)) fail('Tick every item in the checklist to approve');
    if (name === 'storyboard' && body.drop !== undefined && !Array.isArray(body.drop)) fail('drop must be a list of graphic ids');
    if (name === 'script' && body.accept !== undefined && !Array.isArray(body.accept)) fail('accept must be a list of correction ids');
    resolve({ ...body, at: Date.now() });
    return true;
  }

  // --- the run ---------------------------------------------------------------------------------------------------------------
  async #run(entry, resumeInfo = null) {
    const { project, options: o, ctrl } = entry;
    const cps = resumeInfo?.checkpoints || {};
    const reuse = async key => { const f = cps[key]?.file; return f && await exists(f) ? f : null; };
    const id = project.id;
    const dir = this.store.dir(id);
    const execute = (c, a, opts = {}) => this.deps.run(c, a, { ...opts, signal: ctrl.signal });
    const media = project.media.path;
    await this.#emit(id, resumeInfo ? 'run-resumed' : 'run-start', { media: project.media.name, restoredSteps: Object.entries(project.steps).filter(([, s]) => s.restored).map(([k]) => k) });
    this.store.db.touchMedia({ path: media, name: project.media.name, duration: project.media.duration });

    // 1. footage
    let analysis;
    const analysisFile = await reuse('ui:inspect');
    if (analysisFile && project.steps.inspect?.restored) { analysis = await readJson(analysisFile); await this.#emit(id, 'step', { step: 'inspect', ...project.steps.inspect }); }
    else {
      await this.#step(entry, 'inspect', { status: 'running' });
      analysis = await this.deps.analyzeFootage(media, execute);
      await writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 1));
      await this.#footageVisuals(media, path.join(dir, 'media'), analysis.duration, execute).catch(() => {});
      this.store.saveCheckpoint(id, 'ui:inspect', { file: path.join(dir, 'analysis.json') }, entry.runId);
      await this.#step(entry, 'inspect', { status: 'done', summary: { duration: analysis.duration, width: analysis.video?.width, height: analysis.video?.height, fps: analysis.video?.fps,
        lufs: analysis.audio?.integratedLufs, speechRatio: analysis.audio?.speechRatio, pauses: analysis.audio?.pauses, silenceSeconds: analysis.audio?.silenceSeconds, suggestions: analysis.suggestions } });
    }
    if (ctrl.signal.aborted) throw new Cancelled('cancelled');

    // 2. transcript
    let wordsFile = null;
    if (project.steps.transcript) {
      const kept = project.steps.transcript.restored ? await reuse('ui:transcript') : null;
      if (kept) { wordsFile = kept; await this.#emit(id, 'step', { step: 'transcript', ...project.steps.transcript }); }
      else {
        await this.#step(entry, 'transcript', { status: 'running' });
        if (o.wordsFile) { wordsFile = path.resolve(o.wordsFile); await this.#step(entry, 'transcript', { status: 'done', summary: { source: 'supplied words file' } }); }
        else {
          const out = path.join(dir, 'transcript');
          let t;
          if (await exists(path.join(out, 'words.json'))) { // a finished transcript left by an interrupted run
            t = { words: await readJson(path.join(out, 'words.json')), report: await readJson(path.join(out, 'transcription-report.json')).catch(() => ({})) };
          } else t = await this.deps.transcribeWhisper(media, out, { allowTranscribe: true, model: o.model, language: o.language, prompt: o.asrPrompt }, execute);
          wordsFile = path.join(out, 'words.json');
          await this.#step(entry, 'transcript', { status: 'done', summary: { words: t.words.length, model: t.report.model, language: t.report.language, cached: Boolean(t.report.cached) } });
        }
        this.store.saveCheckpoint(id, 'ui:transcript', { file: wordsFile }, entry.runId);
      }
    }

    // 3. script check, with approval of each correction
    if (project.steps.script && wordsFile) {
      const kept = project.steps.script.restored ? await reuse('ui:script') : null;
      if (kept) { wordsFile = kept; await this.#emit(id, 'step', { step: 'script', ...project.steps.script }); }
      else {
        await this.#step(entry, 'script', { status: 'running' });
        wordsFile = await this.#scriptStep(entry, wordsFile, dir);
        this.store.saveCheckpoint(id, 'ui:script', { file: wordsFile }, entry.runId);
      }
    }

    // 4-7. the staged pipeline with its review loops, paused for approval where asked
    const brief = resolveBrief({ deliverable: o.deliverable, content: o.content, vertical: o.vertical, shortLength: o.shortLength, shortPick: o.shortPick, shortFrom: o.shortFrom, shortTo: o.shortTo,
      pace: o.pace, graphics: o.graphics, captions: o.captions, sfx: o.sfx, target: o.target });
    const fromBrief = briefToAutoOptions(brief);
    const autoOptions = {
      format: fromBrief.format, pace: fromBrief.pace, fit: fromBrief.fit, captions: o.captions, target: o.target, voice: o.voice, style: o.style, title: project.name,
      rightsConfirmed: true, rights: o.rights, attribution: o.attribution, words: wordsFile || undefined, analysis, graphics: fromBrief.graphics,
      graphicsMode: o.graphicsMode || fromBrief.graphicsMode, theme: o.theme, engine: o.engine || 'rules', allowLlm: o.allowLlm === true, variants: o.variants || undefined,
      sfx: fromBrief.sfx, sfxEngine: o.sfxEngine, allowMirelo: o.allowMirelo === true, mireloBudget: o.mireloBudget, broll: o.broll || 'plan', content: o.content,
      deliverables: o.deliverable, shortFit: fromBrief.shortFit, shortMax: fromBrief.shortSelection?.maxSeconds, shortFrom: fromBrief.shortSelection?.from, shortTo: fromBrief.shortSelection?.to, shortPick: fromBrief.shortSelection?.pick,
      render: true, approvePlan: true, quality: o.quality, glossary: o.glossary ? parseGlossary(o.glossary) : undefined, reviewAgent: o.reviewAgent, maxRounds: o.maxRounds,
      jumpZoom: o.jumpZoom, speed: o.speed, removeFillers: o.removeFillers !== false, signal: ctrl.signal,
      log: line => this.#onLog(entry, line),
      onEvent: e => this.#onPipelineEvent(entry, e),
      gate: (stage, artifact, info) => this.#pipelineGate(entry, stage, artifact, info)
    };
    if (resumeInfo) {
      const { restored, missing } = await restoreArtifacts(cps, execute);
      const pipelineStages = Object.keys(restored);
      if (pipelineStages.length || missing.length) await this.#emit(id, 'log', { line: `Resuming: ${pipelineStages.length ? `restored ${pipelineStages.join(', ')} from the earlier run` : 'nothing to restore'}${missing.length ? `; files for ${missing.join(', ')} are gone, so those repeat` : ''}` });
      autoOptions.resume = { restored, shortDone: Boolean(project.steps.short?.status === 'done' && project.steps.short?.restored) };
    }
    const result = await this.deps.autoEdit(media, project.root, autoOptions, execute);
    if (ctrl.signal.aborted) throw new Cancelled('cancelled');
    const found = await discover(project.root);
    if (result.loop?.status === 'needs-human') {
      for (const s of Object.values(project.steps)) if (['running', 'waiting'].includes(s.status)) s.status = 'failed';
      project.status = 'needs-attention'; project.error = `The review loop stopped at ${result.loop.stoppedAt}. Open the review notes.`;
      this.store.endRun(entry.runId, 'needs-attention', project.error);
      await this.store.save(project);
      return this.#emit(id, 'needs-attention', { stage: result.loop.stoppedAt });
    }
    if (project.steps.render?.status !== 'done') await this.#step(entry, 'render', { status: 'done', summary: renderSummary(result.rendered) });
    if (project.steps.short) await this.#step(entry, 'short', { status: result.short ? 'done' : 'skipped', summary: result.short ? { duration: result.short.cut?.window?.duration, warnings: result.short.cut?.warnings } : undefined });

    // 8. final approval
    if (project.steps.final) {
      await this.#step(entry, 'final', { status: 'running' });
      const decision = await this.#gate(entry, 'final', { render: found.render, short: found.short, rendered: renderSummary(result.rendered), checks: result.rendered?.verification?.checks, humanReview: result.rendered?.humanReview });
      const ok = decision.approved === true;
      await this.#approval(entry, { gate: 'final', decision: ok ? 'approved' : 'changes-requested', note: decision.note || '', checklist: decision.checklist || {}, fingerprint: result.rendered?.fingerprint || null,
        summary: 'Final video reviewed end to end' });
      await this.#step(entry, 'final', { status: ok ? 'done' : 'failed', summary: { decision: ok ? 'approved' : 'changes requested', note: decision.note || '' } });
      project.status = ok ? 'done' : 'changes-requested';
    } else project.status = 'done';
    project.finishedAt = new Date().toISOString();
    project.pending = null;
    this.store.endRun(entry.runId, project.status);
    await this.store.save(project);
    await this.#emit(id, 'done', { status: project.status });
  }

  async #footageVisuals(media, dir, duration, execute) {
    await mkdir(dir, { recursive: true });
    await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', media, '-lavfi', 'aformat=channel_layouts=mono,showwavespic=s=1400x160:colors=#4cc9f0', '-frames:v', '1', path.join(dir, 'waveform.png')], { timeout: 300000 });
    for (let i = 0; i < 6; i++) await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(Math.max(0, duration * (i + 0.5) / 6)), '-i', media, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', path.join(dir, `frame-${i + 1}.jpg`)], { timeout: 60000 });
  }

  async #scriptStep(entry, wordsFile, dir) {
    const { project, options: o } = entry;
    const words = await readJson(wordsFile);
    // Terms you corrected in earlier projects are checked again, unless you turned that off.
    const remembered = o.useRemembered === false ? '' : this.store.db.glossaryText();
    const glossary = parseGlossary([o.glossary || '', remembered].filter(Boolean).join('\n'));
    const found = findMisheard(words, glossary);
    const candidates = found.map((f, i) => ({ id: `c${i + 1}`, index: f.index, count: f.count, heard: f.heard, to: f.to, kind: f.kind, term: f.term,
      before: words.slice(Math.max(0, f.index - 8), f.index).map(w => w.text).join(' '), after: words.slice(f.index + f.count, f.index + f.count + 8).map(w => w.text).join(' '), at: words[f.index].start }));
    const sdir = path.join(this.store.dir(project.id), 'script');
    await mkdir(sdir, { recursive: true });
    await writeFile(path.join(sdir, 'candidates.json'), JSON.stringify({ glossary, candidates }, null, 1));
    if (!candidates.length && !o.gates.alwaysScript) {
      await this.#step(entry, 'script', { status: 'done', summary: { candidates: 0, applied: 0, note: glossary.length ? 'No mis-heard terms found for your glossary' : 'No glossary given: nothing to check' } });
      return wordsFile;
    }
    let decision = { accept: candidates.map(c => c.id), custom: {}, manual: [] };
    if (o.gates.script !== false) decision = await this.#gate(entry, 'script', { candidates, wordCount: words.length, glossary });
    const accept = new Set(decision.accept || []);
    const fixes = candidates.filter(c => accept.has(c.id)).map(c => ({ index: c.index, count: c.count, to: decision.custom?.[c.id] || c.to, reason: `heard "${c.heard}", you confirmed "${decision.custom?.[c.id] || c.to}"` }));
    for (const m of decision.manual || []) if (m.phrase && m.to) fixes.push({ phrase: m.phrase, to: m.to, reason: 'added by you' });
    const applied = applyScriptFixes(words, fixes);
    // Remember what you confirmed, so the next project catches it without being told.
    for (const c of candidates.filter(c => accept.has(c.id))) this.store.db.learnTerm(c.heard.split(/\s+/).join(' '), decision.custom?.[c.id] || c.to, glossary.find(g => g.term === c.term)?.hints || []);
    for (const m of decision.manual || []) if (m.phrase && m.to) this.store.db.learnTerm(m.phrase, m.to, []);
    const out = path.join(sdir, 'words.corrected.json');
    await writeFile(out, JSON.stringify(applied.words, null, 2));
    await writeFile(path.join(sdir, 'words.corrected.fixes.md'), fixesMarkdown(applied.log));
    await this.#approval(entry, { gate: 'script', decision: 'approved', note: decision.note || '', summary: `${applied.log.length} correction(s) applied, ${candidates.length - accept.size} left as heard`, details: applied.log });
    await this.#step(entry, 'script', { status: 'done', summary: { candidates: candidates.length, applied: applied.log.length, rejected: candidates.length - accept.size } });
    return out;
  }

  // --- pipeline observers ------------------------------------------------------------------------------------------------------
  #onLog(entry, line) {
    const id = entry.project.id;
    const text = String(line).replace(/\s+$/, '');
    if (!text) return;
    this.#emit(id, 'log', { line: text.slice(0, 400), step: entry.current });
    let m;
    const progress = (phase, extra = {}) => this.#emit(id, 'progress', { step: 'render', phase, ...extra });
    if ((m = text.match(/Rendering (\d+) motion graphic/))) { entry.render = { total: Number(m[1]), done: 0 }; progress('graphics', entry.render); }
    else if (/^\s+motion \S+:/.test(text) && entry.render) { entry.render.done++; progress('graphics', entry.render); }
    else if (/Compositing \d+ scene/.test(text)) progress('compositing');
    else if (/Mixing audio/.test(text)) progress('audio');
    else if (/Encoding final video/.test(text)) progress('encoding');
    else if (/Writing captions/.test(text)) progress('deliverables');
    else if (/Cutting the vertical short/.test(text)) { this.#step(entry, 'render', { status: 'done' }); this.#step(entry, 'short', { status: 'running' }); }
  }

  #onPipelineEvent(entry, e) {
    const id = entry.project.id;
    const stepOf = stage => (stage === 'transcript' ? null : stage);
    if (e.type === 'stage-start') {
      const step = stepOf(e.stage);
      if (step && entry.project.steps[step]) { entry.current = step; this.#step(entry, step, { status: 'running', restored: undefined, rerun: e.rerun || undefined }); }
    } else if (e.type === 'stage-produced') {
      const step = stepOf(e.stage);
      if (step === 'cut') this.#step(entry, 'cut', { summary: cutSummary(e.artifact?.result?.report) });
      if (step === 'storyboard') this.#step(entry, 'storyboard', { summary: storyboardSummary(e.artifact) });
    } else if (e.type === 'stage-done') {
      const cp = checkpointOf(e.stage, e.artifact);
      if (cp) this.store.saveCheckpoint(id, e.stage, cp, entry.runId);
    } else if (e.type === 'stage-restored') {
      const step = stepOf(e.stage);
      if (step && entry.project.steps[step]) this.#step(entry, step, { status: 'done', restored: true, summary: step === 'cut' ? cutSummary(e.artifact.result?.report) : step === 'storyboard' ? storyboardSummary(e.artifact) : step === 'render' ? renderSummary(e.artifact.report) : undefined });
    } else if (e.type === 'ledger') this.#emit(id, 'ledger', { entry: e.entry });
  }

  async #pipelineGate(entry, stage, artifact, info) {
    const o = entry.options;
    const p = entry.project;
    const step = stage === 'transcript' ? null : stage;
    const escalated = Boolean(info?.escalated);
    const wanted = escalated || (stage === 'storyboard' && o.gates.storyboard !== false) || (stage === 'cut' && o.gates.cut === true);
    if (!wanted || !step || !p.steps[step]) {
      if (step === 'render' && p.steps.render) await this.#step(entry, 'render', { status: 'done', summary: renderSummary(artifact?.report) });
      else if (step && p.steps[step] && p.steps[step].status !== 'done') await this.#step(entry, step, { status: 'done' });
      return { approved: true };
    }
    if (escalated) {
      const decision = await this.#gate(entry, `escalated-${stage}`, { stage, findings: info.findings || [], message: 'The reviewer and the producer could not settle this. Continue anyway, or stop here and look at the notes.' }, { step });
      await this.#approval(entry, { gate: `escalated-${stage}`, decision: decision.approved ? 'continued-anyway' : 'stopped', note: decision.note || '', summary: `Open findings at ${stage}` });
      return { approved: decision.approved === true };
    }
    const payload = await this.#stagePayload(entry, stage, artifact);
    const decision = await this.#gate(entry, stage, payload, { step });
    if (stage === 'storyboard') {
      const drop = (decision.drop || []).filter(x => typeof x === 'string');
      if (drop.length) {
        entry.manifestOverride = null;
        await this.#approval(entry, { gate: 'storyboard', decision: 'edited', note: decision.note || '', summary: `Removed ${drop.length} graphic(s): ${drop.join(', ')}` });
        return { approved: false, findings: drop.map(d => finding({ id: `human-drop-${d}`, severity: 'major', owner: 'storyboard', target: { item: d }, message: 'Removed by you during approval', fix: { op: 'dropItem', id: d } })) };
      }
      const manifestFile = entry.manifestOverride || artifact.manifestFile;
      let fingerprint = null;
      try { fingerprint = createHash('sha256').update(await readFile(manifestFile)).digest('hex').slice(0, 16); } catch { /* ignore */ }
      await this.#approval(entry, { gate: 'storyboard', decision: 'approved', note: decision.note || '', fingerprint, summary: `${payload.items.length} graphic(s), ${payload.broll?.placed ?? 0} B-roll clip(s), ${payload.sfx.length} sound cue(s) approved for rendering`, rights: 'Footage rights and stock licences confirmed by the user' });
      await this.#step(entry, 'storyboard', { status: 'done', summary: { ...storyboardSummary(artifact), approvedAt: new Date().toISOString() } });
      return { approved: true, ...(entry.manifestOverride ? { patch: { manifestFile: entry.manifestOverride } } : {}) };
    }
    await this.#approval(entry, { gate: stage, decision: 'approved', note: decision.note || '', summary: `${stage} approved` });
    await this.#step(entry, step, { status: 'done' });
    return { approved: true };
  }

  async #stagePayload(entry, stage, artifact) {
    if (stage === 'cut') return { report: artifact.result?.report ? cutSummary(artifact.result.report) : null, manifest: artifact.manifestFile };
    const sb = artifact.storyboard;
    const manifestFile = entry.manifestOverride || artifact.manifestFile;
    let plan = null, planFile = null;
    const stem = artifact.manifestFile.replace(/\.json$/, '');
    if (await exists(`${stem}.BROLL-PLAN.json`)) { planFile = `${stem}.BROLL-PLAN.json`; plan = await readJson(planFile); }
    entry.baseManifest = artifact.manifestFile;
    const manifest = await readJson(manifestFile);
    return {
      theme: sb.theme, density: sb.density, engine: sb.engine, stats: sb.stats, notes: sb.notes, captionsOn: Boolean(manifest.captions) && manifest.captions.burnIn !== false,
      items: sb.items.map(i => ({ id: i.id, template: i.template, mode: i.mode, start: i.start, duration: i.duration, why: i.why, line: i.line, score: i.score, props: i.props,
        alternatives: i.alternatives?.map(a => ({ approach: a.approach, template: a.template, rejected: a.rejected })), chosen: i.chosen })),
      sfx: (manifest.audio?.sfx || []).map(x => ({ at: x.at, kind: String(x.asset).replace(/^sfx-/, ''), gainDb: x.gainDb })),
      broll: { plan, planFile, placed: manifest.scenes.reduce((n, s) => n + (Array.isArray(s.broll) ? s.broll.length : 0), 0), placements: entry.broll?.placements || null },
      timeline: await timelineOf(manifestFile), manifest: manifestFile
    };
  }

  // --- actions during the storyboard approval: fetch and apply B-roll --------------------------------------------------------
  async brollFetch(id, body = {}) {
    const entry = this.active.get(id);
    if (!entry || entry.project.pending?.gate !== 'storyboard') fail('B-roll can be fetched while the storyboard is waiting for approval', 409);
    if (!(body.allowSearch && body.allowDownload && body.rightsConfirmed)) fail('Fetching B-roll sends search words to the stock site and downloads files: confirm all three permissions');
    const payload = entry.project.pending.payload;
    if (!payload.broll?.plan?.moments?.length) fail('There are no planned B-roll moments');
    const manifest = await readJson(entry.baseManifest || payload.manifest);
    const dir = path.join(entry.project.root, `broll-${Date.now().toString(36)}`);
    const library = await Library.open();
    const result = await fetchPlan(payload.broll.plan, { dir, manifest, search: true, download: { allowDownload: true, rightsConfirmed: true, library }, library, provider: pickProvider('auto', process.env, 'video'), type: body.type || 'any',
      max: Math.min(8, Number(body.max) || 6), only: Array.isArray(body.only) && body.only.length ? body.only : null, log: line => this.#onLog(entry, line) });
    entry.broll = { dir, file: result.file, placements: result.placements.map(p => ({ ...p, previewPath: p.preview ? path.join(dir, p.preview) : null })) };
    payload.broll.placements = entry.broll.placements.map(({ previewPath, ...rest }) => ({ ...rest, previewUrl: previewPath ? `/api/projects/${id}/file?p=${encodeURIComponent(path.relative(entry.project.root, previewPath))}` : null }));
    await this.store.save(entry.project);
    await this.#approval(entry, { gate: 'broll-fetch', decision: 'permitted', summary: `Search and download permitted for ${result.placements.length} moment(s); licences confirmed for the selected clips` });
    await this.#emit(id, 'broll', { placements: payload.broll.placements });
    return payload.broll.placements;
  }

  async brollApply(id, body = {}) {
    const entry = this.active.get(id);
    if (!entry?.broll || entry.project.pending?.gate !== 'storyboard') fail('Fetch B-roll first', 409);
    const record = await readJson(entry.broll.file);
    const drop = new Set(body.drop || []);
    for (const p of record.placements) p.drop = drop.has(p.id) || !p.assetDir;
    await writeFile(entry.broll.file, JSON.stringify(record, null, 1));
    const baseManifest = entry.baseManifest;
    const out = `${baseManifest.replace(/\.json$/, '')}.broll.${Date.now().toString(36)}.json`;
    const applied = await applyPlacements(baseManifest, out, entry.broll.file, { fit: body.fit });
    entry.manifestOverride = out;
    entry.project.pending.payload.broll.placed = applied.placed;
    entry.project.pending.payload.timeline = await timelineOf(out);
    await this.store.save(entry.project);
    await this.#emit(id, 'broll-applied', { placed: applied.placed, warnings: applied.warnings });
    return { placed: applied.placed, warnings: applied.warnings, skipped: applied.results.filter(r => r.skipped) };
  }
}

function cutSummary(r) {
  if (!r) return null;
  return { sourceDuration: r.sourceDuration, editedDuration: r.editedDuration, removedSeconds: r.removedSeconds, cuts: r.cuts, fillersRemoved: r.fillersRemoved, quietSeconds: r.quietSeconds, pace: r.settings?.pace, speed: r.speed };
}
function storyboardSummary(a) {
  const sb = a?.storyboard;
  if (!sb) return null;
  return { graphics: sb.stats.graphics, perMinute: sb.stats.perMinute, cutawaySeconds: sb.stats.cutawaySeconds, engine: sb.engine, byTemplate: sb.stats.byTemplate, variants: sb.stats.variants || null };
}
function renderSummary(r) {
  if (!r) return null;
  const m = r.verification?.measured || {};
  return { status: r.status, duration: r.timeline?.duration, lufs: m.integratedLufs, truePeak: m.truePeakDb, width: m.width, height: m.height, renderSeconds: r.renderSeconds, motionGraphics: r.timeline?.motionGraphics, checks: r.verification?.checks, warnings: r.warnings };
}

export function approvalsMarkdown(p) {
  const rows = p.approvals.map(a => `| ${a.at.replace('T', ' ').slice(0, 19)} | ${a.gate} | ${a.decision} | ${a.by} | ${(a.summary || '').replace(/\|/g, '/')}${a.note ? ` (note: ${a.note.replace(/\|/g, '/')})` : ''} |`);
  return `# Approvals: ${p.name}\n\nSource: ${p.media?.path}\n\n| When | Step | Decision | By | What |\n|---|---|---|---|---|\n${rows.join('\n') || '| | | | | none yet |'}\n\nThese records show who approved what and when. They do not verify facts, wording or rights.\n`;
}
