// Project store for the web UI, backed by the local SQLite database (src/db.js). Artifacts (videos, manifests, graphics) stay as files in a
// folder per project; the database keeps the project record, its events, approvals, run history and checkpoints.
//   <home>/video-monk.db                  projects, events, approvals, checkpoints, runs, settings, presets, terms
//   <home>/ui/projects/<id>/run/          the pipeline output folder (same layout as `video-monk auto`)
//   <home>/ui/projects/<id>/APPROVALS.md  a human-readable copy of the approval record
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Db } from '../db.js';

export const homeDir = () => process.env.VIDEO_MONK_HOME || path.join(os.homedir(), '.video-monk');
export const uiHome = () => path.join(homeDir(), 'ui');
const ID = /^p-[a-z0-9-]{6,48}$/;
export const validId = id => ID.test(String(id));

export class Store extends EventEmitter {
  constructor(root, db) { super(); this.root = root; this.db = db; this.seq = new Map(); }

  static async open(home = homeDir()) {
    const db = await Db.open(path.join(home, 'video-monk.db'));
    const store = new Store(path.join(home, 'ui', 'projects'), db);
    await mkdir(store.root, { recursive: true });
    await store.importLegacy();
    return store;
  }

  dir(id) { if (!validId(id)) throw Object.assign(new Error('Invalid project id'), { status: 400 }); return path.join(this.root, id); }

  async list() { return this.db.all('SELECT doc FROM projects ORDER BY updated_at DESC').map(r => JSON.parse(r.doc)); }

  async get(id) {
    this.dir(id);
    const r = this.db.get('SELECT doc FROM projects WHERE id = ?', id);
    if (!r) throw Object.assign(new Error('Project not found'), { status: 404 });
    return JSON.parse(r.doc);
  }

  save(project) {
    project.updatedAt = new Date().toISOString();
    this.dir(project.id);
    this.db.run(`INSERT INTO projects (id, name, status, imported, media_path, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, media_path = excluded.media_path, updated_at = excluded.updated_at, doc = excluded.doc`,
      project.id, project.name, project.status, project.imported ? 1 : 0, project.media?.path || null, project.createdAt, project.updatedAt, JSON.stringify(project));
    this.emit('project', project.id, project);
    return Promise.resolve();
  }

  async create(data) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const id = `p-${stamp}-${randomBytes(3).toString('hex')}`;
    const project = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', steps: {}, approvals: [], pending: null, ...data };
    await mkdir(this.dir(id), { recursive: true });
    await this.save(project);
    return project;
  }

  async remove(id) {
    this.dir(id);
    this.db.tx(() => { for (const t of ['events', 'approvals', 'checkpoints', 'runs']) this.db.run(`DELETE FROM ${t} WHERE project_id = ?`, id); this.db.run('DELETE FROM projects WHERE id = ?', id); });
    this.seq.delete(id);
    await rm(this.dir(id), { recursive: true, force: true });
  }

  // ---- events
  async appendEvent(id, event) {
    const { type, ...data } = event;
    let seq = this.seq.get(id);
    if (seq === undefined) seq = this.db.get('SELECT COALESCE(MAX(seq), 0) AS n FROM events WHERE project_id = ?', id).n;
    seq += 1;
    this.seq.set(id, seq);
    const at = new Date().toISOString();
    this.db.run('INSERT INTO events (project_id, seq, at, type, data) VALUES (?, ?, ?, ?, ?)', id, seq, at, type, JSON.stringify(data));
    const full = { seq, at, type, ...data };
    this.emit('event', id, full);
    return full;
  }
  async events(id, after = 0) { return this.db.all('SELECT seq, at, type, data FROM events WHERE project_id = ? AND seq > ? ORDER BY seq', id, after).map(r => ({ seq: r.seq, at: r.at, type: r.type, ...JSON.parse(r.data) })); }

  // ---- approvals: an audit trail across every project
  recordApproval(projectId, a) {
    this.db.run('INSERT INTO approvals (project_id, gate, decision, by_user, at, note, fingerprint, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      projectId, a.gate, a.decision, a.by || null, a.at, a.note || null, a.fingerprint || null, a.summary || null, a.details ? JSON.stringify(a.details) : null);
  }
  approvalHistory(limit = 200) {
    return this.db.all(`SELECT a.id, a.project_id, p.name AS project, a.gate, a.decision, a.by_user AS by, a.at, a.note, a.fingerprint, a.summary FROM approvals a LEFT JOIN projects p ON p.id = a.project_id ORDER BY a.at DESC LIMIT ?`, limit);
  }

  // ---- runs and checkpoints (what makes resume possible)
  startRun(projectId, resumedFrom = null) {
    return Number(this.db.run('INSERT INTO runs (project_id, started_at, status, resumed_from) VALUES (?, ?, ?, ?)', projectId, new Date().toISOString(), 'running', resumedFrom).lastInsertRowid);
  }
  endRun(runId, status, note = null) { if (runId) this.db.run('UPDATE runs SET ended_at = ?, status = ?, note = ? WHERE id = ?', new Date().toISOString(), status, note, runId); }
  runs(projectId) { return this.db.all('SELECT id, started_at, ended_at, status, resumed_from, note FROM runs WHERE project_id = ? ORDER BY id', projectId); }
  lastRun(projectId) { return this.db.get('SELECT id, status FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1', projectId); }
  saveCheckpoint(projectId, stage, data, runId = null) {
    this.db.run('INSERT INTO checkpoints (project_id, stage, run_id, at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, stage) DO UPDATE SET run_id = excluded.run_id, at = excluded.at, data = excluded.data',
      projectId, stage, runId, new Date().toISOString(), JSON.stringify(data));
  }
  checkpoints(projectId) { return Object.fromEntries(this.db.all('SELECT stage, at, data FROM checkpoints WHERE project_id = ?', projectId).map(r => [r.stage, { at: r.at, ...JSON.parse(r.data) }])); }
  clearCheckpoints(projectId, stages = null) {
    if (!stages) this.db.run('DELETE FROM checkpoints WHERE project_id = ?', projectId);
    else for (const s of stages) this.db.run('DELETE FROM checkpoints WHERE project_id = ? AND stage = ?', projectId, s);
  }

  // One-time import of projects created before the database existed (project.json + events.jsonl per folder).
  async importLegacy() {
    if (this.db.getKv('legacy-json-imported')) return 0;
    let imported = 0;
    let names = [];
    try { names = await readdir(this.root); } catch { /* none */ }
    for (const name of names.filter(validId)) {
      try {
        const doc = JSON.parse(await readFile(path.join(this.root, name, 'project.json'), 'utf8'));
        if (this.db.get('SELECT id FROM projects WHERE id = ?', doc.id)) continue;
        await this.save(doc);
        let seq = 0;
        try { for (const line of (await readFile(path.join(this.root, name, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean)) { const e = JSON.parse(line); const { seq: s, at, type, ...data } = e; seq = Math.max(seq, s); this.db.run('INSERT OR IGNORE INTO events (project_id, seq, at, type, data) VALUES (?, ?, ?, ?, ?)', doc.id, s, at, type, JSON.stringify(data)); } } catch { /* no events */ }
        for (const a of doc.approvals || []) this.recordApproval(doc.id, a);
        imported++;
      } catch { /* not a project folder */ }
    }
    this.db.setKv('legacy-json-imported', { at: new Date().toISOString(), imported });
    return imported;
  }
}
