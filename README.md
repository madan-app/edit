# Graphite — Offline-First Browser Photo Editor

Graphite is a Lightroom/Picsart-style photo editor that runs **entirely in your
browser**. There is no backend, no login, no database, and no payment
gateway — every pixel operation happens on your device, and your original
photo never leaves it unless you explicitly click **Export**.

It's built with plain HTML5, CSS3, vanilla ES modules, Canvas 2D, a Web
Worker for the heavy full-resolution export pass, and IndexedDB for local
projects and presets. Nothing here is copied from Adobe, Picsart, or any
other product — the interface, icon set, filter recipes, and sample assets
are original.

---

## 1. Running it locally

No build step, no `npm install`, no bundler. Because the app uses native ES
modules, it must be served over `http://`/`https://` (opening `index.html`
directly via `file://` will block module imports in most browsers).

Pick any static file server, for example:

```bash
# Python 3
python3 -m http.server 8080

# Node (no install needed)
npx serve .

# VS Code
# Right-click index.html → "Open with Live Server"
```

Then open `http://localhost:8080` in a modern browser (Chrome, Edge,
Firefox, or Safari — all current versions).

---

## 2. Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", choose **Deploy from a branch**, pick your
   default branch and the `/ (root)` folder.
4. Save — GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/`.

That's it — there's no build output to generate, since the repository *is*
the deployable site. The same folder also works unmodified on any static
host (Netlify, Vercel static export, S3 + CloudFront, an nginx box, etc.).

---

## 3. How it's organized

```
index.html
css/            main.css · editor.css · panels.css · responsive.css
js/
  app.js        boot: start screen, open/new/save/export, shortcuts, PWA
  editor.js     non-destructive editing engine (project + layers + history)
  canvas.js     viewport: zoom / pan / fit / before-after compare
  ui.js         all panel rendering + tool pointer interactions
  image-loader.js, adjustments.js, filters.js, presets.js, layers.js,
  masks.js, selection.js, retouch.js, drawing.js, text.js, shapes.js,
  stickers.js, transform.js, history.js, storage.js, export.js,
  shortcuts.js, icons.js, worker-client.js
  workers/image-worker.js   full-resolution export processing off-thread
assets/
  icons/, presets/, stickers/<category>/, backgrounds/, textures/, fonts/
  manifest.json  — lists every sticker/preset/background asset
manifest.json     — PWA manifest
service-worker.js — offline app-shell cache
```

**Non-destructive pipeline:** every image layer keeps its original pixels in
`layer.sourceCanvas` and a separate `layer.adjustments` recipe (exposure,
curves, HSL, filter, etc.). `editor._refreshLayerCanvas()` re-applies that
recipe to a fresh copy of the source any time a slider changes, so nothing
is ever baked in until you crop or flatten. **Full-resolution export**
re-runs the same recipe against the untouched full-size source (kept once,
separately from the editing preview) inside a Web Worker, so large photos
never freeze the UI.

---

## 4. Adding a new filter

Filters live in `js/filters.js` as plain data + optional post-processing:

```js
{
  id: 'my-filter',
  name: 'My Filter',
  adjust: { contrast: 12, temperature: 8, vignette: 10 }, // any adjustments.js key
  post: (data, w, h, strength) => { /* optional raw pixel pass */ }
}
```

Add an entry to the `FILTERS` array and it automatically appears in the
Filters panel with a live thumbnail — no other code changes needed.

## 5. Adding a new preset

Presets are just a name + an `adjustments` object (same shape as
`DEFAULT_ADJUSTMENTS()` in `js/adjustments.js`) + a `filterId`. You can:

- Use **Presets → Save current** in the app to capture your current sliders.
- Or add an entry to `assets/presets/sample-presets.json` (loaded once into
  IndexedDB the first time the app runs with an empty preset library).
- Or **Import** a `.json` file exported from another Graphite session.

## 6. Adding stickers, backgrounds, or fonts

Everything is manifest-driven — no JavaScript edits required:

- **Stickers:** drop an SVG into `assets/stickers/<category>/`, then add
  `{ "name": "...", "path": "./assets/stickers/<category>/your-file.svg" }`
  to the matching category array in `assets/manifest.json` (create a new
  category key if needed).
- **Backgrounds:** drop an image/SVG into `assets/backgrounds/` and list it
  under `backgrounds` in `assets/manifest.json`.
- **Fonts:** add a licensed font file under `assets/fonts/`, `@font-face` it
  in `css/main.css`, and add it to the `TEXT_FONTS` array in `js/text.js`.

---

## 7. Security & privacy model

- **Local-first, always.** There is no server component. Photos are decoded
  with `createImageBitmap`/`<img>`, edited on `<canvas>`, and stored (if you
  choose **Save Project**) in your browser's own IndexedDB — nothing is
  uploaded automatically, ever.
- **File validation.** Only `image/jpeg`, `image/png`, and `image/webp` are
  accepted (`js/image-loader.js`); oversized or corrupt files are rejected
  with a friendly error instead of crashing the app.
- **No `eval()`, no unsanitized `innerHTML`.** User-provided text (layer
  names, text-tool content, preset names) is inserted via `textContent`/DOM
  APIs or escaped before touching `innerHTML`.
- **Sticker/SVG assets** are fetched from same-origin `assets/` paths only
  and rendered through an `<img>`/Blob URL, not injected as live markup, so
  an imported SVG can't execute a `<script>` tag.
- **AI background removal is architected but inert by default.** The
  Background panel explicitly does not call any online API. It's built to
  optionally load a local ONNX/TF.js-style model from `/models/` in a future
  version; until such a model file is present, that feature stays disabled
  and every other background tool (manual selection + replace) works
  without it.
- **Offline after first load.** `service-worker.js` caches the app shell so
  the editor — including all pixel editing — keeps working with no network
  connection at all.

---

## 8. Known limitations (V1)

Per the brief's own priority ("V1 functionality over an overly complicated
interface"), a few advanced items are intentionally simple approximations
rather than research-grade implementations, and are called out in the UI
where relevant:

- **Perspective correction** (`transform.js: perspectiveCorrect`) uses a
  two-triangle affine warp rather than a full projective transform — solid
  for small corrections, not a replacement for dedicated lens-correction
  software.
- **Clone/Heal/Spot/Red-eye** (`retouch.js`) are practical, dependency-free
  pixel algorithms — good for casual touch-ups, not claiming AI-quality
  content-aware fill.
- **AI background removal** has no bundled model; the local-model loading
  path is scaffolded but disabled until a model is supplied.

Everything else listed in the brief — adjustments, curves, HSL, color
grading, filters, presets, masking, layers with blend modes, text, shapes,
drawing, crop/transform, collage-style multi-layer compositing, history,
project storage, and JPG/PNG/WebP export — is fully implemented and
runs offline.
