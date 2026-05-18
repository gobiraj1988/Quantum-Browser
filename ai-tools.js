'use strict'
// AI tools + smart URL suggestions — all free, no API key
;(function () {

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
      setupUrlSuggestions()
    }
  }, 100)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()

window.aiTools = { runFreeTool, getSelText }

})()
