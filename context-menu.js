'use strict'
// Smart context menu — different items based on what was right-clicked
;(function () {

let menuEl   = null   // the single persistent menu div
let activeWv = null   // webview that triggered the last menu

// ── Bootstrap: inject container + global dismiss listeners ────────────────────

function boot () {
  if (document.getElementById('ctx-menu')) return

  menuEl    = document.createElement('div')
  menuEl.id = 'ctx-menu'
  menuEl.setAttribute('role', 'menu')
  menuEl.style.cssText = 'display:none;left:-9999px;top:-9999px'
  document.body.appendChild(menuEl)

  // Dismiss on outside click
  document.addEventListener('mousedown', e => {
    if (menuEl && menuEl.style.display !== 'none' && !menuEl.contains(e.target)) {
      closeMenu()
    }
  })
  // Dismiss on Escape
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu() })

  // Watch webview-stack for new webviews
  const stack = document.getElementById('webview-stack')
  if (!stack) return
  stack.querySelectorAll('webview').forEach(attachToWebview)
  new MutationObserver(mutations =>
    mutations.forEach(m =>
      m.addedNodes.forEach(n => { if (n.tagName === 'WEBVIEW') attachToWebview(n) })
    )
  ).observe(stack, { childList: true })
}

// ── Attach context-menu event to one webview ──────────────────────────────────

function attachToWebview (wv) {
  wv.addEventListener('context-menu', e => {
    const rect = wv.getBoundingClientRect()
    const x    = rect.left + e.params.x
    const y    = rect.top  + e.params.y
    openMenu(e.params, x, y, wv)
  })
}

// ── Open menu ─────────────────────────────────────────────────────────────────

function openMenu (params, rawX, rawY, wv) {
  activeWv = wv
  menuEl.innerHTML = ''
  menuEl.className = ''    // reset animation class
  menuEl.style.display = 'none'

  buildSections(params).forEach((section, idx, arr) => {
    if (section.header) {
      menuEl.appendChild(mkHeader(section.header))
    }
    section.items.forEach(it => menuEl.appendChild(mkItem(it)))
    if (idx < arr.length - 1) menuEl.appendChild(mkSep())
  })

  if (!menuEl.children.length) return

  // Show off-screen first to measure size
  menuEl.style.left    = '-9999px'
  menuEl.style.top     = '-9999px'
  menuEl.style.display = 'block'

  requestAnimationFrame(() => {
    const W  = window.innerWidth
    const H  = window.innerHeight
    const mW = menuEl.offsetWidth  || 230
    const mH = menuEl.offsetHeight || 200

    // Flip horizontally / vertically if near window edges
    let x = rawX + 3
    let y = rawY + 3
    if (x + mW > W - 8) x = rawX - mW - 3
    if (y + mH > H - 8) y = rawY - mH - 3
    x = Math.max(4, x)
    y = Math.max(4, y)

    menuEl.style.left = x + 'px'
    menuEl.style.top  = y + 'px'

    // Trigger enter animation
    void menuEl.offsetWidth   // reflow
    menuEl.classList.add('ctx-open')
  })
}

// ── Close menu ────────────────────────────────────────────────────────────────

function closeMenu () {
  if (!menuEl) return
  menuEl.style.display = 'none'
  menuEl.className     = ''
  menuEl.innerHTML     = ''
}

// ── Build sections based on what was right-clicked ────────────────────────────
// Each section = { header?, items[] }
// Items are separated by dividers automatically between sections.

