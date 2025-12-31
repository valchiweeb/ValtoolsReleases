const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Steam functions
    getSteamPath: () => ipcRenderer.invoke('get-steam-path'),
    getSteamToolsPath: (steamPath) => ipcRenderer.invoke('get-steam-tools-path', steamPath),

    // Game functions
    fetchGameInfo: (appId) => ipcRenderer.invoke('fetch-game-info', appId),
    injectGame: (gameData) => ipcRenderer.invoke('inject-game', gameData),
    removeGame: (appId) => ipcRenderer.invoke('remove-game', appId),
    getInjectedGames: () => ipcRenderer.invoke('get-injected-games'),

    // Settings
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    browseSteamPath: () => ipcRenderer.invoke('browse-steam-path'),

    // Activate Inject
    activateInject: () => ipcRenderer.invoke('activate-inject'),

    // Restart Steam
    restartSteam: () => ipcRenderer.invoke('restart-steam'),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window')
});
