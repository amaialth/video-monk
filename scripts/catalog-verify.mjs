// Verify imported HyperFrames catalog items in the offline renderer: open each, seek to two moments, and record page errors, timelines found, and whether the picture drew.
//   VIDEO_MONK_HOME=<vault> node scripts/catalog-verify.mjs [--only name,name] [--out results.json] [--shots folder]
// Needs Chrome. Items must already be imported (video-monk motion-catalog --import-all --allow-download) and the libraries they use installed (video-monk libs --add gsap ...).
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { launchChrome, openPage } from '../src/chrome.js';
import { expandVm } from '../src/libs.js';
import { listImported } from '../src/catalog.js';

const argv = process.argv.slice(2);
const arg = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const only = arg('--only') ? new Set(arg('--only').split(',')) : null;
const out = path.resolve(arg('--out') || 'catalog-verify.json');
const shots = arg('--shots') ? path.resolve(arg('--shots')) : null;
if (shots) await mkdir(shots, { recursive: true });
const work = path.join(os.tmpdir(), `video-monk-verify-${process.pid}`);
await mkdir(work, { recursive: true });
const items = (await listImported()).filter(i => !only || only.has(i.name));
let browser = await launchChrome();
const results = [];
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took more than ${ms / 1000}s`)), ms))]);
const sha = b => createHash('sha1').update(b).digest('hex');

for (const [n, item] of items.entries()) {
  const res = { name: item.name, ok: false };
  let page = null;
  try {
    const html = await readFile(path.join(item.dir, 'index.html'), 'utf8');
    const expanded = await expandVm(html, { baseDir: item.dir });
    const file = path.join(work, `${item.name}.html`);
    await writeFile(file, expanded.html);
    const width = item.width || 1920, height = item.height || 1080, dur = item.duration || 4;
    page = await withTimeout(openPage(browser, file, { width, height, transparent: false }), 30000, 'opening');
    await withTimeout((async () => {
    const early = path.join(work, `${item.name}-a.png`), mid = shots ? path.join(shots, `${item.name}.png`) : path.join(work, `${item.name}-b.png`);
    await page.evaluate(`Promise.resolve(window.__seek(${Math.min(0.2, dur * 0.05)}))`, true); await page.screenshot(early);
    await page.evaluate(`Promise.resolve(window.__seek(${Math.min(dur * 0.5, 6)}))`, true); await page.screenshot(mid);
    const info = await page.evaluate('({ errors: window.__vmErrors || [], timelines: Object.keys(window.__timelines || {}).length, duration: Math.max(0, ...Object.values(window.__timelines || {}).map(t => t.duration ? t.duration() : 0)) })');
    const a = await readFile(early), b = await readFile(mid);
    Object.assign(res, { errors: info.errors.slice(0, 3), timelines: info.timelines, timelineSeconds: Math.round(info.duration * 10) / 10, bytes: b.length, animates: sha(a) !== sha(b) });
    // alive = no page errors, and either a GSAP timeline or a picture that changes between the two moments (shader pages draw themselves)
    res.ok = info.errors.length === 0 && (info.timelines > 0 || res.animates) && b.length > 3000;
    if (!res.ok) res.problem = info.errors.length ? `page error: ${info.errors[0].slice(0, 120)}` : 'registers no timeline and the picture does not change';
    await rm(early, { force: true }); if (!shots) await rm(mid, { force: true });
    })(), 60000, 'playing');
  } catch (error) {
    res.problem = String(error.message).slice(0, 160);
    try { await browser.close(); } catch { /* the browser may be gone */ }
    browser = await launchChrome();
  } finally { try { await Promise.race([page?.close(), new Promise(r => setTimeout(r, 3000))]); } catch { /* closed with the browser */ } }   // a page of a browser that was just killed never answers
  results.push(res);
  if ((n + 1) % 20 === 0 || n + 1 === items.length) console.error(`  ${n + 1}/${items.length}  ok so far: ${results.filter(r => r.ok).length}`);
}
await browser.close();
await rm(work, { recursive: true, force: true });
await writeFile(out, JSON.stringify({ verifiedAt: new Date().toISOString(), total: results.length, ok: results.filter(r => r.ok).length, results }, null, 1));
console.log(`Verified ${results.length}: ${results.filter(r => r.ok).length} ran cleanly, ${results.filter(r => !r.ok).length} did not. Report: ${out}`);
