const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');

// SteamTools download URL
const STEAMTOOLS_URL = 'https://steamtools.net/res/st-setup-1.8.20.exe';

// Settings path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const dataPath = path.join(app.getPath('userData'), 'injected_games.json');

// ========================================
// Settings Management
// ========================================

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveSettings(settings) {
    try {
        const current = loadSettings();
        const updated = { ...current, ...settings };
        fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

// ========================================
// Steam Path Detection
// ========================================

function getSteamPath() {
    // Check settings first
    const settings = loadSettings();
    if (settings.customSteamPath && fs.existsSync(settings.customSteamPath)) {
        return settings.customSteamPath;
    }

    const possiblePaths = [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        'D:\\Steam',
        'D:\\Program Files (x86)\\Steam',
        'E:\\Steam'
    ];

    // Try registry
    try {
        const { execSync } = require('child_process');
        const result = execSync('reg query "HKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
        const match = result.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match && match[1]) {
            const steamPath = match[1].trim().replace(/\//g, '\\');
            if (fs.existsSync(steamPath)) {
                return steamPath;
            }
        }
    } catch (e) { }

    try {
        const { execSync } = require('child_process');
        const result = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf8' });
        const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match && match[1]) {
            const steamPath = match[1].trim();
            if (fs.existsSync(steamPath)) {
                return steamPath;
            }
        }
    } catch (e) { }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }

    return null;
}

function getSteamToolsPath(steamPath) {
    // Lua scripts go to: Steam\config\stplug-in\
    const stPluginPath = path.join(steamPath, 'config', 'stplug-in');
    if (!fs.existsSync(stPluginPath)) {
        try {
            fs.mkdirSync(stPluginPath, { recursive: true });
        } catch (e) {
            console.error('Failed to create stplug-in folder:', e);
        }
    }
    return stPluginPath;
}

function getSteamAppsFolders(steamPath) {
    const folders = [];
    const mainSteamApps = path.join(steamPath, 'steamapps');

    if (fs.existsSync(mainSteamApps)) {
        folders.push(mainSteamApps);
    }

    const libraryFoldersPath = path.join(mainSteamApps, 'libraryfolders.vdf');
    if (fs.existsSync(libraryFoldersPath)) {
        try {
            const content = fs.readFileSync(libraryFoldersPath, 'utf8');
            const pathMatches = content.match(/"path"\s+"([^"]+)"/g);
            if (pathMatches) {
                pathMatches.forEach(match => {
                    const pathMatch = match.match(/"path"\s+"([^"]+)"/);
                    if (pathMatch && pathMatch[1]) {
                        const libPath = path.join(pathMatch[1].replace(/\\\\/g, '\\'), 'steamapps');
                        if (fs.existsSync(libPath) && !folders.includes(libPath)) {
                            folders.push(libPath);
                        }
                    }
                });
            }
        } catch (e) { }
    }

    return folders;
}

// ========================================
// Activate Inject (Copy PluginSteam DLLs)
// ========================================

function getPluginSteamPath() {
    // Get the path to the PluginSteam folder in assets
    const folderPath = path.join(__dirname, 'assets', 'PluginSteam');
    if (fs.existsSync(folderPath)) {
        return folderPath;
    }
    return null;
}

function getStplugInSourcePath() {
    // Get the path to the stplug-in folder in assets
    const folderPath = path.join(__dirname, 'assets', 'stplug-in');
    if (fs.existsSync(folderPath)) {
        return folderPath;
    }
    return null;
}

