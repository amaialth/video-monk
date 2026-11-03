// The local SQLite database (node:sqlite, built into Node 22.13+; no dependency). One file, shared by the web studio and the CLI:
//   ~/.video-monk/video-monk.db   (or $VIDEO_MONK_HOME/video-monk.db)
// It holds what must survive a restart: projects and their steps, the event log, approvals, run checkpoints (so a run can resume),
// settings, wizard presets, remembered glossary terms, recent footage and usage counters (stock-API request budgets, credits spent).
// Artifacts (videos, manifests, graphics) stay as files; the database only points at them.
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, statSync } from 'node:fs';

let sqlite = null;
async function load() {
  if (sqlite) return sqlite;
  try { sqlite = await import('node:sqlite'); } catch {
    throw new Error('The local database needs Node 22.13 or newer (node:sqlite). Update Node, or use the command-line tools, which do not need it.');
  }
  return sqlite;
}

export const dbPath = (home = process.env.VIDEO_MONK_HOME || path.join(os.homedir(), '.video-monk')) => path.join(home, 'video-monk.db');
const SCHEMA_VERSION = 2;

const MIGRATIONS = [
  // 1: the core
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0, media_path TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL);
   CREATE INDEX projects_updated ON projects(updated_at DESC);
   CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
   CREATE UNIQUE INDEX events_project_seq ON events(project_id, seq);
   CREATE TABLE approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, gate TEXT NOT NULL, decision TEXT NOT NULL, by_user TEXT, at TEXT NOT NULL,
     note TEXT, fingerprint TEXT, summary TEXT, details TEXT);
   CREATE INDEX approvals_project ON approvals(project_id, at);
   CREATE TABLE checkpoints (project_id TEXT NOT NULL, stage TEXT NOT NULL, run_id INTEGER, at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (project_id, stage));
   CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, resumed_from INTEGER, note TEXT);
   CREATE INDEX runs_project ON runs(project_id, id);
   CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at INTEGER);`,
  // 2: things reused across projects
  `CREATE TABLE presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, options TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE terms (heard TEXT NOT NULL, term TEXT NOT NULL, hints TEXT NOT NULL DEFAULT '', uses INTEGER NOT NULL DEFAULT 1, last_used TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (heard, term));
   CREATE TABLE recent_media (path TEXT PRIMARY KEY, name TEXT NOT NULL, duration REAL, used_at TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL, at INTEGER NOT NULL, units REAL NOT NULL DEFAULT 1, project_id TEXT, note TEXT);
   CREATE INDEX usage_service_at ON usage(service, at);`
];

const cache = new Map();

export class Db {
  constructor(handle, file) { this.h = handle; this.file = file; }

  static async open(file = dbPath()) {
    if (cache.has(file)) return cache.get(file);
    const { DatabaseSync } = await load();
    mkdirSync(path.dirname(file), { recursive: true });
    const h = new DatabaseSync(file);
    h.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON;');
    const db = new Db(h, file);
    db.migrate();
    cache.set(file, db);
    return db;
  }
  static closeAll() { for (const db of cache.values()) { try { db.h.close(); } catch { /* already closed */ } } cache.clear(); }

  migrate() {
    const current = this.h.prepare('PRAGMA user_version').get().user_version;
    if (current > SCHEMA_VERSION) throw new Error(`This database was made by a newer Video Monk (schema ${current}); update before opening it.`);
    for (let v = current; v < SCHEMA_VERSION; v++) {
      this.h.exec('BEGIN');
      try { this.h.exec(MIGRATIONS[v]); this.h.exec(`PRAGMA user_version = ${v + 1}`); this.h.exec('COMMIT'); } catch (error) { this.h.exec('ROLLBACK'); throw error; }
    }
  }

  get version() { return this.h.prepare('PRAGMA user_version').get().user_version; }
  run(sql, ...params) { return this.h.prepare(sql).run(...params); }
  all(sql, ...params) { return this.h.prepare(sql).all(...params).map(r => ({ ...r })); }
  get(sql, ...params) { const r = this.h.prepare(sql).get(...params); return r ? { ...r } : null; }
  tx(fn) { this.h.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.h.exec('COMMIT'); return r; } catch (error) { this.h.exec('ROLLBACK'); throw error; } }

  // ---- key/value with optional expiry (settings, small caches)
  getKv(key, fallback = null) {
    const r = this.get('SELECT value, expires_at FROM kv WHERE key = ?', key);
    if (!r) return fallback;
    if (r.expires_at && r.expires_at < Date.now()) { this.run('DELETE FROM kv WHERE key = ?', key); return fallback; }
    try { return JSON.parse(r.value); } catch { return fallback; }
  }
  setKv(key, value, ttlMs = null) {
    this.run('INSERT INTO kv (key, value, updated_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, expires_at = excluded.expires_at',
      key, JSON.stringify(value), new Date().toISOString(), ttlMs ? Date.now() + ttlMs : null);
  }
  deleteKv(key) { this.run('DELETE FROM kv WHERE key = ?', key); }
  pruneKv() { return this.run('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?', Date.now()).changes; }

  // ---- presets: named wizard settings
  presets() { return this.all('SELECT id, name, options, updated_at FROM presets ORDER BY name').map(p => ({ ...p, options: JSON.parse(p.options) })); }
  savePreset(name, options) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('A preset needs a name');
    const now = new Date().toISOString();
    this.run('INSERT INTO presets (name, options, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET options = excluded.options, updated_at = excluded.updated_at', n, JSON.stringify(options), now, now);
    return this.presets().find(p => p.name === n);
  }
  deletePreset(id) { return this.run('DELETE FROM presets WHERE id = ?', id).changes; }

  // ---- remembered glossary terms: corrections you approved before are proposed again in later projects
  terms({ enabledOnly = false } = {}) { return this.all(`SELECT heard, term, hints, uses, last_used, enabled FROM terms ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY uses DESC, term`); }
  learnTerm(heard, term, hints = []) {
    const h = String(heard).toLowerCase().trim(), t = String(term).trim();
    if (!h || !t || h === t.toLowerCase()) return;
    const hintText = [...new Set(hints.map(x => String(x).trim().toLowerCase()).filter(Boolean))].join('; ');
    this.run(`INSERT INTO terms (heard, term, hints, uses, last_used) VALUES (?, ?, ?, 1, ?)
              ON CONFLICT(heard, term) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used, hints = CASE WHEN excluded.hints != '' THEN excluded.hints ELSE terms.hints END`, h, t, hintText, new Date().toISOString());
  }
  setTermEnabled(heard, term, enabled) { return this.run('UPDATE terms SET enabled = ? WHERE heard = ? AND term = ?', enabled ? 1 : 0, heard, term).changes; }
  deleteTerm(heard, term) { return this.run('DELETE FROM terms WHERE heard = ? AND term = ?', heard, term).changes; }
  // The glossary text the script verifier reads: one line per distinct term, with the hints you used before.
  glossaryText() {
    const byTerm = new Map();
    for (const r of this.terms({ enabledOnly: true })) { const e = byTerm.get(r.term) || { hints: new Set() }; for (const x of r.hints.split(';').map(s => s.trim()).filter(Boolean)) e.hints.add(x); byTerm.set(r.term, e); }
    return [...byTerm].map(([term, e]) => (e.hints.size ? `${term} | ${[...e.hints].join('; ')}` : term)).join('\n');
  }

  // ---- recent footage
  touchMedia({ path: p, name, duration = null }) {
    this.run(`INSERT INTO recent_media (path, name, duration, used_at, uses) VALUES (?, ?, ?, ?, 1)
              ON CONFLICT(path) DO UPDATE SET used_at = excluded.used_at, uses = uses + 1, name = excluded.name, duration = COALESCE(excluded.duration, recent_media.duration)`, p, name, duration, new Date().toISOString());
    this.run('DELETE FROM recent_media WHERE path NOT IN (SELECT path FROM recent_media ORDER BY used_at DESC, rowid DESC LIMIT 30)');
  }
  recentMedia(limit = 8) { return this.all('SELECT path, name, duration, used_at, uses FROM recent_media ORDER BY used_at DESC, rowid DESC LIMIT ?', limit); }
  forgetMedia(p) { return this.run('DELETE FROM recent_media WHERE path = ?', p).changes; }

  // ---- usage counters: request budgets (Unsplash allows 50 an hour on a demo key) and credits spent
  addUsage(service, units = 1, { projectId = null, note = null, at = Date.now() } = {}) { this.run('INSERT INTO usage (service, at, units, project_id, note) VALUES (?, ?, ?, ?, ?)', service, at, units, projectId, note); }
  usageSince(service, sinceMs) { return this.get('SELECT COALESCE(SUM(units), 0) AS units, COUNT(*) AS calls FROM usage WHERE service = ? AND at >= ?', service, sinceMs); }
  pruneUsage(olderThanMs = 90 * 86400 * 1000) { return this.run('DELETE FROM usage WHERE at < ?', Date.now() - olderThanMs).changes; }

  info() {
    const count = t => this.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
    let size = 0;
    for (const f of [this.file, `${this.file}-wal`]) { try { size += statSync(f).size; } catch { /* absent */ } }
    return { file: this.file, schema: this.version, bytes: size, projects: count('projects'), events: count('events'), approvals: count('approvals'), checkpoints: count('checkpoints'), runs: count('runs'), presets: count('presets'), terms: count('terms'), recentMedia: count('recent_media'), usage: count('usage') };
  }
  close() { try { this.h.close(); } catch { /* ignore */ } cache.delete(this.file); }
}

// Best-effort access for code that must not fail when the database is unavailable (old Node, read-only disk).
export async function tryDb() { try { return await Db.open(); } catch { return null; } }
