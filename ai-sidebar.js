'use strict'
;(function () {

// ─── Build sidebar DOM ────────────────────────────────────────────────────────

const sidebar = document.createElement('div')
sidebar.id = 'ai-sidebar'
sidebar.innerHTML = `
  <!-- Header -->
  <div class="ai-header">
    <svg class="ai-header-icon" width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
      <path d="M7.5 0.5 L8.9 5.3 L13.8 5.4 L9.9 8.4 L11.4 13.2 L7.5 10.2 L3.6 13.2 L5.1 8.4 L1.2 5.4 L6.1 5.3 Z"/>
    </svg>
    <span class="ai-header-title">Claude AI</span>
    <select class="ai-model-select" id="ai-model-select">
      <option value="claude-haiku-4-5-20251001">Haiku (fast)</option>
      <option value="claude-sonnet-4-6">Sonnet</option>
      <option value="claude-opus-4-7">Opus (powerful)</option>
    </select>
    <button class="ai-header-btn" id="ai-key-btn" title="API key settings">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <circle cx="5" cy="8" r="3"/><path d="M7.5 5.5 L11 2 M9 2 L11 2 L11 4"/>
      </svg>
    </button>
    <button class="ai-header-btn" id="ai-clear-btn" title="Clear chat">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8"/>
      </svg>
    </button>
    <button class="ai-header-btn" id="ai-close-btn" title="Close sidebar">✕</button>
  </div>

  <!-- API key section (shown when no key saved) -->
  <div class="ai-key-section" id="ai-key-section">
    <p>Enter your <strong style="color:#c084fc">Anthropic API key</strong> to activate the AI assistant. Get one free at anthropic.com.</p>
    <div class="ai-key-row">
      <input class="ai-key-input" id="ai-key-input" type="password" placeholder="sk-ant-api03-...">
      <button class="ai-key-save" id="ai-key-save-btn">Save</button>
    </div>
  </div>

  <!-- Chat messages -->
  <div class="ai-chat-area" id="ai-chat-area"></div>

  <!-- Quick action -->
  <div class="ai-actions">
    <button class="ai-summarize-btn" id="ai-summarize-btn">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h9M2 6h7M2 9h5"/>
      </svg>
      Summarize this page
    </button>
  </div>

  <!-- Input -->
  <div class="ai-input-row">
    <textarea class="ai-input" id="ai-input" rows="1" placeholder="Ask about this page…"></textarea>
    <button class="ai-send-btn" id="ai-send-btn" title="Send (Enter)">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 12V2M2 7l5-5 5 5"/>
      </svg>
    </button>
  </div>
`

document.getElementById('main-area').appendChild(sidebar)

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const chatArea    = document.getElementById('ai-chat-area')
const inputEl     = document.getElementById('ai-input')
const sendBtn     = document.getElementById('ai-send-btn')
const summBtn     = document.getElementById('ai-summarize-btn')
const clearBtn    = document.getElementById('ai-clear-btn')
const closeBtn    = document.getElementById('ai-close-btn')
const keySection  = document.getElementById('ai-key-section')
const keyInput    = document.getElementById('ai-key-input')
const keySaveBtn  = document.getElementById('ai-key-save-btn')
const keyBtn      = document.getElementById('ai-key-btn')
const modelSelect = document.getElementById('ai-model-select')
const toggleBtn   = document.getElementById('btn-ai')
const api         = window.electronAPI

// ─── State ────────────────────────────────────────────────────────────────────

let chatHistory = []
let apiKey      = ''
let model       = 'claude-haiku-4-5-20251001'
let isOpen      = false
let isBusy      = false

// ─── Init: load saved key + model ────────────────────────────────────────────

;(async () => {
  try {
    const saved = await api.aiGetKey()
    apiKey = saved.apiKey || ''
    model  = saved.model  || 'claude-haiku-4-5-20251001'
    modelSelect.value = model
  } catch (_) {}
  keySection.style.display = apiKey ? 'none' : 'flex'
  showWelcome()
})()

// ─── Sidebar toggle ───────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', () => {
  isOpen = !isOpen
  sidebar.classList.toggle('open', isOpen)
  toggleBtn.classList.toggle('active', isOpen)
  if (isOpen) inputEl.focus()
})

closeBtn.addEventListener('click', () => {
  isOpen = false
  sidebar.classList.remove('open')
  toggleBtn.classList.remove('active')
})

// ─── API key ──────────────────────────────────────────────────────────────────

keyBtn.addEventListener('click', () => {
  keySection.style.display = keySection.style.display === 'none' ? 'flex' : 'none'
  if (keySection.style.display === 'flex') keyInput.focus()
})

keySaveBtn.addEventListener('click', async () => {
  const k = keyInput.value.trim()
  if (!k) return
  apiKey = k
  keyInput.value = ''
  await api.aiSaveKey({ apiKey, model })
  keySection.style.display = 'none'
  keySaveBtn.textContent = 'Saved!'
  setTimeout(() => { keySaveBtn.textContent = 'Save' }, 1500)
})

keyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') keySaveBtn.click()
})

// ─── Model change ─────────────────────────────────────────────────────────────

modelSelect.addEventListener('change', async () => {
  model = modelSelect.value
  await api.aiSaveKey({ apiKey, model })
})

// ─── Clear chat ───────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  chatHistory = []
  chatArea.innerHTML = ''
  showWelcome()
})

// ─── Summarize ────────────────────────────────────────────────────────────────

summBtn.addEventListener('click', async () => {
  if (isBusy) return
  if (!apiKey) { showKeyPrompt(); return }

  const ctx = await getPageContext()
  if (!ctx.text) {
    appendMsg('error', 'Could not read this page. Try navigating to a webpage first.')
    return
  }

  chatHistory = []
  chatArea.innerHTML = ''
  await sendMessage('Summarize the main content of this page in 3-4 clear paragraphs.', ctx)
})

// ─── Chat input ───────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendInput)

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput() }
})

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'
})

async function sendInput() {
  const text = inputEl.value.trim()
  if (!text || isBusy) return
  if (!apiKey) { showKeyPrompt(); return }
  inputEl.value = ''
  inputEl.style.height = 'auto'
  const ctx = await getPageContext()
  await sendMessage(text, ctx)
}

// ─── Core: send to Claude API ─────────────────────────────────────────────────

async function sendMessage(userText, ctx) {
  isBusy = true
  setBusy(true)

  appendMsg('user', userText)
  chatHistory.push({ role: 'user', content: userText })

  const typingEl = showTyping()

  const system = buildSystem(ctx)

  try {
    const reply = await api.aiChat({ apiKey, model, system, messages: chatHistory })
    typingEl.remove()
    appendMsg('ai', reply)
    chatHistory.push({ role: 'assistant', content: reply })
  } catch (err) {
    typingEl.remove()
    appendMsg('error', err.message || 'Request failed. Check your API key and internet connection.')
  }

  isBusy = false
  setBusy(false)
}

// ─── Page content extraction ──────────────────────────────────────────────────

async function getPageContext() {
  const wv = getActiveWebview()
  if (!wv) return { text: '', url: '', title: '' }
  try {
    const text = await wv.executeJavaScript(
      `(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 9000)`
    )
    return { text, url: wv.getURL(), title: wv.getTitle() }
  } catch { return { text: '', url: '', title: '' } }
}

function getActiveWebview() {
  for (const wv of document.querySelectorAll('#webview-stack webview')) {
    if (wv.style.display && wv.style.display !== 'none') return wv
  }
  return null
}

function buildSystem(ctx) {
  let s = 'You are a helpful AI assistant embedded in a web browser sidebar. Be concise and clear. Use plain text without markdown syntax.'
  if (ctx.text) {
    s += `\n\nThe user is currently viewing:\nURL: ${ctx.url}\nTitle: ${ctx.title}\n\nPage content:\n${ctx.text}`
  } else {
    s += '\n\nNo page content is available — the user may be on a new tab or internal page.'
  }
  return s
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function appendMsg(role, text) {
  // Remove welcome message on first real message
  const welcome = chatArea.querySelector('.ai-welcome')
  if (welcome) welcome.remove()

  const wrap   = document.createElement('div')
  wrap.className = `ai-msg ai-msg-${role}`

  const bubble = document.createElement('div')
  bubble.className = 'ai-msg-bubble'
  bubble.textContent = text
  wrap.appendChild(bubble)

  if (role === 'ai') {
    const copy = document.createElement('button')
    copy.className = 'ai-copy-btn'
    copy.textContent = 'Copy'
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(text).catch(() => {})
      copy.textContent = 'Copied!'
      setTimeout(() => { copy.textContent = 'Copy' }, 1600)
    })
    wrap.appendChild(copy)
  }

  chatArea.appendChild(wrap)
  chatArea.scrollTop = chatArea.scrollHeight
}

function showTyping() {
  const wrap = document.createElement('div')
  wrap.className = 'ai-msg ai-msg-ai ai-typing'
  const bubble = document.createElement('div')
  bubble.className = 'ai-msg-bubble'
  bubble.innerHTML = '<div class="ai-dots"><span></span><span></span><span></span></div>'
  wrap.appendChild(bubble)
  chatArea.appendChild(wrap)
  chatArea.scrollTop = chatArea.scrollHeight
  return wrap
}

function showWelcome() {
  const el = document.createElement('div')
  el.className = 'ai-welcome'
  el.innerHTML = `
    <div class="ai-welcome-icon">✦</div>
    <p>Ask me anything about the current page, or click <strong>Summarize this page</strong> to get started.</p>
  `
  chatArea.appendChild(el)
}

function showKeyPrompt() {
  keySection.style.display = 'flex'
  keyInput.focus()
}

function setBusy(busy) {
  sendBtn.disabled   = busy
  summBtn.disabled   = busy
  inputEl.disabled   = busy
}

})()
