'use strict'
// Reading Mode: extracts article content, adds AI summary, shows clean reader view
;(function () {

// ── CSS ───────────────────────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = `
  #btn-reader { position: relative; }
  #btn-reader.reader-on { color: #fbbf24; }
  #btn-reader.reader-on:hover { background: rgba(251,191,36,0.12); }
`
document.head.appendChild(style)

// Track state
let readerPreviousUrl = ''
let readerActive      = false

// ── Content extraction selectors ─────────────────────────────────────────────

const ARTICLE_SELS = [
  'article',
  '[role="main"] article', '[role="main"]',
  '.post-content', '.entry-content', '.article-body', '.article-content',
  '.story-body',   '.story-content',  '.news-body',   '.post-body',
  '.blog-post',    '.blog-content',   '.content-body','#article-body',
  '#article-content', '#main-content', '#content-body', 'main',
]

const STRIP_SELS = [
  'script','style','noscript','iframe','nav','footer','aside','header',
  'form','figure > figcaption + *','[role="navigation"]','[role="banner"]',
  '[role="complementary"]','[aria-hidden="true"]',
  '.ad','.ads','.advertisement','.sponsored',
  '[class*="share"]','[class*="social"]','[class*="related"]',
  '[class*="sidebar"]','[class*="widget"]','[class*="comment"]',
  '[class*="newsletter"]','[class*="popup"]','[class*="modal"]',
  '[class*="cookie"]','[id*="comment"]','[class*="promo"]',
]

// ── Extract article from webview ──────────────────────────────────────────────

async function extractArticle (wv) {
  const aSelJson = JSON.stringify(ARTICLE_SELS)
  const stripStr = JSON.stringify(STRIP_SELS.join(','))
  return wv.executeJavaScript(`
    (function () {
      var aSelectors = ${aSelJson}
      var stripSels  = ${stripStr}

      function strip(el) {
        var c = el.cloneNode(true)
        try { c.querySelectorAll(stripSels).forEach(function(n){ n.remove() }) } catch(_){}
        return c
      }

      for (var i = 0; i < aSelectors.length; i++) {
        try {
          var el = document.querySelector(aSelectors[i])
          if (!el) continue
          var c    = strip(el)
          var text = (c.innerText || '').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim()
          if (text.length > 400) {
            return {
              title:  document.title,
              url:    location.href,
              author: (document.querySelector('meta[name="author"]') || {}).content || '',
              date:   ((document.querySelector('time') || {}).dateTime || (document.querySelector('time') || {}).innerText || '').trim(),
              text:   text.slice(0, 12000),
              ok:     true,
            }
          }
        } catch(_) {}
      }

      // Fallback: whole body
      var c = strip(document.body)
      return {
        title:  document.title,
        url:    location.href,
        author: '',
        date:   '',
        text:   (c.innerText||'').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0, 12000),
        ok:     true,
      }
    })()
  `)
}

// ── Build clean reader HTML ───────────────────────────────────────────────────

function buildReaderPage (article, aiSummary) {
  function esc (s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  const paragraphs = article.text.split(/\n+/).filter(p => p.trim())
    .map(p => '<p>' + esc(p) + '</p>').join('\n')

  const summaryHtml = aiSummary
    ? `<div class="summary-box">
        <div class="summary-label">
          <span style="color:#c084fc;font-size:14px">✦</span>
          AI Summary
        </div>
        <div class="summary-text">${esc(aiSummary)}</div>
       </div>`
    : ''

  const meta = [article.author && `<span>${esc(article.author)}</span>`, article.date && `<span>${esc(article.date)}</span>`]
    .filter(Boolean).join('<span class="sep">·</span>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(article.title)}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      background: #1a1b1e;
      color: #d1d5db;
      font: 17px/1.8 Georgia, 'Times New Roman', serif;
      padding: 0 24px 60px;
    }
    .wrap { max-width: 720px; margin: 0 auto; }

    /* Reader header bar */
    .reader-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 0 14px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 32px;
      flex-wrap: wrap;
    }
    .reader-badge {
      background: rgba(251,191,36,0.12);
      color: #fbbf24;
      border: 1px solid rgba(251,191,36,0.25);
      border-radius: 6px;
      padding: 4px 12px;
      font: 600 12px -apple-system,sans-serif;
    }
    .reader-back {
      margin-left: auto;
      background: rgba(255,255,255,0.08);
      border: none;
      border-radius: 6px;
      color: #9ca3af;
      font: 12px -apple-system,sans-serif;
      padding: 5px 14px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .reader-back:hover { background: rgba(255,255,255,0.14); color: #e8eaed; }

    /* Article header */
    h1 {
      font-size: 2rem;
      line-height: 1.25;
      color: #f3f4f6;
      font-weight: 700;
      margin-bottom: 12px;
      font-family: -apple-system,'Segoe UI',sans-serif;
    }
    .meta {
      font: 13px -apple-system,sans-serif;
      color: #6b7280;
      margin-bottom: 28px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .sep { margin: 0 4px; }

    /* AI summary box */
    .summary-box {
      background: rgba(192,132,252,0.08);
      border: 1px solid rgba(192,132,252,0.2);
      border-radius: 10px;
      padding: 18px 20px;
      margin-bottom: 32px;
    }
    .summary-label {
      display: flex;
      align-items: center;
      gap: 7px;
      font: 600 12.5px -apple-system,sans-serif;
      color: #c084fc;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .summary-text {
      font: 15px/1.7 -apple-system,'Segoe UI',sans-serif;
      color: #d1d5db;
      white-space: pre-wrap;
    }

    /* Article body */
    p { margin-bottom: 1.4em; color: #d1d5db; }
    p:first-of-type::first-letter {
      font-size: 2.8em;
      font-weight: 700;
      float: left;
      line-height: 0.8;
      margin: 0.08em 0.1em 0 0;
      color: #c084fc;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="reader-bar">
      <span class="reader-badge">Reading Mode</span>
      <button class="reader-back" onclick="history.back()">← Back to original</button>
    </div>
    <h1>${esc(article.title)}</h1>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${summaryHtml}
    ${paragraphs}
  </div>
</body>
</html>`
}