function copyFolderSync(src, dest) {
    // Create destination folder if doesn't exist
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // Read all files/folders in source
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function activateInject() {
    try {
        const steamPath = getSteamPath();
        if (!steamPath) {
            return { success: false, error: 'Steam path tidak ditemukan. Atur di Settings.' };
        }

        // Copy PluginSteam DLLs to Steam folder
        const pluginSteamPath = getPluginSteamPath();
        if (!pluginSteamPath) {
            return { success: false, error: 'Folder PluginSteam tidak ditemukan di assets' };
        }

        // Copy DLLs (hid.dll, xinput1_4.dll) to Steam root folder
        const entries = fs.readdirSync(pluginSteamPath);
        for (const file of entries) {
            const srcPath = path.join(pluginSteamPath, file);
            const destPath = path.join(steamPath, file);

            // Backup existing file if exists
            if (fs.existsSync(destPath)) {
                const backupPath = destPath + '.backup';
                if (!fs.existsSync(backupPath)) {
                    fs.copyFileSync(destPath, backupPath);
                }
            }

            fs.copyFileSync(srcPath, destPath);
        }

        // Also copy stplug-in folder to Steam/config/
        const stplugInPath = getStplugInSourcePath();
        if (stplugInPath) {
            const destStplugIn = path.join(steamPath, 'config', 'stplug-in');
            copyFolderSync(stplugInPath, destStplugIn);
        }

        return { success: true, message: 'Inject berhasil diaktifkan!' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========================================
// Restart Steam
// ========================================

function restartSteam() {
    return new Promise((resolve) => {
        try {
            const steamPath = getSteamPath();
            if (!steamPath) {
                resolve({ success: false, error: 'Steam path not found' });
                return;
            }

            const steamExe = path.join(steamPath, 'steam.exe');
            if (!fs.existsSync(steamExe)) {
                resolve({ success: false, error: 'Steam.exe not found' });
                return;
            }

            // Use Steam's own shutdown command (cleaner shutdown)
            exec(`"${steamExe}" -shutdown`, (error) => {
                // Wait for Steam to fully close (5 seconds)
                setTimeout(() => {
                    // Make sure Steam is really closed
                    exec('taskkill /IM steam.exe 2>nul', () => {
                        // Wait a bit more then start Steam
                        setTimeout(() => {
                            // Launch Steam normally using shell
                            shell.openPath(steamExe).then((err) => {
                                if (err) {
                                    resolve({ success: false, error: err });
                                } else {
                                    resolve({ success: true });
                                }
                            });
                        }, 2000);
                    });
                }, 5000);
            });
        } catch (error) {
            resolve({ success: false, error: error.message });
        }
    });
}

// ========================================
// Game Info & DLC Fetching
// ========================================

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function fetchGameInfo(appId) {
    try {
        const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`;
        const response = await fetchUrl(url);
        const json = JSON.parse(response);

        if (!json[appId] || !json[appId].success) {
            return { success: false, error: 'Game tidak ditemukan' };
        }

        const data = json[appId].data;
        const gameInfo = {
            appId: appId,
            name: data.name,
            type: data.type,
            dlcs: [],
            depots: {}
        };

        // Get DLCs
        if (data.dlc && data.dlc.length > 0) {
            for (const dlcId of data.dlc) {
                try {
                    const dlcUrl = `https://store.steampowered.com/api/appdetails?appids=${dlcId}&cc=us&l=en`;
                    const dlcResponse = await fetchUrl(dlcUrl);
                    const dlcJson = JSON.parse(dlcResponse);

                    if (dlcJson[dlcId] && dlcJson[dlcId].success) {
                        gameInfo.dlcs.push({
                            appId: dlcId,
                            name: dlcJson[dlcId].data.name
                        });
                    } else {
                        gameInfo.dlcs.push({
                            appId: dlcId,
                            name: `DLC ${dlcId}`
                        });
                    }
                } catch (e) {
                    gameInfo.dlcs.push({
                        appId: dlcId,
                        name: `DLC ${dlcId}`
                    });
                }
            }
        }

        return { success: true, data: gameInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========================================
// Depot Keys Database (from ManifestHub)
// ========================================

let depotKeysCache = null;

async function loadDepotKeys() {
    if (depotKeysCache) return depotKeysCache;

    try {
        const url = 'https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/main/depotkeys.json';
        const response = await fetchUrl(url);

        if (response) {
            depotKeysCache = JSON.parse(response);
            console.log(`Loaded ${Object.keys(depotKeysCache).length} depot keys`);
            return depotKeysCache;
        }
        return null;
    } catch (error) {
        console.error('Failed to load depot keys:', error);
        return null;
    }
}

function findDepotsForApp(appId, depotKeys) {
    const gameDepots = [];
    const appIdStr = String(appId);
    const appIdInt = parseInt(appId);

    for (const [depotId, key] of Object.entries(depotKeys)) {
        try {
            const depotInt = parseInt(depotId);
            // Check if depot belongs to this app (within range of appid to appid+100)
            // or if depot ID starts with the app ID digits
            if (depotId.startsWith(appIdStr) ||
                (depotInt >= appIdInt && depotInt < appIdInt + 100)) {
                gameDepots.push({ depotId, key });
            }
        } catch (e) {
            // Skip invalid depot IDs
        }
    }

    return gameDepots;
}

function generateLuaFromDepotKeys(appId, gameName, mainDepots, dlcDepots) {
    let lua = `-- ${gameName}\n`;
    lua += `-- Generated by Steam Manifest Injector\n`;
    lua += `-- App ID: ${appId}\n`;

    const totalDepots = mainDepots.length + dlcDepots.reduce((sum, dlc) => sum + dlc.depots.length, 0);
    lua += `-- Total Depots: ${totalDepots}\n\n`;

    // Main app
    lua += `addappid(${appId})\n`;
    for (const depot of mainDepots) {
        if (depot.key && depot.key.length > 0) {
            lua += `addappid(${depot.depotId}, 0, "${depot.key}")\n`;
        } else {
            lua += `addappid(${depot.depotId}, 0, "")\n`;
        }
    }

    // DLCs
    for (const dlc of dlcDepots) {
        if (dlc.depots.length > 0) {
            lua += `\n-- DLC: ${dlc.name}\n`;
            lua += `addappid(${dlc.appId})\n`;
            for (const depot of dlc.depots) {
                if (depot.key && depot.key.length > 0) {
                    lua += `addappid(${depot.depotId}, 0, "${depot.key}")\n`;
                } else {
                    lua += `addappid(${depot.depotId}, 0, "")\n`;
                }
            }
        }
    }

    return lua;
}

async function fetchLuaFromManifestHub(appId, gameName, dlcs = []) {
    try {
        // First try to get lua file directly from GitHub branch
        const luaUrl = `https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/${appId}/${appId}.lua`;
        const luaResponse = await fetchUrl(luaUrl);

        if (luaResponse && luaResponse.includes('addappid')) {
            return { success: true, lua: luaResponse, source: 'ManifestHub' };
        }

        // Fallback: Generate from depot keys database
        const depotKeys = await loadDepotKeys();
        if (!depotKeys) {
            return { success: false, error: 'Could not load depot keys database' };
        }

        // Find depots for main app
        const mainDepots = findDepotsForApp(appId, depotKeys);

        // Find depots for each DLC
        const dlcDepots = [];
        for (const dlc of dlcs) {
            const dlcDepotsFound = findDepotsForApp(dlc.appId, depotKeys);
            if (dlcDepotsFound.length > 0) {
                dlcDepots.push({
                    appId: dlc.appId,
                    name: dlc.name,
                    depots: dlcDepotsFound
                });
            }
        }

        // Check if we found any depots
        const totalDepots = mainDepots.length + dlcDepots.reduce((sum, dlc) => sum + dlc.depots.length, 0);
        if (totalDepots === 0) {
            return { success: false, error: 'No depot keys found for this game or its DLCs' };
        }

        const lua = generateLuaFromDepotKeys(appId, gameName || `App ${appId}`, mainDepots, dlcDepots);
        return { success: true, lua: lua, source: 'Generated', depotCount: totalDepots };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========================================
// Lua Script Generation (SteamTools)
// ========================================

function generateLuaScript(gameData) {
    const { appId, name, dlcs } = gameData;

    // Fallback: generate without depot keys
    let lua = `-- ${name}\n`;
    lua += `-- Generated by Steam Manifest Injector\n`;
    lua += `-- App ID: ${appId}\n\n`;

    // Add main game (without depot key)
    lua += `addappid(${appId}, 1)\n`;

    // Add all DLCs
    if (dlcs && dlcs.length > 0) {
        lua += `\n-- DLCs\n`;
        dlcs.forEach(dlc => {
            lua += `addappid(${dlc.appId}, 1) -- ${dlc.name}\n`;
        });
    }

    return lua;
}

function generateAppManifest(gameData) {
    const { appId, name } = gameData;
    const now = Math.floor(Date.now() / 1000);

    return `"AppState"
{
\t"appid"\t\t"${appId}"
\t"Universe"\t\t"1"
\t"name"\t\t"${name}"
\t"StateFlags"\t\t"4"
\t"installdir"\t\t"${name.replace(/[^a-zA-Z0-9\s]/g, '')}"
\t"LastUpdated"\t\t"${now}"
\t"SizeOnDisk"\t\t"0"
\t"StagingSize"\t\t"0"
\t"buildid"\t\t"0"
\t"LastOwner"\t\t"0"
\t"UpdateResult"\t\t"0"
\t"BytesToDownload"\t\t"0"
\t"BytesDownloaded"\t\t"0"
\t"BytesToStage"\t\t"0"
\t"BytesStaged"\t\t"0"
\t"TargetBuildID"\t\t"0"
\t"AutoUpdateBehavior"\t\t"1"
\t"AllowOtherDownloadsWhileRunning"\t\t"0"
\t"ScheduledAutoUpdate"\t\t"0"
}`;
}

// ========================================
// Inject/Remove Game
// ========================================

async function injectGame(gameData) {
    try {
        const steamPath = getSteamPath();
        if (!steamPath) {
            return { success: false, error: 'Steam tidak ditemukan' };
        }

        const stPluginPath = getSteamToolsPath(steamPath);
        const steamAppsFolders = getSteamAppsFolders(steamPath);

        // Try to fetch Lua from ManifestHub or generate from depot keys (including DLCs)
        const manifestHubResult = await fetchLuaFromManifestHub(gameData.appId, gameData.name, gameData.dlcs || []);

        if (!manifestHubResult.success) {
            return {
                success: false,
                error: `Game "${gameData.name}" tidak ditemukan di database. ${manifestHubResult.error || ''}`
            };
        }

        const luaScript = manifestHubResult.lua;

        // Save Lua script
        const luaPath = path.join(stPluginPath, `${gameData.appId}.lua`);
        fs.writeFileSync(luaPath, luaScript, 'utf8');

        // Note: We only save Lua script, no appmanifest needed
        // Appmanifest causes Steam to try auto-install/update

        await addToInjectedList(gameData);

        return {
            success: true,
            message: 'Game berhasil di-inject!'
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function removeGame(appId) {
    try {
        const steamPath = getSteamPath();
        if (!steamPath) {
            return { success: false, error: 'Steam tidak ditemukan' };
        }

        const stPluginPath = getSteamToolsPath(steamPath);

        // Remove Lua script only
        const luaPath = path.join(stPluginPath, `${appId}.lua`);
        if (fs.existsSync(luaPath)) {
            fs.unlinkSync(luaPath);
        }

        await removeFromInjectedList(appId);

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========================================
// Injected Games List
// ========================================

async function getInjectedGames() {
    try {
        if (fs.existsSync(dataPath)) {
            return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function addToInjectedList(gameData) {
    let games = await getInjectedGames();
    games = games.filter(g => g.appId !== gameData.appId);

    games.unshift({
        appId: gameData.appId,
        name: gameData.name,
        dlcCount: gameData.dlcs?.length || 0,
        timestamp: Date.now()
    });

    fs.writeFileSync(dataPath, JSON.stringify(games, null, 2));
}

async function removeFromInjectedList(appId) {
    let games = await getInjectedGames();
    games = games.filter(g => g.appId !== appId);
    fs.writeFileSync(dataPath, JSON.stringify(games, null, 2));
}

// ========================================
// Window Creation
// ========================================

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 750,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        backgroundColor: '#0a0a12',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false  // Disable DevTools in production
        }
    });

    mainWindow.loadFile('src/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========================================
// IPC Handlers
// ========================================

// Steam functions
ipcMain.handle('get-steam-path', () => getSteamPath());
ipcMain.handle('get-steam-tools-path', (event, steamPath) => getSteamToolsPath(steamPath));

// Game functions
ipcMain.handle('fetch-game-info', async (event, appId) => fetchGameInfo(appId));
ipcMain.handle('inject-game', async (event, gameData) => injectGame(gameData));
ipcMain.handle('remove-game', async (event, appId) => removeGame(appId));
ipcMain.handle('get-injected-games', async () => getInjectedGames());

// Settings
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => saveSettings(settings));

// Browse for Steam path
ipcMain.handle('browse-steam-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Steam Installation Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Activate Inject
ipcMain.handle('activate-inject', async () => activateInject());

// Restart Steam
ipcMain.handle('restart-steam', () => restartSteam());

// Window controls
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.on('close-window', () => mainWindow.close());
