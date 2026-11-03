// Optional independent reviewer backed by Claude (headless `claude -p`). It sees only the artifact and the criteria, never the
// producer's reasoning, and answers in the shared finding schema. Opt-in: material is sent to Anthropic via your Claude Code login.
import os from 'node:os';
import { run } from './core.js';
import { finding } from './loop.js';

const SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, owner: { type: 'string' },
      target: { type: 'object' }, message: { type: 'string' }, suggestion: { type: 'string' }, fix: { type: 'object' } },
    required: ['id', 'severity', 'message'] } }
  },
  required: ['findings']
};

const CRITERIA = {
  transcript: `Act as a script verifier. Read the words for meaning and find what a speech recogniser got wrong: sound-alike mishearings of technical terms,
product names and acronyms (for example "wrist" or "rist" where the topic is REST APIs, "red is" for Redis, "Jason" for JSON, "coffee" for Kafka), split or merged
words, wrong numbers, and obvious grammar slips the speaker did not make. Decide from the surrounding context and the video's topic, never from sound alone:
a real word that fits the sentence stays. Do not rewrite how the speaker talks. Give the reason in the message.
Fix ops: {"op":"replaceWord","index":<word index>,"to":"<corrected word>"}, {"op":"replaceSpan","index":<first word index>,"count":<words>,"to":"<one corrected word or phrase>"}
or {"op":"dropWord","index":<index>}. owner is "transcript".`,
  storyboard: `Judge each graphic: does it teach the line it covers? Is it grounded in the transcript (no invented facts or numbers)? Is the label wrong,
redundant, too long to read in its duration, or misleading? Do the graphics together follow the house style and structure (concrete question first,
mechanism built progressively, comparisons consistent, recap, next step)? Fix ops: {"op":"dropItem","id":"<item id>"} or
{"op":"setProps","id":"<item id>","props":{...complete corrected props...}} or {"op":"toPanel","id":"<item id>"}. owner is "storyboard".`,
  render: `You are shown frames from the finished video (contact sheet and stills). Look for: text clipped or overlapping, graphics covering something
important, unreadable small text, captions colliding with graphics, empty or broken frames, inconsistent style. Use owner "storyboard" with
{"op":"dropItem","id":"<item id>"} when a graphic is the problem (items are listed in the material), otherwise owner "render".`
};

export function reviewPrompt(stage, material, style) {
  return `You are an independent video-production reviewer for the "${stage}" stage. You did not make this work. Be strict but fair: report only real
problems a viewer would notice, rank them (blocker = must fix, major = should fix, minor = note), and return an empty list when the work is good.
Never invent problems. Give each finding a stable id, a short message and a concrete suggestion, plus a machine-applicable "fix" when possible.
${CRITERIA[stage] || ''}
${style?.brief ? `\nHouse style:\n${style.brief}\n` : ''}
<material>
${material}
</material>`;
}

export async function claudeReview({ stage, material, images = [], cwd = os.tmpdir(), model, allowLlm, style = null }, execute = run) {
  if (allowLlm !== true) throw new Error('Review: the Claude reviewer sends the material to Anthropic through your Claude Code login. Pass --allow-llm to confirm.');
  let prompt = reviewPrompt(stage, material, style);
  const args = ['-p', '', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--no-session-persistence', '--disable-slash-commands'];
  if (images.length) {
    prompt += `\n\nLook at these image files with the Read tool before answering:\n${images.map(p => `- ${p}`).join('\n')}`;
    args.push('--tools', 'Read', '--add-dir', cwd);
  } else args.push('--tools', '');
  args[1] = prompt;
  if (model) args.push('--model', model);
  const { stdout } = await execute('claude', args, { cwd, timeout: 600_000 });
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error('Review: claude returned non-JSON output'); }
  if (data.is_error) throw new Error(`Review: claude reported an error: ${String(data.result || '').slice(0, 300)}`);
  const out = data.structured_output ?? (() => { try { return JSON.parse(data.result); } catch { return null; } })();
  if (!out || !Array.isArray(out.findings)) throw new Error('Review: claude did not return {findings: [...]}');
  const findings = [];
  for (const f of out.findings) {
    try { findings.push(finding({ ...f, id: `claude-${stage}-${String(f.id).slice(0, 48)}`, owner: f.owner || stage })); } catch { /* skip malformed finding */ }
  }
  return { findings, costUsd: data.total_cost_usd ?? null };
}
