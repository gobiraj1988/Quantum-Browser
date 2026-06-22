# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**MyBrowser** (repo name *Quantum-Browser*) is a private, AI-powered desktop
web browser built with **Electron**. It wraps web pages in `<webview>` tags and
layers on ad/tracker blocking, privacy hardening, a proxy/VPN, a media
downloader, an AI assistant, and an account system.

- **Runtime:** Electron `^42` (Chromium + Node.js). No framework, no bundler, no
  TypeScript. Plain ES2020 JavaScript, HTML, and CSS served directly from disk.
- **Entry point:** `main.js` (`"main"` in `package.json`).
- **No build step.** Source files are loaded as-is. There is nothing to compile.

## Running

```bash
npm install      # install Electron + deps (needs network)
npm start        # electron .
npm run dev      # electron . --enable-logging   (verbose console)
```

There is **no test suite, no linter, and no CI** configured. "Verifying" a
change means launching the app with `npm start` and exercising the feature by
hand. Do not claim tests pass — there are none.

> Note: this environment has two checked-out repos under `/home/user`:
> `Quantum-Browser` (this codebase) and `home` (currently **empty** — no
> commits). All real work lives here in `Quantum-Browser`.

## Process model (read this first)

Electron splits code across two worlds. Knowing which world a file runs in is
the single most important thing to get right.

| World | Runs in | Has Node/`require`? | Files |
|-------|---------|---------------------|-------|
| **Main process** | Node.js | Yes — `require('electron')`, `fs`, etc. | `main.js` and the modules it `require`s |
| **Renderer** (browser UI) | Chromium, `contextIsolation: true` | No — only `window.electronAPI` | `renderer.js`, `themes.js`, `context-menu.js`, the dynamically-loaded feature scripts, and `*.html` page scripts |
| **Webview content** | Chromium, per-tab guest pages | Injected scripts only | `youtube-fix.js`, `facebook-fix.js` (injected into guest pages) |

- The renderer **cannot** call Node APIs directly. It talks to the main process
  **only** through the `window.electronAPI` bridge defined in `preload.js`.
- Every renderer↔main feature follows the same three-part contract:
  1. `preload.js` exposes a method (`ipcRenderer.invoke`/`send`/`on`).
  2. A main-process module registers the matching `ipcMain.handle`/`ipcMain.on`.
  3. The renderer (or an HTML page) calls `window.electronAPI.<method>()`.
- **When adding any renderer→main capability, you must edit `preload.js` too** —
  otherwise the renderer has no way to reach it. This is the most common mistake.

## How the UI loads (lazy by design)

Startup is aggressively optimized; most code is deferred until first use.

- `index.html` is the browser shell. It eagerly loads only three scripts:
  `themes.js`, `renderer.js`, `context-menu.js`.
- A small inline loader at the bottom of `index.html` (`load(src)`) injects the
  heavier renderer features **on demand**:
  - AI sidebar (`ai-config.js` → `ai-sidebar.js`) — on first click of the AI button.
  - SEO analyzer (`seo-analyzer.js`) — on first click of the SEO button.
  - `translator.js`, `reading-mode.js`, `ai-tools.js` — on the first `url-changed` event.
- In the **main** process, `lazy-loader.js` does the same for heavy modules
  (`downloader`, `proxy`, `webrtc-blocker`, `fingerprint-spoofer`): registered at
  startup but `init()`-ed only after the window is shown (or when first needed).
- Other windows are standalone HTML pages opened by main-process modules:
  `login.html`, `register.html`, `otp-verify.html`, `download-manager.html`,
  `bulk-downloader.html`, `proxy-manager.html`, `adblocker-settings.html`,
  `adblock-stats.html`, `seo-panel.html`, `ai-sidebar.html`, `newtab.html`,
  `context-menu.html`.

## Key files

### Core shell
- `main.js` — app lifecycle, `BrowserWindow` factory, window-state persistence,
  global shortcuts, GPU/perf command-line switches, background security scanner,
  and the central wiring of every main-process module.
- `preload.js` — the **entire** `window.electronAPI` surface. Single source of
  truth for the renderer↔main contract.
- `renderer.js` — tab management (`<webview>` lifecycle, max 20 tabs), URL bar,
  navigation, toolbar. The heart of the UI.
- `index.html` / `styles.css` — shell markup and styling.
- `context-menu.js` / `context-menu.html` — right-click menu.
- `themes.js` — dark/light/system theme, loaded in `<head>` to avoid flash.
- `newtab.html` — new-tab page.

### Ad/tracker blocking — TWO stacks (important)
There are two independent ad-blocking implementations. **Only the first is
wired into `main.js`:**

1. **Active stack — `safe-adblocker.js`** — the Ghostery / uBlock-Origin engine
   (`@ghostery/adblocker-electron`). This is what actually runs (`main.js` calls
   `safeAdblocker.init(win)`). Plus the always-on cosmetic helpers
   `sponsorblock.js` (YouTube sponsor skip) and `facebook-hide.js` (CSS-only
   sponsored-post hiding).
