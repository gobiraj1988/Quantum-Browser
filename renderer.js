'use strict'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_TABS  = 20
const HOME_URL  = 'https://www.google.com'
const NEWTAB_URL = new URL('newtab.html', window.location.href).href

const GLOBE_SVG = `data:image/svg+xml,` +
  `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'` +
  ` fill='none' stroke='%239aa0a6' stroke-width='1.2' stroke-linecap='round'>` +
  `<circle cx='7' cy='7' r='5.5'/>` +
  `<path d='M7 1.5c-1.8 1.8-1.8 9 0 11M7 1.5c1.8 1.8 1.8 9 0 11M1.5 7h11'/>` +
  `</svg>`

const ICON_REFRESH = document.getElementById('btn-refresh').innerHTML
const ICON_STOP = `
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <line x1="2" y1="2" x2="12" y2="12"/>
    <line x1="12" y1="2" x2="2" y2="12"/>
  </svg>`

const COMMON_SITES = [
  'google.com', 'youtube.com', 'github.com', 'stackoverflow.com',
  'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'linkedin.com', 'amazon.com', 'wikipedia.org', 'netflix.com',
  'twitch.tv', 'discord.com', 'slack.com', 'notion.so', 'figma.com',
  'codepen.io', 'replit.com', 'vercel.com', 'netlify.com', 'npmjs.com',
  'developer.mozilla.org', 'w3schools.com', 'freecodecamp.org',
  'dev.to', 'medium.com', 'news.ycombinator.com', 'openai.com',
  'anthropic.com', 'microsoft.com', 'apple.com', 'gmail.com',
  'drive.google.com', 'calendar.google.com', 'maps.google.com',
]

// ── DOM References ────────────────────────────────────────────────────────────

const tabBar      = document.getElementById('tab-bar')
const newTabBtn   = document.getElementById('new-tab-btn')
const webviewStack = document.getElementById('webview-stack')
const urlInput    = document.getElementById('url-input')
const btnBack     = document.getElementById('btn-back')
const btnForward  = document.getElementById('btn-forward')
const btnRefresh  = document.getElementById('btn-refresh')
const btnHome     = document.getElementById('btn-home')
const lockIcon    = document.getElementById('lock-icon')
const spinner     = document.getElementById('loading-spinner')
const dropdown    = document.getElementById('suggestions-dropdown')
const statusText  = document.getElementById('status-text')

// ── Tab State ─────────────────────────────────────────────────────────────────

