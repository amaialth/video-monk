// House style profiles. `bytemonk` encodes the "approved provisional design direction" from the channel-editing-study
// index (user-supplied, unverified pilot reports of ByteMonk videos). It is a set of creative choices, not a verified
// description of the channel, and it never copies the channel's wording, branding or sponsor material.
// The user approved it as the style every video should follow (2026-11-02).

export const STYLES = {
  bytemonk: {
    name: 'bytemonk',
    status: 'provisional creative direction, approved by the user; derived from unverified user-supplied reports',
    // Dark neutral canvas, rounded cards, restrained glow, readable sans labels; semantic accents plus icons/text, never color alone.
    theme: { preset: 'night', background: '#0d0f14', surface: '#161a23', accent: '#4cc9f0', calm: true,
      palette: ['#4cc9f0', '#34d399', '#fb923c', '#a78bfa', '#f472b6', '#facc15', '#8ecae6'] },
    density: 'medium',
    graphicsMode: 'mixed',
    pace: 'tight',
    // Explanations are built from diagrams, causal flows and comparisons; pull-text is seasoning, not the meal.
    scoreBoost: { flow: 2, steps: 1.5, comparison: 1.5, term: 1, chapter: 1, bullets: 0.5, table: 1, 'kinetic-text': -1.5 },
    maxShare: { 'kinetic-text': 0.25 },
    labelSchematic: true,
    audio: { duckingDb: 14, musicGainDb: -24, notes: 'restrained licensed ambient bed under narration; sparse UI cues only at meaningful state changes' },
    structure: ['concrete question or stake first', 'mechanism built progressively with the narration', 'comparison on a consistent layout',
      'implications kept separate from the mechanism', 'recap that reassembles the mental model', 'practical next step'],
    brief: `House style (ByteMonk-inspired, provisional): explain with a small reusable card vocabulary on a dark neutral canvas. Build each mechanism
progressively: reveal nodes, edges and steps as the narration names them, so motion always has a causal purpose. Prefer flow, steps, comparison and
term cards over pull-text. Compare things on a consistent layout (same dimensions on each side). Keep mechanism and implications as separate
beats. Open with the concrete question or stake, use chapter cards for structure, and close with a recap that rebuilds the mental model plus a
practical next step. Mark conceptual schematics as such. Never rely on color alone: pair semantic accents with icons or text. No gratuitous
transitions or overshoot. Do not copy any creator's wording, branding or sponsor material.`
  },
  plain: {
    name: 'plain', status: 'neutral defaults', theme: null, density: 'medium', graphicsMode: 'mixed', pace: 'tight',
    scoreBoost: {}, maxShare: {}, labelSchematic: false, audio: { duckingDb: 12, musicGainDb: -18 }, structure: [], brief: ''
  }
};

export function resolveStyle(name = 'bytemonk') {
  const style = STYLES[name];
  if (!style) throw new Error(`Style must be one of ${Object.keys(STYLES).join(', ')}`);
  return style;
}

// Theme tokens a style contributes to a manifest (never overrides tokens the manifest already sets).
export function styleTheme(style, fallbackPreset = null) {
  const base = style.theme ? { ...style.theme } : {};
  if (!base.preset && fallbackPreset) base.preset = fallbackPreset;
  return base;
}
