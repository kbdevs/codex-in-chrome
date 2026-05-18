# Codex for Chrome

This repository is a manual reconstruction of a Chrome extension that was recovered from the packaged `.crx` output.

## What lives where

- `background/` contains the rewritten service-worker source split into focused modules.
- `options.html` and `assets/options-C9tM1CFy.js` provide the readable options UI.
- `sidepanel.html`, `assets/local-chrome-shim.js`, and `assets/sidepanel-p3pTyYhf.js` make up the side panel runtime.
- `assets/index-D0tRRs6v.js`, `assets/index-c6gssFmU.js`, and `assets/auto-track-HG4Yyi0E.js` are no-op analytics shims kept only to satisfy dynamic imports.
- `offscreen.html` / `offscreen.js` handle offscreen audio playback and GIF generation.
- `gif_viewer.html` / `gif_viewer.js` render exported GIF previews.
- `assets/content-script.ts-Bwa5rY9t.js`, `assets/accessibility-tree.js-DxrE0N5Q.js`, and `assets/agent-visual-indicator.js-CQ3yeUso.js` are the extension content scripts.

## Reconstructed source

The background service worker was split into these readable modules:

- `background/service-worker.js`
- `background/service-worker-apis.js`
- `background/service-worker-native-host.js`
- `background/service-worker-bridge.js`
- `background/service-worker-control-plane.js`

The options page was also rewritten into a maintainable module instead of a raw bundle.
The sidepanel entry now uses a small localhost-only Chrome API shim so the bundle can render in the dev server without native extension globals.

## Analytics and telemetry

The active analytics paths were removed or neutralized:

- The manifest `connect-src` no longer includes Segment, Sentry, or Honeycomb hosts.
- The shared analytics providers now return `null`, and the remaining analytics wrapper methods are stubbed out as no-ops.
- The shared bundles no longer keep live Segment endpoint constants or write keys around for the reconstructed app paths.
- The event-logging and telemetry initialization paths in the sidepanel/shared state bundles are forced onto inert no-op branches.
- The tool-call logging hook in `assets/mcpPermissions-X6RKG-4F.js` was removed.
- The small analytics helper modules were rewritten as no-op shims:
  - `assets/auto-track-HG4Yyi0E.js`
  - `assets/index-D0tRRs6v.js`
  - `assets/index-c6gssFmU.js`

## Local validation

I validated the rewritten source with:

```bash
node --check background/service-worker.js
node --check background/service-worker-apis.js
node --check background/service-worker-native-host.js
node --check background/service-worker-bridge.js
node --check background/service-worker-control-plane.js
node --check assets/options-C9tM1CFy.js
node --check assets/sidepanel-p3pTyYhf.js
node --check assets/local-chrome-shim.js
node --check assets/index-D0tRRs6v.js
node --check assets/index-c6gssFmU.js
node --check assets/auto-track-HG4Yyi0E.js
node --check offscreen.js
node --check gif_viewer.js
```

I also checked the browser-facing pages in a live Chrome/DevTools session:

- `http://127.0.0.1:4173/options.html` rendered without console errors.
- `http://127.0.0.1:4173/sidepanel.html` rendered the login shell without console errors.

I also verified the selected Chrome profile directly with the bundled Chrome checks:

- Chrome is running.
- The extension is installed, registered, and enabled in the selected profile.
- The native messaging host manifest is present and matches the extension ID.

## Loading the extension

In a normal Chrome profile, load the repo unpacked from `chrome://extensions/` with Developer mode enabled and select the repository root.
The repo-side source is syntactically clean, the local dev-server shells render without errors, and the live Chrome verification in this session confirmed the extension options page, the `chrome://extensions` card, and the background service worker target all load successfully.