2. **Dormant 7-layer "ultra" stack** — `ultra-adblocker.js` orchestrates
   `filter-engine.js`, `dns-blocker.js`, `css-injector.js`, `youtube-killer.js`,
   `facebook-killer.js`, `anti-adblock-bypass.js`, `filter-updater.js`,
   `filterlist.js`, `nuclear-mode.js`, `ad-injector.js`, `adblocker.js`,
   `youtube-fix.js`, `facebook-fix.js`. These require each other but are **not**
   currently referenced from `main.js` — they're an alternative/legacy engine.
   Don't assume changing them affects the running app; verify the wiring first.

The toolbar adblock toggle, settings panel, and stats page (`adblocker-settings.html`,
`adblock-stats.html`) talk to the active backend via `preload.js`.

### Privacy / network
- `privacy.js` — header stripping, HTTPS upgrade, tracking protection (uses
  `onBeforeSendHeaders`/`onHeadersReceived` to avoid clashing with the adblocker's
  `onBeforeRequest`).
- `proxy.js` + `proxy-rotator.js` + `proxy-manager.html` — SOCKS5h proxy/VPN
  (remote DNS, no local leak), multi-source proxy fetching and testing.
- `dns-protection.js`, `dns-cache.js`, `dns-blocker.js` — DNS-over-HTTPS, prefetch
  + fastest-resolver selection, hosts-file parsing.
- `webrtc-blocker.js` — strips `RTCPeerConnection` to stop IP leaks under VPN.
- `fingerprint-spoofer.js` — spoofs language/timezone/canvas when VPN is on.

### Downloads
- `downloader.js` — main-process download engine, uses **`yt-dlp-exec`** for
  media/video. `download-manager.js`/`.html` and `bulk-downloader.js`/`.html` are
  the renderer UIs.

### AI
- `ai-config.js` — free AI providers with auto-fallback (e.g. optional Groq free
  tier). `window.AiConfig.callAI(...)`. No user API key required by default.
- `ai-sidebar.js`/`.html`, `ai-tools.js` — chat sidebar and smart tools.

### Accounts / auth
- `auth-system.js` — main-process auth: session storage via Electron `safeStorage`,
  device IDs, brute-force throttling, login history, Google OAuth window.
- `supabase-config.js` — Supabase REST/auth client (project URL + anon key live
  here; the anon key is public-by-design but treat real secrets carefully).
- `login.html`, `register.html`, `otp-verify.html`, `password-validator.js`
  (local breached-password check + HIBP).

### Other features
- `seo-analyzer.js` / `seo-panel.html` — on-page SEO audit (reads webview DOM).
- `translator.js` — full-page translation (LibreTranslate → AI fallback).
- `reading-mode.js` — clean reader view + AI summary.
- `performance.js` — RAM/CPU/page-load monitor, pushes `perf-update` every 2s.

## Conventions

- **Style:** `'use strict'` at the top of every file. 2-space indent. Single
  quotes. Often no semicolons in newer main-process modules (aligned columns,
  boxed `// ───` section headers). **Match the style of the file you're editing**
  rather than imposing a global standard.
- **Module shape (main process):** each feature is a module exporting an
  `init(win)` (and sometimes more); `main.js` calls `init` once. Register IPC
  inside the module.
- **Module shape (renderer features):** most are IIFEs `(function(){ ... })()`
  that self-inject CSS/DOM and read the `window.electronAPI` / `window.AiConfig`
  bridges. They're loaded lazily, so guard against double-injection
  (`if (window.__x) return; window.__x = true`).
- **IPC naming:** kebab-case channels grouped by feature (`adblocker-*`,
  `dl-*`, `proxy-*`, `auth-*`, `privacy-*`, `ai-*`). Keep new channels consistent
  and mirror them in `preload.js`.
- **Performance first:** the app goes out of its way to defer work and never
  block navigation (e.g. the security scanner runs *after* `did-navigate`). Keep
  new startup/navigation work off the critical path; prefer the lazy loaders.
- **Persistence:** per-feature JSON files under `app.getPath('userData')` (e.g.
  `window-state.json`, `ultra-adblock-settings.json`). Use `userData`, never the
  repo dir.
- **Secrets:** `.env*` and API keys are git-ignored. Never commit private keys.
  Free/no-key services are preferred throughout (Cloudflare DNS, SponsorBlock,
  LibreTranslate, Groq free tier).

## Git workflow for this task

- Active development branch: **`claude/claude-md-docs-5l8h3x`** (already checked
  out). Develop here; create it locally if missing.
- Commit with clear messages and `git push -u origin claude/claude-md-docs-5l8h3x`.
- **Do not open a pull request** unless explicitly asked.
- Do not push to `master` or any other branch without explicit permission.

## Gotchas

- Renderer code has **no `require`** — go through `preload.js`.
- Editing a feature in the dormant ultra stack will have **no runtime effect**
  unless you also wire it into `main.js`; the active blocker is `safe-adblocker.js`.
- `<webview>` is enabled (`webviewTag: true`) but guest pages are isolated; reach
  into them with `webview.executeJavaScript(...)`, not direct DOM access.
- No build/test/lint: validate by running the app, and say so honestly.
