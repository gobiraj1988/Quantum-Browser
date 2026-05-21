const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Window controls ────────────────────────────────────────────────────────
  minimize:   () => ipcRenderer.send('window-minimize'),
  maximize:   () => ipcRenderer.send('window-maximize'),
  close:      () => ipcRenderer.send('window-close'),
  getVersion: () => ipcRenderer.invoke('get-version'),

  onMaximizeChange: (cb) => {
    ipcRenderer.on('window-maximized',   () => cb(true))
    ipcRenderer.on('window-unmaximized', () => cb(false))
  },

  // ── URL bar focus (Ctrl+L) ─────────────────────────────────────────────────
  onFocusUrlBar: (cb) => ipcRenderer.on('focus-url-bar', () => cb()),

  // ── Tab keyboard shortcuts ─────────────────────────────────────────────────
  onTabNew:    (cb) => ipcRenderer.on('tab-new',    ()         => cb()),
  onTabClose:  (cb) => ipcRenderer.on('tab-close',  ()         => cb()),
  onTabSwitch: (cb) => ipcRenderer.on('tab-switch', (_, index) => cb(index)),

  // ── Ad Blocker — toolbar ───────────────────────────────────────────────────
  onAdBlockCount: (cb) => ipcRenderer.on('adblocker-count', (_, count) => cb(count)),
  onAdBlockState: (cb) => ipcRenderer.on('adblocker-state', (_, state) => cb(state)),
  toggleAdBlock:  (en) => ipcRenderer.send('adblocker-toggle', en),
  getAdBlockState: ()  => ipcRenderer.invoke('adblocker-get-state'),

  // ── Ad Blocker — settings panel ───────────────────────────────────────────
  getSettings:         ()       => ipcRenderer.invoke('adblocker-get-settings'),
  addToWhitelist:      (domain) => ipcRenderer.invoke('adblocker-add-whitelist',    domain),
  removeFromWhitelist: (domain) => ipcRenderer.invoke('adblocker-remove-whitelist', domain),
  forceUpdateFilters:  ()       => ipcRenderer.invoke('adblocker-force-update'),
  addCustomRule:       (rule)   => ipcRenderer.invoke('adblocker-add-custom-rule',    rule),
  removeCustomRule:    (rule)   => ipcRenderer.invoke('adblocker-remove-custom-rule', rule),
  setStrictMode:       (en)     => ipcRenderer.invoke('adblocker-toggle-strict', en),
  clearStats:          ()       => ipcRenderer.invoke('adblocker-clear-stats'),

  onSettingsUpdate:     (cb) => ipcRenderer.on('adblocker-settings-update', (_, d) => cb(d)),
  onFilterUpdateStatus: (cb) => ipcRenderer.on('adblocker-update-status',   (_, m) => cb(m)),

  // ── Open settings / stats windows ─────────────────────────────────────────
  openSettings:     () => ipcRenderer.invoke('open-settings'),
  openAdblockStats: () => ipcRenderer.invoke('open-adblock-stats'),

  // ── Ad block stats (used by adblock-stats.html) ────────────────────────────
  ultraGetStats: () => ipcRenderer.invoke('ultra-get-stats'),

  // ── AI Assistant ───────────────────────────────────────────────────────────
  aiChat:    (payload) => ipcRenderer.invoke('ai-chat',     payload),
  aiGetKey:  ()        => ipcRenderer.invoke('ai-get-key'),
  aiSaveKey: (data)    => ipcRenderer.invoke('ai-save-key', data),

  // ── Privacy engine ─────────────────────────────────────────────────────────
  privacyGetSettings:  ()       => ipcRenderer.invoke('privacy-get-settings'),
  privacySaveSettings: (patch)  => ipcRenderer.invoke('privacy-save-settings', patch),
  privacyClearData:    ()       => ipcRenderer.invoke('privacy-clear-data'),
  privacyGetScore:     ()       => ipcRenderer.invoke('privacy-get-score'),
  onPrivacyScoreUpdate: (cb)    => ipcRenderer.on('privacy-score-update', (_, score) => cb(score)),

  // ── Download manager ────────────────────────────────────────────────────────
  dlCheck:             (url)  => ipcRenderer.invoke('dl-check',            url),
  dlStart:             (opts) => ipcRenderer.invoke('dl-start',            opts),
  dlPause:             (id)   => ipcRenderer.invoke('dl-pause',            id),
  dlResume:            (id)   => ipcRenderer.invoke('dl-resume',           id),
  dlCancel:            (id)   => ipcRenderer.invoke('dl-cancel',           id),
  dlOpenFile:          (fp)   => ipcRenderer.invoke('dl-open-file',        fp),
  dlOpenFolder:        (fp)   => ipcRenderer.invoke('dl-open-folder',      fp),
  dlGetAll:            ()     => ipcRenderer.invoke('dl-get-all'),
  dlClearHistory:      ()     => ipcRenderer.invoke('dl-clear-history'),
  dlRemoveHistory:     (idx)  => ipcRenderer.invoke('dl-remove-history',   idx),
  openDownloadManager: ()     => ipcRenderer.invoke('open-download-manager'),
  openBulkDownloader:  ()     => ipcRenderer.invoke('open-bulk-downloader'),
  dlPlaylistInfo:      (url)  => ipcRenderer.invoke('dl-playlist-info',  url),
  dlSaveCsv:           (csv)  => ipcRenderer.invoke('dl-save-csv',       csv),
  onDlUpdate:          (cb)   => ipcRenderer.on('dl-update',          (_, d) => cb(d)),
  onDlHistoryUpdate:   (cb)   => ipcRenderer.on('dl-history-update',  (_, d) => cb(d)),

  // ── Context menu IPC ──────────────────────────────────────────────────────
  ctxSavePdf: (wcId) => ipcRenderer.invoke('ctx-save-pdf', wcId),
  ctxInspect: (data) => ipcRenderer.invoke('ctx-inspect',  data),

  // ── Performance monitor ───────────────────────────────────────────────────
  onPerfUpdate:    (cb) => ipcRenderer.on('perf-update', (_, d) => cb(d)),
  reportPageLoad:  (ms) => ipcRenderer.send('perf-page-load', ms),
  onSecurityWarn:  (cb) => ipcRenderer.on('security-warning', (_, d) => cb(d)),

  // ── DNS prefetch ──────────────────────────────────────────────────────────
  dnsPrefetch: (hosts) => ipcRenderer.send('dns-prefetch', hosts),

  // ── Proxy / VPN ─────────────────────────────────────────────────────────────
  proxyGetState:         ()      => ipcRenderer.invoke('proxy-get-state'),
  proxyFetchList:        (ctry)  => ipcRenderer.invoke('proxy-fetch-list',        ctry),
  proxyTestOne:          (proxy) => ipcRenderer.invoke('proxy-test-one',          proxy),
  proxyConnect:          (proxy) => ipcRenderer.invoke('proxy-connect',           proxy),
  proxyDisconnect:       ()      => ipcRenderer.invoke('proxy-disconnect'),
  proxyGetRealIp:        ()      => ipcRenderer.invoke('proxy-get-real-ip'),
  proxyGetProxyIp:       ()      => ipcRenderer.invoke('proxy-get-proxy-ip'),
  proxyToggleAutoSwitch: (val)   => ipcRenderer.invoke('proxy-toggle-autoswitch', val),
  openProxyManager:      ()      => ipcRenderer.invoke('open-proxy-manager'),
  onProxyState:          (cb)    => ipcRenderer.on('proxy-state', (_, d) => cb(d)),
})
