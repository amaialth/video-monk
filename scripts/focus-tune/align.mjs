// Lines a real recording up with the scripted session: the page flashes magenta at page time 0.5 s, so the recording time of that flash gives the offset.
// frames: rgb24 bytes of tiny frames (width x height x 3 each), sampled at `fps`. Returns the recording time (s) the flash starts, or null.
// Also returns where the page sits in the frame (a bounding box of the flash, as fractions of the frame): a browser window that does not fill the screen shifts every position.
export function locateSyncFlash(frames, { width = 16, height = 9, fps = 10, share = 0.35 } = {}) {
  const px = width * height, count = Math.floor(frames.length / (px * 3));
  for (let f = 0; f < count; f++) {
    let n = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let i = 0; i < px; i++) {
      const r = frames[(f * px + i) * 3], g = frames[(f * px + i) * 3 + 1], b = frames[(f * px + i) * 3 + 2];
      if (r > 170 && g < 100 && b > 110) { n++; const x = i % width, y = Math.floor(i / width); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }   // the flash colour is #ff00c8
    }
    if (n / px >= share) return { t: f / fps, rect: { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height } };
  }
  return null;
}
export const findSyncFlash = (frames, options) => locateSyncFlash(frames, options)?.t ?? null;
export const FLASH_AT = 0.5;   // page time of the flash start, seconds
