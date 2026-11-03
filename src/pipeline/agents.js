// The agents of a short and the events that wake them. No agent calls another: each subscribes to event types, does its work, and publishes what happened.
//
//   short.requested ─► script-writer ─► script.written ─► script-reviewer ─► script.approved | script.revise (back to the writer, with the findings)
//   script.approved ─► director ─► direction.proposed ─► direction-reviewer ─► direction.ready | direction.revise
//   direction.ready ─► visual-planner (waits for YOU to approve the direction) ─► visuals.researched ─► visual-reviewer ─► visuals.ready | visuals.revise | (skipped)
//   visuals.ready ─► narrator (waits for you to approve the pictures and the credits to spend) ─► audio.recorded ─► audio-reviewer ─► audio.ready | script.revise
//   audio.ready ─► producer (waits for you to have listened) ─► plan.ready ─► plan-reviewer ─► plan.reviewed | audio.ready (re-plan)
//   plan.reviewed ─► renderer (waits for your plan approval; slow, no deadline) ─► render.done ─► final-reviewer ─► short.completed | audio.ready (fix, re-plan, re-render) | needs.human
//
// Every review is stored, every recurring finding becomes a lesson that the producing agents read next time, and anything that still fails after the round limit goes to the person.
import path from 'node:path';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { run, exists } from '../core.js';
import { Queue, WaitForGate } from './queue.js';
import * as L from './lessons.js';
import * as R from './reviewers.js';
import { elevenConfig, listVoices } from '../elevenlabs.js';
import { shortOptions, writeScript, generateNarration, planShort, recommendDirection, normalizeDirection, shortsModel, estimate, isV3, isV4 } from '../shorts.js';
import { researchVisuals, readVisuals } from '../visuals.js';
import { reviewProduction, buildProduction } from '../production.js';

const note = f => `${f.message}${f.suggestion ? ` (${f.suggestion})` : ''}`;
const blocking = f => f.severity === 'blocker' || f.severity === 'major';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJsonFile = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);

