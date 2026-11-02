// Imported first by tests that render or transcribe: points the asset library at a throwaway folder.
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
if (!process.env.VIDEO_MONK_LIBRARY_KEEP) process.env.VIDEO_MONK_LIBRARY = mkdtempSync(path.join(os.tmpdir(), 'video-monk-test-library-'));