const tabsMap    = new Map()   // Map<id, tab>
let activeTabId  = null
let tabIdCounter = 0

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeUrl(raw) {
  const input = raw.trim()
  if (!input) return HOME_URL
  if (/^https?:\/\//i.test(input)) return input
  if (/^[\w-]+(\.[\w-]+)+/.test(input) && !input.includes(' ')) return 'https://' + input
  return 'https://www.google.com/search?q=' + encodeURIComponent(input)
}

function isSecure(url)    { return url.startsWith('https://') }
function isNewTabPage(url){ return !url || url === NEWTAB_URL || url.endsWith('/newtab.html') }

// ── Tab Creation ──────────────────────────────────────────────────────────────

function createTab(url = NEWTAB_URL) {
  if (tabsMap.size >= MAX_TABS) return null

  const id  = ++tabIdCounter
  const tab = { id, url, title: 'New Tab', favicon: null, isLoading: false, webviewEl: null, tabEl: null }

  const wv = document.createElement('webview')
  wv.setAttribute('src', url)
  wv.setAttribute('allowpopups', '')
  wv.style.display = 'none'
  webviewStack.appendChild(wv)
  tab.webviewEl = wv

  tabsMap.set(id, tab)
  bindWebviewEvents(tab)
  renderTabBar()
  activateTab(id)
  return tab
}

// ── Tab Closure ───────────────────────────────────────────────────────────────

function closeTab(id) {
  const tab = tabsMap.get(id)
  if (!tab) return

  let nextId = null
  if (id === activeTabId) {
    const ids = [...tabsMap.keys()]
    const idx = ids.indexOf(id)
    nextId = ids[idx + 1] ?? ids[idx - 1] ?? null
  }

  tab.webviewEl.remove()
  tabsMap.delete(id)

  if (tabsMap.size === 0) { createTab(); return }

  renderTabBar()

  if (nextId) activateTab(nextId)
  else if (id === activeTabId) activateTab(tabsMap.keys().next().value)
}

// ── Tab Activation ────────────────────────────────────────────────────────────

function activateTab(id) {
  const tab = tabsMap.get(id)
  if (!tab) return

  tabsMap.forEach((t, tid) => {
    t.webviewEl.style.display = tid === id ? 'flex' : 'none'
    if (t.tabEl) t.tabEl.classList.toggle('active', tid === id)
  })

  activeTabId = id
  syncToolbarToTab(tab)
}

// ── Tab Bar Rendering ─────────────────────────────────────────────────────────

function renderTabBar() {
  tabBar.querySelectorAll('.tab').forEach(el => el.remove())

  const fragment = document.createDocumentFragment()
  for (const [, tab] of tabsMap) {
    const el = buildTabElement(tab)
    tab.tabEl = el
    fragment.appendChild(el)
  }
  tabBar.insertBefore(fragment, newTabBtn)

  newTabBtn.disabled = tabsMap.size >= MAX_TABS
  newTabBtn.title = tabsMap.size >= MAX_TABS ? `Maximum ${MAX_TABS} tabs` : 'New tab (Ctrl+T)'
}

function buildTabElement(tab) {
  const isActive = tab.id === activeTabId
  const wrapper  = document.createElement('div')

  wrapper.innerHTML = `
    <div class="tab${isActive ? ' active' : ''}" data-tab-id="${tab.id}" role="tab">
      <div class="tab-icon-slot">
        <div class="tab-spinner${tab.isLoading ? ' active' : ''}"></div>
        <img class="tab-favicon"
             src="${escHtml(tab.favicon || GLOBE_SVG)}"
             alt=""
             style="${tab.isLoading ? 'display:none' : ''}">
      </div>
      <span class="tab-title">${escHtml(tab.title || 'New Tab')}</span>
      <button class="tab-close" title="Close tab (Ctrl+W)">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
             stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="1" y1="1" x2="9" y2="9"/>
          <line x1="9" y1="1" x2="1" y2="9"/>
        </svg>
      </button>
    </div>`

  const el  = wrapper.firstElementChild
  const img = el.querySelector('.tab-favicon')
  img.onerror = () => { img.src = GLOBE_SVG }
  return el
}

function updateTabEl(id) {
  const tab = tabsMap.get(id)
  if (!tab || !tab.tabEl) return

  const el      = tab.tabEl
  const sp      = el.querySelector('.tab-spinner')
  const fav     = el.querySelector('.tab-favicon')
  const title   = el.querySelector('.tab-title')

  el.className = 'tab' + (id === activeTabId ? ' active' : '')

  if (tab.isLoading) {
    sp.classList.add('active')
    fav.style.display = 'none'
  } else {
    sp.classList.remove('active')
    fav.style.display = 'block'
    fav.src = tab.favicon || GLOBE_SVG
  }

  title.textContent = tab.title || 'New Tab'
}

// ── Toolbar Sync ──────────────────────────────────────────────────────────────

function syncToolbarToTab(tab) {
  urlInput.value = isNewTabPage(tab.url) ? '' : tab.url
  updateLockIcon(tab.url)
  if (tab.isLoading) setToolbarLoading(true)
  else { setToolbarLoading(false); updateNavButtons() }
  document.title = tab.title ? `${tab.title} — MyBrowser` : 'MyBrowser'
  statusText.textContent = tab.isLoading ? 'Loading...' : 'Ready'
}

function setToolbarLoading(loading) {
  spinner.classList.toggle('active', loading)
  lockIcon.classList.toggle('hidden', loading)
  if (loading) {
    btnRefresh.innerHTML = ICON_STOP
    btnRefresh.title = 'Stop loading (Esc)'
    statusText.textContent = 'Loading...'
  } else {
    btnRefresh.innerHTML = ICON_REFRESH
    btnRefresh.title = 'Reload page (F5)'
  }
}

function updateNavButtons() {
  const tab = tabsMap.get(activeTabId)
  if (!tab) return
  try {
    btnBack.disabled    = !tab.webviewEl.canGoBack()
    btnForward.disabled = !tab.webviewEl.canGoForward()
  } catch (_) {
    btnBack.disabled = btnForward.disabled = true
  }
}

function updateLockIcon(url) {
  const secure = isSecure(url)
  lockIcon.className = 'lock-icon ' + (secure ? 'secure' : 'insecure')
  lockIcon.title = secure ? 'Connection is secure (HTTPS)' : 'Not secure (HTTP)'
}

function updateUrlBarFromTab(tab) {
  if (document.activeElement !== urlInput)
    urlInput.value = isNewTabPage(tab.url) ? '' : tab.url
  updateLockIcon(tab.url)
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(rawInput) {
  const tab = tabsMap.get(activeTabId)
  if (!tab) return
  const url = normalizeUrl(rawInput)
  tab.webviewEl.src = url
  urlInput.value    = url
  closeSuggestions()
  urlInput.blur()
}

// ── Webview Events (bound once per tab) ───────────────────────────────────────

function bindWebviewEvents(tab) {
  const wv = tab.webviewEl

  wv.addEventListener('did-start-loading', () => {
    tab.isLoading = true
    updateTabEl(tab.id)
    if (tab.id === activeTabId) setToolbarLoading(true)
  })

  wv.addEventListener('did-stop-loading', () => {
    tab.isLoading = false
    updateTabEl(tab.id)
    if (tab.id === activeTabId) { setToolbarLoading(false); updateNavButtons(); statusText.textContent = 'Done' }
  })

  wv.addEventListener('did-navigate', (e) => {
    tab.url    = e.url
    tab.favicon = null
    updateTabEl(tab.id)
    if (tab.id === activeTabId) { updateUrlBarFromTab(tab); updateNavButtons() }
  })

  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return
    tab.url = e.url
    if (tab.id === activeTabId) updateUrlBarFromTab(tab)
  })

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'New Tab'
    updateTabEl(tab.id)
    if (tab.id === activeTabId) document.title = `${tab.title} — MyBrowser`
  })

  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      tab.favicon = e.favicons[0]
      if (!tab.isLoading) updateTabEl(tab.id)
    }
  })

  wv.addEventListener('update-target-url', (e) => {
    if (tab.id === activeTabId)
      statusText.textContent = e.url || (tab.isLoading ? 'Loading...' : 'Ready')
  })

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return
    tab.isLoading = false
    updateTabEl(tab.id)
    if (tab.id === activeTabId) { setToolbarLoading(false); statusText.textContent = `Error: ${e.errorDescription}` }
  })
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

