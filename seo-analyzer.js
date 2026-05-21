'use strict'
// ════════════════════════════════════════════════════════════════════════════
//  SEO Analyzer — live, on-page SEO audit for MyBrowser
//  ----------------------------------------------------------------------------
//  Runs entirely in the renderer. It reads the active <webview>'s DOM with
//  executeJavaScript(), scores the page 0–100, and auto-refreshes whenever the
//  page changes (the renderer fires a 'url-changed' event on every navigation).
// ════════════════════════════════════════════════════════════════════════════
;(async function () {

  // Guard against being injected twice
  if (window.__seoAnalyzerLoaded) return
  window.__seoAnalyzerLoaded = true

  // ── 1. Build the panel and drop it into the main area ──────────────────────

  const panel = document.createElement('div')
  panel.id = 'seo-panel'

  try {
    const res  = await fetch('./seo-panel.html')
    const html = await res.text()
    // Strip the leading HTML comment, keep <style> + markup
    panel.innerHTML = html.replace(/^<!--.*?-->\n?/s, '')
  } catch (_) {
    // Minimal fallback if the HTML file can't be fetched
    panel.innerHTML =
      '<div class="seo-header"><span class="seo-title">SEO Analyzer</span>' +
      '<button class="seo-icon-btn" id="seo-reanalyze-btn">↻</button>' +
      '<button class="seo-icon-btn" id="seo-close-btn">✕</button></div>' +
      '<div class="seo-body" id="seo-body"></div>'
  }

  document.getElementById('main-area').appendChild(panel)

  // ── 2. DOM references ──────────────────────────────────────────────────────

  const btnSeo   = document.getElementById('btn-seo')
  const closeBtn = document.getElementById('seo-close-btn')
  const reBtn    = document.getElementById('seo-reanalyze-btn')
  const bodyEl   = document.getElementById('seo-body')

  // ── 3. State ───────────────────────────────────────────────────────────────

  let isOpen       = false
  let analyzing    = false
  let hasReport    = false
  let retryCount   = 0
  let analyzeTimer = null

  // ── 4. Helpers ─────────────────────────────────────────────────────────────

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // The currently-visible webview (the active tab)
  function getActiveWebview () {
    return Array.from(document.querySelectorAll('#webview-stack webview'))
      .find(wv => wv.style.display === 'flex')
      || document.querySelector('#webview-stack webview')
  }

  function setReBtnSpinning (on) {
    if (reBtn) reBtn.classList.toggle('seo-spin', !!on)
  }

  // ── 5. The probe — this function is sent INTO the page and run there ───────
  //  It must be fully self-contained (no references to anything outside it),
  //  because it is stringified with .toString() and executed in the webview.

  function pageProbe () {
    var data = {}
    data.url        = location.href
    data.protocol   = location.protocol
    data.readyState = document.readyState

    // Title tag
    var t = document.querySelector('title')
    data.title       = t ? (t.textContent || '').replace(/\s+/g, ' ').trim() : ''
    data.titleLength = data.title.length

    // Meta description
    var md = document.querySelector('meta[name="description"]') ||
             document.querySelector('meta[property="og:description"]')
    data.metaDescription = md ? (md.getAttribute('content') || '').trim() : ''
    data.metaDescLength  = data.metaDescription.length

    // Headings (H1 / H2 / H3)
    function grab (sel) {
      var out = [], els = document.querySelectorAll(sel)
      for (var i = 0; i < els.length; i++) {
        var txt = (els[i].textContent || '').replace(/\s+/g, ' ').trim()
        if (txt) out.push(txt)
      }
      return out
    }
    var h1 = grab('h1'), h2 = grab('h2'), h3 = grab('h3')
    data.h1Count = h1.length
    data.h2Count = h2.length
    data.h3Count = h3.length
    data.h1List  = h1.slice(0, 4)
    data.h2List  = h2.slice(0, 5)
    data.h3List  = h3.slice(0, 4)

    // Images & alt text
    var imgs = document.querySelectorAll('img'), withAlt = 0
    for (var j = 0; j < imgs.length; j++) {
      var alt = imgs[j].getAttribute('alt')
      if (alt !== null && alt.trim() !== '') withAlt++
    }
    data.imagesTotal      = imgs.length
    data.imagesWithAlt    = withAlt
    data.imagesWithoutAlt = imgs.length - withAlt

    // Mobile-friendly (responsive viewport tag)
    var vp = document.querySelector('meta[name="viewport"]')
    data.hasViewport     = !!vp
    data.viewportContent = vp ? (vp.getAttribute('content') || '') : ''

    // Page load speed in milliseconds (Navigation Timing API)
    var loadMs = 0
    try {
      var nav = (performance.getEntriesByType('navigation') || [])[0]
      if (nav && nav.loadEventEnd > 0) {
        loadMs = Math.round(nav.loadEventEnd)
      } else if (performance.timing && performance.timing.loadEventEnd > 0) {
        loadMs = performance.timing.loadEventEnd - performance.timing.navigationStart
      } else if (nav && nav.domContentLoadedEventEnd > 0) {
        loadMs = Math.round(nav.domContentLoadedEventEnd)
      }
    } catch (e) {}
    data.loadTimeMs = loadMs > 0 ? loadMs : 0

    // Word count + keyword density
    var STOP = ('a an the and or but if then else of to in on at by for with as ' +
      'is are was were be been being it its this that these those i you he she ' +
      'we they them his her our your their my me him us do does did has have had ' +
      'not no so up out about into over after under can will would should could ' +
      'just than too very all any more most some such only own same here there ' +
      'when where who whom which what how why from off again once each few new ' +
      'get got also use using one two three not yes via per').split(' ')
    var stop = {}
    for (var s = 0; s < STOP.length; s++) stop[STOP[s]] = true

    var clone = document.body ? document.body.cloneNode(true) : null
    var text  = ''
    if (clone) {
      var junk = clone.querySelectorAll('script,style,noscript,svg,template')
      for (var k = 0; k < junk.length; k++) {
        if (junk[k].parentNode) junk[k].parentNode.removeChild(junk[k])
      }
      text = clone.innerText || clone.textContent || ''
    }
    var words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    var wordCount = 0, freq = {}
    for (var w = 0; w < words.length; w++) {
      var word = words[w]
      if (!word) continue
      wordCount++
      if (word.length < 3) continue
      if (stop[word]) continue
      if (/^[0-9]+$/.test(word)) continue
      freq[word] = (freq[word] || 0) + 1
    }
    data.wordCount = wordCount

    var pairs = []
    for (var key in freq) {
      if (freq.hasOwnProperty(key)) pairs.push([key, freq[key]])
    }
    pairs.sort(function (a, b) { return b[1] - a[1] })
    data.keywords = []
    for (var p = 0; p < Math.min(10, pairs.length); p++) {
      data.keywords.push({
        word:    pairs[p][0],
        count:   pairs[p][1],
        density: wordCount > 0 ? (pairs[p][1] / wordCount * 100) : 0
      })
    }

    return data
  }

  // ── 6. Scoring — turn raw data into nine checks that total 100 points ──────

  function mk (label, status, detail, pts, max) {
    return { label: label, status: status, detail: detail, pts: pts, max: max }
  }

  function buildChecks (d) {
    const checks = []

    // HTTPS — 15 pts
    if (d.protocol === 'https:') {
      checks.push(mk('HTTPS', 'good', 'Served securely over HTTPS', 15, 15))
    } else {
      checks.push(mk('HTTPS', 'bad', 'Not served over HTTPS — not secure', 0, 15))
    }

    // Title tag — 15 pts
    if (d.titleLength === 0) {
      checks.push(mk('Title Tag', 'bad', 'No <title> tag found', 0, 15))
    } else if (d.titleLength >= 30 && d.titleLength <= 60) {
      checks.push(mk('Title Tag', 'good', d.titleLength + ' characters — ideal length', 15, 15))
    } else {
      checks.push(mk('Title Tag', 'warn',
        d.titleLength + ' characters — aim for 30–60', 7, 15))
    }

    // Meta description — 15 pts
    if (d.metaDescLength === 0) {
      checks.push(mk('Meta Description', 'bad', 'No meta description found', 0, 15))
    } else if (d.metaDescLength >= 70 && d.metaDescLength <= 160) {
      checks.push(mk('Meta Description', 'good',
        d.metaDescLength + ' characters — ideal length', 15, 15))
    } else {
      checks.push(mk('Meta Description', 'warn',
        d.metaDescLength + ' characters — aim for 70–160', 7, 15))
    }

    // H1 heading — 15 pts
    if (d.h1Count === 1) {
      checks.push(mk('H1 Heading', 'good', 'Exactly one H1 — perfect', 15, 15))
    } else if (d.h1Count === 0) {
      checks.push(mk('H1 Heading', 'bad', 'No H1 heading on the page', 0, 15))
    } else {
      checks.push(mk('H1 Heading', 'warn', d.h1Count + ' H1 tags — use only one', 7, 15))
    }

    // Image alt text — 10 pts
    if (d.imagesTotal === 0) {
      checks.push(mk('Image Alt Text', 'good', 'No images to check', 10, 10))
    } else if (d.imagesWithoutAlt === 0) {
      checks.push(mk('Image Alt Text', 'good',
        'All ' + d.imagesTotal + ' images have alt text', 10, 10))
    } else if (d.imagesWithAlt > 0) {
      const pts = Math.round(10 * d.imagesWithAlt / d.imagesTotal)
      checks.push(mk('Image Alt Text', 'warn',
        d.imagesWithoutAlt + ' of ' + d.imagesTotal + ' images missing alt text', pts, 10))
    } else {
      checks.push(mk('Image Alt Text', 'bad',
        'All ' + d.imagesTotal + ' images missing alt text', 0, 10))
    }

    // Mobile friendly — 10 pts
    if (d.hasViewport) {
      checks.push(mk('Mobile Friendly', 'good', 'Responsive viewport tag present', 10, 10))
    } else {
      checks.push(mk('Mobile Friendly', 'bad', 'No viewport meta tag', 0, 10))
    }

    // Page load speed — 10 pts
    if (d.loadTimeMs === 0) {
      checks.push(mk('Page Load Speed', 'warn', 'Measuring…', 7, 10))
    } else if (d.loadTimeMs <= 1500) {
      checks.push(mk('Page Load Speed', 'good', d.loadTimeMs + ' ms — very fast', 10, 10))
    } else if (d.loadTimeMs <= 3000) {
      checks.push(mk('Page Load Speed', 'warn', d.loadTimeMs + ' ms — moderate', 7, 10))
    } else {
      checks.push(mk('Page Load Speed', 'bad', d.loadTimeMs + ' ms — slow', 3, 10))
    }

    // Word count — 10 pts
    if (d.wordCount >= 300) {
      checks.push(mk('Word Count', 'good', d.wordCount + ' words — good depth', 10, 10))
    } else if (d.wordCount >= 150) {
      checks.push(mk('Word Count', 'warn', d.wordCount + ' words — a little thin', 6, 10))
    } else {
      checks.push(mk('Word Count', 'bad', d.wordCount + ' words — very thin content', 3, 10))
    }

    return checks
  }

  // ── 7. Rendering ───────────────────────────────────────────────────────────

  const ICON = { good: '✓', warn: '!', bad: '✕' }

  function render (d) {
    const checks = buildChecks(d)
    let score = 0
    checks.forEach(c => { score += c.pts })
    score = Math.max(0, Math.min(100, Math.round(score)))

    const tier =
      score >= 80 ? { color: '#34d399', label: 'Excellent', sub: 'This page is well optimised' } :
      score >= 60 ? { color: '#fbbf24', label: 'Good',       sub: 'A few improvements possible' } :
      score >= 40 ? { color: '#f97316', label: 'Needs Work', sub: 'Several issues to fix' } :
                    { color: '#f28b82', label: 'Poor',       sub: 'Major SEO problems found' }

    // Conic-gradient ring fills `score` percent of the circle
    const ring = 'conic-gradient(' + tier.color + ' ' + (score * 3.6) +
                 'deg, rgba(255,255,255,0.08) 0deg)'

    const checksHtml = checks.map(c =>
      '<div class="seo-check seo-' + c.status + '">' +
        '<span class="seo-check-icon">' + ICON[c.status] + '</span>' +
        '<div class="seo-check-text">' +
          '<span class="seo-check-label">' + esc(c.label) + '</span>' +
          '<span class="seo-check-detail">' + esc(c.detail) + '</span>' +
        '</div>' +
        '<span class="seo-check-pts">' + c.pts + '/' + c.max + '</span>' +
      '</div>'
    ).join('')

    // Heading list
    function headRow (tag, txt) {
      const short = txt.length > 70 ? txt.slice(0, 70) + '…' : txt
      return '<div class="seo-hl-row"><span class="seo-hl-tag">' + tag + '</span>' +
             '<span>' + esc(short) + '</span></div>'
    }
    const headRows = []
    d.h1List.forEach(t => headRows.push(headRow('H1', t)))
    d.h2List.forEach(t => headRows.push(headRow('H2', t)))
    d.h3List.forEach(t => headRows.push(headRow('H3', t)))
    const headListHtml = headRows.length
      ? headRows.join('')
      : '<div class="seo-hl-row"><span style="color:#9aa0a6">No headings found on this page.</span></div>'

    // Keyword density bars (bar width is relative to the top keyword)
    let kwHtml
    if (d.keywords.length) {
      const top = d.keywords[0].count || 1
      kwHtml = d.keywords.map(k =>
        '<div class="seo-kw">' +
          '<span class="seo-kw-word" title="' + esc(k.word) + '">' + esc(k.word) + '</span>' +
          '<div class="seo-kw-bar"><div class="seo-kw-fill" style="width:' +
            (k.count / top * 100).toFixed(0) + '%"></div></div>' +
          '<span class="seo-kw-stat">' + k.count + ' · ' + k.density.toFixed(1) + '%</span>' +
        '</div>'
      ).join('')
    } else {
      kwHtml = '<div class="seo-hl-row"><span style="color:#9aa0a6">' +
               'Not enough text to analyse keywords.</span></div>'
    }

    bodyEl.innerHTML =
      '<div class="seo-score-wrap">' +
        '<div class="seo-score-ring" style="background:' + ring + '">' +
          '<div class="seo-score-inner">' +
            '<span class="seo-score-num" style="color:' + tier.color + '">' + score + '</span>' +
            '<span class="seo-score-max">/ 100</span>' +
          '</div>' +
        '</div>' +
        '<div class="seo-score-label" style="color:' + tier.color + '">' + tier.label + '</div>' +
        '<div class="seo-score-sub">' + tier.sub + '</div>' +
      '</div>' +
      '<div class="seo-url" title="' + esc(d.url) + '">' + esc(d.url) + '</div>' +

      '<div class="seo-section">' +
        '<div class="seo-section-title">Page Checks</div>' + checksHtml +
      '</div>' +

      '<div class="seo-section">' +
        '<div class="seo-section-title">Heading Structure</div>' +
        '<div class="seo-head-counts">' +
          '<div class="seo-hc"><b>' + d.h1Count + '</b><span>H1</span></div>' +
          '<div class="seo-hc"><b>' + d.h2Count + '</b><span>H2</span></div>' +
          '<div class="seo-hc"><b>' + d.h3Count + '</b><span>H3</span></div>' +
        '</div>' +
        '<div class="seo-head-list">' + headListHtml + '</div>' +
      '</div>' +

      '<div class="seo-section">' +
        '<div class="seo-section-title">Top 10 Keywords — density</div>' + kwHtml +
      '</div>'

    hasReport = true
  }

  function renderMessage (icon, msg) {
    hasReport = false
    bodyEl.innerHTML = '<div class="seo-empty"><span class="seo-empty-icon">' +
      icon + '</span>' + esc(msg) + '</div>'
  }

  function renderLoading () {
    if (hasReport) return  // keep the existing report visible while refreshing
    bodyEl.innerHTML = '<div class="seo-empty"><span class="seo-empty-icon">\u{1F50D}</span>' +
      'Analyzing this page…</div>'
  }

  // ── 8. Analyze the active page ─────────────────────────────────────────────

  async function analyze () {
    if (analyzing) return

    const wv = getActiveWebview()
    if (!wv) { renderMessage('\u{1F310}', 'No page open. Open a website to analyze.'); return }

    let url = ''
    try { url = wv.getURL() || '' } catch (_) {}
    if (!url || !/^https?:\/\//i.test(url) || /newtab\.html$/i.test(url)) {
      renderMessage('\u{1F310}', 'Open a website to see its SEO report.')
      return
    }

    analyzing = true
    renderLoading()
    setReBtnSpinning(true)

    let data = null
    try {
      data = await wv.executeJavaScript('(' + pageProbe.toString() + ')()', true)
    } catch (_) {}

    analyzing = false
    setReBtnSpinning(false)

    if (!data || typeof data !== 'object') {
      renderMessage('⚠️', 'This page could not be analyzed — it may block scripts.')
      return
    }

    render(data)

    // The page may still be loading, so the load-time metric is not ready yet.
    // Re-analyze a moment later (up to 3 times) to capture the real load speed.
    if (data.loadTimeMs === 0 && retryCount < 3) {
      retryCount++
      clearTimeout(analyzeTimer)
      analyzeTimer = setTimeout(analyze, 1400)
    } else {
      retryCount = 0
    }
  }

  // Debounced re-analyze, used when the page navigates
  function scheduleAnalyze () {
    retryCount = 0
    clearTimeout(analyzeTimer)
    analyzeTimer = setTimeout(analyze, 500)
  }

  // ── 9. Panel open / close ──────────────────────────────────────────────────

  function openPanel () {
    isOpen = true
    panel.classList.add('open')
    if (btnSeo) btnSeo.classList.add('active')
    retryCount = 0
    analyze()
  }

  function closePanel () {
    isOpen = false
    panel.classList.remove('open')
    if (btnSeo) btnSeo.classList.remove('active')
  }

  function togglePanel () { isOpen ? closePanel() : openPanel() }

  // ── 10. Wire up events ─────────────────────────────────────────────────────

  if (btnSeo)   btnSeo.addEventListener('click', togglePanel)
  if (closeBtn) closeBtn.addEventListener('click', closePanel)
  if (reBtn)    reBtn.addEventListener('click', () => { retryCount = 0; analyze() })

  // The renderer fires 'url-changed' on every navigation / tab switch
  document.addEventListener('url-changed', () => {
    if (isOpen) scheduleAnalyze()
  })

  // ── 11. Start — this script only loads when the SEO button is clicked,
  //         so open the panel and analyze straight away. ─────────────────────

  openPanel()

})()
