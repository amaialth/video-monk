import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { exists } from '../core.js';
import { launchChrome, openPage } from '../chrome.js';
import { renderPage } from './runtime.js';
import { TEMPLATES, validateProps } from './templates.js';

export const DEFAULT_THEME = {
  background: '#0b1020', surface: '#151d33', text: '#f4f6fb', muted: '#9aa5bd', accent: '#4cc9f0',
  grid: 'rgba(255,255,255,0.045)',
  palette: ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#a78bfa', '#ff8c42', '#8ecae6']
};

// Overlay placement boxes (fractions of the frame). Portrait maps left/right to top/bottom halves.
const BOXES = {
  full: [0, 0, 1, 1], center: [0.1, 0.1, 0.8, 0.8], left: [0.04, 0.08, 0.46, 0.84], right: [0.5, 0.08, 0.46, 0.84],
  top: [0.05, 0.04, 0.9, 0.44], bottom: [0.05, 0.52, 0.9, 0.44],
  'top-left': [0.03, 0.05, 0.36, 0.4], 'top-right': [0.61, 0.05, 0.36, 0.4],
  'bottom-left': [0.03, 0.55, 0.36, 0.4], 'bottom-right': [0.61, 0.55, 0.36, 0.4]
};
export const PLACEMENTS = Object.keys(BOXES);

export function placementBox(placement, width, height) {
  const portrait = height > width;
  let key = placement || 'full';
  if (portrait && key === 'left') key = 'top';
  if (portrait && key === 'right') key = 'bottom';
  if (portrait && key === 'center') return { x: Math.round(width * 0.05), y: Math.round(height * 0.2), w: Math.round(width * 0.9), h: Math.round(height * 0.6) };
  const [x, y, w, h] = BOXES[key];
  return { x: Math.round(x * width), y: Math.round(y * height), w: Math.round(w * width), h: Math.round(h * height) };
}

const fontCache = new Map();
async function fontDataUrl(font) {
  if (!font) return null;
  if (!fontCache.has(font)) {
    const ext = path.extname(font).toLowerCase();
    const mime = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' }[ext];
    if (!mime) throw new Error(`Motion: unsupported font type ${ext}; use .ttf, .otf, .woff or .woff2`);
    fontCache.set(font, `data:${mime};base64,${(await readFile(font)).toString('base64')}`);
  }
  return fontCache.get(font);
}

// Build the HTML for one motion job. `job` = { template | html, props, width, height, fps, duration, theme,
// font, placement, panel, background, exit }.
export async function motionPage(job) {
  if (job.html) return readFile(job.html, 'utf8');
  const def = TEMPLATES[job.template];
  if (!def) throw new Error(`Motion: unknown template ${job.template}`);
  const props = def.internal ? job.props : validateProps(job.template, job.props);
  const theme = { ...DEFAULT_THEME, ...(job.theme || {}) };
  const placement = def.fullFrame ? 'full' : job.placement || 'full';
  const box = placementBox(placement, job.width, job.height);
  const ctx = {
    width: job.width, height: job.height, fps: job.fps, duration: job.duration, theme, box,
    unit: Math.min(job.width, job.height) / 100, portrait: job.height > job.width,
    panel: job.panel ?? (placement !== 'full' && !def.fullFrame), exit: job.exit !== false
  };
  return renderPage({ templateSource: `({ ${def.render.toString()} }).render`, props, ctx,
    fontDataUrl: await fontDataUrl(job.font), background: job.background || 'transparent' });
}

export class MotionRenderer {
  constructor() { this.browser = null; this.queue = Promise.resolve(); }

  async start() {
    if (!this.browser) this.browser = await launchChrome();
    return this;
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }

  // Render a job to a frame-exact PNG sequence (frame-000001.png ...). Identical consecutive states are
  // hardlinked instead of re-captured, so held frames cost almost nothing. Returns { dir, pattern, frames, captured }.
  async render(job, cacheRoot) {
    const frames = Math.max(1, Math.round(job.duration * job.fps));
    const html = job.html ? null : await motionPage(job);
    const key = createHash('sha256').update(html ?? `custom:${job.html}:${await readFile(job.html, 'utf8')}`)
      .update(`${job.width}x${job.height}@${job.fps}:${frames}`).digest('hex').slice(0, 20);
    const dir = path.join(cacheRoot, key);
    const done = path.join(dir, 'done.json');
    if (await exists(done)) return { dir, pattern: path.join(dir, 'frame-%06d.png'), frames, ...JSON.parse(await readFile(done, 'utf8')) };
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let page;
    if (html) {
      const file = path.join(dir, 'page.html');
      await writeFile(file, html);
      page = await this.#open(file, job);
    } else {
      page = await this.#open(path.resolve(job.html), job);
    }
    let captured = 0;
    try {
      let previous = null;
      let previousFile = null;
      for (let i = 0; i < frames; i++) {
        const t = i / job.fps;
        const sig = await page.evaluate(`(window.__seek(${t}), typeof window.__sig === 'function' ? window.__sig() : 'f' + ${i})`);
        const file = path.join(dir, `frame-${String(i + 1).padStart(6, '0')}.png`);
        if (sig === previous && previousFile) {
          await link(previousFile, file).catch(() => copyFile(previousFile, file));
        } else {
          await page.screenshot(file);
          captured++;
          previous = sig;
          previousFile = file;
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
    await writeFile(done, JSON.stringify({ captured }));
    return { dir, pattern: path.join(dir, 'frame-%06d.png'), frames, captured };
  }

  async #open(file, job) {
    await this.start();
    return openPage(this.browser, file, { width: job.width, height: job.height, transparent: !job.background || job.background === 'transparent' });
  }
}

// Run async tasks with bounded concurrency, preserving result order.
export async function pool(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
