// Minimal headless-Chrome driver over the DevTools protocol (no npm dependencies).
// Used to render deterministic, seekable HTML/SVG motion graphics into PNG states.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const candidates = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
};

export async function findChrome() {
  const configured = process.env.VIDEO_MONK_CHROME;
  const list = configured ? [configured] : candidates[process.platform] || candidates.linux;
  for (const file of list) {
    try { await access(file); return file; } catch { /* try next */ }
  }
  throw new Error('Motion: Google Chrome/Chromium not found. Install Chrome or set VIDEO_MONK_CHROME to its executable.');
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`Chrome: ${message.error.message}`));
        else resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Chrome: DevTools connection closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

// By default every DNS lookup is blocked, so templates cannot reach the network. Research (logos, source pages) opts in with { network: true }.
export async function launchChrome({ network = false } = {}) {
  const executable = await findChrome();
  const profile = await mkdtemp(path.join(tmpdir(), 'video-monk-chrome-'));
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--disable-default-apps', '--mute-audio', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text',
    // Templates are local and self-contained; block all DNS so pages cannot reach the network.
    ...(network ? [] : ['--host-resolver-rules=MAP * ~NOTFOUND']), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome: timed out waiting for DevTools endpoint')), 30000);
    child.stderr.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code}): ${buffer.slice(-2000)}`)); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
  });
  child.stderr.removeAllListeners('data');
  child.stderr.resume();
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome: cannot connect to DevTools')), { once: true });
  });
  const session = new Session(socket);
  return {
    session,
    async close() {
      try { socket.close(); } catch { /* ignore */ }
      child.kill('SIGKILL');
      await new Promise(resolve => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

// Open a page for a local HTML file at an exact viewport, with optional transparent background.
export async function openPage(browser, htmlFile, { width, height, transparent }) {
  const { session } = browser;
  const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => session.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`Motion template error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result.value;
  };
  const started = Date.now();
  for (;;) {
    const state = await evaluate('window.__vmError ? "error:" + window.__vmError : (window.__vmReady === true ? "ready" : "wait")')
      .catch(() => 'wait');
    if (state === 'ready') break;
    if (state.startsWith('error:')) throw new Error(`Motion template error: ${state.slice(6)}`);
    if (Date.now() - started > 20000) throw new Error('Motion: template did not become ready within 20s');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return {
    evaluate,
    async screenshot(file) {
      // captureScreenshot waits for a fresh compositor frame, so the preceding seek is always included.
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    close: () => session.send('Target.closeTarget', { targetId })
  };
}

// Visit a public web page for research. Only for browsers launched with { network: true }. The page is only read: no cookies are kept (a fresh profile each launch),
// nothing is typed or submitted, and the caller decides which hosts are allowed. Returns helpers to read the page and take a screenshot.
export async function browsePage(browser, url, { width = 1440, height = 900, timeout = 25000, settle = 1500 } = {}) {
  const { session } = browser;
  const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => session.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const started = Date.now();
  for (;;) {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => null);
    if (r?.result?.value === 'complete') break;
    if (Date.now() - started > timeout) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, settle));
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Page error: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  };
  return {
    evaluate,
    async screenshot(file, { clip, transparent = false } = {}) {
      if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, ...(clip ? { clip: { ...clip, scale: clip.scale || 1 } } : {}) });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    close: () => session.send('Target.closeTarget', { targetId }).catch(() => {})
  };
}
