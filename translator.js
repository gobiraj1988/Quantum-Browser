'use strict'
// Full-page translation: LibreTranslate (3 public endpoints) → AI fallback
;(function () {

// ── CSS ───────────────────────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = `
  #btn-translate {
    position: relative;
  }
  #translate-panel {
    display: none;
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 230px;
    background: #2a2b2f;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.55);
    z-index: 9998;
    overflow: hidden;
    animation: tpFadeIn 0.13s ease;
  }
  @keyframes tpFadeIn {
    from { opacity:0; transform:translateY(-5px); }
    to   { opacity:1; transform:translateY(0); }
  }
  #translate-panel.open { display: block; }
  .tp-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    font-size: 12.5px;
    font-weight: 600;
    color: #e8eaed;
  }
  .tp-header-icon { color: #60a5fa; }
  .tp-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .tp-label { font-size: 11px; color: #9aa0a6; margin-bottom: 2px; }
  .tp-select {
    width: 100%;
    background: #35363a;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    color: #e8eaed;
    font-size: 12.5px;
    padding: 7px 10px;
    outline: none;
    cursor: pointer;
  }
  .tp-select:focus { border-color: #60a5fa; }
  .tp-go-btn {
    width: 100%;
    background: rgba(96,165,250,0.15);
    border: 1px solid rgba(96,165,250,0.3);
    border-radius: 7px;
    color: #60a5fa;
    font-size: 12.5px;
    font-weight: 600;
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.12s;
  }
  .tp-go-btn:hover:not(:disabled) { background: rgba(96,165,250,0.25); }
  .tp-go-btn:disabled { opacity: 0.4; cursor: default; }
  .tp-note { font-size: 10.5px; color: #6b7280; text-align: center; }
`
document.head.appendChild(style)

// ── Language map (name → LibreTranslate code) ─────────────────────────────────

const LANGS = {
  'Arabic':               'ar',
  'Chinese (Simplified)': 'zh',
  'Dutch':                'nl',
  'English':              'en',
  'French':               'fr',
  'German':               'de',
  'Hindi':                'hi',
  'Indonesian':           'id',
  'Italian':              'it',
  'Japanese':             'ja',
  'Korean':               'ko',
  'Polish':               'pl',
  'Portuguese':           'pt',
  'Russian':              'ru',
  'Spanish':              'es',
  'Swedish':              'sv',
  'Turkish':              'tr',
  'Ukrainian':            'uk',
  'Vietnamese':           'vi',
}

// Public LibreTranslate instances — tried in order, no key required
const LT_ENDPOINTS = [
  'https://translate.fedilab.app/translate',
  'https://libretranslate.de/translate',
  'https://lt.vern.cc/translate',
]

// ── LibreTranslate call ───────────────────────────────────────────────────────

async function libreTranslate (text, targetCode, sourceCode = 'auto') {
  for (const url of LT_ENDPOINTS) {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: text, source: sourceCode, target: targetCode, format: 'text' }),
        signal:  ctrl.signal,
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data.translatedText) return data.translatedText
    } catch (_) { continue }
    finally { clearTimeout(timer) }
  }
  return null   // all endpoints failed
}

// ── AI fallback translation for a single chunk ────────────────────────────────

async function aiTranslateChunk (text, langName) {
  const { text: t } = await window.AiConfig.callAI([
    {
      role:    'system',
      content: 'Translate the following text to ' + langName + '. Return only the translated text, nothing else.',
    },
    { role: 'user', content: text },
  ])
  return t
}

// ── Split long text into ≤3000-char chunks at paragraph boundaries ─────────────

function splitChunks (text, max = 3000) {
  const paras   = text.split(/\n+/).filter(p => p.trim())
  const chunks  = []
  let   cur     = ''
  for (const p of paras) {
    if ((cur + '\n' + p).length > max && cur) { chunks.push(cur.trim()); cur = p }
    else cur = cur ? cur + '\n' + p : p
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.length ? chunks : [text.slice(0, max)]
}

// ── Translate full text (with progress callback) ──────────────────────────────

async function translateFull (text, targetCode, langName, onProgress) {
  const chunks  = splitChunks(text)
  const results = []
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(Math.round(10 + (i / chunks.length) * 78))
    let out = await libreTranslate(chunks[i], targetCode)
    if (!out) {
      try { out = await aiTranslateChunk(chunks[i], langName) } catch (_) { out = chunks[i] }
    }
    results.push(out)
  }
  onProgress?.(92)
  return results.join('\n\n')
}

// ── Build clean HTML for the translated page ──────────────────────────────────

function buildPage (translated, langName, origTitle) {
  function esc (s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }
  const body = translated.split(/\n+/).filter(p => p.trim())
    .map(p => '<p>' + esc(p) + '</p>').join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Translated: ${esc(origTitle)}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:#1a1b1e; color:#e8eaed; font:16px/1.8 -apple-system,'Segoe UI',sans-serif; padding:40px 24px; }
    .wrap { max-width:800px; margin:0 auto; }
    .hdr  { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:28px; padding-bottom:18px; border-bottom:1px solid rgba(255,255,255,.1); }
    .badge{ background:rgba(96,165,250,.15); color:#60a5fa; border:1px solid rgba(96,165,250,.3); border-radius:6px; padding:4px 14px; font-size:13px; font-weight:600; }
    .hint { color:#6b7280; font-size:12px; }
    p     { margin-bottom:1.3em; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <span style="font-size:20px;color:#60a5fa">🌐</span>
      <span class="badge">Translated to ${esc(langName)}</span>
      <span class="hint">Press the ← Back button to return to the original page</span>
    </div>
    ${body}
  </div>
</body>
</html>`
}

// ── Main: translate the active webview page ───────────────────────────────────

async function translatePage (langName) {
  const bridge = window.aiBridge
  if (!bridge) return

  const wv = bridge.getActiveWebview()
  if (!wv) {
    bridge.openSidebar()
    bridge.appendMsg('error', 'Navigate to a webpage first.')
    return
  }

  const code = LANGS[langName]
  if (!code) { bridge.openSidebar(); bridge.appendMsg('error', 'Unknown language.'); return }

  bridge.openSidebar()
  bridge.setBusy(true)
  const typing = bridge.showTyping()

  try {
    // Extract readable text from webview
    const { pageText, pageTitle } = await wv.executeJavaScript(`
      (function () {
        var c = document.body.cloneNode(true)
        c.querySelectorAll('script,style,noscript,nav,footer,aside,header,iframe,form').forEach(function(el){el.remove()})
        return {
          pageText:  (c.innerText||'').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,14000),
          pageTitle: document.title,
        }
      })()
    `)

    if (!pageText || pageText.length < 30) {
      throw new Error('Could not read page content. Try navigating to an article or news page.')
    }

    typing.remove()

    // Live progress bubble in sidebar chat
    const prog = document.createElement('div')
    prog.className = 'ai-msg ai-msg-ai'
    const bub = document.createElement('div')
    bub.className   = 'ai-msg-bubble'
    bub.textContent = 'Translating to ' + langName + '… 0%'
    prog.appendChild(bub)
    document.getElementById('ai-chat-area')?.appendChild(prog)
    document.getElementById('ai-chat-area').scrollTop = 99999

    const translated = await translateFull(pageText, code, langName, pct => {
      bub.textContent = 'Translating to ' + langName + '… ' + pct + '%'
    })

    prog.remove()

    // Load result as a blob URL (preserves Back navigation)
    const html    = buildPage(translated, langName, pageTitle || '')
    const blob    = new Blob([html], { type: 'text/html;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    wv.src = blobUrl

    bridge.appendMsg('ai',
      'Page translated to ' + langName + '.\n' +
      'Click the ← Back button in the toolbar to return to the original page.'
    )

  } catch (err) {
    typing?.remove()
    bridge.appendMsg('error', err.message || 'Translation failed. Try again.')
  }

  bridge.setBusy(false)
}

// ── Add translate button + panel to the toolbar ───────────────────────────────

function addTranslateButton () {
  if (document.getElementById('btn-translate')) return

  const wrap = document.createElement('div')
  wrap.style.position = 'relative'
  wrap.style.display  = 'flex'

  wrap.innerHTML = `
    <button id="btn-translate" class="nav-btn" title="Translate page">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"
           stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="7.5" cy="7.5" r="6.5"/>
        <path d="M7.5 1C7.5 1 5.5 4 5.5 7.5s2 6.5 2 6.5M7.5 1c0 0 2 3 2 6.5s-2 6.5-2 6.5M1 7.5h13"/>
      </svg>
    </button>
    <div id="translate-panel">
      <div class="tp-header">
        <span class="tp-header-icon">🌐</span>
        Translate Page
      </div>
      <div class="tp-body">
        <div>
          <div class="tp-label">Translate to</div>
          <select id="tp-lang-select" class="tp-select">
            <option value="">Choose language…</option>
            ${Object.keys(LANGS).map(n => `<option>${n}</option>`).join('')}
          </select>
        </div>
        <button id="tp-go-btn" class="tp-go-btn" disabled>
          🌐 Translate full page
        </button>
        <div class="tp-note">LibreTranslate free • no key needed</div>
      </div>
    </div>`

  const aiBtn = document.getElementById('btn-ai')
  if (aiBtn) aiBtn.parentNode.insertBefore(wrap, aiBtn)
  else document.getElementById('toolbar')?.appendChild(wrap)

  const panel  = document.getElementById('translate-panel')
  const selEl  = document.getElementById('tp-lang-select')
  const goBtn  = document.getElementById('tp-go-btn')
  const tBtn   = document.getElementById('btn-translate')

  tBtn.addEventListener('click', e => {
    e.stopPropagation()
    panel.classList.toggle('open')
    tBtn.classList.toggle('panel-open', panel.classList.contains('open'))
  })

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) {
      panel.classList.remove('open')
      tBtn.classList.remove('panel-open')
    }
  })

  selEl.addEventListener('change', () => { goBtn.disabled = !selEl.value })

  goBtn.addEventListener('click', () => {
    const lang = selEl.value
    if (!lang) return
    panel.classList.remove('open')
    tBtn.classList.remove('panel-open')
    translatePage(lang)
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addTranslateButton)
  } else {
    addTranslateButton()
  }
}

init()

window.translator = { translatePage, libreTranslate, LANGS }

})()
