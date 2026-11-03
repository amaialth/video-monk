import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, writeJson } from '../src/core.js';
import { measureVoice, voiceChain, describeVoice } from '../src/voice.js';
import { reviewProduction, buildProduction } from '../src/production.js';
import { loadTimeline } from '../src/timeline.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-voice-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('voice chain: always high-pass, de-ess and compress; EQ only for dull voices; denoise only for noisy rooms; silence untouched', () => {
  const base = voiceChain({ silent: false, dull: false, noisy: false });
  assert.match(base, /^highpass=f=70,deesser=i=0\.2,acompressor=/);
  assert.doesNotMatch(base, /equalizer|afftdn/);
  const dull = voiceChain({ silent: false, dull: true, noisy: false });
  assert.match(dull, /equalizer=f=250:t=q:w=1\.2:g=-3,equalizer=f=3500:t=q:w=1:g=3,treble=g=2:f=10000/);
  const noisy = voiceChain({ silent: false, dull: false, noisy: true, floorDb: -41.4 });
  assert.match(noisy, /afftdn=nr=12:nf=-41:tn=1/);
  assert.equal(voiceChain({ silent: true }), null, 'a near-silent clip must not be boosted');
  assert.equal(voiceChain({ silent: false }, 'off'), null);
  assert.match(voiceChain({ silent: false, dull: false }, 'on'), /equalizer/);
  assert.match(describeVoice({ silent: false, highBandGapDb: 22.1, dull: true, noisy: false }, dull), /dull: presence EQ added/);
});

const ffmpegOk = await run('ffmpeg', ['-version']).then(() => true, () => false);
const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args]);

test('measurement tells a bright voice from a muffled one, a noisy room from a quiet one, and silence from speech', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 120000 }, async t => {
  const folder = await temporary(t);
  const burst = "between(t,0.3,1.4)+between(t,1.9,3.0)+between(t,3.5,4.6)";
  // bright: broadband speech-like noise bursts; muffled: the same energy squeezed below 600 Hz
  await ff(['-f', 'lavfi', '-i', `anoisesrc=color=white:amplitude=0.4:d=5:r=48000,volume='${burst}':eval=frame`, path.join(folder, 'bright.wav')]);
  await ff(['-f', 'lavfi', '-i', `anoisesrc=color=white:amplitude=0.9:d=5:r=48000,lowpass=f=500,volume='${burst}':eval=frame`, path.join(folder, 'muffled.wav')]);
  // noisy room: constant hiss under bursts
  await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.02:d=5:r=48000', '-f', 'lavfi', '-i', `aevalsrc='0.25*sin(2*PI*180*t)*(${burst})':s=48000:d=5`, '-filter_complex', 'amix=inputs=2:normalize=0', path.join(folder, 'noisy.wav')]);
  await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.0003:d=5:r=48000', path.join(folder, 'quiet.wav')]);
  const bright = await measureVoice(path.join(folder, 'bright.wav'));
  const muffled = await measureVoice(path.join(folder, 'muffled.wav'));
  const noisy = await measureVoice(path.join(folder, 'noisy.wav'));
  const quiet = await measureVoice(path.join(folder, 'quiet.wav'));
  assert.equal(bright.dull, false, `bright gap ${bright.highBandGapDb}`);
  assert.equal(muffled.dull, true, `muffled gap ${muffled.highBandGapDb}`);
  assert.ok(muffled.highBandGapDb > bright.highBandGapDb + 10);
  assert.equal(noisy.noisy, true, `noisy floor ${noisy.floorDb} snr ${noisy.snrDb}`);
  assert.equal(bright.noisy, false);
  assert.equal(quiet.silent, true, 'a near-silent clip is detected so it is never boosted');
  assert.equal(voiceChain(quiet), null);
});

test('a real build treats a muffled narration (reported) and passes its checks; voice enhancement can be switched off', { skip: ffmpegOk ? false : 'needs ffmpeg', timeout: 300000 }, async t => {
  const folder = await temporary(t);
  await ff(['-f', 'lavfi', '-i', "anoisesrc=color=white:amplitude=0.9:d=6:r=48000,lowpass=f=500,volume='between(t,0.3,2.8)+between(t,3.3,5.6)':eval=frame", path.join(folder, 'voice.wav')]);
  const make = async (name, voice) => {
    const file = path.join(folder, `${name}.json`);
    await writeJson(file, { version: 2, title: name, fps: 24, width: 320, height: 180,
      assets: [{ id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Own', attribution: 'Me' }],
      scenes: [{ kind: 'color', color: '#112233', duration: 6, purpose: 'x' }], audio: { narration: { asset: 'voice' }, ...(voice ? { voice } : {}) } });
    await reviewProduction(file, path.join(folder, `${name}-r.json`), true);
    return buildProduction(file, path.join(folder, `${name}-r.json`), path.join(folder, `${name}-out`), true, undefined, undefined, { quality: 'draft' });
  };
  const treated = await make('treated');
  assert.equal(treated.voice.voice.dull, true);
  assert.match(treated.voice.voice.treatment, /presence EQ/);
  assert.equal(treated.status, 'technical-checks-passed-needs-human-review', JSON.stringify(treated.verification.checks));
  const off = await make('off', { enhance: 'off' });
  assert.deepEqual(off.voice, {});
  await assert.rejects(loadTimeline(await (async () => { const f = path.join(folder, 'bad.json'); await writeJson(f, { version: 2, title: 'b', fps: 24, width: 320, height: 180, assets: [{ id: 'voice', path: 'voice.wav', kind: 'audio', approved: true, rights: 'Own', attribution: 'Me' }],
    scenes: [{ kind: 'color', color: '#112233', duration: 6, purpose: 'x' }], audio: { voice: { enhance: 'loud' } } }); return f; })()), /audio.voice.enhance/);
});

import { cleanCaptionWords, pageWords } from '../src/captions.js';
test('captions: fragments, fillers and stutters are removed, fixes apply, lone small words join the next page', () => {
  const w = (text, start, end) => ({ text, start, end });
  const cleaned = cleanCaptionWords([
    w('So', 0, 0.2), w('es--', 0.3, 0.4), w('ummm', 0.5, 0.8), w('the', 0.9, 1.0), w('the', 1.05, 1.15), w('gpt', 1.2, 1.4), w('4', 1.4, 1.5), w('is', 1.6, 1.7), w('you', 1.8, 1.9), w('know', 1.9, 2.0), w('great', 2.1, 2.4), w('.', 2.4, 2.4),
  ], { replace: { 'gpt 4': 'GPT-4' }, drop: ['you know'] });
  assert.deepEqual(cleaned.map(x => x.text), ['So', 'the', 'GPT-4', 'is', 'great.']);
  const pages = pageWords([w('A', 0, 0.1), w('quick', 0.2, 0.5), w('test', 0.6, 0.9)], {});
  assert.equal(pages.length, 1);
  assert.ok(pages[0].end - pages[0].start >= 0.9);
});
