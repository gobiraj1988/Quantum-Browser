'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  LAZY-LOADER.JS  —  Deferred module initialization for the main process.
//  Heavy modules (proxy, downloader, VPN) are registered here but their
//  init() is only called when actually needed, keeping startup fast.
// ─────────────────────────────────────────────────────────────────────────────

const registry = new Map()   // name -> { factory, module, ready }

// Register a module with its loader factory.
// factory = () => require('./some-module')
function register(name, factory) {
  registry.set(name, { factory, module: null, ready: false })
}

// Load (if not loaded) and init (if not inited) the module.
// Extra args are forwarded to module.init(...args).
// Returns the module instance.
function init(name, ...args) {
  const entry = registry.get(name)
  if (!entry) { console.warn('[LazyLoader] Unknown module:', name); return null }

  if (!entry.module) {
    try {
      entry.module = entry.factory()
    } catch (e) {
      console.error('[LazyLoader] Failed to load:', name, e.message)
      return null
    }
  }

  if (!entry.ready && typeof entry.module.init === 'function') {
    try {
      entry.module.init(...args)
      entry.ready = true
    } catch (e) {
      console.error('[LazyLoader] Failed to init:', name, e.message)
    }
  }

  return entry.module
}

// Get the module instance if already loaded, or null.
function get(name) {
  return registry.get(name)?.module ?? null
}

// Check whether a module has been loaded AND inited.
function isReady(name) {
  return registry.get(name)?.ready === true
}

module.exports = { register, init, get, isReady }
