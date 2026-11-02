// YOUTUBE.md: a ready-to-paste publishing package built only from what is in the video (transcript, chapters, credits).
// Nothing here is invented: titles and descriptions are drafts for the human to edit, and nothing is uploaded.
import { STOP_WORDS, cleanWord } from './stress.js';

const stamp = s => { const v = Math.floor(s); const h = Math.floor(v / 3600); const m = Math.floor(v / 60) % 60; const sec = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };

export function keywords(words, count = 12) {
  const tally = new Map();
  for (const w of words || []) {
    const c = cleanWord(w.text).toLowerCase();
    if (c.length < 4 || STOP_WORDS.has(c) || /^\d+$/.test(c)) continue;
    tally.set(c, (tally.get(c) || 0) + 1);
  }
  return [...tally].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([w]) => w);
}

export function firstSentences(words, maxChars = 280) {
  const out = [];
  let len = 0;
  let sentence = [];
  for (const w of words || []) {
    sentence.push(w.text);
    if (/[.!?]["')\]]?$/.test(w.text)) {
      const text = sentence.join(' ');
      if (len + text.length > maxChars && out.length) break;
      out.push(text); len += text.length + 1; sentence = [];
      if (out.length >= 3) break;
    }
  }
  return out.join(' ');
}

// YouTube shows chapters only when the list starts at 0:00, has at least three entries and each is at least 10 s long.
export function validChapters(list, duration) {
  if (list.length < 3 || list[0].time !== 0) return { ok: false, reason: list.length < 3 ? 'fewer than three chapters' : 'the first chapter must start at 0:00' };
  for (let i = 0; i < list.length; i++) {
    const end = list[i + 1]?.time ?? duration;
    if (end - list[i].time < 10) return { ok: false, reason: `chapter "${list[i].title}" is shorter than 10 seconds` };
  }
  return { ok: true };
}

export function youtubePackage({ title, duration, width, height, words, chapters, credits, captionsFile, warnings = [] }) {
  const vertical = height > width;
  const kw = keywords(words);
  const check = validChapters(chapters, duration);
  const lines = [`# ${title}`, '', `Publishing package drafted from the video itself. Edit before use; nothing has been uploaded.`, '',
    '## Title options', `- ${title}`, ...(kw.length >= 2 ? [`- ${title.replace(/\s*\(.*\)$/, '')}: ${kw.slice(0, 2).join(' and ')}`] : []), '',
    '## Description', '', firstSentences(words) || '(no transcript was available; write a two-sentence summary here)', ''];
  if (chapters.length && check.ok) lines.push('Chapters', ...chapters.map(c => `${stamp(c.time)} ${c.title}`), '');
  else if (chapters.length) lines.push(`> Chapters not included: ${check.reason}. YouTube needs a 0:00 start, at least three chapters and 10 s minimum each.`, '');
  const attributions = [...new Set((credits || []).filter(c => c.sourceUrl || /music|sound|stock/i.test(c.rights || '')).map(c => `${c.attribution}${c.sourceUrl ? ` (${c.sourceUrl})` : ''}`))];
  if (attributions.length) lines.push('Credits', ...attributions.map(a => `- ${a}`), '');
  if (kw.length) lines.push(kw.slice(0, 3).map(k => `#${k.replace(/[^a-z0-9]/gi, '')}`).join(' ') + (vertical ? ' #Shorts' : ''), '');
  lines.push('## Tags', kw.length ? kw.join(', ') : '(none suggested)', '', '## Files to upload',
    '- final.mp4', `- ${captionsFile || 'captions.srt'} (upload as the caption track so it stays searchable)`, '- thumbnail.png (a frame; make a designed thumbnail for long-form)', '',
    '## Before publishing', '- [ ] Watch the whole video, including every graphic (facts and numbers are NOT VERIFIED)',
    '- [ ] Check the caption wording and proper nouns', ...(vertical ? [`- [ ] Vertical ${Math.round(duration)} s: ${duration > 180 ? 'TOO LONG for Shorts (limit 3 min)' : duration > 60 ? 'under 60 s performs best on Shorts, Reels and TikTok' : 'fits Shorts, Reels and TikTok'}`] : []),
    ...warnings.map(w => `- [ ] Warning: ${w}`));
  return `${lines.join('\n')}\n`;
}
