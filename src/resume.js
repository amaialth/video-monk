// Resume: turn what a stage produced into a small checkpoint (file paths only) when it is approved, and turn checkpoints back into stage
// artifacts when a run is resumed. Only what later stages read is restored; a restored artifact is marked `restored` and cannot be revised.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists } from './core.js';
import { loadTimeline } from './timeline.js';

const readJson = async f => JSON.parse(await readFile(f, 'utf8'));

// What to remember about an approved stage artifact.
export function checkpointOf(stage, artifact) {
  switch (stage) {
    case 'transcript': return artifact.file ? { file: artifact.file } : null;
    case 'cut': return artifact.manifestFile ? { manifestFile: artifact.manifestFile, outputDir: artifact.outputDir } : null;
    case 'storyboard': return artifact.manifestFile ? { manifestFile: artifact.manifestFile, storyboardFile: artifact.storyboardFile, baseManifestFile: artifact.baseManifestFile } : null;
    case 'render': return artifact.outputDir ? { outputDir: artifact.outputDir, manifestFile: artifact.manifestFile } : null;
    default: return null;
  }
}

// Checkpoints (in pipeline order) -> artifacts. Stops at the first stage whose files are gone, so nothing later is trusted.
export async function restoreArtifacts(checkpoints, execute) {
  const restored = {};
  const missing = [];
  const need = async (file, what) => { if (!file || !(await exists(file))) { missing.push(what); return false; } return true; };
  if (checkpoints.transcript && await need(checkpoints.transcript.file, 'transcript')) {
    restored.transcript = { words: await readJson(checkpoints.transcript.file), file: checkpoints.transcript.file, version: 1 };
  }
  if (checkpoints.cut && await need(checkpoints.cut.manifestFile, 'cut')) {
    const c = checkpoints.cut;
    const reportFile = path.join(c.outputDir || path.dirname(c.manifestFile), 'autocut-report.json');
    restored.cut = { result: { manifest: await readJson(c.manifestFile), report: (await exists(reportFile)) ? await readJson(reportFile) : null }, context: null, outputDir: c.outputDir, manifestFile: c.manifestFile, version: 1 };
  }
  if (restored.cut && checkpoints.storyboard && await need(checkpoints.storyboard.manifestFile, 'storyboard') && await need(checkpoints.storyboard.storyboardFile, 'storyboard')) {
    const c = checkpoints.storyboard;
    const loaded = await loadTimeline(c.manifestFile, execute);
    const storyboard = await readJson(c.storyboardFile);
    restored.storyboard = { storyboard, manifestFile: c.manifestFile, storyboardFile: c.storyboardFile, baseManifestFile: c.baseManifestFile, words: loaded.words, duration: loaded.duration, version: 1,
      captionsOn: Boolean(loaded.manifest.captions) && loaded.manifest.captions.burnIn !== false };
  }
  if ((restored.storyboard || restored.cut) && checkpoints.render && await need(path.join(checkpoints.render.outputDir || '', 'report.json'), 'render')) {
    const c = checkpoints.render;
    const report = await readJson(path.join(c.outputDir, 'report.json'));
    restored.render = { outputDir: c.outputDir, report, manifestFile: c.manifestFile, version: 1, manifestCaptions: Boolean((await readJson(c.manifestFile)).captions) };
  }
  return { restored, missing };
}