// ── Main: enter reading mode ──────────────────────────────────────────────────

async function enterReadingMode () {
  const bridge = window.aiBridge
  const wv     = bridge?.getActiveWebview()
  if (!wv) { bridge?.openSidebar(); bridge?.appendMsg('error', 'Navigate to a webpage first.'); return }

  const btn = document.getElementById('btn-reader')
  btn?.classList.add('reader-on')

  bridge?.openSidebar()
  bridge?.setBusy(true)
  const typing = bridge?.showTyping()

  try {
    readerPreviousUrl = wv.getURL?.() || ''
    readerActive      = true

    // 1. Extract article content
    const article = await extractArticle(wv)
    if (!article?.text || article.text.length < 100) {
      throw new Error('Could not find article content on this page.')
    }

    // 2. Get AI summary (non-blocking — show reader immediately if AI is slow)
    let aiSummary = ''
    try {
      const { text } = await window.AiConfig.callAI([
        {
          role:    'system',
          content: 'Summarize the article in 2-3 concise sentences. Plain text only, no markdown. Be direct.',
        },
        { role: 'user', content: article.text.slice(0, 5000) },
      ])
      aiSummary = text || ''
    } catch (_) {}  // silently skip summary if AI is unavailable

    typing?.remove()

    // 3. Build reader HTML and load as blob URL
    const html    = buildReaderPage(article, aiSummary)
    const blob    = new Blob([html], { type: 'text/html;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    wv.src = blobUrl

    bridge?.appendMsg('ai',
      'Reading Mode active.\n' +
      (aiSummary ? 'AI summary added at the top.\n' : '') +
      'Click "← Back to original" inside the reader (or the browser Back button) to exit.'
    )

  } catch (err) {
    typing?.remove()
    readerActive = false
    btn?.classList.remove('reader-on')
    bridge?.appendMsg('error', err.message || 'Reading Mode failed.')
  }

  bridge?.setBusy(false)
}

// ── Add reader button to toolbar ──────────────────────────────────────────────

function addReaderButton () {
  if (document.getElementById('btn-reader')) return

  const btn = document.createElement('button')
  btn.id        = 'btn-reader'
  btn.className = 'nav-btn'
  btn.title     = 'Reading Mode — clean article view with AI summary'
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
         stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5"/>
      <line x1="5" y1="5.5" x2="11" y2="5.5"/>
      <line x1="5" y1="8"   x2="11" y2="8"/>
      <line x1="5" y1="10.5" x2="8" y2="10.5"/>
    </svg>`

  const aiBtn = document.getElementById('btn-ai')
  if (aiBtn) aiBtn.parentNode.insertBefore(btn, aiBtn)
  else document.getElementById('toolbar')?.appendChild(btn)

  btn.addEventListener('click', () => {
    if (readerActive) {
      // Exit reader mode: go back
      readerActive = false
      btn.classList.remove('reader-on')
      const wv = window.aiBridge?.getActiveWebview()
      if (wv && readerPreviousUrl) wv.src = readerPreviousUrl
    } else {
      enterReadingMode()
    }
  })

  // Detect if user navigates away from reader manually (e.g. via Back button)
  document.getElementById('webview-stack')?.addEventListener('click', () => {
    // Reset reader state when user navigates
    setTimeout(() => {
      const wv = window.aiBridge?.getActiveWebview()
      if (wv && readerActive) {
        const url = wv.getURL?.() || ''
        if (url !== '' && !url.startsWith('blob:')) {
          readerActive = false
          btn.classList.remove('reader-on')
        }
      }
    }, 500)
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addReaderButton)
else addReaderButton()

window.readingMode = { enterReadingMode }

})()
