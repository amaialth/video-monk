// Shorts in the web app: a blog or a concept becomes a script (Claude), narration (ElevenLabs) and a vertical video, step by step, with the person in charge of
// every step that sends text out, spends credits or approves a build. Each short is a folder under the studio's home; slow steps run as background jobs.
// The ElevenLabs key is read from the environment by the server only: no route returns it and the page never sees it.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { exists, run } from '../core.js';
import { uiHome } from './store.js';
import { environment } from './env.js';
import { elevenConfig, listVoices, listModels, DEFAULT_MODEL } from '../elevenlabs.js';
import { shortOptions, validateScript, writeScript, generateNarration, planShort, estimate, recommendDirection, defaultDirection, normalizeDirection, shortsModel, isExpressive, AUDIO_TAG, DIRECTION_KEYS, LENGTHS, TONES, AUDIENCES, CAPTION_STYLES, SHORT_TEMPLATES } from '../shorts.js';
import { reviewProduction, buildProduction } from '../production.js';
import { researchVisuals, readVisuals, approveVisuals } from '../visuals.js';

const ID = /^s-[a-f0-9]{8}$/;
const SERVED = /\.(mp3|wav|mp4|png|srt|vtt|json|md|txt)$/i;
const PLAN_FILES = ['production.json', 'brief.json', 'facts.json', 'PLAN.md', 'review.json', 'sfx', 'scenes', 'build'];
export const shortsRoot = () => path.join(uiHome(), 'shorts');

