// Second deliverable: after the long-form render, cut a vertical short from the finished manifest and render it beside the long one.
import path from 'node:path';
import { run } from './core.js';
import { cutdownManifest } from './cutdown.js';
import { reviewProduction, buildProduction } from './production.js';

export async function buildShort({ manifest, output, options = {}, execute = run, log = () => {} }) {
  const stem = path.basename(manifest, '.json');
  const target = path.join(path.dirname(manifest), `${stem}.short.json`);
  const pick = options.shortPick || 'hook';
  const cut = await cutdownManifest(manifest, target, {
    aspect: '9:16', fit: options.shortFit || 'blur', from: options.shortFrom, to: options.shortTo, maxSeconds: options.shortMax,
    highlight: pick === 'highlight' });
  log(`Vertical short: ${cut.window.duration}s (${cut.window.from}s to ${cut.window.to}s of the long video), ${cut.scenes} scenes${cut.warnings.length ? `; ${cut.warnings.join('; ')}` : ''}`);
  const review = path.join(path.dirname(manifest), `${stem}.short.review.json`);
  await reviewProduction(target, review, true, execute);
  const rendered = await buildProduction(target, review, output, true, execute, undefined, { log, quality: options.quality, concurrency: options.concurrency });
  return { cut, manifest: target, rendered, finalFile: path.join(output, 'final.mp4') };
}
