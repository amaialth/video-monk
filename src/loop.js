// Review loops. Every stage has a producer and an independent reviewer:
//   produce -> review -> (rejected) -> producer receives the findings, revises ONLY the parts they point at -> review again
// The lead loop (runPipeline) orders the stages, and when a reviewer's finding is owned by an EARLIER stage it sends the
// feedback back to that stage's producer, then re-produces everything downstream. Every round is recorded in a ledger.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { exists } from './core.js';

export const SEVERITIES = ['blocker', 'major', 'minor'];
const blocking = f => f.severity === 'blocker' || f.severity === 'major';

// Normalise a finding so reviewers (code, Claude, subagents) all speak one schema.
export function finding({ id, severity = 'major', owner, target = {}, message, suggestion = '', fix = null }) {
  if (!SEVERITIES.includes(severity)) throw new Error(`Loop: severity must be one of ${SEVERITIES.join(', ')}`);
  if (!id || !message) throw new Error('Loop: a finding needs an id and a message');
  return { id, severity, ...(owner ? { owner } : {}), target, message, ...(suggestion ? { suggestion } : {}), ...(fix ? { fix } : {}) };
}

// A verdict is rejected when any blocker or major finding exists; minors are kept as notes.
export function verdict({ stage, round, reviewer, findings, metrics = {} }) {
  const blockers = findings.filter(blocking);
  return { version: 1, stage, round, reviewer, decision: blockers.length ? 'rejected' : 'approved', metrics, findings };
}

export class Ledger {
  constructor(file = null) { this.file = file; this.entries = []; this.queue = Promise.resolve(); }

  static async open(file) {
    const ledger = new Ledger(file);
    if (file && await exists(file)) ledger.entries = JSON.parse(await readFile(file, 'utf8')).entries || [];
    return ledger;
  }

  record(entry) {
    const stamped = { at: new Date().toISOString(), ...entry };
    this.entries.push(stamped);
    try { this.onRecord?.(stamped); } catch { /* a listener must never break the loop */ }
    if (!this.file) return Promise.resolve();
    const snapshot = `${JSON.stringify({ version: 1, entries: this.entries }, null, 1)}\n`;
    this.queue = this.queue.then(async () => { const temp = `${this.file}.tmp`; await writeFile(temp, snapshot); await rename(temp, this.file); });
    return this.queue;
  }

  stageSummary() {
    const out = {};
    for (const e of this.entries) {
      const s = out[e.stage] ??= { rounds: 0, rejections: 0, revisions: 0, reroutes: 0, status: 'pending', outstanding: [] };
      if (e.kind === 'review') { s.rounds++; if (e.decision === 'rejected') s.rejections++; s.status = e.decision; s.outstanding = e.findings.filter(blocking).map(f => f.id); }
      if (e.kind === 'revise') s.revisions++;
      if (e.kind === 'reroute') s.reroutes++;
      if (e.kind === 'escalate') s.status = 'escalated';
    }
    return out;
  }

