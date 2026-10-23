# Quantum Browser for Android

A native Android browser for Quantum, built to match Brave's premium privacy features. It's written in Kotlin
on the plain Android framework (no AndroidX or third-party libraries), which keeps the APK small and
cold start fast.

## Features

| Feature | What it does |
|---|---|
| **Shields** (per site) | Blocks ads and trackers at the network level using EasyList, EasyPrivacy, StevenBlack hosts and Peter Lowe's list. These are downloaded in the background and refreshed every 24 h; a bundled starter list works offline from the first launch. The toolbar badge counts what was blocked on the current page. |
| Blocking modes | **Standard** blocks third-party trackers and keeps sites working. **Aggressive** also blocks first-party trackers. **Off** disables blocking. |
| HTTPS upgrade | Upgrades `http://` to `https://` automatically. If a site has no working HTTPS, it falls back to HTTP for that site. |
| Fingerprint protection | Adds per-session noise to canvas, WebGL and audio reads and reports generic hardware values. |
| WebRTC leak protection | Routes WebRTC through relay servers so your real IP stays hidden. |
| Cookie controls | Blocks cross-site cookies, hides cookie consent banners, and sends Global Privacy Control (`Sec-GPC`). |
| Cosmetic filtering | Hides leftover empty ad boxes (Taboola, Outbrain, AdSense and others). |
| Pop-up blocker | Blocks pop-ups that open without a user tap. |
| Script blocker | Blocks JavaScript on a site you choose, from the Shields panel. |
| Private tabs | Keep no history, cache or form data, with a purple UI. Long-press **＋** to open one. |
| Quantum AI | A page assistant like Brave Leo: summarize the page or ask questions about it. It uses your own Anthropic API key, and page text is sent only when you ask. |
| New tab page | Shows trackers blocked, bandwidth saved and time saved, plus a search box and speed dial. |
| Browsing tools | Tabs (restored on launch), bookmarks, history with URL-bar suggestions, a download manager, reader mode, night mode for pages, desktop site, find in page, share, and full-screen video. |
| Default browser | Can be set as Android's default browser. It also handles shared text and web searches. |
| Privacy defaults | Optional clear-on-exit. Backups are disabled, so browsing data never leaves the device. Bad TLS certificates are never bypassed. |

Search engines: Brave Search (default), DuckDuckGo, Startpage, Google, Bing.

## Build

Requirements: JDK 17 and the Android SDK (platform 36). Android Studio Ladybug or newer works.

```bash
cd android
./gradlew testDebugUnitTest      # unit tests (filter engine + bundled list)
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug           # install on a connected device
```

On Windows, use `gradlew.bat` instead.

Each push also builds a debug APK in GitHub Actions (`.github/workflows/android.yml`). Download it from the
run's **Artifacts** section.

### Release signing

Release builds are signed using these environment variables, so the keystore is never committed:
`QUANTUM_KEYSTORE`, `QUANTUM_KEYSTORE_PASSWORD`, `QUANTUM_KEY_ALIAS`, `QUANTUM_KEY_PASSWORD`. Then run:

```bash
./gradlew bundleRelease    # .aab for the Play Store (R8 minify + resource shrinking on)
```

## Code map

```
app/src/main/java/com/quantum/browser/
  MainActivity.kt        browser UI: URL bar, tabs, menus, Shields panel, downloads, permissions
  BrowserTab.kt          one WebView: Shields client (blocking, HTTPS upgrade, injection), chrome client
  NewTabPage.kt          stats + search + speed dial page
  SettingsActivity.kt    all settings
  shields/FilterMatcher  pure-Kotlin filter engine (unit tested)
  shields/Shields        list loading and daily updates
  shields/PrivacyScripts fingerprint, WebRTC, GPC, cosmetic, cookie-banner, reader-mode scripts
  ai/QuantumAi           Claude Messages API client
  data/                  settings, bookmarks, history, stats
```

## Known limits

These come from Android System WebView and would need a different engine or extra libraries to fix:

- **Private tabs share cookies with normal tabs.** WebView has one cookie store per app. Fully isolated
  profiles need the `androidx.webkit` Profile API.
- **Privacy scripts run at page start, not before the page's own scripts.** A tracker that runs very
  early can still read real values. Injecting at document start needs `androidx.webkit`.
- **Network blocking is by domain.** Path-based and cosmetic `##` rules from EasyList are skipped, except
  for the built-in cosmetic CSS.
- **No built-in VPN.** The desktop app's proxy and VPN features aren't ported.
