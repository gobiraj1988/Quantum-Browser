'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  dns-blocker.js  —  Layer 2: Parse hosts-format files into the filter engine
//
//  StevenBlack/hosts and similar files list ad/tracker domains in the format:
//    0.0.0.0 ads.example.com
//    127.0.0.1 tracker.example.com
//    # comment
//
//  This module parses those files and bulk-loads the domains into filter-engine.
//  Also handles AdBlock Plus domain-only lines (||domain.com^).
// ═══════════════════════════════════════════════════════════════════════════════

const filterEngine = require('./filter-engine')

// ── Parse a hosts-format file (StevenBlack, etc.) ────────────────────────────

function parseHostsFile (text) {
  const domains = []
  const lines = text.split('\n')

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line[0] === '#') continue

    const parts = line.split(/\s+/)
    if (parts.length < 2) continue

    const ip     = parts[0]
    const domain = parts[1].toLowerCase()

    // Only accept 0.0.0.0 or 127.0.0.1 redirect entries
    if (ip !== '0.0.0.0' && ip !== '127.0.0.1') continue
    // Skip localhost and broadcast
    if (domain === 'localhost' || domain === '0.0.0.0' ||
        domain === '127.0.0.1' || domain === 'broadcasthost') continue
    // Must have a real TLD
    if (!domain.includes('.') || domain.includes('*')) continue

    domains.push(domain)
  }

  return domains
}

// ── Parse an AdBlock Plus filter list (EasyList, EasyPrivacy, etc.) ───────────
// Extracts domain-only rules (||domain.com^) — these are safe to add to the
// domain Set. URL-pattern rules are compiled and added as patterns.

function parseAdBlockList (text) {
  const domains  = []
  const patterns = []
  const lines    = text.split('\n')

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line[0] === '!' || line[0] === '[') continue
    if (line.startsWith('@@')) continue  // whitelist rules — skip
    if (line.startsWith('#@#') || line.startsWith('##')) continue  // CSS only
    if (line.startsWith('#?#')) continue  // extended CSS

    // Domain rule: ||domain.com^ (no path = block entire domain)
    if (line.startsWith('||') && line.endsWith('^') && !line.includes('/')) {
      let domain = line.slice(2, -1).toLowerCase()
      // Strip option suffixes (e.g., ^$third-party)
      const dollar = domain.indexOf('$')
      if (dollar > 0) domain = domain.slice(0, dollar).replace(/\^$/, '')
      if (domain && domain.includes('.') && !domain.includes('*') && !domain.includes('/')) {
        domains.push(domain)
      }
      continue
    }

    // Skip pure CSS element hiding rules
    if (line.includes('##') || line.includes('#@#')) continue

    // URL pattern: add as a pattern (these block specific paths)
    // Only add patterns that look like real URL filters to keep the list small
    if ((line.startsWith('||') || line.startsWith('|') || line.includes('*')) &&
        !line.includes('##')) {
      patterns.push(line)
    }
  }

  return { domains, patterns }
}

// ── Load parsed data into the filter engine ───────────────────────────────────

function loadHostsText (text, source) {
  const domains = parseHostsFile(text)
  filterEngine.addDomains(domains)
  console.log(`[DNS-Blocker] ${source}: loaded ${domains.length.toLocaleString()} domains`)
  return domains.length
}

function loadAdBlockText (text, source) {
  const { domains, patterns } = parseAdBlockList(text)
  filterEngine.addDomains(domains)
  // Only add URL patterns from curated lists (EasyList can have 60k+ patterns
  // which would slow down the regex check). We add a limited set.
  const patternSlice = patterns.slice(0, 3000)
  filterEngine.addPatterns(patternSlice)
  console.log(`[DNS-Blocker] ${source}: loaded ${domains.length.toLocaleString()} domains + ${patternSlice.length} patterns`)
  return { domainCount: domains.length, patternCount: patternSlice.length }
}

// ── Smart pattern learner (Layer 7 heuristics) ────────────────────────────────
// When a domain is blocked repeatedly, auto-learn related subdomain patterns.

const learnedPatterns = new Map() // base-domain → hit count

function learnFromBlock (hostname) {
  if (!hostname) return
  const parts = hostname.split('.')
  if (parts.length < 2) return
  const base = parts.slice(-2).join('.')  // e.g., ads.com from sub.ads.com

  const count = (learnedPatterns.get(base) || 0) + 1
  learnedPatterns.set(base, count)

  // After 3 blocks from the same base, auto-add pattern for all subdomains
  if (count === 3) {
    filterEngine.addDomain(base)
    console.log(`[DNS-Blocker] Smart-learned: ${base} (pattern threshold reached)`)
  }
}

module.exports = { parseHostsFile, parseAdBlockList, loadHostsText, loadAdBlockText, learnFromBlock }
