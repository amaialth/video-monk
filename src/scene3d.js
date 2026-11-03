// True 3D scenes (three.js, from the library vault: `video-monk libs --add three --allow-download`), generated from a short's own content so each one is specific to it.
// The planner chooses where depth helps and which kind; the words and numbers always come from the beat's own on-screen props, never from the planner:
//   hero    a glossy slab carrying a brand's logo flies in out of the depth and settles under orbiting rings, with the hook line building below it
//   layers  a stack of 3 to 5 layers (an architecture, a protocol stack, "built on top of") floats apart and is labelled with the beat's own list items
//   ring    one percentage drawn as a 3D gauge that fills while the number counts up
// Every frame is a pure function of time (seeded stars, no clocks), as the offline renderer needs.
import path from 'node:path';

const jsString = value => JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
export const SCENE3D_KINDS = ['hero', 'layers', 'ring'];

export function parseEmphasis(text) {
  // "Perplexity dropped *MCP*" -> [{ text: 'Perplexity dropped ', accent: false }, { text: 'MCP', accent: true }]
  const parts = []; let accent = false;
  for (const piece of String(text || '').split('*')) { if (piece) parts.push({ text: piece, accent }); accent = !accent; }
  return parts;
}
const plain = text => String(text || '').replace(/\*/g, '').trim();

// What each kind needs from a beat's own props. Returns null when the beat cannot honestly be shown that way.
export function labelsFor(show, props = {}) {
  const clip = s => plain(s).slice(0, 28);
  let labels = [];
  if (show === 'bullets') labels = (props.items || []).map(i => (typeof i === 'string' ? i : i?.text || i?.title || ''));
  else if (show === 'steps') labels = (props.steps || []).map(s => (typeof s === 'string' ? s : s?.title || ''));
  else if (show === 'flow') labels = (props.nodes || []).map(n => (typeof n === 'string' ? n : n?.label || n?.title || ''));
  else if (show === 'comparison') labels = (props.columns || []).flatMap(c => (c.items || []).slice(0, 2));
  else if (show === 'tabs-panels') labels = (props.tabs || []).flatMap(t => (t.points || []).slice(0, 2));
  labels = labels.map(clip).filter(Boolean);
  return labels.length >= 3 ? labels.slice(0, 5) : null;
}
export function ringFrom(show, props = {}) {
  if (!['stat', 'pull-back-reveal', 'counter'].includes(show)) return null;
  const raw = String(props.value ?? '');
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  const percent = /%/.test(raw) || props.suffix === '%';
  if (!Number.isFinite(n) || !(n > 0) || n > 100 || !percent) return null;
  return { value: n, label: plain(props.label || '') };
}
export function heroFrom(show, props = {}) {
  if (!['title', 'kinetic-text', 'quote', 'term'].includes(show)) return null;
  const title = plain(props.title || props.text || props.term || props.quote || '');
  return title ? { kicker: plain(props.kicker || props.eyebrow || props.category || ''), title: props.title || props.text || props.term || props.quote, subtitle: plain(props.subtitle || props.definition || '') } : null;
}
export function depthPossible(kind, show, props) {
  return kind === 'layers' ? Boolean(labelsFor(show, props)) : kind === 'ring' ? Boolean(ringFrom(show, props)) : kind === 'hero' ? Boolean(heroFrom(show, props)) : false;
}

