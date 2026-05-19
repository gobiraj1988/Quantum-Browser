'use strict'

const api = window.electronAPI

// ── State ─────────────────────────────────────────────────────────────────────

const activeMap = new Map()   // id → dl object
let historyList = []
let query       = ''

// ── DOM ───────────────────────────────────────────────────────────────────────

const listActive   = document.getElementById('list-active')
const emptyActive  = document.getElementById('empty-active')
const listHistory  = document.getElementById('list-history')
const emptyHistory = document.getElementById('empty-history')
const badge        = document.getElementById('active-badge')
const searchEl     = document.getElementById('search')
const clearBtn     = document.getElementById('btn-clear')

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function shortUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return String(url).slice(0, 40) }
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
         ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function iconClass(dl) {
  if (dl.status === 'complete')  return 'ico-done'
  if (dl.status === 'error')     return 'ico-error'
  if (dl.status === 'paused')    return 'ico-paused'
  if (dl.format  === 'audio')    return 'ico-audio'
  return 'ico-video'
}

function iconGlyph(dl) {
  if (dl.status === 'complete')  return '✓'
  if (dl.status === 'error')     return '✕'
  if (dl.status === 'paused')    return '⏸'
  if (dl.format  === 'audio')    return '♪'
  return '▶'
}

// ── Render one active download item ──────────────────────────────────────────

function buildActiveItem(dl) {
  const name  = dl.filename || shortUrl(dl.url)
  const pct   = dl.pct ? Math.min(100, dl.pct) : 0
  const barCls = ['downloading','paused','complete','error','starting'].includes(dl.status)
                  ? dl.status : 'downloading'

  // Action buttons
  let btns = ''
  if (dl.status === 'downloading')
    btns += `<button class="db pause"       data-act="pause"        data-id="${dl.id}" title="Pause">⏸</button>`
  if (dl.status === 'paused')
    btns += `<button class="db resume"      data-act="resume"       data-id="${dl.id}" title="Resume">▶</button>`
  if (dl.status === 'complete') {
    btns += `<button class="db open-file"   data-act="open-file"    data-id="${dl.id}" data-fp="${esc(dl.filePath)}" title="Open file">⎋</button>`
    btns += `<button class="db show-folder" data-act="show-folder"  data-id="${dl.id}" data-fp="${esc(dl.filePath)}" title="Show in folder">📁</button>`
  }
  if (['downloading','paused','starting'].includes(dl.status))
    btns += `<button class="db cancel"      data-act="cancel"       data-id="${dl.id}" title="Cancel">✕</button>`
  if (['complete','error','cancelled'].includes(dl.status))
    btns += `<button class="db dismiss"     data-act="dismiss"      data-id="${dl.id}" title="Remove">✕</button>`

  // Stats row
  let stats = ''
  if (dl.speed)    stats += `<span class="dl-stat"><span class="stat-lbl">Speed</span>&nbsp;<span class="stat-val">${esc(dl.speed)}</span></span>`
  if (dl.eta && dl.status === 'downloading')
                   stats += `<span class="dl-stat"><span class="stat-lbl">ETA</span>&nbsp;<span class="stat-val">${esc(dl.eta)}</span></span>`
  if (dl.totalSize)stats += `<span class="dl-stat"><span class="stat-lbl">Size</span>&nbsp;<span class="stat-val">${esc(dl.totalSize)}</span></span>`
  if (dl.quality)  stats += `<span class="dl-stat"><span class="stat-lbl">Quality</span>&nbsp;<span class="stat-val">${esc(dl.quality)}</span></span>`

  const label = dl.status.charAt(0).toUpperCase() + dl.status.slice(1)

  return `<div class="dl-item" data-id="${dl.id}">
    <div class="dl-r1">
      <div class="dl-icon ${iconClass(dl)}">${iconGlyph(dl)}</div>
      <div class="dl-info">
        <div class="dl-name" title="${esc(name)}">${esc(name)}</div>
        <div class="dl-url">${esc(shortUrl(dl.url))}</div>
      </div>
      <div class="dl-btns">${btns}</div>
    </div>
    <div class="dl-r2">
      <div class="dl-bar-bg"><div class="dl-bar ${barCls}" style="width:${pct.toFixed(1)}%"></div></div>
      <span class="dl-pct">${pct.toFixed(0)}%</span>
    </div>
    <div class="dl-r3">
      ${stats}
      <span class="chip chip-${dl.status}">${label}</span>
    </div>
  </div>`
}

// ── Render one history item ───────────────────────────────────────────────────

