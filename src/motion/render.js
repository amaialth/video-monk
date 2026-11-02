import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { exists } from '../core.js';
import { launchChrome, openPage } from '../chrome.js';
import { renderPage } from './runtime.js';
import { TEMPLATES, validateProps } from './templates.js';

// Theme presets. `night` suits dark footage; `paper` (warm gray canvas, black ink, one orange accent, after the
// motion-graphics skill's defaults) suits light slides and screen recordings.
export const THEMES = {
  night: {
    background: '#0b1020', surface: '#151d33', text: '#f4f6fb', muted: '#9aa5bd', accent: '#4cc9f0', grid: 'rgba(255,255,255,0.045)',
    palette: ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#a78bfa', '#ff8c42', '#8ecae6']
  },
  paper: {
    background: '#e9e7e2', surface: '#ffffff', text: '#0b0b0b', muted: '#5b5a55', accent: '#ff5a1f', grid: 'rgba(0,0,0,0.055)',
    palette: ['#ff5a1f', '#0b0b0b', '#2f6fed', '#12a150', '#8b5cf6', '#d99a00', '#0e7490']
  }
};
export const DEFAULT_THEME = THEMES.night;
export function resolveTheme(theme) {
  const { preset, font: _font, ...rest } = theme || {};
  return { ...(THEMES[preset] || THEMES.night), ...rest };
}

// Overlay placement boxes (fractions of the frame). Portrait maps left/right to top/bottom halves.
const BOXES = {
  // Boxed placements end at 82% height so burned-in captions (bottom) stay clear.
  full: [0, 0, 1, 1], center: [0.1, 0.08, 0.8, 0.74], left: [0.04, 0.06, 0.46, 0.76], right: [0.5, 0.06, 0.46, 0.76],
  top: [0.05, 0.04, 0.9, 0.44], bottom: [0.05, 0.52, 0.9, 0.44],
  'top-left': [0.03, 0.05, 0.36, 0.4], 'top-right': [0.61, 0.05, 0.36, 0.4],
  'bottom-left': [0.03, 0.55, 0.36, 0.4], 'bottom-right': [0.61, 0.55, 0.36, 0.4],
  // Slim strips for pull-text over footage: stays clear of captions (bottom) and keeps the picture visible.
  'strip-top': [0.06, 0.05, 0.88, 0.2], 'strip-center': [0.06, 0.38, 0.88, 0.24]
};
export const PLACEMENTS = Object.keys(BOXES);

export function placementBox(placement, width, height) {
  const portrait = height > width;
  let key = placement || 'full';
  if (portrait && key === 'left') key = 'top';
  if (portrait && key === 'right') key = 'bottom';
  if (portrait && key === 'center') return { x: Math.round(width * 0.05), y: Math.round(height * 0.2), w: Math.round(width * 0.9), h: Math.round(height * 0.6) };
  if (portrait && key.startsWith('strip')) {
    const y = key === 'strip-top' ? 0.1 : 0.4;
    return { x: Math.round(width * 0.05), y: Math.round(height * y), w: Math.round(width * 0.9), h: Math.round(height * 0.16) };
  }
  const [x, y, w, h] = BOXES[key];
  return { x: Math.round(x * width), y: Math.round(y * height), w: Math.round(w * width), h: Math.round(h * height) };
}

// Bundled fonts (SIL OFL): Geist variable (sans, wght 100-900), Instrument Serif Italic (stressed words), Geist Mono.
const fontDir = new URL('../../assets/fonts/', import.meta.url);
const fontCache = new Map();
async function dataUrl(file, mime) {
  const key = String(file);
  if (!fontCache.has(key)) fontCache.set(key, `data:${mime};base64,${(await readFile(file)).toString('base64')}`);
  return fontCache.get(key);
}
async function loadFonts(customFont) {
  let sans = null;
  if (customFont) {
    const ext = path.extname(customFont).toLowerCase();
    const mime = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' }[ext];
    if (!mime) throw new Error(`Motion: unsupported font type ${ext}; use .ttf, .otf, .woff or .woff2`);
    sans = await dataUrl(customFont, mime);
  } else sans = await dataUrl(new URL('Geist-Variable.woff2', fontDir), 'font/woff2');
  return {
    sans,
    stress: await dataUrl(new URL('InstrumentSerif-Italic.ttf', fontDir), 'font/ttf'),
    mono: await dataUrl(new URL('GeistMono-Medium.woff2', fontDir), 'font/woff2')
  };
}

// Build the HTML for one motion job. `job` = { template | html, props, width, height, fps, duration, theme,
// font, placement, panel, background, exit, fadeFrame }.
export async function motionPage(job) {
  if (job.html) return readFile(job.html, 'utf8');
  const def = TEMPLATES[job.template];
  if (!def) throw new Error(`Motion: unknown template ${job.template}`);
  const props = def.internal ? job.props : validateProps(job.template, job.props);
  const theme = resolveTheme(job.theme);
  const placement = def.fullFrame ? 'full' : job.placement || 'full';
  const box = placementBox(placement, job.width, job.height);
  const ctx = {
    width: job.width, height: job.height, fps: job.fps, duration: job.duration, theme, box,
    unit: Math.min(job.width, job.height) / 100, portrait: job.height > job.width,
    panel: job.panel ?? (placement !== 'full' && !def.fullFrame), exit: job.exit !== false,
    fadeFrame: job.fadeFrame === true
  };
  return renderPage({ templateSource: `({ ${def.render.toString()} }).render`, props, ctx,
    fonts: await loadFonts(job.font), background: job.background || 'transparent' });
}

export class MotionRenderer {
  constructor() { this.browser = null; }

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
    if (await exists(done)) return { dir, pattern: path.join(dir, 'frame-%06d.png'), frames, ...JSON.parse(await readFile(done, 'utf8')), cached: true };
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
    return { dir, pattern: path.join(dir, 'frame-%06d.png'), frames, captured, cached: false };
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