// ---------------------------------------------------------------- the shared world: renderer, light, environment, stars and text helpers
function world({ theme = 'night', seconds = 6, logoTone = 'dark' }) {
  const light = theme === 'paper';
  const bg = light ? '#f1eee7' : '#0b1020', ink = light ? '#101522' : '#ffffff', soft = light ? '#4a5266' : '#aab3c8', accent = light ? '#1a6fe0' : '#4cc9f0';
  return `import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const W = innerWidth, H = innerHeight, SECONDS = ${Number(seconds) || 6};
const BG = '${bg}', INK = '${ink}', SOFT = '${soft}', ACCENT = '${accent}', LIGHT = ${light}, LOGO_TONE = '${logoTone === 'light' ? 'light' : 'dark'}';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 16, 44);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.AmbientLight(0xffffff, LIGHT ? 0.9 : 0.35));
const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 5, 6); scene.add(key);
const rim = new THREE.PointLight(new THREE.Color(ACCENT), 60, 18); rim.position.set(-4, 2, -2); scene.add(rim);
let seed = 20260101; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };   // seeded: the same pixels every run
const N = 700, pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) pos.set([(rnd() - 0.5) * 26, (rnd() - 0.5) * 34, -2 - rnd() * 30], i * 3);
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: new THREE.Color(LIGHT ? '#7f8aa6' : '#bcd8ff'), size: LIGHT ? 0.06 : 0.07, transparent: true, opacity: LIGHT ? 0.5 : 0.85, sizeAttenuation: true, depthWrite: false }));
scene.add(stars);
const ease = x => x * x * (3 - 2 * x), p = (t, a, d) => Math.min(1, Math.max(0, (t - a) / d));
const backOut = x => { const c = 1.45; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const FONT = 'system-ui, -apple-system, Helvetica, Arial, sans-serif';
function textPlane({ lines, size, weight = 800, color = INK, width = 3.5, align = 'center', spacing = 1.18 }) {
  const c = document.createElement('canvas'); c.width = 2048; const g0 = c.getContext('2d');
  const px = size * 2; g0.font = weight + ' ' + px + 'px ' + FONT;
  const rows = lines.map(parts => parts.map(q => ({ ...q, w: g0.measureText(q.text).width })));
  c.height = Math.ceil(rows.length * px * spacing + px * 0.5);
  const g = c.getContext('2d'); g.font = weight + ' ' + px + 'px ' + FONT; g.textBaseline = 'middle';
  rows.forEach((row, i) => { const total = row.reduce((s, q) => s + q.w, 0); let x = align === 'center' ? (c.width - total) / 2 : 40; const y = px * 0.25 + px * spacing * (i + 0.5);
    row.forEach(q => { g.fillStyle = q.accent ? ACCENT : color; g.fillText(q.text, x, y); x += q.w; }); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const h = width * c.height / c.width;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  m.userData.h = h; m.renderOrder = 10; m.material.depthTest = false; return m;
}
function wrap(text, maxChars) {   // at most three lines; *emphasis* keeps the accent colour
  const parts = []; let accent = false; for (const piece of String(text).split('*')) { if (piece) parts.push({ text: piece, accent }); accent = !accent; }
  const words = []; parts.forEach(q => q.text.split(/(\\s+)/).filter(Boolean).forEach(w => words.push({ text: w, accent: q.accent })));
  const lines = [[]]; let len = 0;
  for (const w of words) { if (len + w.text.length > maxChars && lines.length < 3 && w.text.trim()) { lines.push([]); len = 0; } lines[lines.length - 1].push(w); len += w.text.length; }
  return lines.map(l => { while (l.length && !l[0].text.trim()) l.shift(); while (l.length && !l[l.length - 1].text.trim()) l.pop(); return l; }).filter(l => l.length);
}
const glowTexture = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 4, 128, 128, 128); gr.addColorStop(0, LIGHT ? 'rgba(26,111,224,0.28)' : 'rgba(76,201,240,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); };
`;
}
const close = `
window.__seek(0); window.__vmReady = true;
</script></body></html>
`;
const head = (title, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style></head><body>
<!-- Generated by Video Monk. Needs the vaulted three.js. A frame is a pure function of t. -->
<vm-lib name="three"></vm-lib>
${extra}<script type="module">
`;

// ---------------------------------------------------------------- hero: a logo card flying in
export function hook3dHtml({ kicker = '', title = '', subtitle = '', logo, logoTone = 'dark', theme = 'night', seconds = 6 }) {
  return head('3D hook', `<vm-asset name="logo" src="${logo.split(path.sep).join('/')}"></vm-asset>\n`) + world({ theme, seconds, logoTone }) + `
const KICKER = ${jsString(kicker)}, TITLE = ${jsString(title)}, SUBTITLE = ${jsString(subtitle)};
const ringMat = o => new THREE.MeshStandardMaterial({ color: new THREE.Color(ACCENT), metalness: 0.7, roughness: 0.25, transparent: true, opacity: o, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.35 });
const ringA = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.018, 16, 160), ringMat(0.75)), ringB = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.012, 16, 160), ringMat(0.45));
const ringsGroup = new THREE.Group(); ringsGroup.add(ringA, ringB); ringsGroup.position.set(0, 2.25, -0.8); scene.add(ringsGroup);
const kickerPlane = KICKER ? textPlane({ lines: [[{ text: KICKER.toUpperCase().split('').join('\\u200a'), accent: true }]], size: 40, weight: 700, width: 3.2, color: ACCENT }) : null;
const titlePlane = textPlane({ lines: wrap(TITLE, 15), size: 118, width: 3.55 });
const subPlane = SUBTITLE ? textPlane({ lines: wrap(SUBTITLE, 34).slice(0, 2), size: 50, weight: 500, width: 3.2, color: SOFT }) : null;
const hero = new THREE.Group(); scene.add(hero);
const TY = 0.1;
if (kickerPlane) { kickerPlane.position.set(0, TY + 0.5, 0); scene.add(kickerPlane); }
titlePlane.position.set(0, TY - titlePlane.userData.h / 2 + 0.2, 0); scene.add(titlePlane);
if (subPlane) { subPlane.position.set(0, titlePlane.position.y - titlePlane.userData.h / 2 - subPlane.userData.h / 2 - 0.05, 0); scene.add(subPlane); }
const img = new Image(); img.src = window.__vmAssets.logo; await img.decode();
const aspect = Math.min(4.5, Math.max(0.6, img.naturalWidth / img.naturalHeight));
const CW = aspect >= 1 ? Math.min(3.5, 2.1 + aspect * 0.55) : 2.3 * Math.max(0.85, aspect + 0.2), CH = Math.min(2.5, CW / Math.max(1, aspect * 0.9) + 0.5);
hero.add(new THREE.Mesh(new RoundedBoxGeometry(CW, CH, 0.34, 6, 0.16), new THREE.MeshStandardMaterial({ color: LIGHT ? 0xdfe3ee : 0x151c36, metalness: 0.85, roughness: 0.22, envMapIntensity: 1.2 })));
const face = document.createElement('canvas'); face.width = 1024; face.height = Math.round(1024 * CH / CW); const fg = face.getContext('2d');
fg.beginPath(); fg.roundRect(26, 26, face.width - 52, face.height - 52, 70); fg.fillStyle = LOGO_TONE === 'light' ? '#0e1426' : '#ffffff'; fg.fill();
const k = Math.min(face.width * (aspect > 2.5 ? 0.84 : 0.64) / img.naturalWidth, face.height * 0.56 / img.naturalHeight);
fg.drawImage(img, (face.width - img.naturalWidth * k) / 2, (face.height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
const faceTex = new THREE.CanvasTexture(face); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 8;
const front = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, metalness: 0.05, roughness: 0.35, envMapIntensity: 0.6 }));
front.position.z = 0.172; hero.add(front);
const glow = new THREE.Mesh(new THREE.PlaneGeometry(CW * 2.4, CH * 2.4), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: LIGHT ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false }));
glow.position.z = -0.4; hero.add(glow);
window.__seek = t => {
  const fly = p(t, 0.05, 1.25), e = backOut(fly), settle = ease(p(t, 1.1, 0.9));
  hero.position.set(Math.sin(t * 0.8) * 0.06 * settle, 2.25 + Math.sin(t * 1.35) * 0.07 + (1 - ease(fly)) * 1.4, -(1 - ease(fly)) * 15);
  hero.rotation.set(Math.cos(t * 0.7) * 0.07 * settle, (1 - e) * Math.PI * 2.4 + Math.sin(t * 0.9) * 0.3 * settle, (1 - e) * -0.5);
  hero.scale.setScalar((0.5 + 0.5 * ease(fly)) * 0.78);
  glow.material.opacity = ease(p(t, 0.3, 1.0));
  ringsGroup.rotation.set(1.15 + Math.sin(t * 0.5) * 0.08, t * 0.35, t * 0.22); ringsGroup.scale.setScalar(0.4 + 0.6 * ease(p(t, 0.1, 1.2)));
  ringA.material.opacity = 0.75 * ease(p(t, 0.3, 0.8)); ringB.material.opacity = 0.45 * ease(p(t, 0.4, 0.8)); ringB.rotation.x = t * 0.3;
  const tin = ease(p(t, 0.95, 0.7));
  titlePlane.material.opacity = tin; titlePlane.position.y = TY - titlePlane.userData.h / 2 + 0.2 - (1 - tin) * 0.25;
  if (kickerPlane) kickerPlane.material.opacity = ease(p(t, 0.8, 0.6));
  if (subPlane) subPlane.material.opacity = ease(p(t, 1.5, 0.7));
  stars.position.set(Math.sin(t * 0.2) * 0.4, t * 0.12, t * 0.35); stars.material.opacity = (LIGHT ? 0.5 : 0.85) * ease(p(t, 0, 0.6));
  camera.position.set(Math.sin(t * 0.35) * 0.18, 0.15 + Math.cos(t * 0.3) * 0.05, 12.2 - 1.3 * ease(p(t, 0, SECONDS)));
  camera.lookAt(0, 1.0, 0);
  renderer.render(scene, camera);
};` + close;
}

// ---------------------------------------------------------------- layers: a stack that floats apart, labelled with the beat's own items
export function layers3dHtml({ title = '', labels = [], theme = 'night', seconds = 6 }) {
  return head('3D layers') + world({ theme, seconds }) + `
