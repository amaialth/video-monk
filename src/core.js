import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
export const run = async (command, args, options = {}) => {
  try {
    return await exec(command, args, {
      windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024, ...options
    });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing executable: ${command}. Install it and add it to PATH.`);
    throw new Error(`${command} failed: ${String(error.stderr || error.message).slice(-6000)}`);
  }
};

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeNew(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { flag: 'wx' });
}

export async function writeJson(file, value) {
  await writeNew(file, `${JSON.stringify(value, null, 2)}\n`);
}

export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export function youtubeChannel(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(url.hostname) ||
      url.username || url.password || url.port ||
      !/^\/(?:@[\w.-]+|channel\/UC[\w-]+)(?:\/(?:videos|shorts|streams))?\/?$/.test(url.pathname)) {
    throw new Error('Use an HTTPS YouTube channel URL, such as https://www.youtube.com/@ByteMonk.');
  }
  return `https://www.youtube.com${url.pathname.replace(/\/(?:videos|shorts|streams)\/?$/, '').replace(/\/$/, '')}`;
}

export function integer(value, name, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

export function endpoint(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('LLM base URL must use HTTPS (HTTP is allowed only on loopback), without credentials or query parameters.');
  }
  return `${url.href.replace(/\/$/, '')}/chat/completions`;
}

export async function loadProject(folder) {
  const root = path.resolve(folder || '.');
  const config = await readJson(path.join(root, 'video-monk.json'));
  if (config.version !== 1) throw new Error('Unsupported project configuration version.');
  youtubeChannel(config.channel);
  endpoint(config.llm.baseUrl);
  if (!config.llm.model || !/^[A-Z_][A-Z0-9_]*$/.test(config.llm.apiKeyEnv)) {
    throw new Error('Configure an LLM model and an environment-variable name in video-monk.json.');
  }
  return { root, config };
}
