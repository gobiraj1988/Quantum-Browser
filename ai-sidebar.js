'use strict'
;(async function () {

// ── Inject sidebar HTML into the main area ────────────────────────────────────

const sidebar = document.createElement('div')
sidebar.id    = 'ai-sidebar'

try {
  const res  = await fetch('./ai-sidebar.html')
  const html = await res.text()
  // Strip the HTML comment on line 1, use the rest
  sidebar.innerHTML = html.replace(/^<!--.*?-->\n?/s, '')
} catch (_) {
  // Minimal inline fallback if file fetch fails
  sidebar.innerHTML = `
    <div class="ai-header">
      <span class="ai-header-title">AI Assistant</span>
      <span class="ai-provider-badge" id="ai-provider-badge"></span>
      <button class="ai-header-btn" id="ai-clear-btn">🗑</button>
      <button class="ai-header-btn" id="ai-close-btn">✕</button>
    </div>
    <div class="ai-actions">
      <button class="ai-summarize-btn" id="ai-summarize-btn">📄 Summarize this page</button>
    </div>
    <div class="ai-tools-grid">
      <button class="ai-tool-btn" id="ai-facts-btn">Find Facts</button>
      <button class="ai-tool-btn" id="ai-translate-btn">Translate</button>
      <button class="ai-tool-btn" id="ai-grammar-btn">Grammar</button>
      <button class="ai-tool-btn" id="ai-explain-btn">Explain</button>
    </div>
    <div class="ai-translate-row" id="ai-translate-row">
      <select class="ai-lang-select" id="ai-lang-select">
        <option value="">Choose language…</option>
        <option>Spanish</option><option>French</option><option>German</option>
        <option>Japanese</option><option>Arabic</option><option>Hindi</option>
        <option>English</option>
      </select>
      <button class="ai-translate-go" id="ai-translate-go">Go</button>
    </div>
    <div class="ai-chat-area" id="ai-chat-area"></div>
    <div class="ai-input-row">
      <textarea class="ai-input" id="ai-input" rows="1" placeholder="Ask about this page…"></textarea>
      <button class="ai-send-btn" id="ai-send-btn">▲</button>
    </div>`
}

document.getElementById('main-area').appendChild(sidebar)

// ── DOM refs ──────────────────────────────────────────────────────────────────

const chatArea     = document.getElementById('ai-chat-area')
const inputEl      = document.getElementById('ai-input')
const sendBtn      = document.getElementById('ai-send-btn')
const summBtn      = document.getElementById('ai-summarize-btn')
const clearBtn     = document.getElementById('ai-clear-btn')
const closeBtn     = document.getElementById('ai-close-btn')
const translateRow = document.getElementById('ai-translate-row')
const langSelect   = document.getElementById('ai-lang-select')
const translateGo  = document.getElementById('ai-translate-go')
const provBadge    = document.getElementById('ai-provider-badge')
const toggleBtn    = document.getElementById('btn-ai')

// ── State ─────────────────────────────────────────────────────────────────────

let chatHistory = []   // [ { role, content }, … ]
let isOpen      = false
let isBusy      = false

// ── Sidebar open / close ──────────────────────────────────────────────────────

toggleBtn.addEventListener('click', () => {
  isOpen = !isOpen
  sidebar.classList.toggle('open', isOpen)
  toggleBtn.classList.toggle('active', isOpen)
  if (isOpen) { updateProviderBadge(); inputEl.focus() }
})

closeBtn.addEventListener('click', () => {
  isOpen = false
  sidebar.classList.remove('open')
  toggleBtn.classList.remove('active')
})

// ── Clear chat ────────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  chatHistory = []
  chatArea.innerHTML = ''
  translateRow.classList.remove('open')
  showWelcome()
})

// ── Get the currently-visible webview ─────────────────────────────────────────

function getActiveWebview () {
  return Array.from(document.querySelectorAll('#webview-stack webview'))
    .find(wv => wv.style.display === 'flex')
    || document.querySelector('#webview-stack webview')
}

// ── Extract readable text from the active page ────────────────────────────────

