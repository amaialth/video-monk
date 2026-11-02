// Voice treatment: measure the recording first, then apply only what it needs. A clean voice has its 3 kHz+ band roughly 10-15 dB
// below the total; a covered or muffled mic is around 20 dB or more. Every voice gets a gentle high-pass, de-esser and compressor;
// EQ presence is added for dull voices and noise reduction for noisy rooms. Near-silent clips are left alone (normalizing them
// only boosts hiss).
import path from 'node:path';
import { run } from './core.js';
import { chooseNoiseDb, levelProfile } from './autocut.js';

const tool = name => process.env[`VIDEO_MONK_${name.toUpperCase()}`] || name;
const num = (text, key) => { const m = String(text).match(new RegExp(`${key}: (-?[0-9.]+|-inf) dB`)); return m && m[1] !== '-inf' ? Number(m[1]) : null; };

async function meanVolume(file, filter, seconds, execute) {
  const { stderr } = await execute(tool('ffmpeg'), ['-hide_banner', '-nostdin', '-t', String(seconds), '-i', path.resolve(file), '-vn', '-af', `${filter ? `${filter},` : ''}volumedetect`, '-f', 'null', '-'], { timeout: 600_000 });
  return { mean: num(stderr, 'mean_volume'), max: num(stderr, 'max_volume') };
}

export async function measureVoice(file, execute = run, { seconds = 150 } = {}) {
  const full = await meanVolume(file, '', seconds, execute);
  if (full.mean === null) return { silent: true, meanDb: null, highBandGapDb: null, dull: false, noisy: false, floorDb: null, speechDb: null };
  const high = await meanVolume(file, 'highpass=f=3000', seconds, execute);
  const levels = await levelProfile(file, execute).catch(() => []);
  const noise = levels.length ? chooseNoiseDb(levels) : { floorDb: null, speechDb: null };
  const gap = high.mean === null ? 40 : full.mean - high.mean;
  const snr = noise.speechDb !== null && noise.floorDb !== null ? noise.speechDb - noise.floorDb : null;
  return {
    silent: full.mean < -55, meanDb: full.mean, peakDb: full.max, highBandGapDb: Math.round(gap * 10) / 10,
    dull: gap > 19, noisy: snr !== null && noise.floorDb > -52 && snr < 32, floorDb: noise.floorDb, speechDb: noise.speechDb, snrDb: snr
  };
}

// FFmpeg filter chain for a measured profile, or null when the clip should be left untouched.
export function voiceChain(profile, mode = 'auto') {
  if (mode === 'off' || !profile || profile.silent) return null;
  const parts = ['highpass=f=70'];
  if (profile.noisy) parts.push(`afftdn=nr=12:nf=${Math.max(-80, Math.min(-20, Math.round(profile.floorDb)))}:tn=1`);
  if (profile.dull || mode === 'on') parts.push('equalizer=f=250:t=q:w=1.2:g=-3', 'equalizer=f=3500:t=q:w=1:g=3', 'treble=g=2:f=10000');
  parts.push('deesser=i=0.2', 'acompressor=threshold=0.1:ratio=2.5:attack=20:release=250:makeup=1.5');
  return parts.join(',');
}

export function describeVoice(profile, chain) {
  if (!profile) return 'not measured';
  if (profile.silent) return 'near-silent: left untouched';
  const bits = [`${profile.highBandGapDb} dB between full band and 3 kHz+`];
  if (profile.dull) bits.push('dull: presence EQ added');
  if (profile.noisy) bits.push(`noisy (SNR ${Math.round(profile.snrDb)} dB): noise reduction added`);
  return `${bits.join('; ')}${chain ? '' : '; no treatment'}`;
}
