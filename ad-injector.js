'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  AD-INJECTOR.JS  —  Injects platform-specific ad-block scripts into webviews
//  Hooks into web-contents-created so every tab gets scripts on dom-ready.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('electron')
const path    = require('path')
const fs      = require('fs')

let alreadyInit = false
let ytScript    = null   // loaded once from youtube-fix.js
let fbScript    = null   // loaded once from facebook-fix.js

// ─── Script loader ────────────────────────────────────────────────────────────

function loadScripts () {
  const load = (file) => {
    try {
      return fs.readFileSync(path.join(__dirname, file), 'utf8')
    } catch (e) {
      console.error(`[AdInjector] Cannot read ${file}:`, e.message)
      return null
    }
  }
  ytScript = load('youtube-fix.js')
  fbScript = load('facebook-fix.js')
  console.log(`[AdInjector] Loaded: youtube=${ytScript ? 'ok' : 'FAIL'}, facebook=${fbScript ? 'ok' : 'FAIL'}`)
}

// ─── Inject the right script based on URL ────────────────────────────────────

function injectForUrl (wc, url) {
  if (!url || !url.startsWith('http')) return
  try {
    if (wc.isDestroyed()) return
    if ((url.includes('youtube.com') || url.includes('youtu.be')) && ytScript) {
      wc.executeJavaScript(ytScript).catch(() => {})
    } else if (url.includes('facebook.com') && fbScript) {
      wc.executeJavaScript(fbScript).catch(() => {})
    }
  } catch (_) {}
}

// ─── Public init ─────────────────────────────────────────────────────────────

function init () {
  if (alreadyInit) return
  alreadyInit = true

  loadScripts()

  app.on('web-contents-created', (_, wc) => {

    // Inject on full page load (dom-ready = main frame document is ready)
    wc.on('dom-ready', () => {
      injectForUrl(wc, wc.getURL())
    })

    // Inject on SPA navigation (YouTube uses pushState between videos)
    // isMainFrame guard avoids running on iframe navigations
    wc.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame) injectForUrl(wc, url)
    })
  })
}

module.exports = { init }
