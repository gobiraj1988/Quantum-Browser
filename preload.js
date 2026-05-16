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

  // ── Open settings window ───────────────────────────────────────────────────
  openSettings: () => ipcRenderer.invoke('open-settings'),
})
