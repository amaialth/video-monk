// Syntax-check every shipped JS file (cross-platform replacement for a shell loop).
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const walk = dir => readdirSync(dir).flatMap(name => {
  const file = path.join(dir, name);
  return statSync(file).isDirectory() ? walk(file) : file.endsWith('.js') ? [file] : [];
});
for (const file of [...walk('bin'), ...walk('src'), ...walk('web')]) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('syntax ok');