export function createPipeline({ db, root, execute = run, fetcher = fetch, env = process.env, cwd = process.cwd(), store = null, maxRounds = 3, maxReroutes = 2, verifyAudio = true, log = () => {}, now = () => Date.now() }) {
  const queue = new Queue(db, { now });
  const dirOf = id => path.join(root, id);
  const stateFile = id => path.join(dirOf(id), 'short.json');

  // what an agent can see and do for one job
  const apiFor = job => {
    const shortId = job.short_id, dir = dirOf(shortId);
    const api = {
      shortId, dir, job,
      st: async () => readJson(stateFile(shortId)),
      save: async patch => { const s = { ...(await readJson(stateFile(shortId))), ...patch, updatedAt: new Date().toISOString() }; await writeJsonFile(stateFile(shortId), s); return s; },
      script: async () => readJson(path.join(dir, 'script.json')).catch(() => null),
      gate: (name, why = '') => { if (!queue.granted(shortId, name)) throw new WaitForGate(name, why); },
      emit: (type, payload = {}) => queue.publish(shortId, type, payload, { parentId: job.id }),
      log: message => log(`[${shortId}] ${message}`)
    };
    api.options = async () => { const s = await api.st(); const m = s.direction?.modelId || s.modelId || shortsModel({}); return shortOptions({ ...s.options, audioTags: isV4(m) ? 'v4' : isV3(m) }); };
    api.allowLlm = () => queue.granted(shortId, 'llm');
    return api;
  };
  const lessonsFor = async (api, stage) => { const b = L.lessonBlock(db, stage); const s = await api.st(); await api.save({ applied: { ...(s.applied || {}), [stage]: b.ids } }); return b.text; };

  // store the review, learn from it, and publish what happens next
  async function conclude(api, stage, review, { approved, revised, payload = {} }) {
    const round = L.roundFor(db, api.shortId, stage);
    L.recordReview(db, { shortId: api.shortId, stage, round, reviewer: review.reviewer, verdict: review.verdict, findings: review.findings, metrics: review.metrics, jobId: api.job.id, now: now() });
    for (const f of review.findings) if (f.code && f.lesson) L.learn(db, f, { stage, source: f.reviewer === 'claude' ? 'claude' : 'code', now: now() });
    const s = await api.st();
    L.judgeLessons(db, stage, s.applied?.[stage] || [], review.findings);
    await api.save({ applied: { ...(s.applied || {}), [stage]: [] }, lastReview: { ...(s.lastReview || {}), [stage]: { round, verdict: review.verdict, at: new Date().toISOString() } } });
    const notes = review.findings.filter(f => !blocking(f));
    if (review.verdict === 'approve') return api.emit(approved, { ...payload, round, notes: notes.map(f => f.message).slice(0, 12) });
    if (round < maxRounds) return api.emit(revised, { ...payload, round, findings: review.findings.filter(blocking).concat(notes) });
    return api.emit('needs.human', { stage, round, findings: review.findings.filter(blocking), reason: `still not approved after ${round} review rounds` });
  }
  const reroutes = async (api, key) => { const s = await api.st(); return (s.reroutes || {})[key] || 0; };
  const bumpReroute = async (api, key) => { const s = await api.st(); await api.save({ reroutes: { ...(s.reroutes || {}), [key]: ((s.reroutes || {})[key] || 0) + 1 } }); };

  // ------------------------------------------------------------ the agents
  const agents = {
    'script-writer': { on: ['short.requested', 'script.revise'], async run(job, api) {
      api.gate('llm', 'writing the script sends your text to Claude');
      const s = await api.st(), options = await api.options();
      const prior = job.type === 'script.revise' ? await api.script() : null;
      const feedback = job.type === 'script.revise' ? (job.payload.findings || []).map(note) : null;
      api.log(prior ? 'rewriting the script with the reviewer\'s findings' : 'writing the script');
      const written = await writeScript(s.source, options, { kind: s.kind, execute, lessons: await lessonsFor(api, 'script'), previous: prior, feedback });
      await writeJsonFile(path.join(api.dir, 'script.json'), written.script);
      await api.save({ title: written.script.title, stage: 'script' });
      api.emit('script.written', { round: L.roundFor(db, api.shortId, 'script'), warnings: written.warnings });
    } },
    'script-reviewer': { on: ['script.written'], async run(job, api) {
      const s = await api.st(), script = await api.script(), options = await api.options();
      const review = await R.reviewScript({ script, source: s.source, options, allowLlm: api.allowLlm(), execute, cwd: api.dir });
      await conclude(api, 'script', review, { approved: 'script.approved', revised: 'script.revise' });
    } },

    'director': { on: ['script.approved', 'direction.revise'], async run(job, api) {
      const s = await api.st(), script = await api.script(), options = await api.options();
      if (job.type === 'script.approved' && s.direction?.approved) { api.log('direction already approved: reusing it'); return api.emit('direction.ready', { reused: true }); }
      const cfg = await elevenConfig(env, cwd);
      const modelId = s.direction?.modelId || s.modelId || shortsModel(cfg);
      if (job.type === 'direction.revise' && s.direction) {
        // simple problems are fixed in code; anything else goes back to Claude with the findings
        let d = { ...s.direction }, fixed = 0;
        for (const f of job.payload.findings || []) {
          if (f.code === 'direction.model-ignores-tags') { d.modelId = shortsModel({}); fixed++; }
          if (f.code === 'direction.flat-delivery') { d.voiceSettings = { ...d.voiceSettings, stability: 0.4 }; fixed++; }
          if (f.code === 'direction.too-wild') { d.voiceSettings = { ...d.voiceSettings, stability: 0.5 }; fixed++; }
          if (f.code === 'direction.sfx-too-busy') { d.sfx = 'subtle'; fixed++; }
        }
        if (fixed) { await api.save({ direction: { ...d, approved: false }, modelId: d.modelId, options: shortOptions({ ...s.options, sfx: d.sfx || s.options.sfx }) }); return api.emit('direction.proposed', { fixes: fixed }); }
      }
      api.gate('llm', 'choosing the voice and look sends the script and your voice names to Claude');
      let voices = [];
      if (cfg.hasKey) { try { voices = await listVoices({ env, cwd, fetcher, max: 60 }); } catch { /* defaults */ } }
      const feedback = job.type === 'direction.revise' ? (job.payload.findings || []).map(note) : null;
      const direction = await recommendDirection(script, options, { voices, modelId, fallbackVoiceId: cfg.voiceId, execute, lessons: await lessonsFor(api, 'direction'), feedback });
      await api.save({ modelId, direction: { ...direction, approved: false }, voicesSeen: voices.map(v => v.id), stage: 'script' });
      api.emit('direction.proposed', {});
    } },
    'direction-reviewer': { on: ['direction.proposed'], async run(job, api) {
      const s = await api.st(), script = await api.script(), options = await api.options();
      const voices = (s.voicesSeen || []).map(id => ({ id }));
      const review = await R.reviewDirection({ direction: s.direction, script, options, voices: voices.length ? voices : null, allowLlm: false, execute });
      await conclude(api, 'direction', review, { approved: 'direction.ready', revised: 'direction.revise' });
    } },

    'visual-planner': { on: ['direction.ready', 'visuals.revise'], async run(job, api) {
      api.gate('direction', 'approve the direction (voice, delivery, look)');
      const s = await api.st(), script = await api.script();
      const file = path.join(api.dir, 'visuals.json');
      if (job.type === 'visuals.revise') {
        const v = await readVisuals(file); let changed = 0;
        for (const f of job.payload.findings || []) {
          const op = f.fix; if (op?.op !== 'drop') continue;
          const beat = v.beats.find(b => b.beat === op.beat); if (!beat) continue;
          if (op.kind === 'logo' && beat.logos[op.index]) { Object.assign(beat.logos[op.index], { status: 'dropped', approved: false, reason: `dropped by the reviewer: ${f.message}` }); changed++; }
          if (op.kind === 'broll' && beat.broll) { Object.assign(beat.broll, { status: 'dropped', approved: false }); changed++; }
          for (const s3 of [].concat(v.scene3d || [])) if (s3.beat === op.beat && s3.kind === 'hero') s3.approved = false;
        }
        await writeJsonFile(file, v);
        api.log(`applied ${changed} reviewer fixes to the picture candidates`);
        return api.emit('visuals.researched', { fixes: changed });
      }
      if (await exists(file)) { api.log('picture candidates already exist: reviewing them again'); return api.emit('visuals.researched', { reused: true }); }
      const browse = queue.granted(api.shortId, 'browse'), stock = queue.granted(api.shortId, 'stock');
      if (!browse && !stock) { api.log('no permission to visit websites or search stock: skipping pictures'); return api.emit('visuals.skipped', {}); }
      api.gate('llm', 'asking Claude where pictures help sends the script and source text to Claude');
      await researchVisuals({ script, source: s.source, dir: api.dir, lessons: await lessonsFor(api, 'visuals'), allowLlm: true, allowBrowse: browse, allowStock: stock, allowStockDownload: stock, rightsConfirmed: stock, execute, fetcher, log: m => api.log(m) });
      api.emit('visuals.researched', {});
    } },
    'visual-reviewer': { on: ['visuals.researched'], async run(job, api) {
      const script = await api.script(), visuals = await readVisuals(path.join(api.dir, 'visuals.json'));
      const review = await R.reviewVisuals({ visuals, script, base: api.dir, allowLlm: api.allowLlm(), execute });
      await conclude(api, 'visuals', review, { approved: 'visuals.ready', revised: 'visuals.revise' });
    } },

    'narrator': { on: ['visuals.ready', 'visuals.skipped'], async run(job, api) {
      if (job.type === 'visuals.ready') api.gate('visuals', 'approve the pictures (logos, footage, 3D scenes)');
      const s = await api.st(), script = await api.script(), d = s.direction;
      const cfg = await elevenConfig(env, cwd);
      if (!cfg.hasKey) throw new Error('ELEVENLABS_API_KEY is not set');
      const spend = queue.granted(api.shortId, 'spend'), maxChars = queue.gateDetails(api.shortId, 'spend')?.maxChars || 3000;
      const options = await api.options();
      const args = { dir: api.dir, voiceId: d.voiceId, modelId: d.modelId, voiceSettings: d.voiceSettings, languageCode: options.language === 'en' ? undefined : options.language, maxChars, db, projectId: `short-${api.shortId}`, env, cwd, fetcher, execute, onBeat: (n, cached) => api.log(`beat ${n}: ${cached ? 'already recorded' : 'recorded'}`) };
      let audio;
      try { audio = await generateNarration(script, { ...args, allowSpend: spend }); }
      catch (error) { if (/not recorded yet/.test(error.message)) throw new WaitForGate('spend', `recording needs ElevenLabs credits (${estimate(script).characters} characters)`); throw error; }
      if (audio.recorded) {
        queue.revoke(api.shortId, 'spend');            // one go-ahead covers one recording; recording again asks again
        if (s.recordedOnce) queue.revoke(api.shortId, 'audio');   // new recordings must be listened to again
        await api.save({ recordedOnce: true });
      }
      await writeJsonFile(path.join(api.dir, 'audio-info.json'), { totalSeconds: audio.totalSeconds, layout: audio.layout, files: audio.files, recorded: audio.recorded, cached: audio.cached, characters: audio.characters });
      await api.save({ beatAudio: audio.files, narrationSeconds: audio.totalSeconds, recorded: audio.recorded, cached: audio.cached, voice: { id: d.voiceId, name: d.voiceName, modelId: d.modelId, settings: d.voiceSettings } });
      api.emit('audio.recorded', { seconds: audio.totalSeconds });
    } },
    'audio-reviewer': { on: ['audio.recorded'], async run(job, api) {
      const script = await api.script(), options = await api.options(), info = await readJson(path.join(api.dir, 'audio-info.json'));
      const review = await R.reviewAudio({ script, audio: { ...info, narration: path.join(api.dir, 'narration.wav') }, options, execute, workDir: api.dir, transcribe: verifyAudio });
      // a script-owned problem (too long) is sent back to the writer once; everything else is the person's call
      const toScript = review.findings.filter(f => blocking(f) && f.owner === 'script');
      if (review.verdict === 'revise' && toScript.length && await reroutes(api, 'script') < maxReroutes) {
        L.recordReview(db, { shortId: api.shortId, stage: 'audio', round: L.roundFor(db, api.shortId, 'audio'), reviewer: review.reviewer, verdict: 'revise', findings: review.findings, metrics: review.metrics, jobId: job.id, now: now() });
        for (const f of review.findings) if (f.code && f.lesson) L.learn(db, f, { stage: 'audio', source: 'code', now: now() });
        await bumpReroute(api, 'script');
        await rm(path.join(api.dir, 'visuals.json.stale'), { force: true });
        return api.emit('script.revise', { findings: toScript, from: 'audio-reviewer' });
      }
      await conclude(api, 'audio', review, { approved: 'audio.ready', revised: 'needs.human', payload: { stage: 'audio' } });
    } },

    'producer': { on: ['audio.ready'], async run(job, api) {
      api.gate('audio', 'listen to each beat and approve the narration');
      const s = await api.st(), script = await api.script(), d = s.direction, options = await api.options();
      const info = await readJson(path.join(api.dir, 'audio-info.json'));
      for (const f of ['production.json', 'brief.json', 'facts.json', 'PLAN.md', 'review.json', 'sfx', 'scenes', 'build']) await rm(path.join(api.dir, f), { recursive: true, force: true });
      const visuals = await readVisuals(path.join(api.dir, 'visuals.json')).catch(() => null);
      const audio = { ...info, narration: path.join(api.dir, 'narration.wav'), words: [] };
      const planned = await planShort(script, audio, api.dir, { ...options, ...Object.fromEntries(['captions', 'theme', 'sfx', 'calm', 'onTwos', 'current', 'bed'].map(k => [k, d[k] ?? options[k]])) }, { source: s.source, provider: { voiceId: d.voiceId, voiceName: d.voiceName, modelId: d.modelId }, visuals });
      await api.save({ stage: 'planned', planWarnings: planned.warnings || [], planNotes: planned.visuals || [] });
      api.emit('plan.ready', { warnings: planned.warnings || [] });
    } },
    'plan-reviewer': { on: ['plan.ready'], async run(job, api) {
      const s = await api.st(), script = await api.script(), options = await api.options();
      const review = await R.reviewPlan({ manifestFile: path.join(api.dir, 'production.json'), script, options, warnings: s.planWarnings || [], execute });
      await conclude(api, 'plan', review, { approved: 'plan.reviewed', revised: 'audio.ready', payload: { replan: true } });
    } },

    'renderer': { on: ['plan.reviewed'], async run(job, api) {
      api.gate('plan', 'approve the plan: you have read the script, listened to the voice and checked the pictures');
      const s = await api.st(), quality = queue.gateDetails(api.shortId, 'plan')?.quality === 'final' ? 'final' : 'draft';
      const manifest = path.join(api.dir, 'production.json'), reviewFile = path.join(api.dir, 'review.json');
      await rm(path.join(api.dir, 'build'), { recursive: true, force: true }); await rm(reviewFile, { force: true });
      const report = await reviewProduction(manifest, reviewFile, true, execute);
      if (store) store.recordApproval(`short-${api.shortId}`, { gate: 'short-build', decision: 'approved', by: 'local user', at: new Date().toISOString(), summary: `Short "${s.title}": reviewed by the pipeline, then approved (${quality})`, fingerprint: (await readJson(reviewFile)).fingerprint || null, details: { scenes: report.scenes, seconds: report.duration } });
      api.log('building the video: this takes as long as it takes (3D pages are slow)');
      const built = await buildProduction(manifest, reviewFile, path.join(api.dir, 'build'), true, execute, 'ffmpeg', { quality, log: m => api.log(m) });
      await api.save({ stage: 'built', quality });
      api.emit('render.done', { status: built.status });
    } },
    'final-reviewer': { on: ['render.done'], async run(job, api) {
      const s = await api.st(), build = path.join(api.dir, 'build');
      const manifest = await readJson(path.join(api.dir, 'production.json')), report = await readJson(path.join(build, 'report.json')).catch(() => null);
      // a still from the middle of every scene for the visual review
      const frames = []; let t = 0;
      await mkdir(path.join(api.dir, 'review-frames'), { recursive: true });
      for (const [i, sc] of manifest.scenes.entries()) { const at = t + sc.duration / 2; t += sc.duration; const out = path.join(api.dir, 'review-frames', `scene-${i + 1}.png`); try { await execute(process.env.VIDEO_MONK_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(at.toFixed(2)), '-i', path.join(build, 'final.mp4'), '-frames:v', '1', '-vf', 'scale=540:-1', out]); frames.push(out); } catch { /* a missing still only weakens the visual review */ } }
      const review = await R.reviewRender({ video: path.join(build, 'final.mp4'), report, manifest, contactSheet: await exists(path.join(build, 'contact-sheet.png')) ? path.join(build, 'contact-sheet.png') : null, frames, allowLlm: api.allowLlm(), execute });
      const round = L.roundFor(db, api.shortId, 'render');
      const fixable = review.findings.filter(f => blocking(f) && ['visuals', 'plan', 'render'].includes(f.owner));
      const human = review.findings.filter(f => blocking(f) && !['visuals', 'plan', 'render'].includes(f.owner));
      if (review.verdict === 'revise' && fixable.length && !human.length && await reroutes(api, 'render') < maxReroutes) {
        // fixes that cost no credits are made automatically: drop what the reviewer flagged, then re-plan and re-render
        L.recordReview(db, { shortId: api.shortId, stage: 'render', round, reviewer: review.reviewer, verdict: 'revise', findings: review.findings, metrics: review.metrics, jobId: job.id, now: now() });
        for (const f of review.findings) if (f.code && f.lesson) L.learn(db, f, { stage: 'render', source: f.reviewer === 'claude' ? 'claude' : 'code', now: now() });
        await bumpReroute(api, 'render');
        const drops = fixable.filter(f => f.fix?.op === 'drop');
        if (drops.length) { const v = await readVisuals(path.join(api.dir, 'visuals.json')).catch(() => null); if (v) { for (const f of drops) { const b = v.beats.find(x => x.beat === f.fix.beat); if (!b) continue; if (f.fix.kind === 'logo' && b.logos[f.fix.index]) b.logos[f.fix.index].approved = false; if (f.fix.kind === 'broll' && b.broll) b.broll.approved = false; } await writeJsonFile(path.join(api.dir, 'visuals.json'), v); } }
        return api.emit('audio.ready', { replan: true, from: 'final-reviewer', findings: fixable.map(f => f.message) });
      }
      await conclude(api, 'render', review, { approved: 'short.completed', revised: 'needs.human', payload: { stage: 'render' } });
    } }
  };
  for (const [name, agent] of Object.entries(agents)) for (const type of agent.on) queue.subscribe(type, name);

  // ------------------------------------------------------------ driving it
  async function step(backoffMs = 30_000) {
    const job = queue.claim();
    if (!job) return null;
    const agent = agents[job.handler];
    if (!agent) { queue.fail(job.id, new Error(`no agent named ${job.handler}`), { backoffMs: 0 }); return job; }
    try { await agent.run(job, apiFor(job)); queue.complete(job.id); }
    catch (error) {
      if (error instanceof WaitForGate) queue.park(job.id, error.gate, error.note);
      else { log(`[${job.short_id}] ${job.handler} failed: ${String(error.message).slice(0, 200)}`); queue.fail(job.id, error, { backoffMs }); }
    }
    return queue.get(job.id);
  }
  // Work through everything that is ready, one job at a time, with no deadline. Returns when nothing more can run (the rest is waiting for a person or a backoff).
  async function drain({ maxSteps = Infinity, backoffMs = 30_000, signal = null } = {}) {
    let n = 0;
    while (n < maxSteps && !signal?.aborted) { const job = await step(backoffMs); if (!job) break; n++; }
    return n;
  }
  const start = (shortId, extra = {}) => queue.publish(shortId, 'short.requested', extra);
  return { queue, agents, step, drain, start, dirOf };
}

// A person's go-ahead for one gate, with the side effects that gate has.
export async function grantGate(pipeline, { shortId, gate, details = {}, store = null, now = () => new Date().toISOString() }) {
  const dir = pipeline.dirOf(shortId), file = path.join(dir, 'short.json');
  if (gate === 'direction') {
    const s = await readJson(file);
    if (!s.direction) throw new Error('there is no direction to approve yet');
    await writeJsonFile(file, { ...s, direction: { ...s.direction, approved: true, approvedAt: now() }, updatedAt: now() });
    store?.recordApproval(`short-${shortId}`, { gate: 'short-direction', decision: 'approved', by: 'local user', at: now(), summary: `Short "${s.title}": voice ${s.direction.voiceName || s.direction.voiceId}`, fingerprint: null, details: {} });
  }
  return pipeline.queue.grant(shortId, gate, { details });
}
