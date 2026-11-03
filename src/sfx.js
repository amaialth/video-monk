// Sound effects, synthesised offline with FFmpeg: no samples, no downloads, no API key, so every sound is original and rights-clean.
// A subtle set accents graphics as they appear (whoosh for a cutaway, swipe for a side panel, pop for a stat or term, chime for a chapter card).
// Sounds are indexed in the asset library and reused. External generators (AI sound-effect APIs) are deliberately not wired in: they send
// prompts to a third party, so they stay a separate, user-approved step that supplies a licensed file to `audio.sfx`.
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { exists, run } from './core.js';
import { tryDb } from './db.js';
import { mireloKey, account, creditsPerSecond, generate, finish, cacheId, PROMPTS, RIGHTS as MIRELO_RIGHTS, DEFAULT_MODEL } from './mirelo.js';

const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const VERSION = 1; // bump when a recipe changes so cached library copies are regenerated
const aeval = (expr, d) => ({ inputs: ['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${d}`], graph: '[0:a]anull' });
const noise = (color, d, a) => `anoisesrc=c=${color}:r=48000:d=${d}:a=${a}`;

export const SFX = {
  tick: { seconds: 0.08, why: 'tiny UI tick', build: () => ({ ...aeval('(random(0)*2-1)*exp(-t*220)*0.9', 0.08), graph: '[0:a]highpass=f=2500' }) },
  click: { seconds: 0.1, why: 'soft button click', build: () => aeval('sin(2*PI*1800*t)*exp(-t*90)*0.7+(random(0)*2-1)*exp(-t*300)*0.4', 0.1) },
  pop: { seconds: 0.25, why: 'rounded pop for a number or term', build: () => aeval('sin(2*PI*(200*t+900*(1-exp(-t*50))/50))*exp(-t*28)*0.9', 0.25) },
  ding: { seconds: 1.4, why: 'clean bell', build: () => aeval('(sin(2*PI*1318.5*t)+0.35*sin(2*PI*2637*t)+0.12*sin(2*PI*3951*t))*exp(-t*4.5)*0.45*min(1,t*400)', 1.4) },
  chime: { seconds: 1.6, why: 'two-note chime for a new section', build: () =>
    aeval('(sin(2*PI*880*t)*exp(-t*4)+gt(t,0.14)*sin(2*PI*1318.5*(t-0.14))*exp(-(t-0.14)*4))*0.4*min(1,t*400)', 1.6) },
  impact: { seconds: 1.3, why: 'soft low hit', build: () => ({ ...aeval('sin(2*PI*(42*t+90*(1-exp(-t*14))/14))*exp(-t*4.5)*0.95+(random(0)*2-1)*exp(-t*30)*0.35', 1.3), graph: '[0:a]lowpass=f=2500' }) },
  whoosh: { seconds: 0.9, why: 'air whoosh for a cutaway', build: () => ({
    inputs: ['-f', 'lavfi', '-i', noise('pink', 0.9, 0.8), '-f', 'lavfi', '-i', noise('white', 0.9, 0.5)],
    graph: "[0:a]lowpass=f=1500,volume='pow(sin(PI*min(t/0.9,1)),2)':eval=frame[a];[1:a]highpass=f=2500,lowpass=f=9000,volume='0.5*pow(sin(PI*min(pow(t/0.9,0.75),1)),3)':eval=frame[b];[a][b]amix=inputs=2:normalize=0" }) },
  swipe: { seconds: 0.4, why: 'short swipe for a side panel', build: () => ({
    inputs: ['-f', 'lavfi', '-i', noise('pink', 0.4, 0.8), '-f', 'lavfi', '-i', noise('white', 0.4, 0.5)],
    graph: "[0:a]lowpass=f=2200,volume='pow(sin(PI*min(t/0.4,1)),2)':eval=frame[a];[1:a]highpass=f=3000,lowpass=f=10000,volume='0.45*pow(sin(PI*min(pow(t/0.4,0.7),1)),3)':eval=frame[b];[a][b]amix=inputs=2:normalize=0" }) },
  riser: { seconds: 2, why: 'rising sweep into a reveal', build: () => ({
    inputs: ['-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*(180*t+(1400-180)*t*t/4))*0.22*(t/2)':s=48000:d=2", '-f', 'lavfi', '-i', "aevalsrc='(random(0)*2-1)*0.35*pow(t/2,2)':s=48000:d=2"],
    graph: '[1:a]highpass=f=1500[n];[0:a][n]amix=inputs=2:normalize=0' }) }
};
export const SFX_KINDS = Object.keys(SFX);

export async function synthesize(kind, file, execute = run) {
  const def = SFX[kind];
  if (!def) throw new Error(`SFX: unknown kind ${kind}; use ${SFX_KINDS.join(', ')}`);
  const { inputs, graph } = def.build();
  const fade = Math.min(0.03, def.seconds / 4);
  await mkdir(path.dirname(file), { recursive: true });
  await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputs,
    '-filter_complex', `${graph},aformat=sample_fmts=fltp:channel_layouts=stereo,alimiter=limit=0.7:level=false,afade=t=in:d=0.002,afade=t=out:st=${(def.seconds - fade).toFixed(3)}:d=${fade.toFixed(3)}[out]`,
    '-map', '[out]', '-t', String(def.seconds), '-ar', '48000', '-c:a', 'pcm_s16le', file]);
  return file;
}

// Graphics in a manifest, as { start, duration, template, mode } with mode cutaway | panel | overlay.
export function graphicsOf(manifest) {
  const items = [];
  let at = 0;
  for (const s of manifest.scenes) {
    if (s.kind === 'graphic') items.push({ start: at, duration: s.duration, template: s.graphic?.template, mode: 'cutaway' });
    for (const o of s.overlays || []) items.push({ start: at + o.start, duration: o.duration, template: o.template, mode: modeOf(o) });
    at += s.duration;
  }
  for (const o of manifest.globalOverlays || []) items.push({ start: o.start, duration: o.duration, template: o.template, mode: modeOf(o) });
  return items.filter(i => i.template).sort((a, b) => a.start - b.start);
}
const modeOf = o => (o.background && o.background !== 'transparent' ? 'cutaway' : /^strip/.test(o.placement || '') ? 'overlay' : 'panel');

// Which sound goes where. subtle: one accent per graphic, at least 2 s apart, at most 5 a minute, quiet.
// full: also pops on overlays and a swipe as cutaways leave, 1 s apart, at most 10 a minute.
export function planSfx(items, { mode = 'subtle', duration = Infinity } = {}) {
  if (mode === 'off') return [];
  const full = mode === 'full';
  const gap = full ? 1 : 2, perMinute = full ? 10 : 5;
  const events = [];
  const consider = (kind, at, gainDb, why) => {
    if (at < 0 || at > duration - 0.3) return;
    const last = events.at(-1);
    if (last && at - last.at < gap) return;
    const minute = events.filter(e => e.at > at - 60).length;
    if (minute >= perMinute) return;
    events.push({ kind, at: Math.round(at * 1000) / 1000, gainDb, why });
  };
  for (const it of items) {
    const lead = Math.max(0, it.start - 0.05);
    if (it.template === 'chapter' || it.template === 'title') consider('chime', lead, -17, `${it.template} card`);
    else if (it.mode === 'cutaway') consider('whoosh', lead, -15, 'full-frame cutaway');
    else if (it.mode === 'panel') consider('swipe', lead, -17, 'side panel');
    else if (full && ['stat', 'term', 'callout'].includes(it.template)) consider('pop', lead, -17, `${it.template} reveal`);
    else if (it.template === 'stat' || it.template === 'term') consider('pop', lead, -18, `${it.template} reveal`);
    if (full && it.mode === 'cutaway' && it.duration > 3) consider('swipe', it.start + it.duration - 0.25, -20, 'cutaway leaves');
  }
  return events.sort((a, b) => a.at - b.at);
}

// Mirelo session: key, balance, price and a spending budget shared by every sound of one run.
export async function mireloSession({ allow, budget = 300, fetchFn = fetch } = {}) {
  if (!allow) throw new Error('Mirelo sends your prompt to Mirelo and spends credits: add --allow-mirelo to use it');
  const key = await mireloKey();
  if (!key) throw new Error('Mirelo: no API key. Set MIRELO_API_KEY in the environment or in a .env file (which git ignores)');
  const acct = await account(key, fetchFn);
  if (!acct.ready) throw new Error('Mirelo: the account is not ready (check billing in Mirelo Studio)');
  return { key, fetchFn, available: acct.credits, startCredits: acct.credits, cps: await creditsPerSecond(key, DEFAULT_MODEL, fetchFn), budget, spent: 0 };
}

// One sound from Mirelo, reused from the library when the same prompt/length/model was generated before (no second charge).
export async function obtainFromMirelo({ prompt, seconds, file, session, library = null, execute = run, tags = [], name, project = null }) {
  const id = cacheId(prompt, seconds);
  if (library?.get(id)) { await library.checkout(id, file); return { reused: true, credits: 0 }; }
  const estimate = Math.ceil(seconds * session.cps);
  if (session.spent + estimate > session.budget) throw new Error(`the ${session.budget}-credit budget would be exceeded (${session.spent} spent, this sound ~${estimate})`);
  if (estimate > session.available - session.spent) throw new Error('not enough credits left on the account');
  const raw = `${file}.raw.wav`;
  const made = await generate({ prompt, seconds, key: session.key, file: raw, fetchFn: session.fetchFn });
  await finish(raw, file, seconds, execute);
  await rm(raw, { force: true });
  const charged = Number.isFinite(made.credits) ? made.credits : estimate;
  session.spent += charged;
  (await tryDb())?.addUsage('mirelo', charged, { project: null, note: prompt.slice(0, 60) });
  await library?.add({ id, kind: 'audio', source: file, name: name || `Mirelo: ${prompt.slice(0, 40)}`, description: prompt, tags: ['sfx', 'mirelo', 'generated', ...tags],
    rights: MIRELO_RIGHTS, attribution: 'Generated with Mirelo', approved: true, createdBy: 'sfx', project, meta: { prompt, model: made.model, seconds, credits: charged } });
  return { reused: false, credits: charged };
}

// Add sound files (synthesised or reused from the library), their assets and audio.sfx cues to a manifest object. Existing sfx cues are kept.
export async function applySfx(manifest, { mode = 'subtle', dir, relTo, library = null, execute = run, project = null, engine = 'synth', session = null, log = () => {} }) {
  const warnings = [];
  let credits = 0;
  if (mode === 'off') return { manifest, events: [], warnings, credits };
  const events = planSfx(graphicsOf(manifest), { mode, duration: manifest.scenes.reduce((n, s) => n + s.duration, 0) });
  if (!events.length) return { manifest, events, warnings, credits };
  const out = { ...manifest, assets: [...manifest.assets], audio: { ...(manifest.audio || {}) } };
  for (const kind of [...new Set(events.map(e => e.kind))]) {
    const id = `sfx-${kind}`;
    if (out.assets.some(a => a.id === id)) continue;
    const file = path.join(dir, `${kind}.wav`);
    let usedMirelo = false;
    if (!(await exists(file)) && engine === 'mirelo') {
      try {
        const got = await obtainFromMirelo({ prompt: PROMPTS[kind], seconds: Math.max(0.3, SFX[kind].seconds), file, session, library, execute, tags: [kind], name: `SFX ${kind} (Mirelo)`, project });
        credits += got.credits; usedMirelo = true;
        log(`  sfx ${kind}: ${got.reused ? 'reused from the library' : `generated with Mirelo (${got.credits} credits)`}`);
      } catch (error) {
        warnings.push(`Mirelo could not make "${kind}" (${error.message}); used the built-in synthesised sound instead`);
      }
    } else if (await exists(file)) usedMirelo = false;
    if (!(await exists(file))) {
      const libId = `sfx-${kind}-v${VERSION}`;
      if (library?.get(libId)) await library.checkout(libId, file);
      else {
        await synthesize(kind, file, execute);
        await library?.add({ id: libId, kind: 'audio', source: file, name: `SFX ${kind}`, description: SFX[kind].why, tags: ['sfx', kind, 'generated'],
          rights: 'Original synthesis by Video Monk (no third-party samples)', attribution: 'Video Monk generated', approved: true, createdBy: 'sfx', project });
      }
    }
    out.assets.push({ id, path: path.relative(relTo, file).split(path.sep).join('/'), kind: 'audio', approved: true,
      rights: usedMirelo ? MIRELO_RIGHTS : 'Original synthesis by Video Monk (no third-party samples)', attribution: usedMirelo ? 'Generated with Mirelo' : 'Video Monk generated' });
  }
  out.audio.sfx = [...(out.audio.sfx || []), ...events.map(e => ({ asset: `sfx-${e.kind}`, at: e.at, gainDb: e.gainDb }))];
  return { manifest: out, events, warnings, credits };
}

// Audition page: every .wav in a folder with a player, a waveform and a spectrogram, so sounds can be judged by ear and by eye in a browser.
export async function auditionPage(dir, output, execute = run) {
  const { readdir, writeFile } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.wav')).sort();
  if (!files.length) throw new Error('SFX: no .wav files in that folder');
  const folder = `${output.replace(/\.html?$/i, '')}-images`;
  await mkdir(folder, { recursive: true });
  const cards = [];
  for (const f of files) {
    const stem = f.replace(/\.wav$/i, '');
    await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(dir, f), '-lavfi', 'showspectrumpic=s=560x180:legend=0:scale=log', path.join(folder, `${stem}.spec.png`)]);
    await execute(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(dir, f), '-lavfi', 'aformat=channel_layouts=mono,showwavespic=s=560x90:colors=#4cc9f0', '-frames:v', '1', path.join(folder, `${stem}.wave.png`)]);
    const rel = path.relative(path.dirname(output), path.join(dir, f)).split(path.sep).join('/');
    const img = name => path.relative(path.dirname(output), path.join(folder, name)).split(path.sep).join('/');
    cards.push(`<section><h2>${stem}</h2><audio controls preload="none" src="${rel}"></audio><img src="${img(`${stem}.wave.png`)}" alt="waveform"><img src="${img(`${stem}.spec.png`)}" alt="spectrogram"></section>`);
  }
  await writeFile(output, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SFX audition</title>
<style>:root{color-scheme:light dark}body{font:16px system-ui;margin:0 auto;max-width:640px;padding:16px}section{margin:0 0 24px}h2{font-size:1rem;margin:0 0 6px}audio{width:100%}img{display:block;width:100%;margin-top:6px;border-radius:6px}</style>
<h1>SFX audition</h1><p>Play each sound at normal listening level next to the voice track, not alone. Too loud or too often: lower <code>gainDb</code> or use <code>--sfx subtle</code>.</p>${cards.join('')}\n`);
  return { page: output, count: files.length };
}
