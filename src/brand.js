// Brand kit for motion: brand.json (read by --brand: theme tokens, logo, motion flags) and MOTION.md (the file every agent reads before it
// animates anything: colours and what they are for, type, timing, how things move, finish, what must never happen).
// Adapted from the brand-intake skill in charlie947/motion-graphics-skills (MIT). Anything not given is written as "ASK ME", never guessed.
import path from 'node:path';
import { exists, writeNew, writeJson } from './core.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const fail = message => { throw new Error(`Brand: ${message}`); };

export function brandKit(o) {
  const name = String(o.name || '').trim();
  if (!name || name.length > 80) fail('give the brand a name (--name, up to 80 characters)');
  const colors = {};
  for (const k of ['background', 'surface', 'text', 'muted', 'accent']) {
    if (o[k] === undefined) continue;
    if (!HEX.test(o[k])) fail(`--${k} must be a #RRGGBB hex code (got ${o[k]})`);
    colors[k] = o[k].toLowerCase();
  }
  const never = (o.never ? String(o.never).split(/[;\n]/).map(x => x.trim()).filter(Boolean) : []).slice(0, 12);
  const theme = { ...colors, ...(o.preset ? { preset: o.preset } : {}), ...(o.font ? { font: o.font } : {}), ...(o.calm ? { calm: true } : {}), ...(o.onTwos ? { onTwos: true } : {}) };
  if (theme.preset && !['night', 'paper'].includes(theme.preset)) fail('--preset must be night or paper');
  const brand = { name, theme, ...(o.logo ? { logo: { path: o.logo, position: 'top-right', size: 0.1, opacity: 0.85 } } : {}), ...(o.rights ? { rights: o.rights } : {}), ...(o.attribution ? { attribution: o.attribution } : {}) };
  return { brand, never };
}

export function motionMarkdown({ brand, never }, o = {}) {
  const t = brand.theme;
  const ask = 'ASK ME';
  const color = (k, role) => `- **${k[0].toUpperCase()}${k.slice(1)}** ${t[k] || ask}: ${role}`;
  return `# MOTION.md: ${brand.name}

Read this in full before you design, generate or animate anything for ${brand.name}. Every colour, font, timing and motion value comes from here.
This file sets the look, not the ambition: when asked to go all out, go all out. If something is not covered here, ask rather than choosing.
When you finish, check your own frames against this file, fix what fails, and only then show them.

## The feeling

${o.feel ? o.feel : ask} (what a viewer should feel in the first second)

## Colours and what each is for

${color('background', 'the ground behind everything')}
${color('surface', 'cards and panels')}
${color('text', 'headlines and body')}
${color('muted', 'labels and secondary text')}
${color('accent', 'the one colour that carries emphasis; use it sparingly')}

Hex codes typed by the brand win over any colour sampled from an image.

## Type

- Font: ${t.font ? path.basename(t.font) : `${ask} (the toolkit's bundled Geist sans is used until given one)`}
- Stressed words in a headline: italic serif in the accent colour (the toolkit's default)
- Sizes: ${ask}. Hero words 120 px or more at 1080 wide; labels never under 34 px; at most 5 words on screen at once.

## Timing and movement

- Frame rate and easing: ${t.calm ? 'calm easing, gentle, no overshoot' : 'springs with a small settle, nothing linear'}
- Stepping: ${t.onTwos ? '**on twos**: every pose is held for two frames (the stepped, hand-made look). Never smooth corporate easing.' : 'smooth (not stepped). Set theme.onTwos for a hand-made feel.'}
- Entrances, holds and exits: ${ask}. Hold the finished state long enough to read it aloud.
- One thing always alive, but only one focus.

## Finish and texture

${ask}

## Never

${never.length ? never.map(x => `- ${x}`).join('\n') : `- ${ask} (name five things this brand's motion must never do)`}
- Invent a fact, a number, a name or a quote
- Redraw a logo or a UI from memory: use the real files

## Assets

- Logo: ${brand.logo ? brand.logo.path : ask}
- Brand file for the toolkit: \`brand.json\` (pass it with \`--brand brand.json\`)

## One example, shot by shot, done right

${ask} (describe one finished piece so the next agent has a target)
`;
}

export async function writeBrand(folder, options) {
  const dir = path.resolve(folder);
  if (await exists(dir)) fail(`output folder exists: ${dir}`);
  const kit = brandKit(options);
  await writeJson(path.join(dir, 'brand.json'), kit.brand);
  await writeNew(path.join(dir, 'MOTION.md'), motionMarkdown(kit, options));
  return { dir, brand: kit.brand, unknown: ['MOTION.md'].length };
}
