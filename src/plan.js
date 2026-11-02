import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists } from './core.js';

export const PLAN_SCHEMA = {
  version: 1,
  title: 'Original edit',
  fps: 24,
  width: 1920,
  height: 1080,
  clips: [{ mediaId: 'intro', in: 0, out: 5, purpose: 'Hook' }],
  captions: [{ start: 0, end: 2, text: 'Verified spoken words only' }],
  finishing: {
    audio: ['Human-reviewed dialogue balance, licensed music, and platform loudness target'],
    color: ['Check source color space and match shots using scopes'],
    graphics: ['Original diagrams; review legibility and safe areas'],
    export: ['Review timeline, configure render settings, and inspect exported file']
  }
};

export async function validateInventory(value, base) {
  if (value.version !== 1 || !Array.isArray(value.media) || !value.media.length) {
    throw new Error('Inventory needs version: 1 and a nonempty media array.');
  }
  const ids = new Set();
  const media = [];
  for (const entry of value.media) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Inventory IDs must be unique alphanumeric identifiers.');
    ids.add(entry.id);
    if (entry.role !== 'source') throw new Error(`Media ${entry.id} must have role "source"; reference footage cannot be used in an original edit.`);
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`Missing media path: ${entry.id}`);
    const file = path.resolve(base, entry.path);
    if (!(await exists(file))) throw new Error(`Media does not exist: ${file}`);
    if (typeof entry.description !== 'string' || !entry.description.trim()) throw new Error(`Describe media ${entry.id} before asking an LLM to select it.`);
    media.push({ ...entry, path: file });
  }
  return { version: 1, media };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid edit plan: ${message}`);
}

function keys(value, allowed, location) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${location} must be an object`);
  assert(Object.keys(value).every(key => allowed.includes(key)), `unsupported fields in ${location}`);
}

export function validatePlan(plan, inventory) {
  keys(plan, ['version', 'title', 'fps', 'width', 'height', 'clips', 'captions', 'finishing', 'durationFrames'], 'plan');
  assert(plan && plan.version === 1, 'version must be 1');
  assert(typeof plan.title === 'string' && plan.title.trim().length > 0 && plan.title.length <= 120, 'title must contain 1-120 characters');
  assert([24, 25, 30, 50, 60].includes(plan.fps), 'fps must be 24, 25, 30, 50, or 60 (non-drop-frame)');
  assert(Number.isInteger(plan.width) && plan.width >= 256 && plan.width <= 3840 && plan.width % 2 === 0, 'width must be even, 256-3840');
  assert(Number.isInteger(plan.height) && plan.height >= 256 && plan.height <= 2160 && plan.height % 2 === 0, 'height must be even, 256-2160');
  assert(Array.isArray(plan.clips) && plan.clips.length > 0 && plan.clips.length <= 1000, 'provide 1-1000 clips');
  const sources = new Map(inventory.media.map(media => [media.id, media]));
  let totalFrames = 0;
  for (const clip of plan.clips) {
    keys(clip, ['mediaId', 'in', 'out', 'purpose'], 'clip');
    const source = sources.get(clip.mediaId);
    assert(source && source.role === 'source', `unknown or reference media: ${clip.mediaId}`);
    assert(Number.isFinite(source.duration) && source.duration > 0 && Number.isFinite(source.fps) && source.fps > 0, `unprobed media: ${clip.mediaId}`);
    assert(Number.isFinite(clip.in) && Number.isFinite(clip.out) && clip.in >= 0 && clip.out > clip.in && clip.out <= source.duration, `invalid bounds for ${clip.mediaId}`);
    const startFrame = Math.round(clip.in * source.fps);
    const endFrame = Math.round(clip.out * source.fps);
    assert(endFrame > startFrame && endFrame <= Math.floor(source.duration * source.fps + 0.0001), `source-frame bounds for ${clip.mediaId}`);
    assert(typeof clip.purpose === 'string' && clip.purpose.trim(), 'every clip needs a purpose');
    const durationFrames = Math.round((endFrame - startFrame) / source.fps * plan.fps);
    assert(durationFrames > 0, 'clip is shorter than one timeline frame');
    totalFrames += durationFrames;
  }
  assert(Array.isArray(plan.captions), 'captions must be an array, even if empty');
  let previousEnd = 0;
  for (const caption of plan.captions) {
    keys(caption, ['start', 'end', 'text'], 'caption');
    assert(Number.isFinite(caption.start) && Number.isFinite(caption.end) &&
      caption.start >= previousEnd && caption.end > caption.start &&
      Math.round(caption.end * 1000) > Math.round(caption.start * 1000) &&
      caption.end <= totalFrames / plan.fps, 'caption timing must be ordered, non-overlapping, and within timeline');
    assert(typeof caption.text === 'string' && caption.text.trim() && !caption.text.includes('-->') &&
      !/[\r\n]/.test(caption.text), 'caption text must be nonempty, single-line, and contain no SRT arrow');
    previousEnd = caption.end;
  }
  keys(plan.finishing, ['audio', 'color', 'graphics', 'export'], 'finishing');
  for (const category of ['audio', 'color', 'graphics', 'export']) {
    assert(Array.isArray(plan.finishing?.[category]) && plan.finishing[category].length > 0 &&
      plan.finishing[category].every(note => typeof note === 'string' && note.trim()), `finishing.${category} needs actionable review notes`);
  }
  return { ...plan, durationFrames: totalFrames };
}

