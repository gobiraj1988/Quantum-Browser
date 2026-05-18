'use strict'
// Context-menu AI tools + smart URL suggestions — all free, no API key
;(function () {

// ── Floating context toolbar styles ───────────────────────────────────────────

const style = document.createElement('style')
style.textContent = `
  .ai-ctx-bar {
    position: fixed;
    z-index: 99999;
    background: #2d2e32;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 9px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
    min-width: 180px;
    animation: ctxBarIn 0.11s ease;
  }
  @keyframes ctxBarIn {
    from { opacity:0; transform:translateY(-4px); }
    to   { opacity:1; transform:translateY(0); }
  }
  .ai-ctx-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    background: transparent;
    border: none;
    color: #e8eaed;
    font: 12.5px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background 0.1s;
  }
  .ai-ctx-btn:hover { background: #3c4043; }
  .ai-ctx-sep { height: 1px; background: rgba(255,255,255,0.07); margin: 2px 4px; }
  .ai-ctx-btn .ctx-icon { font-size:13px; width:14px; flex-shrink:0; }
`
document.head.appendChild(style)

// ── Core: call free AI and send result to sidebar ─────────────────────────────

async function runFreeTool (systemPrompt, userContent) {
  const bridge = window.aiBridge
  if (!bridge) return
  bridge.openSidebar()
  bridge.setBusy(true)
  const typing = bridge.showTyping()
  try {
    const { text } = await window.AiConfig.callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ])
    typing.remove()
    bridge.appendMsg('ai', text)
  } catch (_) {
    typing.remove()
    bridge.appendMsg('error', 'AI temporarily unavailable, try again')
  }
  bridge.setBusy(false)
}

// ── Helper: get selected text from active webview ─────────────────────────────

async function getSelText () {
  const wv = window.aiBridge?.getActiveWebview()
  if (!wv) return ''
  try { return await wv.executeJavaScript("window.getSelection().toString().trim()") }
  catch (_) { return '' }
}

// ── Context menu: right-click on selected text ────────────────────────────────

let ctxBar = null

function showCtxBar (selText, wvEl) {
  hideCtxBar()
  if (!selText || selText.length < 3) return

  ctxBar = document.createElement('div')
  ctxBar.className = 'ai-ctx-bar'
  ctxBar.innerHTML = `
    <button class="ai-ctx-btn" id="ctxb-explain">
      <span class="ctx-icon">✦</span>Explain this simply
    </button>
    <div class="ai-ctx-sep"></div>
    <button class="ai-ctx-btn" id="ctxb-grammar">
      <span class="ctx-icon">✓</span>Check grammar
    </button>`

  // Anchor to top-right of the webview, always visible
  const rect = wvEl.getBoundingClientRect()
  ctxBar.style.right = '22px'
  ctxBar.style.top   = (rect.top + 60) + 'px'
  document.body.appendChild(ctxBar)

  document.getElementById('ctxb-explain').onclick = () => {
    hideCtxBar()
    runFreeTool(
      'Explain the given text in very simple, plain language. Use short sentences. Avoid jargon. Be brief.',
      'Explain simply:\n\n' + selText.slice(0, 2500)
    )
  }
  document.getElementById('ctxb-grammar').onclick = () => {
    hideCtxBar()
    runFreeTool(
      'Check for spelling, grammar, punctuation, and clarity issues. List each problem with a corrected version. Use plain text, no markdown symbols. If the text is correct, say "No issues found."',
      'Grammar check:\n\n' + selText.slice(0, 2500)
    )
  }

  // Auto-hide after 6 s or on next click anywhere
  const tid = setTimeout(hideCtxBar, 6000)
  const dismiss = () => { clearTimeout(tid); hideCtxBar(); document.removeEventListener('click', dismiss) }
  setTimeout(() => document.addEventListener('click', dismiss), 80)
}

function hideCtxBar () { ctxBar?.remove(); ctxBar = null }