let suggestionList = []
let selectedIndex  = -1
let sessionHistory = []

function getSuggestions(query) {
  if (!query || query.length < 2) return []
  const q = query.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  const seen = new Set(); const results = []
  for (const url of sessionHistory) {
    const display = url.replace(/^https?:\/\//, '')
    if (display.toLowerCase().includes(q) && !seen.has(url)) { seen.add(url); results.push({ url, display, type: 'history' }) }
    if (results.length >= 4) break
  }
  for (const site of COMMON_SITES) {
    const url = 'https://' + site
    if (site.toLowerCase().includes(q) && !seen.has(url)) { seen.add(url); results.push({ url, display: site, type: 'site' }) }
    if (results.length >= 8) break
  }
  return results
}

function renderSuggestions(items) {
  suggestionList = items; selectedIndex = -1
  if (!items.length) { dropdown.innerHTML = ''; dropdown.classList.remove('visible'); return }
  dropdown.innerHTML = items.map((item, i) => `
    <div class="suggestion-item" data-index="${i}">
      <span class="sugg-icon">${item.type === 'history' ? '🕐' : '🌐'}</span>
      <span class="sugg-url">${escHtml(item.display)}</span>
      <span class="sugg-label">${item.type === 'history' ? 'History' : 'Site'}</span>
    </div>`).join('')
  dropdown.classList.add('visible')
}

function selectSuggestion(index) {
  dropdown.querySelectorAll('.suggestion-item').forEach((el, i) => el.classList.toggle('selected', i === index))
  if (index >= 0 && suggestionList[index]) { urlInput.value = suggestionList[index].url; selectedIndex = index }
  else selectedIndex = -1
}

function closeSuggestions() {
  dropdown.innerHTML = ''; dropdown.classList.remove('visible'); suggestionList = []; selectedIndex = -1
}

function trackHistory(url) {
  if (!url || isNewTabPage(url)) return
  sessionHistory = [url, ...sessionHistory.filter(u => u !== url)].slice(0, 100)
}

// ── Button Listeners ──────────────────────────────────────────────────────────

btnBack.addEventListener('click',    () => tabsMap.get(activeTabId)?.webviewEl.goBack())
btnForward.addEventListener('click', () => tabsMap.get(activeTabId)?.webviewEl.goForward())
btnHome.addEventListener('click',    () => navigate(HOME_URL))

btnRefresh.addEventListener('click', () => {
  const tab = tabsMap.get(activeTabId)
  if (!tab) return
  if (tab.isLoading) { tab.webviewEl.stop(); tab.isLoading = false; updateTabEl(activeTabId); setToolbarLoading(false) }
  else tab.webviewEl.reload()
})

// Tab bar — delegated events (one listener handles all tab pills)
tabBar.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.tab-close')
  if (closeBtn) {
    e.stopPropagation()
    const tabEl = closeBtn.closest('.tab')
    if (tabEl) closeTab(parseInt(tabEl.dataset.tabId, 10))
    return
  }
  const tabEl = e.target.closest('.tab')
  if (tabEl) activateTab(parseInt(tabEl.dataset.tabId, 10))
})

