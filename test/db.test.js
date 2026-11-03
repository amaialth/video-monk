import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Db } from '../src/db.js';
import { Store } from '../src/ui/store.js';

async function temporary(t) {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'video-monk-db-')));
  t.after(() => { Db.closeAll(); return rm(folder, { recursive: true, force: true }); });
  return folder;
}

test('the database migrates to the current schema and refuses a newer one', async t => {
  const home = await temporary(t);
  const db = await Db.open(path.join(home, 'a.db'));
  assert.equal(db.version, 3);
  assert.equal(db.info().projects, 0);
  db.h.exec('PRAGMA user_version = 99');
  Db.closeAll();
  await assert.rejects(Db.open(path.join(home, 'a.db')), /newer Video Monk/);
});

test('key/value with expiry, presets, recent footage and usage counters', async t => {
  const home = await temporary(t);
  const db = await Db.open(path.join(home, 'b.db'));
  db.setKv('x', { a: 1 }); assert.deepEqual(db.getKv('x'), { a: 1 });
  db.setKv('gone', 1, -1); assert.equal(db.getKv('gone', 'fallback'), 'fallback', 'expired entries are not returned');
  db.savePreset('A', { pace: 'tight' }); db.savePreset('A', { pace: 'natural' });
  assert.deepEqual(db.presets().map(p => [p.name, p.options.pace]), [['A', 'natural']], 'saving a name again replaces it');
  assert.throws(() => db.savePreset('  ', {}), /needs a name/);
  for (let i = 0; i < 35; i++) db.touchMedia({ path: `/v/${i}.mp4`, name: `${i}.mp4` });
  assert.equal(db.recentMedia(100).length, 30, 'only the 30 most recent are kept');
  assert.equal(db.recentMedia(1)[0].name, '34.mp4');
  const now = Date.now();
  db.addUsage('unsplash', 1, { at: now - 7200e3 }); db.addUsage('unsplash', 1, { at: now - 60e3 }); db.addUsage('mirelo', 40); db.addUsage('mirelo', 15);
  assert.equal(db.usageSince('unsplash', now - 3600e3).calls, 1);
  assert.equal(db.usageSince('mirelo', now - 86400e3).units, 55);
});

test('remembered terms: counted, merged into a glossary with hints, switchable and removable', async t => {
  const home = await temporary(t);
  const db = await Db.open(path.join(home, 'c.db'));
  db.learnTerm('wrist', 'REST', ['api', 'http']); db.learnTerm('rist', 'REST', ['endpoint']); db.learnTerm('red is', 'Redis', []); db.learnTerm('wrist', 'REST', []);
  db.learnTerm('same', 'Same', []);
  assert.equal(db.terms().find(x => x.heard === 'wrist').uses, 2);
  assert.equal(db.terms().some(x => x.heard === 'same'), false, 'a correction that changes nothing is not remembered');
  assert.equal(db.glossaryText(), 'REST | api; http; endpoint\nRedis');
  db.setTermEnabled('red is', 'Redis', false);
  assert.equal(db.glossaryText(), 'REST | api; http; endpoint');
  assert.equal(db.deleteTerm('rist', 'REST'), 1);
});

test('the store keeps projects, ordered events and approvals, imports projects from the earlier JSON-file layout once, and removes everything with a project', async t => {
  const home = await temporary(t);
  // a project made before the database existed
  const legacy = path.join(home, 'ui', 'projects', 'p-202601010000-aaaaaa');
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'project.json'), JSON.stringify({ id: 'p-202601010000-aaaaaa', name: 'Old one', status: 'done', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', steps: {}, approvals: [{ gate: 'final', decision: 'approved', by: 'me', at: '2026-01-01T00:00:00Z' }], media: { path: '/v/old.mp4', name: 'old.mp4' } }));
  await writeFile(path.join(legacy, 'events.jsonl'), '{"seq":1,"at":"2026-01-01T00:00:00Z","type":"run-start"}\n{"seq":2,"at":"2026-01-01T00:00:01Z","type":"done","status":"done"}\n');
  const store = await Store.open(home);
  assert.deepEqual((await store.list()).map(p => p.name), ['Old one']);
  assert.deepEqual((await store.events('p-202601010000-aaaaaa')).map(e => e.type), ['run-start', 'done']);
  assert.equal(store.approvalHistory()[0].project, 'Old one');
  assert.equal(await store.importLegacy(), 0, 'imported once');

  const p = await store.create({ name: 'New', media: { path: '/v/new.mp4', name: 'new.mp4' } });
  const e1 = await store.appendEvent(p.id, { type: 'a', x: 1 }), e2 = await store.appendEvent(p.id, { type: 'b' });
  assert.deepEqual([e1.seq, e2.seq], [1, 2]);
  assert.deepEqual((await store.events(p.id, 1)).map(e => e.type), ['b']);
  // checkpoints and runs
  const run1 = store.startRun(p.id);
  store.saveCheckpoint(p.id, 'cut', { manifestFile: '/m.json' }, run1);
  store.saveCheckpoint(p.id, 'cut', { manifestFile: '/m2.json' }, run1);
  assert.equal(store.checkpoints(p.id).cut.manifestFile, '/m2.json', 'a stage has one checkpoint: the latest');
  store.endRun(run1, 'cancelled'); const run2 = store.startRun(p.id, run1);
  assert.deepEqual(store.runs(p.id).map(r => [r.status, r.resumed_from]), [['cancelled', null], ['running', run1]]);
  store.clearCheckpoints(p.id, ['cut']); assert.deepEqual(store.checkpoints(p.id), {});
  void run2;
  // a second handle on the same file sees the same data (the studio and the command line share one database)
  const again = await Store.open(home);
  assert.equal((await again.list()).length, 2);
  await store.remove(p.id);
  assert.equal((await store.list()).length, 1);
  assert.deepEqual(await store.events(p.id), []);
  assert.throws(() => store.dir('../etc'), /Invalid project id/);
});