function srtTime(seconds) {
  const millis = Math.round(seconds * 1000);
  return `${String(Math.floor(millis / 3600000)).padStart(2, '0')}:${String(Math.floor(millis / 60000) % 60).padStart(2, '0')}:${String(Math.floor(millis / 1000) % 60).padStart(2, '0')},${String(millis % 1000).padStart(3, '0')}`;
}

export function captionsSrt(captions) {
  return captions.map((caption, index) => `${index + 1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}\n`).join('\n');
}

export function resolveXml(plan, inventory) {
  const escape = value => String(value).replace(/[<>&"']/g, char => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[char]);
  let position = 0;
  const track = plan.clips.map((clip, index) => {
    const media = inventory.media.find(entry => entry.id === clip.mediaId);
    const start = Math.round(clip.in * media.fps);
    const end = Math.round(clip.out * media.fps);
    const duration = Math.round((end - start) / media.fps * plan.fps);
    const item = `<clipitem id="clip-${index + 1}"><name>${escape(media.id)}</name><duration>${end - start}</duration><rate><timebase>${Math.round(media.fps)}</timebase><ntsc>FALSE</ntsc></rate><start>${position}</start><end>${position + duration}</end><in>${start}</in><out>${end}</out><file id="file-${index + 1}"><name>${escape(path.basename(media.path))}</name><pathurl>${escape(pathToFileURL(media.path).href)}</pathurl><duration>${Math.floor(media.duration * media.fps)}</duration><rate><timebase>${Math.round(media.fps)}</timebase><ntsc>FALSE</ntsc></rate><media><video><samplecharacteristics><width>${media.width}</width><height>${media.height}</height></samplecharacteristics></video></media></file></clipitem>`;
    position += duration;
    return item;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence><name>${escape(plan.title)}</name><duration>${position}</duration><rate><timebase>${plan.fps}</timebase><ntsc>FALSE</ntsc></rate><media><video><format><samplecharacteristics><rate><timebase>${plan.fps}</timebase><ntsc>FALSE</ntsc></rate><width>${plan.width}</width><height>${plan.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format><track>${track}</track></video></media></sequence></xmeml>\n`;
}

export function requireXmlRates(inventory) {
  for (const media of inventory.media) {
    if (![24, 25, 30, 50, 60].includes(media.fps)) {
      throw new Error(`XML handoff currently requires integer source frame rates; ${media.id} is ${media.fps}. Conform a copy of the media before use.`);
    }
  }
}
