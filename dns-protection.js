'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  DNS-PROTECTION.JS
//  • Builds socks5h proxy rules (proxy handles DNS — no local DNS leak)
//  • Enables DNS-over-HTTPS (DoH) when Electron supports it
//  • Injects Accept-Language / spoof headers via onBeforeSendHeaders
//  • Exports country data used by fingerprint-spoofer.js
// ─────────────────────────────────────────────────────────────────────────────

const { session } = require('electron')

// ─── Country data ─────────────────────────────────────────────────────────────
// tzOffset = minutes WEST of UTC (JS Date.getTimezoneOffset convention)
//   UTC-5 (US East) = +300    UTC+1 (EU) = -60    UTC+9 (Tokyo) = -540

const COUNTRY_DATA = {
  US: { lang: 'en-US', tz: 'America/New_York',    tzOffset:  300,  lat:  40.7128, lon:  -74.0060 },
  GB: { lang: 'en-GB', tz: 'Europe/London',       tzOffset:    0,  lat:  51.5074, lon:   -0.1278 },
  UK: { lang: 'en-GB', tz: 'Europe/London',       tzOffset:    0,  lat:  51.5074, lon:   -0.1278 },
  DE: { lang: 'de-DE', tz: 'Europe/Berlin',       tzOffset:  -60,  lat:  52.5200, lon:   13.4050 },
  NL: { lang: 'nl-NL', tz: 'Europe/Amsterdam',    tzOffset:  -60,  lat:  52.3702, lon:    4.8952 },
  FR: { lang: 'fr-FR', tz: 'Europe/Paris',        tzOffset:  -60,  lat:  48.8566, lon:    2.3522 },
  CA: { lang: 'en-CA', tz: 'America/Toronto',     tzOffset:  300,  lat:  43.6532, lon:  -79.3832 },
  AU: { lang: 'en-AU', tz: 'Australia/Sydney',    tzOffset: -600,  lat: -33.8688, lon:  151.2093 },
  JP: { lang: 'ja-JP', tz: 'Asia/Tokyo',          tzOffset: -540,  lat:  35.6762, lon:  139.6503 },
  SG: { lang: 'en-SG', tz: 'Asia/Singapore',      tzOffset: -480,  lat:   1.3521, lon:  103.8198 },
  SE: { lang: 'sv-SE', tz: 'Europe/Stockholm',    tzOffset:  -60,  lat:  59.3293, lon:   18.0686 },
  CH: { lang: 'de-CH', tz: 'Europe/Zurich',       tzOffset:  -60,  lat:  47.3769, lon:    8.5417 },
  HK: { lang: 'zh-HK', tz: 'Asia/Hong_Kong',      tzOffset: -480,  lat:  22.3193, lon:  114.1694 },
  BR: { lang: 'pt-BR', tz: 'America/Sao_Paulo',   tzOffset:  180,  lat: -23.5505, lon:  -46.6333 },
  IN: { lang: 'en-IN', tz: 'Asia/Kolkata',        tzOffset: -330,  lat:  28.6139, lon:   77.2090 },
  RU: { lang: 'ru-RU', tz: 'Europe/Moscow',       tzOffset: -180,  lat:  55.7558, lon:   37.6176 },
}

const DEFAULT_COUNTRY = COUNTRY_DATA.US

// EU countries — use Quad9/Swiss DoH (GDPR-friendly)
const EU_SET = new Set(['DE', 'FR', 'NL', 'SE', 'CH', 'AT', 'BE', 'PL', 'IT', 'ES', 'PT', 'FI', 'DK', 'NO'])

// ─── Build proxy rule ─────────────────────────────────────────────────────────
// socks5h = SOCKS5 with REMOTE hostname resolution.
// The proxy server resolves DNS, not your local machine.
// This is THE critical fix for DNS leaks through SOCKS5 proxies.

function buildProxyRule(proxy) {
  if (!proxy) return 'direct://'
  const type = proxy.type === 'http' ? 'http' : 'socks5h'
  return `${type}=${proxy.ip}:${proxy.port}`
}

// ─── DoH helper ───────────────────────────────────────────────────────────────

function getDohServer(countryCode) {
  if (EU_SET.has(countryCode)) {
    return 'https://dns.digitale-gesellschaft.ch/dns-query'  // Swiss, GDPR-compliant
  }
  return 'https://cloudflare-dns.com/dns-query'
}

// ─── Get country data (normalises to 2-letter code) ──────────────────────────

function getCountryData(raw) {
  if (!raw) return DEFAULT_COUNTRY
  const code = String(raw).slice(0, 2).toUpperCase()
  return COUNTRY_DATA[code] || DEFAULT_COUNTRY
}

// ─── State ────────────────────────────────────────────────────────────────────

let headerListenerActive = false
let activeDns            = null   // currently active DoH server string

// ─── Enable ───────────────────────────────────────────────────────────────────

function enable(countryCode) {
  const code = String(countryCode || 'US').slice(0, 2).toUpperCase()
  const data = COUNTRY_DATA[code] || DEFAULT_COUNTRY
  const doh  = getDohServer(code)
  activeDns  = doh

  // ── DNS-over-HTTPS (Electron 22+) ──────────────────────────────────────────
  try {
    if (typeof session.defaultSession.setDnsoverHttpsMode === 'function') {
      session.defaultSession.setDnsoverHttpsMode('secure', { server: doh })
      console.log('[DNS] DoH enabled →', doh)
    } else {
      console.log('[DNS] DoH API not available in this Electron build')
    }
  } catch (e) {
    console.log('[DNS] DoH setup error:', e.message)
  }

  // ── Accept-Language header spoofing ───────────────────────────────────────
  if (headerListenerActive) {
    try { session.defaultSession.webRequest.onBeforeSendHeaders(null) } catch (_) {}
  }
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = Object.assign({}, details.requestHeaders)
      headers['Accept-Language'] = data.lang + ',en;q=0.9'
      callback({ requestHeaders: headers })
    }
  )
  headerListenerActive = true

  console.log(`[DNS] Country: ${code} | lang: ${data.lang} | tz: ${data.tz}`)
  return { data, doh }
}

// ─── Disable ──────────────────────────────────────────────────────────────────

function disable() {
  activeDns = null
  try {
    if (typeof session.defaultSession.setDnsoverHttpsMode === 'function') {
      session.defaultSession.setDnsoverHttpsMode('off')
    }
  } catch (_) {}
  if (headerListenerActive) {
    try { session.defaultSession.webRequest.onBeforeSendHeaders(null) } catch (_) {}
    headerListenerActive = false
  }
  console.log('[DNS] Protection disabled')
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getStatus() {
  return { active: headerListenerActive, dnsServer: activeDns || '(system default)' }
}

module.exports = { buildProxyRule, getCountryData, enable, disable, getStatus }
