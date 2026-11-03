// Serves the scripted session page on this computer only (127.0.0.1) so a real screen recording can be made of it with OBS.
//   node scripts/focus-tune/serve.mjs      then open the printed address, start OBS recording, press Start on the page, stop when it says Done.
//   node scripts/focus-tune/run.mjs <your recording> --align      score the detector on it (the magenta flash lines the recording up with the script).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = http.createServer(async (req, res) => {
  if (!['127.0.0.1:4390', 'localhost:4390'].includes(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  if (new URL(req.url, 'http://x').pathname !== '/') { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
  res.end(await readFile(path.join(here, 'app.html')));
});
server.listen(4390, '127.0.0.1', () => console.log('Open http://127.0.0.1:4390/?live in a browser, make it full screen, start your OBS recording, then press Start.\nStop the server with Ctrl+C when you are done.'));