function buildSections (params) {
  const { mediaType, linkURL, srcURL, selectionText } = params
  const sections = []

  // ── VIDEO ──────────────────────────────────────────────────────────────────
  if (mediaType === 'video') {
    sections.push({
      header: 'Video',
      items: [
        { icon: '⬇', label: 'Download video',       cls: 'ctx-item-green', action: 'video-dl'    },
        { icon: '♪', label: 'Download audio only',  action: 'video-audio'  },
        { icon: '🖼', label: 'Download thumbnail',   action: 'video-thumb'  },
        { icon: '⛶', label: 'Picture in Picture',   action: 'video-pip'    },
        ...(srcURL ? [{ icon: '🔗', label: 'Copy video address', action: 'copy', data: srcURL }] : []),
      ],
    })
  }

  // ── IMAGE ──────────────────────────────────────────────────────────────────
  if (mediaType === 'image' && srcURL) {
    sections.push({
      header: 'Image',
      items: [
        { icon: '🔗', label: 'Copy image address',    action: 'copy',      data: srcURL },
        { icon: '↗',  label: 'Open image in new tab', cls: 'ctx-item-green', action: 'new-tab', data: srcURL },
        { icon: '⬇', label: 'Download image',         action: 'img-dl',   data: srcURL },
      ],
    })
  }

  // ── LINK ───────────────────────────────────────────────────────────────────
  if (linkURL) {
    sections.push({
      items: [
        { icon: '↗',  label: 'Open in new tab',   cls: 'ctx-item-green', action: 'new-tab', data: linkURL },
        { icon: '🔗', label: 'Copy link address',  action: 'copy',        data: linkURL },
      ],
    })
  }

  // ── TEXT SELECTION ─────────────────────────────────────────────────────────
  if (selectionText && selectionText.trim().length > 0) {
    const q   = selectionText.trim()
    const lbl = q.length > 30 ? q.slice(0, 30) + '…' : q
    sections.push({
      items: [
        { icon: '🔍', label: 'Search "' + lbl + '" on Google', action: 'search-google',  data: q },
        { icon: '✦',  label: 'Explain with AI',   cls: 'ctx-item-ai', action: 'ai-explain', data: q },
        { icon: '✓',  label: 'Check grammar',      cls: 'ctx-item-ai', action: 'ai-grammar', data: q },
      ],
    })
  }

  // ── PAGE (always shown) ────────────────────────────────────────────────────
  sections.push({
    header: sections.length ? 'This Page' : null,
    items: [
      { icon: '✦',  label: 'Summarize with AI',  cls: 'ctx-item-ai',   action: 'ai-summarize' },
      { icon: '🌐', label: 'Translate this page', cls: 'ctx-item-blue', action: 'translate'    },
      { icon: '⬇', label: 'Save page as PDF',                           action: 'save-pdf'     },
    ],
  })

  sections.push({
    items: [
      { icon: '</>', label: 'View page source',  action: 'view-source' },
      { icon: '🔧',  label: 'Inspect element',   action: 'inspect', data: { x: params.x, y: params.y } },
    ],
  })

  return sections
}

// ── Element builders ──────────────────────────────────────────────────────────

function mkItem ({ icon, label, cls, action, data }) {
  const btn = document.createElement('button')
  btn.className = 'ctx-item' + (cls ? ' ' + cls : '')
  btn.setAttribute('role', 'menuitem')

  const ic = document.createElement('span')
  ic.className   = 'ctx-icon'
  ic.textContent = icon

  const tx = document.createElement('span')
  tx.className   = 'ctx-label-text'
  tx.textContent = label

  btn.appendChild(ic)
  btn.appendChild(tx)
  btn.addEventListener('click', () => { closeMenu(); handleAction(action, data) })
  return btn
}

function mkSep () {
  const d = document.createElement('div')
  d.className = 'ctx-sep'
  return d
}

