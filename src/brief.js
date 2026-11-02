// Brief: the questions to settle BEFORE editing, so a long-form landscape cut is never delivered when the user wanted a vertical Short
// (or the reverse). `QUESTIONS` is shaped for a Claude Code AskUserQuestion call and for the terminal prompt; `resolveBrief` turns answers
// into the options `auto` understands.
import { readFile } from 'node:fs/promises';
import readline from 'node:readline/promises';

const opt = (value, label, description) => ({ value, label, description });

export const QUESTIONS = [
  { id: 'deliverable', header: 'Format', multiSelect: false, question: 'What should this edit produce?', options: [
    opt('long', 'Long-form (16:9)', 'One landscape video for YouTube or the web, with captions and motion graphics'),
    opt('short', 'Short-form (9:16)', 'A vertical Short / Reel / TikTok built from the footage (up to 3 minutes; under 60 s performs best)'),
    opt('both', 'Long-form + a vertical short', 'The landscape video, plus a vertical cut taken from it, delivered together'),
    opt('feed', 'Square or 4:5 feed post', 'A 1:1 or 4:5 video for Instagram / LinkedIn feeds')] },
  { id: 'content', header: 'Content', multiSelect: false, question: 'What kind of footage is it?', options: [
    opt('talking-head', 'Talking head', 'One person to camera: tight pacing, graphics only where something is explained'),
    opt('screen', 'Screen recording / tutorial', 'Software or slides on screen: graphics sit beside the screen, never over what is being shown'),
    opt('explainer', 'Explainer with slides or diagrams', 'Concept-heavy narration: the most motion graphics, shown as panels and cutaways'),
    opt('interview', 'Interview / conversation', 'Natural pauses kept, minimal graphics, speaker names')] },
  { id: 'vertical', header: 'Vertical', multiSelect: false, appliesTo: ['short', 'both', 'feed'], question: 'How should the picture be framed for vertical or square?', options: [
    opt('blur', 'Whole picture over a blurred background', 'Nothing is cropped away; best for screen recordings, slides and wide shots'),
    opt('cover', 'Crop to the centre', 'Fills the frame; best for a centred talking head'),
    opt('contain', 'Whole picture on a plain background', 'Letterboxed, no blur')] },
  { id: 'shortLength', header: 'Short length', multiSelect: false, appliesTo: ['short', 'both'], question: 'How long should the vertical short be?', options: [
    opt('30', 'About 30 seconds', 'One idea, one hook'),
    opt('55', 'Under 60 seconds', 'The usual sweet spot for Shorts, Reels and TikTok'),
    opt('90', 'About 90 seconds', 'A little room for a second point'),
    opt('whole', 'The whole video', 'Reformat everything (Shorts allow up to 3 minutes)')] },
  { id: 'shortPick', header: 'Which part', multiSelect: false, appliesTo: ['short', 'both'], question: 'Which part of the video should the short use?', options: [
    opt('hook', 'The opening', 'From the start, ending on a full sentence'),
    opt('highlight', 'Claude picks the strongest moment', 'Chosen from the transcript and shown to you for approval before rendering'),
    opt('range', 'A time range I give', 'You name the start and end time')] },
  { id: 'pace', header: 'Pace', multiSelect: false, question: 'How tight should the pacing be?', options: [
    opt('tight', 'Tight (recommended for talking heads)', 'Pauses and breaths removed, quick and clean'),
    opt('natural', 'Natural', 'Dead air and fillers out, speech rhythm kept'),
    opt('extra', 'Extra tight', 'Fast, punchy, short-form style'),
    opt('relaxed', 'Relaxed', 'Breathing room kept, for interviews and calm voices')] },
  { id: 'graphics', header: 'Graphics', multiSelect: false, question: 'How many motion graphics and infographics?', options: [
    opt('medium', 'Medium (default)', 'Up to about 6 per minute, wherever something is explained'),
    opt('heavy', 'Heavy', 'Up to about 10 per minute; very visual explainers'),
    opt('light', 'Light', 'Up to about 3 per minute; mostly face time'),
    opt('off', 'None', 'Cut and captions only')] },
  { id: 'captions', header: 'Captions', multiSelect: false, question: 'Burn captions into the video?', options: [
    opt('kinetic', 'Yes, animated with stressed words', 'Word-timed, key words in italic serif and the accent colour'),
    opt('plain', 'Yes, plain', 'Simple word-timed captions'),
    opt('off', 'No, captions file only', 'captions.srt and captions.vtt are still written')] },
  { id: 'target', header: 'Destination', multiSelect: false, question: 'Where will it be published?', options: [
    opt('youtube', 'YouTube / social', 'Bitrate tuned for platform re-encoding, -14 LUFS'),
    opt('web', 'Website or email', 'Smaller file, same loudness'),
    opt('master', 'Archive master', 'Highest quality, large file')] }
];

