// The event queue between the agents of a short. An event is published once; every agent subscribed to its type gets its own job, so agents never call each
// other: each reacts to what happened. Jobs live in the database, so a restart loses nothing; a job that needs the person (spend credits, send text out, approve)
// parks on a named GATE and wakes only when that gate is granted. The runner takes one job at a time, with no deadline: slow work (3D pages, recordings) just takes the time it takes.
const fail = message => { throw new Error(`Pipeline: ${message}`); };
export const GATES = ['llm', 'browse', 'stock', 'spend', 'direction', 'visuals', 'audio', 'plan'];
export const STATUSES = ['pending', 'running', 'waiting', 'done', 'failed', 'dead', 'cancelled'];

// Thrown by an agent that cannot go on until the person has granted a gate.
export class WaitForGate extends Error {
  constructor(gate, note = '') { super(`waiting for ${gate}`); this.gate = gate; this.note = note; }
}

const row = r => r && ({ ...r, payload: JSON.parse(r.payload || '{}'), result: r.result ? JSON.parse(r.result) : null });

export class Queue {
  constructor(db, { now = () => Date.now() } = {}) { this.db = db; this.now = now; this.subscribers = new Map(); }

  // agents subscribe by event type; one agent can handle several types
  subscribe(type, agent) { const list = this.subscribers.get(type) || []; if (!list.includes(agent)) list.push(agent); this.subscribers.set(type, list); }