newTabBtn.addEventListener('click', () => createTab(NEWTAB_URL))

// ── URL Bar Listeners ─────────────────────────────────────────────────────────

urlInput.addEventListener('focus', () => { urlInput.select(); renderSuggestions(getSuggestions(urlInput.value)) })

urlInput.addEventListener('blur', () => {
  setTimeout(() => {
    closeSuggestions()
    const tab = tabsMap.get(activeTabId)
    if (tab) urlInput.value = isNewTabPage(tab.url) ? '' : tab.url
  }, 180)
})

urlInput.addEventListener('input', () => renderSuggestions(getSuggestions(urlInput.value)))

urlInput.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'Enter':
      e.preventDefault()
      if (selectedIndex >= 0 && suggestionList[selectedIndex]) {
        navigate(suggestionList[selectedIndex].url); trackHistory(suggestionList[selectedIndex].url)
      } else { navigate(urlInput.value); trackHistory(normalizeUrl(urlInput.value)) }
      break
    case 'Escape':
      if (dropdown.classList.contains('visible')) {
        closeSuggestions()
        const tab = tabsMap.get(activeTabId)
        if (tab) urlInput.value = isNewTabPage(tab.url) ? '' : tab.url
      } else urlInput.blur()
      break
    case 'ArrowDown': e.preventDefault(); selectSuggestion(Math.min(selectedIndex + 1, suggestionList.length - 1)); break
    case 'ArrowUp':   e.preventDefault(); selectSuggestion(selectedIndex <= 0 ? -1 : selectedIndex - 1); break
  }
})

dropdown.addEventListener('mousedown', (e) => {
  e.preventDefault()
  const item = e.target.closest('.suggestion-item')
  if (!item) return
  const idx = parseInt(item.dataset.index, 10)
  navigate(suggestionList[idx].url); trackHistory(suggestionList[idx].url)
})

document.addEventListener('click', (e) => { if (!e.target.closest('#url-bar-wrapper')) closeSuggestions() })

// ── Keyboard Shortcuts via IPC ────────────────────────────────────────────────

window.electronAPI?.onFocusUrlBar?.(() => { urlInput.focus(); urlInput.select() })
window.electronAPI?.onTabNew?.(() => createTab(NEWTAB_URL))
window.electronAPI?.onTabClose?.(() => { if (activeTabId !== null) closeTab(activeTabId) })
window.electronAPI?.onTabSwitch?.((zeroBasedIndex) => {
  const ids = [...tabsMap.keys()]
  const idx = zeroBasedIndex === 8 ? ids.length - 1 : Math.min(zeroBasedIndex, ids.length - 1)
  if (ids[idx] !== undefined) activateTab(ids[idx])
})

document.addEventListener('keydown', (e) => {
  const tab = tabsMap.get(activeTabId)
  if (!tab) return
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); tab.webviewEl.goBack() }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); tab.webviewEl.goForward() }
  if (e.key === 'F5' && !e.altKey)        { e.preventDefault(); tab.webviewEl.reload() }
})

// ── Start ─────────────────────────────────────────────────────────────────────

createTab(NEWTAB_URL)