const SHORT_WINDOW = { 30: 30, 55: 55, 90: 90 };

// answers: { deliverable, content, vertical, shortLength, shortPick, shortFrom, shortTo, pace, graphics, captions, target }
export function resolveBrief(answers = {}) {
  const a = { deliverable: 'long', content: 'talking-head', ...answers };
  const check = (key, allowed) => { if (a[key] !== undefined && !allowed.includes(a[key])) throw new Error(`Brief: ${key} must be ${allowed.join(', ')} (got ${a[key]})`); };
  for (const q of QUESTIONS) check(q.id, q.options.map(o => o.value));
  const wantsVertical = ['short', 'both'].includes(a.deliverable);
  const pace = a.pace || { 'talking-head': 'tight', screen: 'natural', explainer: 'tight', interview: 'relaxed' }[a.content];
  const graphics = a.graphics || { 'talking-head': 'light', screen: 'medium', explainer: 'heavy', interview: 'light' }[a.content];
  const vertical = a.vertical || (a.content === 'talking-head' ? 'cover' : 'blur');
  const out = {
    deliverable: a.deliverable, content: a.content, pace, graphics, captions: a.captions || 'kinetic', target: a.target || 'youtube',
    // What the main edit is rendered as:
    primaryFormat: a.deliverable === 'short' ? 'vertical' : a.deliverable === 'feed' ? 'square' : 'landscape',
    fit: ['short', 'feed'].includes(a.deliverable) ? vertical : undefined,
    graphicsMode: a.content === 'screen' ? 'panel' : a.content === 'explainer' ? 'mixed' : undefined
  };
  if (a.deliverable === 'both') out.shortFit = vertical;
  if (wantsVertical) {
    const pick = a.shortPick || 'hook';
    const len = a.shortLength || '55';
    out.shortSelection = { pick, ...(len === 'whole' ? {} : { maxSeconds: SHORT_WINDOW[len] }), ...(pick === 'range' ? { from: Number(a.shortFrom), to: Number(a.shortTo) } : {}) };
    if (pick === 'range' && !(out.shortSelection.to > out.shortSelection.from)) throw new Error('Brief: a time range needs shortFrom and shortTo (seconds, to > from)');
    if (a.deliverable === 'short') out.primaryFormat = 'vertical';
  }
  return out;
}

// CLI flags equivalent to a resolved brief, for printing and for `auto --brief`.
export function briefToAutoOptions(brief) {
  return {
    format: brief.primaryFormat, pace: brief.pace, graphics: brief.graphics, graphicsMode: brief.graphicsMode, fit: brief.fit,
    captions: brief.captions, target: brief.target, deliverables: brief.deliverable, shortFit: brief.shortFit,
    ...(brief.shortSelection ? { shortMax: brief.shortSelection.maxSeconds, shortFrom: brief.shortSelection.from, shortTo: brief.shortSelection.to, shortPick: brief.shortSelection.pick } : {})
  };
}

export async function loadBrief(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  return raw.deliverable && raw.primaryFormat ? raw : resolveBrief(raw);
}

// Terminal prompt: numbered options, Enter takes the first. Asks only the questions that apply to earlier answers.
export async function askInteractive(input = process.stdin, output = process.stderr) {
  const rl = readline.createInterface({ input, output });
  const answers = {};
  try {
    for (const q of QUESTIONS) {
      if (q.appliesTo && !q.appliesTo.includes(answers.deliverable)) continue;
      output.write(`\n${q.question}\n`);
      q.options.forEach((o, i) => output.write(`  ${i + 1}. ${o.label}: ${o.description}\n`));
      const reply = (await rl.question(`Choose 1-${q.options.length} [1]: `)).trim();
      const index = reply ? Number(reply) - 1 : 0;
      if (!Number.isInteger(index) || index < 0 || index >= q.options.length) throw new Error(`Brief: choose a number from 1 to ${q.options.length}`);
      answers[q.id] = q.options[index].value;
      if (q.id === 'shortPick' && answers.shortPick === 'range') {
        answers.shortFrom = Number(await rl.question('Start time in seconds: '));
        answers.shortTo = Number(await rl.question('End time in seconds: '));
      }
    }
  } finally { rl.close(); }
  return answers;
}
