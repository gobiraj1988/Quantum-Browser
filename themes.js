'use strict'

/* ════════════════════════════════════════════════════════════════════════════
   themes.js — dark / light / system theme engine for MyBrowser
   ────────────────────────────────────────────────────────────────────────────
   Loaded in the <head> so the theme is applied BEFORE the first paint
   (no white flash for light-mode users).

   How it works
   ------------
   • The chosen MODE is one of: 'dark' | 'light' | 'system'  (default 'dark').
   • It is saved in localStorage under the key  "mybrowser-theme".
   • The RESOLVED theme ('dark' or 'light') is written to
     <html data-theme="...">. styles.css swaps every colour from that.
   • 'system' follows the operating system and updates live if the OS changes.
   ════════════════════════════════════════════════════════════════════════════ */

;(function () {

  const STORE_KEY = 'mybrowser-theme'
  const root      = document.documentElement
  const media     = window.matchMedia('(prefers-color-scheme: dark)')

  // ── Read the saved mode (falls back to 'dark') ──────────────────────────
  function savedMode() {
    try {
      const m = localStorage.getItem(STORE_KEY)
      if (m === 'dark' || m === 'light' || m === 'system') return m
    } catch (_) {}
    return 'dark'
  }

  // ── Turn a mode into a concrete theme ───────────────────────────────────
  function resolve(mode) {
    if (mode === 'system') return media.matches ? 'dark' : 'light'
    return mode
  }

  // ── Apply a mode to the document ────────────────────────────────────────
  function apply(mode) {
    root.dataset.theme     = resolve(mode)   // 'dark' | 'light'  → styles.css
    root.dataset.themeMode = mode            // 'dark' | 'light' | 'system'
  }

  // Apply immediately — runs while <head> is parsing, before any paint.
  apply(savedMode())

  // ── Change the mode (used by the toolbar menu) ──────────────────────────
  function setMode(mode) {
    try { localStorage.setItem(STORE_KEY, mode) } catch (_) {}
    apply(mode)
    refreshMenu(mode)
    refreshButtonIcon()
  }

  // Live-update when the OS theme changes (only matters in 'system' mode).
  media.addEventListener('change', () => {
    if (savedMode() === 'system') { apply('system'); refreshButtonIcon() }
  })

  // Expose a tiny API in case other scripts want it.
  window.Themes = {
    get:      savedMode,
    resolved: () => resolve(savedMode()),
    set:      setMode,
  }

  // ── Toolbar button + popup menu wiring ──────────────────────────────────

  function refreshMenu(mode) {
    document.querySelectorAll('.theme-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeMode === mode)
    })
  }

  function refreshButtonIcon() {
    const btn = document.getElementById('btn-theme')
    if (!btn) return
    const sun  = btn.querySelector('.theme-icon-sun')
    const moon = btn.querySelector('.theme-icon-moon')
    if (!sun || !moon) return
    const isDark = resolve(savedMode()) === 'dark'
    moon.style.display = isDark ? 'block' : 'none'
    sun.style.display  = isDark ? 'none'  : 'block'
  }

  function wire() {
    const btn  = document.getElementById('btn-theme')
    const menu = document.getElementById('theme-menu')
    if (!btn || !menu) return

    refreshMenu(savedMode())
    refreshButtonIcon()

    // Toggle the menu open/closed
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = menu.classList.toggle('open')
      btn.classList.toggle('panel-open', open)
    })

    // Pick a mode
    menu.querySelectorAll('.theme-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation()
        setMode(opt.dataset.themeMode)
        menu.classList.remove('open')
        btn.classList.remove('panel-open')
      })
    })

    // Click anywhere else closes the menu
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.classList.remove('open')
        btn.classList.remove('panel-open')
      }
    })
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', wire)
  else
    wire()

})()