export function registerShorts(on, { store, serveFile, HANDLED, err, deps = {} }) {
  const { execute = run, fetcher = fetch, env = process.env, cwd = process.cwd() } = deps;
  const jobs = new Map();
  const dirOf = id => { if (!ID.test(id)) throw err('Invalid short id'); return path.join(shortsRoot(), id); };
  const readState = async id => { try { return JSON.parse(await readFile(path.join(dirOf(id), 'short.json'), 'utf8')); } catch { throw err('Short not found', 404); } };
  const saveState = async (id, state) => writeFile(path.join(dirOf(id), 'short.json'), `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  const readScript = async id => { try { return JSON.parse(await readFile(path.join(dirOf(id), 'script.json'), 'utf8')); } catch { return null; } };
  const sourceOf = (state, script) => state.source || script?.beats?.map(b => b.say).join(' ') || '';
  // The options a script is checked against: audio tags are allowed when the chosen model reads them (v4 by default).
  const checkOptions = state => { const m = String(state.direction?.modelId || state.modelId || shortsModel({})); return shortOptions({ ...state.options, audioTags: /^eleven_v4/.test(m) ? 'v4' : /^eleven_v3/.test(m) }); };
  const busy = id => [...jobs.values()].some(j => j.shortId === id && j.status === 'running');

  // A job runs in the background; the page polls it. Errors are readable messages, never stack traces or secrets.
  const startJob = (shortId, kind, work) => {
    if (busy(shortId)) throw err('That short is already working on something', 409);
    const job = { id: `j-${randomBytes(4).toString('hex')}`, shortId, kind, status: 'running', log: [], startedAt: Date.now() };
    jobs.set(job.id, job);
    const log = message => { job.log.push(String(message).slice(0, 300)); if (job.log.length > 200) job.log.shift(); };
    (async () => { try { job.result = await work(log); job.status = 'done'; } catch (error) { job.error = String(error.message).slice(0, 1500); job.status = 'error'; } finally { job.endedAt = Date.now(); } })();
    return job;
  };

  on('GET', '/api/shorts/config', async () => {
    const [eleven, env2] = await Promise.all([elevenConfig(env, cwd), environment().catch(() => ({ canUseClaude: false }))]);
    return { elevenlabs: { ...eleven, shortsModel: shortsModel(eleven) }, canUseClaude: Boolean(deps.claude ?? env2.canUseClaude),
      templates: SHORT_TEMPLATES, options: { lengths: LENGTHS, tones: TONES, audiences: AUDIENCES, captions: CAPTION_STYLES, themes: ['night', 'paper'], sfx: ['off', 'subtle', 'full'], currents: ['left', 'right', 'up', 'down'] }, defaults: shortOptions({}) };
  });
  let voiceCache = null;
  on('GET', '/api/shorts/voices', async ({ query }) => {
    const search = String(query.get('search') || '').slice(0, 60);
    if (voiceCache && voiceCache.search === search && Date.now() - voiceCache.at < 300_000) return voiceCache.voices;
    try { const voices = await listVoices({ search, env, cwd, fetcher, max: 100 }); voiceCache = { search, at: Date.now(), voices }; return voices; } catch (error) { throw err(String(error.message).replace(/^ElevenLabs: /, ''), error.status === 401 ? 401 : 502); }
  });
  on('GET', '/api/shorts/models', async () => { try { return await listModels({ env, cwd, fetcher }); } catch (error) { throw err(String(error.message).replace(/^ElevenLabs: /, ''), 502); } });

  on('GET', '/api/shorts', async () => {
    const out = [];
    for (const id of (await readdir(shortsRoot()).catch(() => [])).filter(n => ID.test(n))) { try { const s = await readState(id); out.push({ id, title: s.title, stage: s.stage, createdAt: s.createdAt, updatedAt: s.updatedAt, length: s.options?.length }); } catch { /* not a short */ } }
    return out.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  });

  on('POST', '/api/shorts', async ({ body }) => {
    const text = String(body.source || body.concept || '').trim();
    if (!text) throw err('Paste the text to explain, or describe the concept');
    if (text.length > 200_000) throw err('That is larger than 200 KB; paste the part you want explained');
    let options;
    try { options = shortOptions(body.options || {}); } catch (error) { throw err(String(error.message).replace(/^Shorts: /, '')); }
    const id = `s-${randomBytes(4).toString('hex')}`;
    await mkdir(dirOf(id), { recursive: true });
    const state = { id, title: String(body.title || '').slice(0, 80) || (text.split(/\n/)[0] || 'Short').slice(0, 60), createdAt: new Date().toISOString(), stage: 'draft', kind: body.source ? 'text' : 'concept', source: text, options };
    await saveState(id, state);
    return { id, ...state };
  });

  on('GET', '/api/shorts/jobs/:jobId', async ({ params }) => { const j = jobs.get(params.jobId); if (!j) throw err('Job not found', 404); return { id: j.id, shortId: j.shortId, kind: j.kind, status: j.status, log: j.log.slice(-40), result: j.result, error: j.error }; });

  on('GET', '/api/shorts/:sid', async ({ params }) => {
    const state = await readState(params.sid), dir = dirOf(params.sid), script = await readScript(params.sid);
    const job = [...jobs.values()].filter(j => j.shortId === params.sid).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
    const visuals = await readVisuals(path.join(dir, 'visuals.json')).catch(() => null);
    return { ...state, visuals, script, estimate: script ? estimate(script) : null, check: script ? validateScript(script, sourceOf(state, script), checkOptions(state)) : null,
      files: { plan: await exists(path.join(dir, 'production.json')), narration: await exists(path.join(dir, 'narration.wav')), video: await exists(path.join(dir, 'build', 'final.mp4')), contactSheet: await exists(path.join(dir, 'build', 'contact-sheet.png')) },
      job: job && { id: job.id, kind: job.kind, status: job.status } };
  });
  on('DELETE', '/api/shorts/:sid', async ({ params }) => { await readState(params.sid); if (busy(params.sid)) throw err('Wait for it to finish first', 409); await rm(dirOf(params.sid), { recursive: true, force: true }); return { deleted: true }; });

  // 1. the script (sends the source text to Claude: needs confirmLlm)
  on('POST', '/api/shorts/:sid/script', async ({ params, body }) => {
    const state = await readState(params.sid);
    if (body.confirmLlm !== true) throw err('Writing the script sends your text to Claude. Confirm first.');
    if (body.options) { try { state.options = shortOptions({ ...state.options, ...body.options }); } catch (error) { throw err(String(error.message).replace(/^Shorts: /, '')); } await saveState(params.sid, state); }
    const cfg = await elevenConfig(env, cwd);
    const modelId = String(body.modelId || state.modelId || shortsModel(cfg));
    const job = startJob(params.sid, 'script', async log => {
      log('Writing the script with Claude…');
      const options = { ...state.options, audioTags: /^eleven_v4/.test(modelId) ? 'v4' : /^eleven_v3/.test(modelId) };
      const written = await writeScript(state.source, options, { kind: state.kind, execute, onTry: n => n > 1 && log('Fixing what the first draft got wrong…') });
      await writeFile(path.join(dirOf(params.sid), 'script.json'), `${JSON.stringify(written.script, null, 2)}\n`);
      // Claude then chooses the voice, delivery and look for this script. The person reviews and approves it before anything is recorded.
      log('Choosing the voice, delivery and look…');
      let voices = [];
      if (cfg.hasKey) { try { voices = await listVoices({ env, cwd, fetcher, max: 60 }); } catch { /* the direction falls back to defaults */ } }
      const direction = await recommendDirection(written.script, state.options, { voices, modelId, fallbackVoiceId: cfg.voiceId, execute });
      await saveState(params.sid, { ...state, title: written.script.title, stage: 'script', modelId, direction: { ...direction, approved: false } });
      return { beats: written.script.beats.length, seconds: written.seconds, warnings: written.warnings, direction: direction.by };
    });
    return { jobId: job.id };
  });
  // the person's edits to the script (checked against the source, so a made-up number is refused here too)
  on('PUT', '/api/shorts/:sid/script', async ({ params, body }) => {
    const state = await readState(params.sid);
    if (busy(params.sid)) throw err('Wait for the current step to finish', 409);
    const check = validateScript(body.script, sourceOf(state, body.script), checkOptions(state));
    if (check.errors.length) throw err(`The script needs changes: ${check.errors.slice(0, 6).join('; ')}`);
    await writeFile(path.join(dirOf(params.sid), 'script.json'), `${JSON.stringify(body.script, null, 2)}\n`);
    await saveState(params.sid, { ...state, title: body.script.title, stage: 'script' });
    return { check, estimate: estimate(body.script) };
  });

  // 2. the direction: what Claude chose, what the person changed, and the person's approval (needed before anything is recorded)
  on('POST', '/api/shorts/:sid/direction', async ({ params, body }) => {
    const state = await readState(params.sid), script = await readScript(params.sid);
    if (!script) throw err('Write the script first');
    if (body.confirmLlm !== true) throw err('Asking Claude to choose the voice and look sends the script and your voice names to Claude. Confirm first.');
    const cfg = await elevenConfig(env, cwd);
    const modelId = String(body.modelId || state.modelId || state.direction?.modelId || shortsModel(cfg));
    const job = startJob(params.sid, 'direction', async log => {
      log('Choosing the voice, delivery and look…');
      let voices = [];
      if (cfg.hasKey) { try { voices = await listVoices({ env, cwd, fetcher, max: 60 }); } catch { /* defaults */ } }
      const direction = await recommendDirection(script, state.options, { voices, modelId, fallbackVoiceId: cfg.voiceId, execute });
      await saveState(params.sid, { ...state, modelId, direction: { ...direction, approved: false } });
      return { by: direction.by };
    });
    return { jobId: job.id };
  });
  on('PUT', '/api/shorts/:sid/direction', async ({ params, body }) => {
    const state = await readState(params.sid), script = await readScript(params.sid);
    if (!script) throw err('Write the script first');
    if (busy(params.sid)) throw err('Wait for the current step to finish', 409);
    const given = body.direction || {};
    const modelId = String(given.modelId || state.direction?.modelId || state.modelId || DEFAULT_MODEL);
    if (!/^[a-z0-9_.-]{3,64}$/.test(modelId)) throw err('The model id looks wrong');
    if (script.beats.some(b => AUDIO_TAG.test(b.say)) && !isExpressive(modelId)) { AUDIO_TAG.lastIndex = 0; throw err('The script has audio tags, which only Eleven v3 and v4 understand. Choose one of those models, or edit the script and remove the tags.'); }
    AUDIO_TAG.lastIndex = 0;
    const voiceId = String(given.voiceId || '');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(voiceId)) throw err('Choose a voice');
    const cleaned = normalizeDirection({ ...given, voiceId }, { voices: [{ id: voiceId, name: String(given.voiceName || '').slice(0, 60) }], options: state.options, modelId, by: given.by === 'claude' ? 'claude+you' : 'you' });
    const settings = given.voiceSettings && typeof given.voiceSettings === 'object' ? given.voiceSettings : cleaned.voiceSettings;
    const direction = { ...cleaned, voiceSettings: normalizeDirection({ voiceId, stability: settings.stability, similarity: settings.similarity_boost }, { voices: [{ id: voiceId }], options: state.options, modelId }).voiceSettings, approved: false };
    if (body.approve === true) {
      direction.approved = true; direction.approvedAt = new Date().toISOString();
      store.recordApproval(`short-${params.sid}`, { gate: 'short-direction', decision: 'approved', by: 'local user', at: direction.approvedAt, summary: `Short "${state.title}": voice ${direction.voiceName || direction.voiceId}, model ${modelId}, captions ${direction.captions}, theme ${direction.theme}`, fingerprint: null, details: { voiceId, modelId, by: direction.by } });
    }
    const options = shortOptions({ ...state.options, ...Object.fromEntries(DIRECTION_KEYS.map(k => [k, direction[k]])) });
    await saveState(params.sid, { ...state, modelId, options, direction });
    return { direction };
  });

  // 3. the pictures: a researcher finds each named company's logo (a browser visits its own website) and stock footage; the person approves what appears in the video
  on('POST', '/api/shorts/:sid/visuals', async ({ params, body }) => {
    const state = await readState(params.sid), script = await readScript(params.sid);
    if (!script) throw err('Write the script first');
    if (body.confirmLlm !== true) throw err('Asking Claude where pictures help sends the script and source text to Claude. Confirm first.');
    const browse = body.confirmBrowse === true, stock = body.confirmStock === true;
    if (!browse && !stock) throw err('Choose what to look for: logos (a browser visits each company\'s website) and/or stock footage.');
    if (stock && body.confirmRights !== true) throw err('Footage is downloaded under the stock provider\'s licence. Confirm that you accept it.');
    const job = startJob(params.sid, 'visuals', async log => {
      const result = await researchVisuals({ script, source: sourceOf(state, script), dir: dirOf(params.sid), allowLlm: true, allowBrowse: browse, allowStock: stock, allowStockDownload: stock, rightsConfirmed: stock && body.confirmRights === true, execute, fetcher, log });
      await saveState(params.sid, { ...state, visualsAt: new Date().toISOString() });
      return { beats: result.beats.length };
    });
    return { jobId: job.id };
  });
  on('PUT', '/api/shorts/:sid/visuals', async ({ params, body }) => {
    const state = await readState(params.sid), file = path.join(dirOf(params.sid), 'visuals.json');
    if (busy(params.sid)) throw err('Wait for the current step to finish', 409);
    const v = await readVisuals(file).catch(() => null);
    if (!v) throw err('Look for pictures first');
    for (const a of Array.isArray(body.approvals) ? body.approvals.slice(0, 50) : []) {
      if (a.kind === 'scene3d') { if (v.scene3d) v.scene3d.approved = a.approved === true && v.scene3d.available === true; continue; }
      const beat = v.beats.find(b => b.beat === a.beat); if (!beat) continue;
      if (a.kind === 'logo' && beat.logos[a.index]) beat.logos[a.index].approved = a.approved === true && beat.logos[a.index].status === 'fetched';
      if (a.kind === 'broll' && beat.broll) beat.broll.approved = a.approved === true && beat.broll.status === 'downloaded';
    }
    if (body.approveAll === true) approveVisuals(v);
    await writeFile(file, `${JSON.stringify(v, null, 2)}\n`);
    await saveState(params.sid, state);
    return { visuals: v };
  });

  // 4. the recording (spends ElevenLabs credits: needs confirmSpend, and the approved direction)
  on('POST', '/api/shorts/:sid/audio', async ({ params, body }) => {
    const state = await readState(params.sid), script = await readScript(params.sid);
    if (!script) throw err('Write the script first');
    const cfg = await elevenConfig(env, cwd);
    if (!cfg.hasKey) throw err('ELEVENLABS_API_KEY is not set. Put it in your environment or a .env file and restart the studio.');
    if (state.direction?.approved !== true) throw err('Review and approve the direction (voice, delivery and look) first', 409);
    const voiceId = String(state.direction.voiceId || '');
    if (!voiceId) throw err('Choose a voice');
    const est = estimate(script);
    if (body.confirmSpend !== true) throw err(`Recording uses about ${est.characters} ElevenLabs characters. Confirm to spend them.`, 409);
    const modelId = String(state.direction.modelId || state.modelId || shortsModel(cfg));
    const voiceSettings = state.direction.voiceSettings || undefined;
    const job = startJob(params.sid, 'audio', async log => {
      const dir = dirOf(params.sid);
      for (const f of PLAN_FILES) await rm(path.join(dir, f), { recursive: true, force: true });       // a new plan replaces the old one; recordings stay cached
      log(`Recording ${script.beats.length} beats (${est.characters} characters)…`);
      const audio = await generateNarration(script, { dir, voiceId, modelId, voiceSettings, languageCode: state.options.language === 'en' ? undefined : state.options.language, allowSpend: true, maxChars: Math.min(Number(body.maxChars) || 8000, 20000), db: store.db, projectId: `short-${params.sid}`, env, cwd, fetcher, execute, onBeat: (n, cached) => log(`Beat ${n}: ${cached ? 'already recorded' : 'recorded'}`) });
      log('Planning the video…');
      const planned = await planShort(script, audio, dir, state.options, { source: sourceOf(state, script), provider: { voiceId, voiceName: state.direction.voiceName || null, modelId }, visuals: await readVisuals(path.join(dir, 'visuals.json')).catch(() => null) });
      await saveState(params.sid, { ...state, stage: 'planned', voice: { id: voiceId, name: state.direction.voiceName || null, modelId, settings: voiceSettings || null }, beatAudio: audio.files, narrationSeconds: audio.totalSeconds, recorded: audio.recorded, cached: audio.cached });
      return { seconds: Math.round(audio.totalSeconds), recorded: audio.recorded, cached: audio.cached, warnings: planned.warnings || [] };
    });
    return { jobId: job.id };
  });

  // 3. the build (needs the person's approval of the script, the recording and the plan)
  on('POST', '/api/shorts/:sid/build', async ({ params, body }) => {
    const state = await readState(params.sid), dir = dirOf(params.sid);
    if (!(await exists(path.join(dir, 'production.json')))) throw err('Record the voice first so there is a plan');
    if (body.approve !== true) throw err('Confirm that you have read the script, listened to the voice and checked the plan');
    const quality = body.quality === 'final' ? 'final' : 'draft';
    const job = startJob(params.sid, 'build', async log => {
      await rm(path.join(dir, 'build'), { recursive: true, force: true });
      const review = path.join(dir, 'review.json');
      await rm(review, { force: true });
      const report = await reviewProduction(path.join(dir, 'production.json'), review, true);
      store.recordApproval(`short-${params.sid}`, { gate: 'short-build', decision: 'approved', by: 'local user', at: new Date().toISOString(), summary: `Short "${state.title}": script, voice and plan reviewed (${quality})`, fingerprint: JSON.parse(await readFile(review, 'utf8')).fingerprint || null, details: { scenes: report.scenes, seconds: report.duration } });
      log('Building the video…');
      const built = await buildProduction(path.join(dir, 'production.json'), review, path.join(dir, 'build'), true, execute, 'ffmpeg', { quality, log });
      await saveState(params.sid, { ...state, stage: 'built', quality });
      return { status: built.status };
    });
    return { jobId: job.id };
  });

  // files of a short (audio previews, the video, the contact sheet), only from inside its own folder
  on('GET', '/api/shorts/:sid/file', async ({ req, res, params, query }) => {
    await readState(params.sid);
    const rel = String(query.get('p') || '');
    const file = path.resolve(dirOf(params.sid), rel);
    if (!SERVED.test(file) || !file.startsWith(`${dirOf(params.sid)}${path.sep}`) || /(^|\/)short\.json$/.test(rel)) throw err('Not found', 404);
    await serveFile(req, res, file);
    return HANDLED;
  });
}
