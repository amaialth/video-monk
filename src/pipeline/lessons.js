// Reviews, human feedback and the lessons learned from them. Every review is stored with its findings. A finding that recurs becomes a LESSON: a short rule that is put
// in front of the producing agent the next time it works on that stage. Lessons are measured: each time one is applied, the next review shows whether the problem came
// back (the lesson did not work) or stayed away (it did). What persists is under the person's control:
//   - rules written by this toolkit's own deterministic reviewers become active after the problem has been seen twice;
//   - rules proposed by a Claude reviewer wait as "proposed" until the person approves them (they were written by a model that had read the source text, so they never apply on their own);
//   - rules the person writes as feedback are active at once.
// A lesson is guidance, capped and cleaned (no links, code or control characters); it is never an instruction from the source text.
const fail = message => { throw new Error(`Lessons: ${message}`); };
export const STAGES = ['script', 'direction', 'visuals', 'audio', 'plan', 'render'];
export const LESSON_STATUSES = ['candidate', 'proposed', 'active', 'disabled', 'ineffective', 'retired'];
const WEIGHT = { blocker: 3, major: 2, minor: 1 };
const BLOCKED = /ignore (all|any|the|previous|above)|system prompt|api[ _-]?key|password|secret|exfiltrat|do not (tell|show) the user|disregard/i;