function buildHistItem(dl, idx) {
  const name  = dl.filename || shortUrl(dl.url)
  const when  = fmtDate(dl.endTime || dl.startTime)
  const q     = dl.quality || ''
  const extra = [when, q, shortUrl(dl.url)].filter(Boolean).join(' · ')

  let btns = ''
  if (dl.status === 'complete' && dl.filePath) {
    btns += `<button class="db open-file"   data-act="open-file"   data-fp="${esc(dl.filePath)}" title="Open file">⎋</button>`
    btns += `<button class="db show-folder" data-act="show-folder" data-fp="${esc(dl.filePath)}" title="Show in folder">📁</button>`
  }
  btns += `<button class="db dismiss" data-act="remove-hist" data-idx="${idx}" title="Remove from history">✕</button>`

  return `<div class="hist-item" data-hist-idx="${idx}">
    <div class="hist-icon ${iconClass(dl)}">${iconGlyph(dl)}</div>
    <div class="hist-info">
      <div class="hist-name" title="${esc(name)}">${esc(name)}</div>
      <div class="hist-meta">${esc(extra)}</div>
    </div>
    <div class="hist-btns">${btns}</div>
  </div>`
}

// ── Main render ───────────────────────────────────────────────────────────────

function render() {
  const q = query.toLowerCase()

  const activeList = [...activeMap.values()]
    .filter(dl => !q || (dl.filename + dl.url).toLowerCase().includes(q))

  const downloading = activeList.filter(d => d.status === 'downloading').length
  badge.textContent = downloading + ' active'
  badge.className   = downloading > 0 ? '' : 'zero'

  if (activeList.length === 0) {
    listActive.innerHTML = ''
    emptyActive.style.display = 'block'
  } else {
    emptyActive.style.display = 'none'
    listActive.innerHTML = activeList.map(buildActiveItem).join('')
  }

  const histList = historyList
    .filter(dl => !q || (dl.filename + dl.url).toLowerCase().includes(q))

  if (histList.length === 0) {
    listHistory.innerHTML = ''
    emptyHistory.style.display = 'block'
  } else {
    emptyHistory.style.display = 'none'
    listHistory.innerHTML = histList.map((dl, i) => buildHistItem(dl, i)).join('')
  }
}

// ── Button delegation ─────────────────────────────────────────────────────────

document.addEventListener('click', async e => {
  const el  = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const id  = el.dataset.id  !== undefined ? parseInt(el.dataset.id)  : null
  const fp  = el.dataset.fp  || ''
  const idx = el.dataset.idx !== undefined ? parseInt(el.dataset.idx) : null

  switch (act) {
    case 'pause':       await api.dlPause(id);         break
    case 'resume':      await api.dlResume(id);        break
    case 'cancel':      await api.dlCancel(id);        break
    case 'open-file':   await api.dlOpenFile(fp);      break
    case 'show-folder': await api.dlOpenFolder(fp);    break
    case 'dismiss':
      activeMap.delete(id)
      render()
      break
    case 'remove-hist':
      await api.dlRemoveHistory(idx)
      break
  }
})

// ── IPC listeners ─────────────────────────────────────────────────────────────

api.onDlUpdate(dl => {
  if (dl.status === 'cancelled') {
    activeMap.delete(dl.id)
  } else {
    activeMap.set(dl.id, dl)
  }
  render()
})

api.onDlHistoryUpdate(list => {
  historyList = list
  render()
})

// ── Search ────────────────────────────────────────────────────────────────────

searchEl.addEventListener('input', () => {
  query = searchEl.value.trim()
  render()
})

// ── Clear history ─────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all download history? This cannot be undone.')) return
  await api.dlClearHistory()
})

// ── Bulk downloader ───────────────────────────────────────────────────────────

document.getElementById('btn-bulk').addEventListener('click', () => {
  api.openBulkDownloader()
})

// ── Export history as CSV ─────────────────────────────────────────────────────

document.getElementById('btn-export-csv').addEventListener('click', async () => {
  if (!historyList.length) { alert('No download history to export.'); return }
  const headers = ['Filename', 'URL', 'Status', 'Size', 'Quality', 'Date']
  const rows = historyList.map(dl => [
    dl.filename  || '',
    dl.url       || '',
    dl.status    || '',
    dl.totalSize || '',
    dl.quality   || '',
    dl.endTime ? new Date(dl.endTime).toLocaleString() : '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  await api.dlSaveCsv(csv)
})

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchEl.focus() }
  if (e.key === 'Escape' && query) { searchEl.value = ''; query = ''; render() }
})

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const { active, history } = await api.dlGetAll()
    for (const dl of active) activeMap.set(dl.id, dl)
    historyList = history
  } catch (_) {}
  render()
}

init()