function mkHeader (text) {
  const d = document.createElement('div')
  d.className   = 'ctx-section-header'
  d.textContent = text
  return d
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleAction (action, data) {
  const wv     = activeWv
  const bridge = window.aiBridge

  switch (action) {

    // ── Video downloads ───────────────────────────────────────────────────────
    case 'video-dl':
    case 'video-audio': {
      const url = wv?.getURL?.() || ''
      if (!url) break
      try {
        await window.electronAPI.dlStart({
          url,
          quality: action === 'video-audio' ? 'audio' : '720p',
          format:  action === 'video-audio' ? 'audio' : 'mp4',
        })
      } catch (_) {}
      break
    }

    case 'video-thumb': {
      const url  = wv?.getURL?.() || ''
      const ytId = url.match(/(?:v=|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1]
      window._newTab?.(
        ytId ? 'https://img.youtube.com/vi/' + ytId + '/maxresdefault.jpg' : url
      )
      break
    }

    case 'video-pip': {
      if (!wv) break
      try {
        await wv.executeJavaScript(
          '(function(){var v=document.querySelector("video");' +
          'if(v&&document.pictureInPictureEnabled)v.requestPictureInPicture().catch(function(){})})()'
        )
      } catch (_) {}
      break
    }

    // ── Image download ────────────────────────────────────────────────────────
    case 'img-dl': {
      if (!data) break
      try {
        const res   = await fetch(data)
        const blob  = await res.blob()
        const burl  = URL.createObjectURL(blob)
        const fname = data.split('/').pop().split('?')[0] || 'image.jpg'
        const a     = Object.assign(document.createElement('a'), { href: burl, download: fname })
        a.click()
        setTimeout(() => URL.revokeObjectURL(burl), 5000)
      } catch (_) {
        window._newTab?.(data)   // fallback: open in new tab
      }
      break
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    case 'new-tab': {
      if (data) window._newTab?.(data)
      break
    }

    // ── Clipboard ─────────────────────────────────────────────────────────────
    case 'copy': {
      if (data) navigator.clipboard.writeText(data).catch(() => {})
      break
    }

    // ── Search ────────────────────────────────────────────────────────────────
    case 'search-google': {
      if (data) {
        window._newTab?.('https://www.google.com/search?q=' + encodeURIComponent(data))
      }
      break
    }

    // ── AI tools (uses free API chain via ai-tools.js) ────────────────────────
    case 'ai-explain': {
      if (!data) break
      bridge?.openSidebar()
      window.aiTools?.runFreeTool(
        'Explain the given text in very simple, plain language. Use short sentences. Be brief. No markdown.',
        'Explain simply:\n\n' + data.slice(0, 2500)
      )
      break
    }

    case 'ai-grammar': {
      if (!data) break
      bridge?.openSidebar()
      window.aiTools?.runFreeTool(
        'Check for spelling, grammar, punctuation, and clarity issues. List each problem with a corrected version. No markdown symbols. If text is correct, say "No issues found."',
        'Grammar check:\n\n' + data.slice(0, 2500)
      )
      break
    }

    case 'ai-summarize': {
      bridge?.openSidebar()
      // Trigger the sidebar's own summarize button so it handles busy state properly
      document.getElementById('ai-summarize-btn')?.click()
      break
    }

    // ── Translation ───────────────────────────────────────────────────────────
    case 'translate': {
      bridge?.openSidebar()
      // Open the translate language picker in the sidebar
      setTimeout(() => document.getElementById('ai-translate-btn')?.click(), 120)
      break
    }

    // ── Save as PDF ───────────────────────────────────────────────────────────
    case 'save-pdf': {
      if (!wv) break
      try {
        const wcId = wv.getWebContentsId?.()
        if (wcId != null) await window.electronAPI.ctxSavePdf(wcId)
      } catch (err) {
        console.error('[ctx-save-pdf]', err.message)
      }
      break
    }

    // ── View source ───────────────────────────────────────────────────────────
    case 'view-source': {
      const url = wv?.getURL?.() || ''
      if (url && !url.startsWith('view-source:') && !url.startsWith('blob:')) {
        window._newTab?.('view-source:' + url)
      }
      break
    }

    // ── Inspect element ───────────────────────────────────────────────────────
    case 'inspect': {
      if (!wv || !data) break
      try {
        const wcId = wv.getWebContentsId?.()
        if (wcId != null) await window.electronAPI.ctxInspect({ wcId, x: data.x, y: data.y })
      } catch (_) {}
      break
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()

})()
