// The shorts pipeline in the web app: start it, watch the queue, give the go-aheads it waits for, read every review, give feedback, and look after what it has learned.
// A background worker takes one job at a time with no deadline. Nothing is sent, spent or approved without the person: every gate is an explicit confirmation.
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { createPipeline, grantGate } from '../pipeline/agents.js';
import { GATES } from '../pipeline/queue.js';
import * as L from '../pipeline/lessons.js';
import { shortsRoot } from './shorts.js';

const ID = /^s-[a-f0-9]{8}$/;

export function registerPipeline(on, { store, err, deps = {} }) {
  const { execute, fetcher, env, cwd } = deps;
  const root = shortsRoot();
  const pipeline = createPipeline({ db: store.db, root, execute, fetcher, env, cwd, store, verifyAudio: deps.verifyAudio !== false, log: deps.log || (() => {}), ...(deps.pipeline || {}) });
  pipeline.queue.recoverStale(0);
  let working = false, timer = null;
  const tick = async () => { if (working) return; working = true; try { await pipeline.drain({ backoffMs: deps.backoffMs ?? 30_000 }); } catch { /* a job failure is recorded on the job */ } finally { working = false; } };
  if (deps.worker !== false) { timer = setInterval(tick, deps.pollMs ?? 1500); timer.unref?.(); }
  const kick = () => { if (deps.worker !== false) setImmediate(tick); };   // with the worker off (tests) nothing runs behind the caller's back
  const sid = params => { if (!ID.test(params.sid)) throw err('Invalid short id'); return params.sid; };

  const summary = id => {
    const q = pipeline.queue, jobs = q.jobs(id), counts = q.counts(id), reviews = L.reviewsFor(store.db, id);
    const real = jobs.filter(j => j.handler);
    const last = jobs.at(-1);
    let status = 'idle';
    if (counts.running || counts.pending) status = 'working';
    else if (counts.waiting) status = 'waiting';
    else if (counts.dead || counts.failed) status = 'failed';
    else if (last?.type === 'needs.human') status = 'needs-you';
    else if (jobs.some(j => j.type === 'short.completed')) status = 'complete';
    else if (!real.length) status = 'idle';
    return { status, counts, gates: q.gates(id).map(g => g.gate), waiting: q.waiting(id),
      jobs: jobs.slice(-120).map(j => ({ id: j.id, handler: j.handler, type: j.type, status: j.status, attempts: j.attempts, createdAt: j.created_at, startedAt: j.started_at, endedAt: j.ended_at, gate: j.wait_gate, note: j.wait_note, error: j.error, payload: j.type === 'needs.human' ? j.payload : undefined })),
      reviews: reviews.map(r => ({ id: r.id, stage: r.stage, round: r.round, reviewer: r.reviewer, verdict: r.verdict, at: r.at, metrics: r.metrics, findings: r.findings.map(f => ({ id: f.id, code: f.code, severity: f.severity, message: f.message, suggestion: f.suggestion, owner: f.owner, lesson: f.lesson, by: f.reviewer || 'code' })) })),
      feedback: L.feedbackFor(store.db, id), needsYou: last?.type === 'needs.human' ? last.payload : null };
  };

  on('GET', '/api/shorts/:sid/pipeline', async ({ params }) => summary(sid(params)));

  // Start: the person says, once, what the pipeline may do. Each confirmation is its own gate; gates not given here are asked for when an agent reaches them.
  on('POST', '/api/shorts/:sid/pipeline/start', async ({ params, body }) => {
    const id = sid(params), q = pipeline.queue;
    if (q.jobs(id).some(j => ['pending', 'running', 'waiting'].includes(j.status))) throw err('That short is already in the pipeline', 409);
    if (body.confirmLlm === true) q.grant(id, 'llm');
    if (body.confirmBrowse === true) q.grant(id, 'browse');
    if (body.confirmStock === true) { if (body.confirmRights !== true) throw err('Footage is downloaded under the stock provider\'s licence. Confirm that you accept it.'); q.grant(id, 'stock'); }
    if (body.confirmSpend === true) q.grant(id, 'spend', { details: { maxChars: Math.min(Math.max(Number(body.maxChars) || 3000, 100), 20000) } });
    pipeline.start(id);
    kick();
    return summary(id);
  });

  on('POST', '/api/shorts/:sid/pipeline/gate', async ({ params, body }) => {
    const id = sid(params), gate = String(body.gate || '');
    if (!GATES.includes(gate)) throw err('Unknown gate');
    if (['llm', 'browse', 'spend'].includes(gate) && body.confirm !== true) throw err(gate === 'spend' ? 'Confirm that you allow ElevenLabs credits to be spent.' : gate === 'llm' ? 'Confirm that your text may be sent to Claude.' : 'Confirm that a browser may visit the companies\' websites.');
    if (gate === 'stock' && (body.confirm !== true || body.confirmRights !== true)) throw err('Confirm the stock search and that you accept the provider\'s licence.');
    const details = gate === 'spend' ? { maxChars: Math.min(Math.max(Number(body.maxChars) || 3000, 100), 20000) } : gate === 'plan' ? { quality: body.quality === 'final' ? 'final' : 'draft' } : {};
    try { await grantGate(pipeline, { shortId: id, gate, details, store }); } catch (error) { throw err(String(error.message)); }
    kick();
    return summary(id);
  });

  on('POST', '/api/shorts/:sid/pipeline/feedback', async ({ params, body }) => {
    const id = sid(params);
    if (!L.STAGES.includes(body.stage)) throw err('Unknown stage');
    const kind = ['note', 'dispute'].includes(body.kind) ? body.kind : 'note';
    try { const r = L.recordFeedback(store.db, { shortId: id, stage: body.stage, kind, text: String(body.text || ''), details: { code: body.code ? String(body.code).slice(0, 60) : undefined } }); return { ok: true, lesson: r.lesson }; } catch (error) { throw err(String(error.message)); }
  });
  on('POST', '/api/shorts/:sid/pipeline/retry', async ({ params }) => { const id = sid(params); const n = pipeline.queue.retryDead(id); kick(); return { retried: n }; });
  on('POST', '/api/shorts/:sid/pipeline/cancel', async ({ params }) => ({ cancelled: pipeline.queue.cancel(sid(params)) }));

  // what the studio has learned
  on('GET', '/api/lessons', async ({ query }) => ({ lessons: L.listLessons(store.db, { stage: query.get('stage') || null, status: query.get('status') || null }), stages: L.STAGES, statuses: L.LESSON_STATUSES }));
  on('PUT', '/api/lessons/:lid', async ({ params, body }) => {
    const id = Number(params.lid); if (!Number.isInteger(id)) throw err('Invalid lesson');
    try {
      if (typeof body.rule === 'string') L.editLesson(store.db, id, body.rule);
      if (body.status) L.setLessonStatus(store.db, id, String(body.status));
    } catch (error) { throw err(String(error.message)); }
    return { lessons: L.listLessons(store.db) };
  });
  on('DELETE', '/api/lessons/:lid', async ({ params }) => { const id = Number(params.lid); if (!Number.isInteger(id)) throw err('Invalid lesson'); L.deleteLesson(store.db, id); return { deleted: true }; });

  return { pipeline, tick, stop() { if (timer) clearInterval(timer); } };
}
