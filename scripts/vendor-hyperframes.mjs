// Refresh the vendored HyperFrames registry from one fixed commit:  node scripts/vendor-hyperframes.mjs <full commit sha>
// Only git runs here: nothing from the repository is installed, built or executed. Files are copied unchanged.
// After a refresh, set CATALOG_COMMIT in src/catalog.js to the same commit (a test checks that they match).
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const REPOSITORY = 'https://github.com/heygen-com/hyperframes.git';
const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('Usage: node scripts/vendor-hyperframes.mjs <full 40-character commit sha>');

const target = fileURLToPath(new URL('../vendor/hyperframes/', import.meta.url));
const work = await mkdtemp(path.join(os.tmpdir(), 'video-monk-hyperframes-'));
const git = (...args) => execFileSync('git', args, { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
const countFiles = async dir => (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).length;

try {
  git('init', '--quiet');
  git('remote', 'add', 'origin', REPOSITORY);
  git('sparse-checkout', 'set', 'registry');                                 // the rest of the monorepo (about 300 MB) is not fetched
  git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', commit);
  git('checkout', '--quiet', 'FETCH_HEAD');
  await rm(path.join(target, 'registry'), { recursive: true, force: true });
  await cp(path.join(work, 'registry'), path.join(target, 'registry'), { recursive: true });
  for (const file of ['LICENSE', 'CREDITS.md']) await cp(path.join(work, file), path.join(target, file));
  const files = await countFiles(path.join(target, 'registry'));
  await writeFile(path.join(target, 'VENDORED.json'), `${JSON.stringify({ repository: REPOSITORY, commit, paths: ['registry', 'LICENSE', 'CREDITS.md'], license: 'Apache-2.0', copyright: 'Copyright 2026 HeyGen, Inc. and contributors', registryFiles: files, modified: false }, null, 2)}\n`);
  console.log(`Vendored registry/ at ${commit.slice(0, 7)}: ${files} files copied unchanged into ${target}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
