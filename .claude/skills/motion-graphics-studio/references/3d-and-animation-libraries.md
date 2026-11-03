# 3D and animation libraries: what works here, and how

Fourteen tools were researched for 3D and richer motion graphics. The renderer is **offline** (headless Chrome, DNS blocked, no CDN), and a frame must be a pure function of time. So the question for each is: can it draw an exact moment on request, with nothing loaded from the network?

Nine can, and are available through the **library vault**. Five cannot, and the table says what to do instead.
**Nothing is bundled with the toolkit.** The first time you ask, `libs --add <name> --allow-download` fetches the package once from `registry.npmjs.org`, checks it against the registry's SHA-512 hash and keeps it under `~/.video-monk/libs/` with its licence recorded. Each library keeps its own licence.

## Verdicts

| Asked for | Verdict | Vault name | Licence | Seek it with |
|---|---|---|---|---|
| threejs-webgl | works | `three` | MIT | set object and camera transforms from `t`, then render; `mixer.setTime(t)` for a glTF's animation |
| react-three-fiber | not in the vault | | | needs React and a JSX build, and runs its own frame loop. Write the same scene in three.js |
| babylonjs-engine | works (large, about 8 MB) | `babylonjs` | Apache-2.0 | `scene.animationsEnabled = false`, set transforms from `t`, call `scene.render()` |
| playcanvas-engine | works | `playcanvas` | MIT | `app.autoRender = false`, set transforms, `app.update(0); app.render()` |
| aframe-webxr | works, but rarely the right tool | `aframe` | MIT | it wraps three.js: use three.js directly for video. WebXR is for headsets |
| gsap-scrolltrigger | works (timelines; ScrollTrigger is for scrolling pages, not video) | `gsap` | GSAP "no charge" licence (free; not open source) | `tl = gsap.timeline({ paused: true })`, then `tl.time(t)` |
| motion-framer | works | `motion` | MIT | create each animation, pause it, set `animation.time = t` |
| react-spring-physics | not in the vault | | | a React hook library. Use Motion or anime.js springs, or the built-in spring easing |
| animejs | works | `animejs` | MIT | `createTimeline({ autoplay: false })`, then `tl.seek(t * 1000)` |
| lottie-animations | works | `lottie-web` | MIT | `anim.goToAndStop(frame, true)` with `frame = round(t * fps)` |
| blender-web-pipeline | authoring tool | | | export glTF/GLB, load it with three.js (`<vm-asset>`) |
| spline-interactive | not in the vault | | | scenes load from Spline's hosted service and its runtime licence is not stated. Export a glTF or a video instead |
| rive-interactive | works, **untested here** | `rive` | MIT | `rive.scrub(animationName, seconds)`; needs your own `.riv` file, which the toolkit cannot ship |
| substance-3d-texturing | authoring tool | | | export the PBR maps (base colour, normal, roughness, metallic, AO) and put them on a three.js `MeshStandardMaterial` |

`video-monk libs --supported` prints this list with the reasons. GSAP's licence is not OSI open source, which is why it is only ever downloaded by you, on request.
`gsap` extras (`SplitText`, `MorphSVGPlugin`, `DrawSVGPlugin`, `Flip`, `MotionPathPlugin`) come with `--with SplitText,...`.

## Using one in a graphic

```
video-monk libs --add three --allow-download      # once; later renders are offline
video-monk libs                                    # what is installed
```

In a custom HTML graphic, two tags are expanded by the renderer before the page loads:

- `<vm-lib name="three"></vm-lib>`: inlines the library. UMD libraries become a script and define their global (`gsap`, `anime`, `lottie`, `Motion`, `rive`, `BABYLON`, `pc`, `AFRAME`). three.js is ES modules, so it becomes an import map: write `<script type="module">` and `import * as THREE from 'three'`; addons come from `three/addons/...` (`loaders/GLTFLoader.js`, `postprocessing/EffectComposer.js`, `UnrealBloomPass.js`, `OutputPass.js`, `environments/RoomEnvironment.js`, `geometries/RoundedBoxGeometry.js`). Optional: `version="..."`, `with="..."`.
- `<vm-asset name="model" src="model.glb"></vm-asset>`: inlines your file (up to 60 MB) as a data URL in `window.__vmAssets.model`. Use it for glTF models, Lottie JSON, textures, `.riv` files. Paths are relative to the HTML file.
- A tag inside an HTML comment is documentation, not a request.

The page must still define `window.__seek(t)` and set `window.__vmReady = true`. **Nothing may run on its own:** turn off each library's own clock (paused timelines, `autoplay: false`, `animationsEnabled = false`, `autoRender = false`) and draw only inside `__seek`. WebGL2 is available (ANGLE/Metal on a Mac); a missing library fails the render with the command to install it.

## Starters

`assets/motion-starters/` (inside the installed package) has a working page for each: `three-showcase.html` (PBR, bloom, a seeded star field), `three-gltf.html` (a turntable for your GLB, with its animation), `babylon-scene.html`, `playcanvas-scene.html`, `gsap-timeline.html`, `anime-timeline.html`, `motion-spring.html`, `lottie-player.html` and `rive-player.html` (untested). Copy one next to your project, edit it, then:

```
video-monk graphic --html my-scene.html --output frame.png --at 2.5 --seconds 6     # look at it
video-monk graphic --html my-scene.html --output scene.mp4 --seconds 6
```

Use it as a graphic scene (`"graphic": { "html": "my-scene.html" }`) or as a beat in `motion-video`.

## Craft notes for 3D

- One world, one slow camera move, the subject readable at phone size. Bloom sparingly: it turns white into a blob.
- Seed every random value (star fields, particles). The same `t` must give the same pixels.
- Flat or low-poly shading with a good environment reads as designed; a default grey sphere reads as a demo.
- A big engine (Babylon) costs seconds on the first frame. Use it only when you need its features; three.js is the default.
- Render a still first (`--at`), then a short clip; check the first frame, the last frame and one in the middle.