  markdown(title = 'Review loop') {
    const lines = [`# ${title}`, '', '| Stage | Rounds | Rejections | Revisions | Rerouted in | Final |', '|---|---:|---:|---:|---:|---|'];
    for (const [stage, s] of Object.entries(this.stageSummary())) lines.push(`| ${stage} | ${s.rounds} | ${s.rejections} | ${s.revisions} | ${s.reroutes} | ${s.status}${s.outstanding.length ? ` (${s.outstanding.length} open)` : ''} |`);
    lines.push('', '## Rounds', '');
    for (const e of this.entries) {
      if (e.kind === 'review') {
        lines.push(`- **${e.stage} round ${e.round}** (${e.reviewer}): ${e.decision}${e.findings.length ? `, ${e.findings.length} finding(s)` : ''}`);
        for (const f of e.findings) lines.push(`  - [${f.severity}] ${f.id}${f.owner && f.owner !== e.stage ? ` → ${f.owner}` : ''}: ${f.message}${f.suggestion ? ` — ${f.suggestion}` : ''}`);
      } else if (e.kind === 'revise') lines.push(`- ${e.stage} revised (${e.reviser || 'producer'}): ${e.changed.length ? e.changed.join('; ') : 'no change'}`);
      else if (e.kind === 'reroute') lines.push(`- feedback from ${e.from} sent back to ${e.stage}: ${e.findings.map(f => f.id).join(', ')}`);
      else if (e.kind === 'escalate') lines.push(`- **${e.stage} escalated to a human** after ${e.rounds} round(s): ${e.findings.map(f => f.id).join(', ')}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

// One stage: review, and while rejected, hand the stage's OWN blocking findings to its producer. Findings owned by another
// stage are returned for the lead loop to route. Returns { status, artifact, upstream }.
export async function reviewLoop(stage, artifact, ctx, { ledger, maxRounds = 3, log = () => {} }) {
  for (let round = 1; round <= maxRounds + 1; round++) {
    const v = await stage.review(artifact, { ...ctx, round });
    await ledger.record({ kind: 'review', stage: stage.name, round, reviewer: v.reviewer, decision: v.decision, metrics: v.metrics, findings: v.findings });
    log(`  ${stage.name} review ${round}: ${v.decision}${v.findings.length ? ` (${v.findings.filter(blocking).length} blocking, ${v.findings.length - v.findings.filter(blocking).length} notes)` : ''}`);
    if (v.decision === 'approved') return { status: 'approved', artifact, upstream: [] };
    const mine = v.findings.filter(f => blocking(f) && (!f.owner || f.owner === stage.name));
    const upstream = v.findings.filter(f => blocking(f) && f.owner && f.owner !== stage.name);
    if (!mine.length) return { status: 'rejected', artifact, upstream };
    if (round > maxRounds) {
      await ledger.record({ kind: 'escalate', stage: stage.name, rounds: maxRounds, findings: mine });
      return { status: 'escalated', artifact, upstream };
    }
    // The producer sees the findings, changes only what they target, and reports what it changed.
    const revised = await stage.revise(artifact, mine, { ...ctx, round });
    await ledger.record({ kind: 'revise', stage: stage.name, round, reviser: stage.reviser || 'producer', changed: revised.changed || [], addressed: mine.map(f => f.id) });
    artifact = revised.artifact;
    if (upstream.length) return { status: 'rejected', artifact, upstream };
  }
  return { status: 'escalated', artifact, upstream: [] };
}

// Lead loop: runs stages in order. stage = { name, produce(ctx), review(artifact, ctx), revise(artifact, findings, ctx) }.
// Optional observers for a UI: onEvent({type, stage, ...}) reports progress; gate(stageName, artifact, info) is awaited when a stage is approved (or
// escalated) and returns { approved: true, patch? } to continue (patch is merged into the artifact, e.g. a new manifest file) or
// { approved: false, findings } to send human findings back to the stage's producer; signal (AbortSignal) cancels between stages.
export async function runPipeline({ stages, ctx = {}, ledger = new Ledger(), maxRounds = 3, maxReroutes = 3, log = () => {}, onEvent = () => {}, gate = null, signal = null }) {
  const names = stages.map(s => s.name);
  const artifacts = {};
  ctx = { ...ctx, artifacts };
  const keep = new Set();
  let reroutes = 0;
  let i = 0;
  while (i < stages.length) {
    const stage = stages[i];
    if (signal?.aborted) return { status: 'cancelled', artifacts, ledger, stoppedAt: stage.name };
    log(`Stage ${i + 1}/${stages.length}: ${stage.name}`);
    onEvent({ type: 'stage-start', stage: stage.name, index: i, total: stages.length, rerun: keep.has(stage.name) });
    if (!keep.has(stage.name)) { artifacts[stage.name] = await stage.produce(ctx); onEvent({ type: 'stage-produced', stage: stage.name, artifact: artifacts[stage.name] }); }
    keep.delete(stage.name);
    const result = await reviewLoop(stage, artifacts[stage.name], ctx, { ledger, maxRounds, log });
    artifacts[stage.name] = result.artifact;
    if (result.upstream.length && reroutes < maxReroutes) {
      reroutes++;
      const byOwner = new Map();
      for (const f of result.upstream) byOwner.set(f.owner, [...(byOwner.get(f.owner) || []), f]);
      // Route only the earliest owner's findings: re-producing later stages would discard their revisions, and anything still
      // wrong is flagged again by the next review.
      const earliest = Math.min(...[...byOwner.keys()].map(o => names.indexOf(o)).filter(x => x >= 0 && x < i));
      if (Number.isFinite(earliest)) {
        const owner = names[earliest];
        const findings = byOwner.get(owner);
        const target = stages[earliest];
        await ledger.record({ kind: 'reroute', stage: owner, from: stage.name, findings });
        log(`  feedback from ${stage.name} sent back to ${owner}`);
        const revised = await target.revise(artifacts[owner], findings, { ...ctx, round: 0 });
        await ledger.record({ kind: 'revise', stage: owner, round: 0, reviser: target.reviser || 'producer', changed: revised.changed || [], addressed: findings.map(f => f.id) });
        artifacts[owner] = revised.artifact;
        keep.add(owner); // its revised artifact is reviewed again, not re-produced
        i = earliest;
        continue;
      }
    }
    const stuck = result.status === 'escalated' || (result.status === 'rejected' && result.upstream.length);
    if (gate) {
      onEvent({ type: stuck ? 'stage-escalated' : 'stage-approved', stage: stage.name, artifact: artifacts[stage.name] });
      const g = await gate(stage.name, artifacts[stage.name], { ...ctx, escalated: stuck, findings: stuck ? result.upstream : [] });
      if (signal?.aborted) return { status: 'cancelled', artifacts, ledger, stoppedAt: stage.name };
      if (g && g.approved === false && g.findings?.length) {
        const revised = await stage.revise(artifacts[stage.name], g.findings, { ...ctx, round: 0 });
        await ledger.record({ kind: 'human', stage: stage.name, findings: g.findings, changed: revised.changed || [] });
        artifacts[stage.name] = revised.artifact;
        keep.add(stage.name); // the human-revised artifact goes through the reviewer again
        continue;
      }
      if (g?.approved === false) return { status: 'needs-human', artifacts, ledger, stoppedAt: stage.name };
      if (g?.patch) artifacts[stage.name] = { ...artifacts[stage.name], ...g.patch };
      await ledger.record({ kind: 'human-approve', stage: stage.name, overrode: stuck });
    } else if (stuck) {
      return { status: 'needs-human', artifacts, ledger, stoppedAt: stage.name };
    }
    i++;
  }
  return { status: 'approved', artifacts, ledger };
}