  // Publish an event: one job per subscribed agent (or one finished audit row when nobody listens, so the timeline still shows it).
  publish(shortId, type, payload = {}, { parentId = null, delayMs = 0, dedupeKey = null } = {}) {
    const agents = this.subscribers.get(type) || [];
    const at = this.now();
    if (!agents.length) return [this.insert({ shortId, type, handler: null, payload, parentId, status: 'done', availableAt: at, endedAt: at, dedupeKey })];
    return agents.map(agent => this.insert({ shortId, type, handler: agent, payload, parentId, status: 'pending', availableAt: at + delayMs, dedupeKey: dedupeKey ? `${dedupeKey}:${agent}` : null }));
  }
  insert({ shortId, type, handler, payload, parentId, status, availableAt, endedAt = null, dedupeKey = null }) {
    if (!shortId || !type) fail('an event needs a short and a type');
    if (dedupeKey) { const hit = this.db.get('SELECT id FROM pipeline_jobs WHERE dedupe_key = ?', dedupeKey); if (hit) return hit.id; }
    return Number(this.db.run('INSERT INTO pipeline_jobs (short_id, type, handler, payload, status, available_at, created_at, ended_at, parent_id, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      shortId, type, handler, JSON.stringify(payload), status, availableAt, this.now(), endedAt, parentId, dedupeKey).lastInsertRowid);
  }

  // The oldest job that is ready, marked running. Only one runner works at a time, so this is a simple claim.
  claim() {
    return this.db.tx(() => {
      const next = this.db.get("SELECT * FROM pipeline_jobs WHERE status = 'pending' AND available_at <= ? ORDER BY available_at, id LIMIT 1", this.now());
      if (!next) return null;
      this.db.run("UPDATE pipeline_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, error = NULL WHERE id = ?", this.now(), next.id);
      return row(this.db.get('SELECT * FROM pipeline_jobs WHERE id = ?', next.id));
    });
  }
  complete(id, result = null) { this.db.run("UPDATE pipeline_jobs SET status = 'done', ended_at = ?, result = ?, wait_gate = NULL WHERE id = ?", this.now(), result ? JSON.stringify(result).slice(0, 20000) : null, id); }
  // transient problem: try again later (backoff); out of attempts: park it as dead so a person can look
  fail(id, error, { backoffMs = 30_000 } = {}) {
    const job = this.db.get('SELECT attempts, max_attempts FROM pipeline_jobs WHERE id = ?', id);
    const message = String(error?.message || error).slice(0, 1500);
    if (job && job.attempts < job.max_attempts) this.db.run("UPDATE pipeline_jobs SET status = 'pending', available_at = ?, error = ? WHERE id = ?", this.now() + backoffMs * 2 ** (job.attempts - 1), message, id);
    else this.db.run("UPDATE pipeline_jobs SET status = 'dead', ended_at = ?, error = ? WHERE id = ?", this.now(), message, id);
    return this.get(id);
  }
  park(id, gate, note = '') { this.db.run("UPDATE pipeline_jobs SET status = 'waiting', wait_gate = ?, wait_note = ?, attempts = MAX(0, attempts - 1) WHERE id = ?", gate, String(note).slice(0, 300), id); }
  get(id) { return row(this.db.get('SELECT * FROM pipeline_jobs WHERE id = ?', id)); }

  // ---- gates: the person's go-ahead for one kind of thing, per short
  granted(shortId, gate) { return Boolean(this.db.get('SELECT 1 AS x FROM pipeline_gates WHERE short_id = ? AND gate = ?', shortId, gate)); }
  gateDetails(shortId, gate) { const r = this.db.get('SELECT details FROM pipeline_gates WHERE short_id = ? AND gate = ?', shortId, gate); return r ? JSON.parse(r.details) : null; }
  grant(shortId, gate, { by = 'local user', details = {} } = {}) {
    if (!GATES.includes(gate)) fail(`unknown gate ${gate}`);
    this.db.run('INSERT INTO pipeline_gates (short_id, gate, granted_at, by_user, details) VALUES (?, ?, ?, ?, ?) ON CONFLICT(short_id, gate) DO UPDATE SET granted_at = excluded.granted_at, by_user = excluded.by_user, details = excluded.details', shortId, gate, this.now(), by, JSON.stringify(details));
    return this.db.run("UPDATE pipeline_jobs SET status = 'pending', wait_gate = NULL, available_at = ? WHERE short_id = ? AND status = 'waiting' AND wait_gate = ?", this.now(), shortId, gate).changes;
  }
  revoke(shortId, gate) { return this.db.run('DELETE FROM pipeline_gates WHERE short_id = ? AND gate = ?', shortId, gate).changes; }
  gates(shortId) { return this.db.all('SELECT gate, granted_at, by_user FROM pipeline_gates WHERE short_id = ? ORDER BY granted_at', shortId); }

  // ---- looking at it
  jobs(shortId, { limit = 300 } = {}) { return this.db.all('SELECT * FROM pipeline_jobs WHERE short_id = ? ORDER BY id DESC LIMIT ?', shortId, limit).reverse().map(row); }
  waiting(shortId) { return this.db.all("SELECT id, handler, type, wait_gate, wait_note FROM pipeline_jobs WHERE short_id = ? AND status = 'waiting'", shortId); }
  counts(shortId = null) {
    const rows = shortId ? this.db.all('SELECT status, COUNT(*) AS n FROM pipeline_jobs WHERE short_id = ? GROUP BY status', shortId) : this.db.all('SELECT status, COUNT(*) AS n FROM pipeline_jobs GROUP BY status');
    return Object.fromEntries(rows.map(r => [r.status, r.n]));
  }
  // after a crash: jobs left running go back to pending (handlers are written to be repeatable)
  recoverStale(olderThanMs = 0) { return this.db.run("UPDATE pipeline_jobs SET status = 'pending', error = 'recovered after a restart' WHERE status = 'running' AND started_at <= ?", this.now() - olderThanMs).changes; }
  cancel(shortId) { return this.db.run("UPDATE pipeline_jobs SET status = 'cancelled', ended_at = ? WHERE short_id = ? AND status IN ('pending','waiting','running')", this.now(), shortId).changes; }
  retryDead(shortId) { return this.db.run("UPDATE pipeline_jobs SET status = 'pending', attempts = 0, available_at = ?, error = NULL WHERE short_id = ? AND status IN ('dead','failed')", this.now(), shortId).changes; }
}
