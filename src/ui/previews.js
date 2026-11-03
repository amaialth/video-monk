// Still previews of storyboard graphics (PNG) for the UI, rendered by the same headless-Chrome engine as the final video and cached by content.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { exists } from '../core.js';
import { MotionRenderer } from '../motion/render.js';
import { uiHome } from './store.js';

export class Previews {
  constructor() { this.renderer = null; this.queue = Promise.resolve(); }

  async still({ template, props, theme = 'night', mode = 'cutaway', duration = 4, width = 640, height = 360 }) {
    const key = createHash('sha256').update(JSON.stringify([template, props, theme, mode, Math.round(duration * 10), width, height])).digest('hex').slice(0, 24);
    const dir = path.join(uiHome(), 'cache', 'previews');
    const out = path.join(dir, `${key}.png`);
    if (await exists(out)) return out;
    const job = async () => {
      if (await exists(out)) return out;
      await mkdir(dir, { recursive: true });
      this.renderer ||= new MotionRenderer();
      await this.renderer.start();
      const placement = mode === 'panel' ? 'right' : mode === 'overlay' ? (template === 'kinetic-text' ? 'strip-top' : 'strip-center') : undefined;
      const d = Math.max(2.5, duration);
      await this.renderer.still({ template, props, width, height, fps: 10, duration: d, theme: { preset: theme }, placement, background: 'grid', exit: false }, d * 0.85, out);
      return out;
    };
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => {});
    return next;
  }

  async close() { await this.renderer?.close().catch(() => {}); this.renderer = null; }
}