export function sanitizeRule(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (clean.length < 8) fail('a lesson needs a short rule of at least a few words');
  if (BLOCKED.test(clean)) fail('that rule looks like an instruction aimed at the agent rather than a lesson about the work');
  return clean;
}
const codeOf = value => String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---------------------------------------------------------------- reviews
export function recordReview(db, { shortId, stage, round, reviewer, verdict, findings = [], metrics = {}, jobId = null, now = Date.now() }) {
  if (!STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  if (!['approve', 'revise', 'block'].includes(verdict)) fail('a verdict is approve, revise or block');
  return Number(db.run('INSERT INTO pipeline_reviews (short_id, stage, round, reviewer, verdict, findings, metrics, job_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    shortId, stage, round, reviewer, verdict, JSON.stringify(findings).slice(0, 60000), JSON.stringify(metrics).slice(0, 8000), jobId, now).lastInsertRowid);
}
export function reviewsFor(db, shortId, stage = null) {
  return db.all(`SELECT * FROM pipeline_reviews WHERE short_id = ? ${stage ? 'AND stage = ?' : ''} ORDER BY id`, ...(stage ? [shortId, stage] : [shortId])).map(r => ({ ...r, findings: JSON.parse(r.findings), metrics: JSON.parse(r.metrics) }));
}
export const roundFor = (db, shortId, stage) => db.get('SELECT COUNT(*) AS n FROM pipeline_reviews WHERE short_id = ? AND stage = ?', shortId, stage).n + 1;

// ---------------------------------------------------------------- learning
// One finding seen again is a pattern. `source` says who wrote the rule: 'code' (our own reviewers), 'claude' (a model reviewer) or 'human'.
export function learn(db, finding, { stage, source = 'code', now = Date.now() } = {}) {
  const code = codeOf(finding.code);
  if (!code || !finding.lesson) return null;
  let rule; try { rule = sanitizeRule(finding.lesson); } catch { return null; }
  const severity = ['blocker', 'major', 'minor'].includes(finding.severity) ? finding.severity : 'major';
  const existing = db.get('SELECT * FROM lessons WHERE stage = ? AND code = ?', stage, code);
  if (!existing) {
    const status = source === 'human' ? 'active' : 'candidate';
    db.run('INSERT INTO lessons (stage, code, rule, source, status, severity, occurrences, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)', stage, code, rule, source, status, severity, now, now);
  } else {
    let status = existing.status;
    const occurrences = existing.occurrences + 1;
    if (status === 'candidate' && occurrences >= 2) status = source === 'code' ? 'active' : 'proposed';       // a model's rule always waits for the person
    db.run('UPDATE lessons SET occurrences = ?, last_seen = ?, status = ?, severity = ? WHERE id = ?', occurrences, now, status, WEIGHT[severity] > WEIGHT[existing.severity] ? severity : existing.severity, existing.id);
  }
  return db.get('SELECT * FROM lessons WHERE stage = ? AND code = ?', stage, code);
}

// What a producing agent is told before it works. Marks each lesson as applied; the next review judges it.
export function lessonBlock(db, stage, { limit = 6, now = Date.now() } = {}) {
  const rows = db.all("SELECT * FROM lessons WHERE stage = ? AND status = 'active'", stage)
    .map(l => ({ ...l, score: WEIGHT[l.severity] * (l.occurrences + (l.source === 'human' ? 4 : 0)) + Math.max(0, 3 - (now - l.last_seen) / (30 * 86400_000)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
  for (const l of rows) db.run('UPDATE lessons SET applied = applied + 1, last_applied = ? WHERE id = ?', now, l.id);
  return { ids: rows.map(l => l.id), text: rows.length ? rows.map(l => `- ${l.rule}`).join('\n') : '' };
}

// After a review: did a lesson that was applied do its job? The same finding coming back means no.
export function judgeLessons(db, stage, appliedIds, findings) {
  const codes = new Set(findings.map(f => codeOf(f.code)));
  let held = 0, recurred = 0;
  for (const id of appliedIds || []) {
    const l = db.get('SELECT * FROM lessons WHERE id = ?', id);
    if (!l || l.stage !== stage) continue;
    if (codes.has(l.code)) { recurred++; db.run('UPDATE lessons SET recurred = recurred + 1 WHERE id = ?', id); if (l.recurred + 1 >= 3 && l.held === 0) db.run("UPDATE lessons SET status = 'ineffective' WHERE id = ?", id); }
    else { held++; db.run('UPDATE lessons SET held = held + 1 WHERE id = ?', id); }
  }
  return { held, recurred };
}

export function listLessons(db, { stage = null, status = null } = {}) {
  const where = [], params = [];
  if (stage) { where.push('stage = ?'); params.push(stage); }
  if (status) { where.push('status = ?'); params.push(status); }
  return db.all(`SELECT * FROM lessons ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE status WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 WHEN 'ineffective' THEN 2 ELSE 3 END, occurrences DESC, last_seen DESC`, ...params);
}
export function setLessonStatus(db, id, status) {
  if (!LESSON_STATUSES.includes(status)) fail(`unknown status ${status}`);
  return db.run('UPDATE lessons SET status = ? WHERE id = ?', status, id).changes;
}
export function editLesson(db, id, rule) { return db.run("UPDATE lessons SET rule = ?, status = CASE WHEN status IN ('ineffective','proposed') THEN 'active' ELSE status END, recurred = 0, held = 0 WHERE id = ?", sanitizeRule(rule), id).changes; }
export function deleteLesson(db, id) { return db.run('DELETE FROM lessons WHERE id = ?', id).changes; }

// ---------------------------------------------------------------- the person's feedback
// Written feedback is a lesson at once (it is the person's own rule). Disagreeing with a reviewer lowers that finding's standing.
export function recordFeedback(db, { shortId, stage, kind = 'note', text = '', details = {}, now = Date.now() }) {
  if (!STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  const id = Number(db.run('INSERT INTO pipeline_feedback (short_id, stage, kind, text, details, at) VALUES (?, ?, ?, ?, ?, ?)', shortId, stage, kind, String(text).slice(0, 1000), JSON.stringify(details).slice(0, 4000), now).lastInsertRowid);
  let lesson = null;
  if (kind === 'note' && String(text).trim().length >= 8) {
    try { lesson = learn(db, { code: `human-${codeOf(String(text).split(/\s+/).slice(0, 5).join('-'))}`, lesson: text, severity: 'major' }, { stage, source: 'human', now }); } catch { /* not a usable rule: kept as feedback only */ }
  }
  if (kind === 'dispute' && details.code) { const l = db.get('SELECT * FROM lessons WHERE stage = ? AND code = ?', stage, codeOf(details.code)); if (l) db.run("UPDATE lessons SET status = CASE WHEN occurrences <= 2 THEN 'disabled' ELSE status END, note = ? WHERE id = ?", 'the person disagreed with the reviewer', l.id); }
  return { id, lesson };
}
export function feedbackFor(db, shortId) { return db.all('SELECT * FROM pipeline_feedback WHERE short_id = ? ORDER BY id', shortId).map(r => ({ ...r, details: JSON.parse(r.details) })); }
