// Delivery quality: platform targets, bitrate caps and H.264 profile by resolution, colour tagging and the RGB->YUV matrix, and
// source colour handling. Practices follow community export guidance (cap the bitrate instead of "automatic", tag BT.709 so the
// picture does not look faded on Apple devices, 320 kb/s AAC) and what YouTube re-encodes anyway.

// PNG graphics are RGB; FFmpeg's default RGB->YUV matrix is BT.601. Convert explicitly to BT.709 limited range.
export const RGB_TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int';
export const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export const TARGETS = {
  youtube: { lufs: -14, truePeak: -1, audioKbps: 320, capped: true, capScale: 1, crf: 18, preset: 'medium', note: 'YouTube re-encodes; stay near its recommendation' },
  master: { lufs: -14, truePeak: -1, audioKbps: 320, capped: false, capScale: 1, crf: 14, preset: 'slow', note: 'High-quality archive, uncapped' },
  web: { lufs: -16, truePeak: -1, audioKbps: 192, capped: true, capScale: 0.6, crf: 21, preset: 'medium', note: 'Smaller files for embedding' }
};

// Typical upload bitrates (Mb/s) for SDR H.264: [30 fps, 60 fps].
export function videoCapMbps(width, height, fps, scale = 1) {
  const pixels = width * height;
  const [a, b] = pixels <= 1280 * 720 ? [10, 15] : pixels <= 1920 * 1080 ? [16, 24] : pixels <= 2560 * 1440 ? [32, 48] : [55, 80];
  return Math.round((fps > 30 ? b : a) * scale * 10) / 10;
}

export function h264Level(width, height, fps) {
  const rate = width * height * fps;
  if (rate <= 1920 * 1080 * 30) return '4.0';
  if (rate <= 1920 * 1080 * 60) return '4.2';
  if (rate <= 3840 * 2160 * 30) return '5.1';
  return '5.2';
}

export function resolveDelivery(delivery = {}) {
  const target = TARGETS[delivery.target ?? 'youtube'];
  if (!target) throw new Error(`Delivery target must be one of ${Object.keys(TARGETS).join(', ')}`);
  return { target: delivery.target ?? 'youtube', ...target, ...(delivery.targetLufs !== undefined ? { lufs: delivery.targetLufs } : {}),
    ...(delivery.truePeak !== undefined ? { truePeak: delivery.truePeak } : {}), ...(delivery.audioBitrate !== undefined ? { audioKbps: delivery.audioBitrate } : {}),
    ...(delivery.crf !== undefined ? { crf: delivery.crf } : {}), ...(delivery.preset !== undefined ? { preset: delivery.preset } : {}),
    ...(delivery.maxrateMbps !== undefined ? { maxrateOverride: delivery.maxrateMbps } : {}) };
}

// Video encoder arguments: capped CRF, High profile, closed 2 s GOPs, BT.709 tags, faststart is set by the caller.
export function videoArgs({ width, height, fps, delivery, draft = false }) {
  const d = resolveDelivery(delivery);
  const args = ['-c:v', 'libx264', '-preset', draft ? 'veryfast' : d.preset, '-crf', String(draft ? 26 : d.crf), '-profile:v', 'high', '-level', h264Level(width, height, fps),
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), ...COLOR_TAGS,
    // libx264 only writes the transfer and primaries tags through its own parameters.
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv'];
  const cap = d.maxrateOverride ?? (d.capped ? videoCapMbps(width, height, fps, d.capScale) : null);
  if (cap) args.push('-maxrate', `${cap}M`, '-bufsize', `${Math.round(cap * 2)}M`);
  return { args, capMbps: cap, delivery: d };
}

// HDR sources (PQ/HLG) look flat and dim if treated as SDR. This FFmpeg may lack zscale, so we detect and warn rather than guess.
export function hdrInfo(videoStream) {
  const transfer = videoStream?.color_transfer || '';
  const hdr = ['smpte2084', 'arib-std-b67'].includes(transfer);
  return { hdr, transfer, primaries: videoStream?.color_primaries || '', space: videoStream?.color_space || '' };
}

// Filter prefix that brings an SD (BT.601) source to BT.709; HD sources pass through unchanged.
export function sourceColorFix(videoStream) {
  const space = videoStream?.color_space || '';
  if (['smpte170m', 'bt470bg'].includes(space)) return `colorspace=all=bt709:iall=${space === 'bt470bg' ? 'bt601-6-625' : 'bt601-6-525'}:fast=1,`;
  return '';
}
