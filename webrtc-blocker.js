'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  WEBRTC-BLOCKER.JS
//  Injects a script into every page that removes RTCPeerConnection and related
//  APIs so WebRTC cannot leak the real IP when VPN is connected.
// ─────────────────────────────────────────────────────────────────────────────

const { app, webContents } = require('electron')

// Script injected into every page — disables all WebRTC APIs
const BLOCK_SCRIPT = /* js */`(function(){
  'use strict'
  if (window.__webrtcBlocked) return
  window.__webrtcBlocked = true

  var noop = function() {}
  var props = [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'mozRTCPeerConnection',
    'RTCDataChannel',
    'RTCSessionDescription',
    'RTCIceCandidate',
    'RTCDTMFSender',
    'RTCStatsReport',
  ]
  props.forEach(function(p) {
    try { Object.defineProperty(window, p, { get: function() { return undefined }, configurable: false }) } catch(_) {}
  })

  // Block mediaDevices (used for WebRTC getUserMedia)
  try {
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        get: function() { return { getUserMedia: noop, enumerateDevices: noop } },
        configurable: false,
      })
    }
  } catch(_) {}

  // Intercept any dynamic creation attempt
  try {
    window.RTCPeerConnection   = undefined
    window.RTCDataChannel      = undefined
    window.webkitRTCPeerConnection = undefined
  } catch(_) {}
})()`

// Script to restore WebRTC (best-effort — page refresh is the reliable restore)
const RESTORE_SCRIPT = /* js */`(function(){
  delete window.__webrtcBlocked
})()`

let enabled     = false
let alreadyInit = false

// ─── Init (call once from main.js before any windows open) ───────────────────

function init() {
  if (alreadyInit) return
  alreadyInit = true

  app.on('web-contents-created', (_, wc) => {
    wc.on('dom-ready', () => {
      const url = wc.getURL()
      if (url.startsWith('devtools://') || url.startsWith('chrome-extension://')) return
      if (enabled) wc.executeJavaScript(BLOCK_SCRIPT).catch(() => {})
    })
  })

  console.log('[WebRTC] Blocker initialised')
}

// ─── Enable — injects into all existing webContents immediately ───────────────

function enable() {
  enabled = true
  webContents.getAllWebContents().forEach(wc => {
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (url.startsWith('devtools://') || !url.startsWith('http')) return
    wc.executeJavaScript(BLOCK_SCRIPT).catch(() => {})
  })
  console.log('[WebRTC] Blocking ON — RTCPeerConnection disabled in all pages')
}

// ─── Disable ──────────────────────────────────────────────────────────────────
// Note: the block cannot be fully reversed in already-loaded pages without
// a refresh (Object.defineProperty with configurable:false is permanent).
// New navigations will load without the block script.

function disable() {
  enabled = false
  console.log('[WebRTC] Blocking OFF — refresh pages to fully restore WebRTC')
}

function isEnabled() { return enabled }

module.exports = { init, enable, disable, isEnabled }
