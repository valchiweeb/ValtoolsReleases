const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    focusWindow: () => ipcRenderer.invoke('focus-window'),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectSteamPath: () => ipcRenderer.invoke('select-steam-path'),

    // Cloud sync via Python backend
    loadCloudData: () => ipcRenderer.invoke('load-cloud-data'),
    saveCloudData: (adminHash, accounts) => ipcRenderer.invoke('save-cloud-data', adminHash, accounts),

    // Steam Guard sync via Python backend
    sgLoginAdmin: (password) => ipcRenderer.invoke('sg-login-admin', password),
    sgLoginGuest: (code) => ipcRenderer.invoke('sg-login-guest', code),
    sgSetupAdmin: (password) => ipcRenderer.invoke('sg-setup-admin', password),
    sgSaveAccounts: (masterKey, accounts) => ipcRenderer.invoke('sg-save-accounts', masterKey, accounts),
    sgCreateVoucher: (masterKey, days) => ipcRenderer.invoke('sg-create-voucher', masterKey, days),

    // Overlay
    showOverlay: (text, subtext) => ipcRenderer.invoke('show-overlay', text, subtext),
    hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
    updateOverlay: (text, subtext, color) => ipcRenderer.invoke('update-overlay', text, subtext, color),
    destroyOverlay: () => ipcRenderer.invoke('destroy-overlay'),

    // Python automation
    runInjection: (accountData, steamPath) => ipcRenderer.invoke('run-injection', accountData, steamPath),
    abortInjection: () => ipcRenderer.invoke('abort-injection'),

    // Listen for injection status updates
    onInjectionStatus: (callback) => {
        ipcRenderer.on('injection-status', (event, data) => callback(data));
    },

    // Listen for overlay updates (for overlay window)
    onOverlayUpdate: (callback) => {
        ipcRenderer.on('update-overlay', (event, data) => callback(data));
    },

    // Auto-update APIs
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),

    // Auto-update event listeners
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, info) => callback(info));
    },
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (event, progress) => callback(progress));
    },
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, info) => callback(info));
    },
    onUpdateNotAvailable: (callback) => {
        ipcRenderer.on('update-not-available', (event) => callback());
    },
    onCheckingForUpdate: (callback) => {
        ipcRenderer.on('checking-for-update', (event) => callback());
    },
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, message) => callback(message));
    },

    // External links
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Game Injection APIs
    getSteamPathInject: () => ipcRenderer.invoke('get-steam-path-inject'),
    getSteamToolsPath: (steamPath) => ipcRenderer.invoke('get-steam-tools-path', steamPath),
    fetchGameInfo: (appId) => ipcRenderer.invoke('fetch-game-info', appId),
    injectGame: (gameData) => ipcRenderer.invoke('inject-game', gameData),
    removeGame: (appId) => ipcRenderer.invoke('remove-game', appId),
    getInjectedGames: () => ipcRenderer.invoke('get-injected-games'),
    activateInject: () => ipcRenderer.invoke('activate-inject'),
    restartSteamInject: () => ipcRenderer.invoke('restart-steam-inject'),
    browseSteamFolder: () => ipcRenderer.invoke('browse-steam-folder')
});