async function getPageContext () {
  const wv = getActiveWebview()
  if (!wv) return { text: '', url: '', title: '' }
  try {
    const text = await wv.executeJavaScript(`
      (function () {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('script,style,noscript,nav,footer,aside,header,[role="navigation"],[role="banner"]')
          .forEach(el => el.remove())
        return (clone.innerText || '')
          .replace(/[ \\t]+/g, ' ')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim()
          .slice(0, 8000)
      })()
    `)
    return {
      text:  text || '',
      url:   wv.getURL?.()   || '',
      title: wv.getTitle?.() || '',
    }
  } catch (_) {
    return { text: '', url: '', title: '' }
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystem (ctx) {
  let s = 'You are a helpful AI assistant embedded in a web browser sidebar. '
  s    += 'Be concise, clear, and friendly. Use plain text — no markdown symbols like **, ##, or *. '
  s    += 'Detect the language of the page content and respond in that same language by default.'
  if (ctx.text) {
    s += '\n\nCurrent page URL: '   + ctx.url
    s += '\nPage title: '           + ctx.title
    s += '\nPage content:\n'        + ctx.text
  } else {
    s += '\n\nNo page content available. The user may be on a new tab or blank page.'
  }
  return s
}

// ── Core: send message with auto-fallback ─────────────────────────────────────

async function sendMessage (userText, ctx) {
  if (isBusy) return
  isBusy = true
  setBusy(true)

  appendMsg('user', userText)
  chatHistory.push({ role: 'user', content: userText })

  const typingEl = showTyping()
  const system   = buildSystem(ctx)
  const messages = [{ role: 'system', content: system }, ...chatHistory]

  try {
    const { text, label } = await window.AiConfig.callAI(messages)
    typingEl.remove()
    appendMsg('ai', text)
    chatHistory.push({ role: 'assistant', content: text })
    updateProviderBadge(label)
  } catch (err) {
    typingEl.remove()
    appendMsg('error', 'AI temporarily unavailable, try again')
    console.error('[AI Sidebar]', err.message)
  }

  isBusy = false
  setBusy(false)
}

// ── Summarize ─────────────────────────────────────────────────────────────────

summBtn.addEventListener('click', async () => {
  if (isBusy) return
  const ctx = await getPageContext()
  if (!ctx.text) {
    appendMsg('error', 'Could not read this page. Navigate to any webpage first.')
    return
  }
  chatHistory = []
  chatArea.innerHTML = ''
  await sendMessage(
    'Summarize the main content of this page in 3-4 clear paragraphs. Be informative and concise.',
    ctx
  )
})

// ── Find Facts ────────────────────────────────────────────────────────────────

document.getElementById('ai-facts-btn').addEventListener('click', async () => {
  if (isBusy) return
  const ctx = await getPageContext()
  if (!ctx.text) { appendMsg('error', 'Navigate to a webpage first.'); return }
  await sendMessage(
    'List the 5 most important facts or key points from this page, numbered, one per line.',
    ctx
  )
})

// ── Translate ─────────────────────────────────────────────────────────────────
// Uses translator.js (LibreTranslate + AI fallback) when available,
// otherwise falls back to AI-only translation in the chat.

document.getElementById('ai-translate-btn').addEventListener('click', () => {
  translateRow.classList.toggle('open')
  if (translateRow.classList.contains('open')) langSelect.focus()
})

langSelect.addEventListener('change', () => {
  translateGo.disabled = !langSelect.value
})

translateGo.addEventListener('click', async () => {
  const lang = langSelect.value
  if (!lang) return
  translateRow.classList.remove('open')
  if (isBusy) return

  // Prefer full-page LibreTranslate if available
  if (window.translator?.translatePage) {
    await window.translator.translatePage(lang)
    return
  }

  // AI-only fallback (shows translation in chat)
  const ctx = await getPageContext()
  if (!ctx.text) { appendMsg('error', 'Navigate to a webpage first.'); return }
  await sendMessage(
    'Translate the main content of this page into ' + lang + '. Translate naturally and clearly.',
    ctx
  )
})

langSelect.addEventListener('keydown', e => {
  if (e.key === 'Enter') translateGo.click()
})

// ── Reading Mode (sidebar shortcut) ──────────────────────────────────────────

document.getElementById('ai-reader-btn')?.addEventListener('click', () => {
  if (window.readingMode?.enterReadingMode) {
    window.readingMode.enterReadingMode()
  } else {
    appendMsg('error', 'Reading mode is loading. Try again in a moment.')
  }
})

// ── Grammar Check ─────────────────────────────────────────────────────────────

document.getElementById('ai-grammar-btn').addEventListener('click', async () => {
  if (isBusy) return
  const wv = getActiveWebview()
  let selected = ''
  if (wv) {
    try { selected = await wv.executeJavaScript('window.getSelection().toString().trim()') } catch (_) {}
  }
  if (!selected) {
    appendMsg('error', 'Select some text on the page first, then click Grammar.')
    return
  }
  await sendMessage(
    'Grammar check this text and list any corrections needed:\n\n"' + selected.slice(0, 2000) + '"',
    { text: '', url: '', title: '' }
  )
})

// ── Explain ───────────────────────────────────────────────────────────────────

document.getElementById('ai-explain-btn').addEventListener('click', async () => {
  if (isBusy) return
  const wv = getActiveWebview()
  let selected = ''
  if (wv) {
    try { selected = await wv.executeJavaScript('window.getSelection().toString().trim()') } catch (_) {}
  }
  if (!selected) {
    appendMsg('error', 'Select some text on the page first, then click Explain.')
    return
  }
  await sendMessage(
    'Explain this in simple terms that anyone can understand:\n\n"' + selected.slice(0, 2000) + '"',
    { text: '', url: '', title: '' }
  )
})

// ── Chat input ────────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendInput)

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput() }
})

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'
})