const TITLE = ${jsString(title)}, LABELS = ${JSON.stringify(labels.slice(0, 5).map(plain))};
const COLORS = [0x4cc9f0, 0xf72585, 0xffd166, 0x06d6a0, 0xa78bfa];
const titlePlane = TITLE ? textPlane({ lines: wrap(TITLE, 18).slice(0, 2), size: 86, width: 3.3 }) : null;
if (titlePlane) { titlePlane.position.set(0, 3.15, 0); scene.add(titlePlane); }
const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: LIGHT ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false }));
glow.position.set(0, 0.7, -2.5); scene.add(glow);
const stack = new THREE.Group(); stack.position.set(0, 0.25, 0); scene.add(stack);
const slabs = LABELS.map((name, i) => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.0, 0.24, 2.0, 5, 0.09), new THREE.MeshStandardMaterial({ color: COLORS[i % COLORS.length], metalness: 0.15, roughness: 0.5, envMapIntensity: 0.45 }));
  const tag = textPlane({ lines: [[{ text: name }]], size: 92, weight: 900, width: 3.1, color: '#0b1020' });
  tag.material.opacity = 0; tag.position.set(0, 0.3, 1.25); g.add(body); stack.add(g); scene.add(tag);
  return { g, tag, i, body };
});
const n = slabs.length;
window.__seek = t => {
  const enter = i => ease(p(t, 0.08 + i * 0.16, 0.8)), apart = ease(p(t, 1.0, 1.0));
  stack.rotation.y = -0.55 + Math.sin(t * 0.55) * 0.22 + (1 - ease(p(t, 0, 1.4))) * 1.2; stack.rotation.x = 0.0;
  slabs.forEach(({ g, tag, i, body }) => {
    const rest = (n - 1 - i) * 0.3, spread = (n - 1 - i) * 1.02, e = enter(i);
    g.position.y = (rest + (spread - rest) * apart) - ((n - 1) * 0.51) * apart * 0.0 + (1 - e) * (3.2 + i * 0.5);
    g.rotation.y = (1 - e) * 0.9; body.material.opacity = 1;
    const wp = new THREE.Vector3(); g.getWorldPosition(wp);
    tag.position.set(0, wp.y + 0.02, 1.45); tag.material.opacity = ease(p(t, 1.5 + i * 0.12, 0.5));
  });
  if (titlePlane) titlePlane.material.opacity = ease(p(t, 0.3, 0.7));
  glow.material.opacity = ease(p(t, 0.2, 1.0));
  stars.position.set(Math.sin(t * 0.2) * 0.4, t * 0.12, t * 0.35); stars.material.opacity = (LIGHT ? 0.5 : 0.85) * ease(p(t, 0, 0.6));
  camera.position.set(Math.sin(t * 0.3) * 0.5, 3.4, 12.5 - 1.0 * ease(p(t, 0, SECONDS)));
  camera.lookAt(0, 0.9, 0);
  renderer.render(scene, camera);
};` + close;
}

// ---------------------------------------------------------------- ring: one percentage as a 3D gauge
export function ring3dHtml({ value = 50, label = '', theme = 'night', seconds = 6 }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  return head('3D gauge') + world({ theme, seconds }) + `
const VALUE = ${v}, LABEL = ${jsString(label)};
const R = 1.55, TUBE = 0.2, SEG = 240;
const trackMat = new THREE.MeshStandardMaterial({ color: LIGHT ? 0xcfd5e6 : 0x1a2244, metalness: 0.6, roughness: 0.35 });
const fillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ACCENT), metalness: 0.5, roughness: 0.2, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.55 });
const track = new THREE.Mesh(new THREE.TorusGeometry(R, TUBE * 0.72, 28, SEG), trackMat);
fillMat.side = THREE.DoubleSide;
const fill = new THREE.Mesh(new THREE.TorusGeometry(R, TUBE, 28, 4, 0.01), fillMat);   // the arc is rebuilt each frame (a torus is ordered around its tube, not along its arc)
fill.rotation.z = Math.PI / 2; fill.scale.y = -1;   // start at the top and run clockwise
const gauge = new THREE.Group(); gauge.add(track, fill); gauge.position.set(0, 2.3, 0); scene.add(gauge);
const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: LIGHT ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false }));
glow.position.set(0, 2.3, -2); scene.add(glow);
// the number is a canvas redrawn as it counts up
const nc = document.createElement('canvas'); nc.width = 1024; nc.height = 512; const ng = nc.getContext('2d');
const ntex = new THREE.CanvasTexture(nc); ntex.colorSpace = THREE.SRGBColorSpace;
const numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: ntex, transparent: true, depthWrite: false, fog: false })); numberPlane.position.set(0, 2.3, 0.4); numberPlane.renderOrder = 10; numberPlane.material.depthTest = false; scene.add(numberPlane);
const drawNumber = n => { ng.clearRect(0, 0, 1024, 512); ng.font = '900 300px ' + FONT; ng.textBaseline = 'middle'; ng.textAlign = 'center'; ng.fillStyle = INK; ng.fillText(String(Math.round(n)), 440, 270); ng.font = '800 170px ' + FONT; ng.fillStyle = ACCENT; ng.fillText('%', 820, 300); ntex.needsUpdate = true; };
const labelPlane = LABEL ? textPlane({ lines: wrap(LABEL, 26).slice(0, 3), size: 60, weight: 700, width: 3.1 }) : null;
if (labelPlane) { labelPlane.position.set(0, 0.45 - labelPlane.userData.h / 2, 0); scene.add(labelPlane); }
window.__seek = t => {
  const e = ease(p(t, 0.4, 1.9)), shown = VALUE * e;
  fill.geometry.dispose(); fill.geometry = new THREE.TorusGeometry(R, TUBE, 28, Math.max(2, Math.ceil(SEG * shown / 100)), Math.max(0.02, Math.PI * 2 * shown / 100));
  drawNumber(shown);
  const enter = ease(p(t, 0, 0.9));
  gauge.position.y = 2.3 + (1 - enter) * 1.6 + Math.sin(t * 1.2) * 0.05; gauge.scale.setScalar(0.5 + 0.5 * enter);
  gauge.rotation.set(-0.2 + Math.sin(t * 0.6) * 0.08 + (1 - enter) * 1.0, Math.sin(t * 0.5) * 0.28, 0);
  numberPlane.material.opacity = enter; glow.material.opacity = enter;
  if (labelPlane) labelPlane.material.opacity = ease(p(t, 0.9, 0.7));
  stars.position.set(Math.sin(t * 0.2) * 0.4, t * 0.12, t * 0.35); stars.material.opacity = (LIGHT ? 0.5 : 0.85) * ease(p(t, 0, 0.6));
  camera.position.set(Math.sin(t * 0.35) * 0.25, 2.1 + Math.cos(t * 0.3) * 0.05, 12 - 1.0 * ease(p(t, 0, SECONDS)));
  camera.lookAt(0, 1.7, 0);
  renderer.render(scene, camera);
};` + close;
}