function attachCtxMenu (wv) {
  wv.addEventListener('context-menu', e => {
    const sel = (e.params?.selectionText || '').trim()
    if (sel) showCtxBar(sel, wv)
    else hideCtxBar()
  })
}

function setupContextMenu () {
  const stack = document.getElementById('webview-stack')
  if (!stack) return
  stack.querySelectorAll('webview').forEach(attachCtxMenu)
  new MutationObserver(muts =>
    muts.forEach(m =>
      m.addedNodes.forEach(n => { if (n.tagName === 'WEBVIEW') attachCtxMenu(n) })
    )
  ).observe(stack, { childList: true })
}

// ── Smart URL bar suggestions (local curated list — no external API) ──────────

const SMART_SITES = [
  // AI
  'chat.openai.com', 'claude.ai', 'gemini.google.com', 'huggingface.co',
  'perplexity.ai', 'you.com', 'phind.com', 'copilot.microsoft.com',
  // Dev
  'github.com', 'stackoverflow.com', 'codepen.io', 'replit.com',
  'developer.mozilla.org', 'devdocs.io', 'css-tricks.com', 'npmjs.com',
  'codesandbox.io', 'jsfiddle.net', 'regex101.com', 'caniuse.com',
  // News & knowledge
  'news.ycombinator.com', 'techcrunch.com', 'theverge.com', 'arxiv.org',
  'wikipedia.org', 'medium.com', 'dev.to', 'hashnode.com',
  // Tools
  'figma.com', 'notion.so', 'linear.app', 'vercel.com', 'netlify.com',
  'cloudflare.com', 'railway.app', 'supabase.com', 'planetscale.com',
  // Learning
  'coursera.org', 'udemy.com', 'freecodecamp.org', 'khanacademy.org',
]

function escH (s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function setupUrlSuggestions () {
  const input    = document.getElementById('url-input')
  const dropdown = document.getElementById('suggestions-dropdown')
  if (!input || !dropdown) return

  let timer = null

  input.addEventListener('input', () => {
    clearTimeout(timer)
    clearSmartItems(dropdown)
    const val = input.value.trim()
    if (val.length < 2) return
    if (/^https?:\/\//i.test(val)) return  // already a URL
    if (/^[\w-]+(\.[\w-]+)+/.test(val) && !val.includes(' ')) return  // looks like a direct URL

    timer = setTimeout(() => {
      const q       = val.toLowerCase().replace(/^www\./, '')
      const matches = SMART_SITES.filter(s => s.includes(q)).slice(0, 3)
      if (!matches.length) return
      matches.forEach(site => {
        const row = document.createElement('div')
        row.className   = 'suggestion-item ai-smart-item'
        row.dataset.href = 'https://' + site
        row.innerHTML   = `
          <span class="sugg-icon" style="color:#c084fc;font-size:10px">✦</span>
          <span class="sugg-url">${escH(site)}</span>
          <span class="sugg-label" style="color:#c084fc;background:rgba(192,132,252,.1)">Smart</span>`
        row.addEventListener('mousedown', e => {
          e.preventDefault()
          input.value = 'https://' + site
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
        dropdown.appendChild(row)
      })
      dropdown.classList.add('visible')
    }, 300)
  })

  input.addEventListener('blur', () => { clearTimeout(timer); setTimeout(() => clearSmartItems(dropdown), 200) })
}

function clearSmartItems (dropdown) {
  dropdown.querySelectorAll('.ai-smart-item').forEach(el => el.remove())
  if (!dropdown.querySelector('.suggestion-item')) dropdown.classList.remove('visible')
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init () {
  let tries = 0
  const poll = setInterval(() => {
    if (window.AiConfig || ++tries > 50) {
      clearInterval(poll)
      setupContextMenu()
      setupUrlSuggestions()
    }
  }, 100)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()

window.aiTools = { runFreeTool, getSelText }

})()