async function sendInput () {
  const text = inputEl.value.trim()
  if (!text || isBusy) return
  inputEl.value        = ''
  inputEl.style.height = 'auto'
  const ctx = await getPageContext()
  await sendMessage(text, ctx)
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function appendMsg (role, text) {
  chatArea.querySelector('.ai-welcome')?.remove()

  const wrap   = document.createElement('div')
  wrap.className = 'ai-msg ai-msg-' + role

  const bubble = document.createElement('div')
  bubble.className   = 'ai-msg-bubble'
  bubble.textContent = text
  wrap.appendChild(bubble)

  if (role === 'ai') {
    const copy = document.createElement('button')
    copy.className   = 'ai-copy-btn'
    copy.textContent = 'Copy'
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(text).catch(() => {})
      copy.textContent = 'Copied!'
      setTimeout(() => { copy.textContent = 'Copy' }, 1800)
    })
    wrap.appendChild(copy)
  }

  chatArea.appendChild(wrap)
  chatArea.scrollTop = chatArea.scrollHeight
}

function showTyping () {
  const wrap   = document.createElement('div')
  wrap.className = 'ai-msg ai-msg-ai ai-typing'
  const bubble = document.createElement('div')
  bubble.className = 'ai-msg-bubble'
  bubble.innerHTML = '<div class="ai-dots"><span></span><span></span><span></span></div>'
  wrap.appendChild(bubble)
  chatArea.appendChild(wrap)
  chatArea.scrollTop = chatArea.scrollHeight
  return wrap
}

function showWelcome () {
  const el = document.createElement('div')
  el.className = 'ai-welcome'
  el.innerHTML = `
    <div class="ai-welcome-icon">✦</div>
    <p><strong>Free AI — no API key needed.</strong></p>
    <p>Click <strong>Summarize</strong> for a quick page summary,<br>or type any question below.</p>
    <p style="margin-top:6px">Select text on the page first,<br>then use <strong>Grammar</strong> or <strong>Explain</strong>.</p>`
  chatArea.appendChild(el)
}

function updateProviderBadge (label) {
  if (!provBadge) return
  provBadge.textContent = label || window.AiConfig?.getCurrentLabel() || 'Free AI'
}

function setBusy (busy) {
  sendBtn.disabled = busy
  summBtn.disabled = busy
  inputEl.disabled = busy
  ;['ai-facts-btn', 'ai-translate-btn', 'ai-grammar-btn', 'ai-explain-btn', 'ai-translate-go']
    .forEach(id => {
      const el = document.getElementById(id)
      if (el) el.disabled = busy
    })
}

// ── Public bridge (used by other scripts that want to talk to the sidebar) ────

window.aiBridge = {
  openSidebar () {
    if (!isOpen) {
      isOpen = true
      sidebar.classList.add('open')
      toggleBtn.classList.add('active')
      updateProviderBadge()
    }
  },
  appendMsg,
  showTyping,
  setBusy,
  getActiveWebview,
  sendMessage: async (text, usePageCtx = true) => {
    const ctx = usePageCtx ? await getPageContext() : { text: '', url: '', title: '' }
    return sendMessage(text, ctx)
  },
}

// ── Init ──────────────────────────────────────────────────────────────────────

showWelcome()
updateProviderBadge()

})()
