// Lines a real recording up with the scripted session: the page flashes magenta at page time 0.5 s, so the recording time of that flash gives the offset.
// frames: rgb24 bytes of tiny frames (width x height x 3 each), sampled at `fps`. Returns the recording time (s) the flash starts, or null.
export function findSyncFlash(frames, { width = 16, height = 9, fps = 10, share = 0.35 } = {}) {
  const px = width * height, count = Math.floor(frames.length / (px * 3));
  for (let f = 0; f < count; f++) {
    let n = 0;
    for (let i = 0; i < px; i++) { const r = frames[(f * px + i) * 3], g = frames[(f * px + i) * 3 + 1], b = frames[(f * px + i) * 3 + 2]; if (r > 170 && g < 100 && b > 110) n++; }   // the flash colour is #ff00c8
    if (n / px >= share) return f / fps;
  }
  return null;
}
export const FLASH_AT = 0.5;   // page time of the flash start, seconds
