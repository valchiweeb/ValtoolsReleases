const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');

let mainWindow;
let overlayWindow;
let pythonProcess = null;

// Auto-updater configuration - Silent auto-update
autoUpdater.autoDownload = true;  // Download automatically
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;

// Force update checking for GitHub releases (public release repo)
autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'daffafitrony-jpg',
    repo: 'ValtoolsReleases',
    releaseType: 'release'
});

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const injectedGamesPath = path.join(app.getPath('userData'), 'injected_games.json');

// Depot keys cache for game injection
let depotKeysCache = null;

// Auto-updater events - Forced update mode
function setupAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        if (mainWindow) {
            mainWindow.webContents.send('checking-for-update');
        }
    });

    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version, '- downloading...');
        if (mainWindow) {
            mainWindow.webContents.send('update-available', info);
        }
    });

    autoUpdater.on('update-not-available', () => {
        console.log('Already on latest version');
        if (mainWindow) {
            mainWindow.webContents.send('update-not-available');
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-update error:', err);
        if (mainWindow) {
            mainWindow.webContents.send('update-error', err.message);
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        console.log('Download progress:', Math.round(progress.percent), '%');
        if (mainWindow) {
            mainWindow.webContents.send('download-progress', progress);
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded, auto-installing...');
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info);
        }
        // Auto-install after short delay to let UI update
        setTimeout(() => {
            autoUpdater.quitAndInstall(false, true);
        }, 1500);
    });
}

// Manual version check using GitHub API
function checkForUpdatesManually() {
    const https = require('https');
    const currentVersion = app.getVersion();

    const options = {
        hostname: 'api.github.com',
        path: '/repos/daffafitrony-jpg/ValtoolsElectron/releases/latest',
        method: 'GET',
        headers: {
            'User-Agent': 'ValTools-Electron'
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const release = JSON.parse(data);
                const latestVersion = release.tag_name.replace('v', '');
                console.log('Current version:', currentVersion, 'Latest version:', latestVersion);

                if (compareVersions(latestVersion, currentVersion) > 0) {
                    console.log('Manual check found update:', latestVersion);
                    if (mainWindow) {
                        mainWindow.webContents.send('update-available', {
                            version: latestVersion,
                            releaseNotes: release.body || '',
                            downloadUrl: release.html_url
                        });
                    }
                } else {
                    console.log('Already on latest version');
                    if (mainWindow) {
                        mainWindow.webContents.send('update-not-available');
                    }
                }
            } catch (e) {
                console.error('Failed to parse release info:', e);
            }
        });
    });

    req.on('error', (err) => {
        console.error('Manual update check failed:', err);
    });

    req.end();
}

// Simple version comparison
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { steam_path: 'C:\\Program Files (x86)\\Steam\\steam.exe' };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0e14',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
            devTools: false  // Disable DevTools for security
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('src/index.html');

    // Block DevTools keyboard shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
        if (input.key === 'F12' ||
            (input.control && input.shift && ['I', 'i', 'J', 'j', 'C', 'c'].includes(input.key))) {
            event.preventDefault();
        }
    });
}

function createOverlayWindow() {
    overlayWindow = new BrowserWindow({
        fullscreen: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    overlayWindow.loadFile('src/overlay.html');
    overlayWindow.setIgnoreMouseEvents(false);
    return overlayWindow;
}

// IPC Handlers
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.handle('window-close', () => mainWindow.close());
ipcMain.handle('focus-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});

ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
});

// Auto-update IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', () => {
    return autoUpdater.checkForUpdates().catch(err => ({ error: err.message }));
});
ipcMain.handle('download-update', () => {
    autoUpdater.downloadUpdate();
});
ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => {
    saveSettings(settings);
    return true;
});

ipcMain.handle('select-steam-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Steam Executable',
        filters: [{ name: 'Executable', extensions: ['exe'] }],
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Cloud sync - Native JavaScript implementation (no Python required)
const crypto = require('crypto');
const https = require('https');

// Cloud API configuration
const CLOUD_API_KEY = '$2a$10$rogV/OBNjQ8GYVjQbuRiRu02pxTYppJ2QF4PxFEUJzGo8il9XRyYG';
const CLOUD_BIN_ID = '69208b43d0ea881f40f70c06';
const FERNET_KEY = 'LDfE_w9DvToSg8P1QOk50_h-DqrtDKjJBbm2zmOl42Y=';

// Fernet-compatible encryption/decryption
function fernetDecrypt(token) {
    try {
        const keyBuffer = Buffer.from(FERNET_KEY, 'base64');
        const signingKey = keyBuffer.slice(0, 16);
        const encryptionKey = keyBuffer.slice(16, 32);

        const tokenBuffer = Buffer.from(token, 'base64');
        const version = tokenBuffer[0];
        const timestamp = tokenBuffer.slice(1, 9);
        const iv = tokenBuffer.slice(9, 25);
        const ciphertext = tokenBuffer.slice(25, -32);
        const hmac = tokenBuffer.slice(-32);

        const decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (e) {
        console.error('Decrypt error:', e.message);
        return null;
    }
}

function fernetEncrypt(text) {
    try {
        const keyBuffer = Buffer.from(FERNET_KEY, 'base64');
        const signingKey = keyBuffer.slice(0, 16);
        const encryptionKey = keyBuffer.slice(16, 32);

        const iv = crypto.randomBytes(16);
        const timestamp = Buffer.alloc(8);
        timestamp.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000)));

        const cipher = crypto.createCipheriv('aes-128-cbc', encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        const version = Buffer.from([0x80]);
        const payload = Buffer.concat([version, timestamp, iv, encrypted]);

        const hmacObj = crypto.createHmac('sha256', signingKey);
        hmacObj.update(payload);
        const hmacDigest = hmacObj.digest();

        const token = Buffer.concat([payload, hmacDigest]);
        return token.toString('base64');
    } catch (e) {
        console.error('Encrypt error:', e.message);
        return null;
    }
}

function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

ipcMain.handle('load-cloud-data', async () => {
    try {
        const response = await httpRequest({
            hostname: 'api.jsonbin.io',
            path: `/v3/b/${CLOUD_BIN_ID}/latest`,
            method: 'GET',
            headers: { 'X-Master-Key': CLOUD_API_KEY }
        });

        if (response.status === 200 && response.data.record && response.data.record.payload) {
            const decrypted = fernetDecrypt(response.data.record.payload);
            if (decrypted) {
                const parsed = JSON.parse(decrypted);
                return {
                    success: true,
                    accounts: parsed.accounts || {},
                    admin_hash: parsed.admin_hash || ''
                };
            }
        }
        return { success: false, error: 'Failed to load data' };
    } catch (e) {
        console.error('Load cloud error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-cloud-data', async (event, adminHash, accounts) => {
    try {
        const payload = fernetEncrypt(JSON.stringify({
            admin_hash: adminHash,
            accounts: accounts
        }));

        if (!payload) {
            return { success: false, error: 'Encryption failed' };
        }

        const postData = JSON.stringify({ payload: payload });

        const response = await httpRequest({
            hostname: 'api.jsonbin.io',
            path: `/v3/b/${CLOUD_BIN_ID}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': CLOUD_API_KEY,
                'Content-Length': Buffer.byteLength(postData)
            }
        }, postData);

        if (response.status === 200 || response.status === 201) {
            return { success: true };
        }
        return { success: false, error: `HTTP ${response.status}` };
    } catch (e) {
        console.error('Save cloud error:', e);
        return { success: false, error: e.message };
    }
});

// Steam Guard Firebase sync via Python backend
ipcMain.handle('sg-login-admin', async (event, password) => {
    return runSteamGuardSync(['--action', 'login-admin', '--password', password]);
});

ipcMain.handle('sg-login-guest', async (event, code) => {
    return runSteamGuardSync(['--action', 'login-guest', '--code', code]);
});

ipcMain.handle('sg-setup-admin', async (event, password) => {
    return runSteamGuardSync(['--action', 'setup-admin', '--password', password]);
});

ipcMain.handle('sg-save-accounts', async (event, masterKey, accounts) => {
    return runSteamGuardSync(['--action', 'save-accounts', '--master-key', masterKey, '--accounts', JSON.stringify(accounts)]);
});

ipcMain.handle('sg-create-voucher', async (event, masterKey, days) => {
    return runSteamGuardSync(['--action', 'create-voucher', '--master-key', masterKey, '--days', days.toString()]);
});

function runSteamGuardSync(args) {
    return new Promise((resolve, reject) => {
        const executableName = process.platform === 'win32' ? 'steamguard_sync.exe' : 'steamguard_sync';

        let executablePath;
        if (app.isPackaged) {
            executablePath = path.join(process.resourcesPath, 'backend', executableName);
        } else {
            executablePath = path.join(__dirname, 'backend', 'dist', executableName);
        }

        if (!fs.existsSync(executablePath)) {
            // Fallback for dev if exe not built
            const pyScript = path.join(__dirname, 'backend', 'steamguard_sync.py');
            if (fs.existsSync(pyScript)) {
                console.log('Using fallback Python script for Steam Guard');
                const proc = spawn('python', [pyScript, ...args]);
                handleProcess(proc, resolve, reject);
                return;
            }
            reject(new Error(`Steam Guard executable not found at: ${executablePath}`));
            return;
        }

        console.log('Spawning Steam Guard executable:', executablePath);
        const proc = spawn(executablePath, args);
        handleProcess(proc, resolve, reject);
    });
}

function handleProcess(proc, resolve, reject) {
    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
        output += data.toString();
    });

    proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    proc.on('close', (code) => {
        try {
            const result = JSON.parse(output.trim());
            resolve(result);
        } catch (e) {
            reject(new Error(errorOutput || 'Failed to parse Steam Guard response'));
        }
    });

    proc.on('error', (err) => {
        reject(err);
    });
}

ipcMain.handle('show-overlay', (event, text, subtext) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow();
    }
    overlayWindow.show();
    overlayWindow.webContents.send('update-overlay', { text, subtext });
});

ipcMain.handle('hide-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
    }
});

ipcMain.handle('update-overlay', (event, text, subtext, color) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-overlay', { text, subtext, color });
    }
});

ipcMain.handle('destroy-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
        overlayWindow = null;
    }
});

// Python backend communication
ipcMain.handle('run-injection', async (event, accountData, steamPath) => {
    return new Promise((resolve, reject) => {
        const executableName = process.platform === 'win32' ? 'automation.exe' : 'automation';

        let executablePath;
        let spawnArgs = [
            '--username', accountData.u,
            '--password', accountData.p,
            '--steam-path', steamPath
        ];
        let spawnCmd;

        if (app.isPackaged) {
            executablePath = path.join(process.resourcesPath, 'backend', executableName);
        } else {
            executablePath = path.join(__dirname, 'backend', 'dist', executableName);
        }

        if (fs.existsSync(executablePath)) {
            spawnCmd = executablePath;
            console.log('Starting injection with executable:', {
                path: executablePath,
                username: accountData.u
            });
        } else {
            // Fallback to python script
            const pythonScript = path.join(__dirname, 'backend', 'automation.py');
            if (fs.existsSync(pythonScript)) {
                console.log('Starting injection with Python script (fallback):', pythonScript);
                spawnCmd = 'python';
                spawnArgs = [pythonScript, ...spawnArgs];
            } else {
                reject(new Error('Automation executable/script not found'));
                return;
            }
        }

        // Use shell: false for executables
        pythonProcess = spawn(spawnCmd, spawnArgs, {
            shell: false,
            windowsHide: true,
            detached: false // Keep attached so we can kill it
        });

        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                output += trimmed + '\n';
                console.log('Python:', trimmed);

                // Try to parse each line as JSON
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.type === 'status') {
                        mainWindow.webContents.send('injection-status', parsed);
                    }
                } catch (e) {
                    // Not JSON, ignore
                }
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const stderr = data.toString();
            errorOutput += stderr;
            console.error('Python stderr:', stderr);
        });

        pythonProcess.on('close', (code) => {
            console.log('Python process closed with code:', code);
            console.log('stderr:', errorOutput);
            pythonProcess = null;
            if (code === 0) {
                resolve({ success: true, output });
            } else {
                // Include stderr in error message
                const errorMsg = errorOutput.trim() || `Process exited with code ${code}`;
                reject(new Error(errorMsg));
            }
        });

        pythonProcess.on('error', (err) => {
            console.error('Python spawn error:', err);
            pythonProcess = null;
            reject(err);
        });
    });
});

ipcMain.handle('abort-injection', () => {
    if (pythonProcess) {
        pythonProcess.kill('SIGTERM');
        pythonProcess = null;
        return true;
    }
    return false;
});

// ========================================
// GAME INJECTION - Steam Path Detection
// ========================================

function getSteamPathForInjection() {
    // Check settings first for custom path
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

// ========================================
// GAME INJECTION - Activate Inject (Copy DLLs)
// ========================================

function getPluginSteamPath() {
    const folderPath = path.join(__dirname, 'assets', 'PluginSteam');
    if (fs.existsSync(folderPath)) {
        return folderPath;
    }
    return null;
}

function copyFolderSync(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

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
        const steamPath = getSteamPathForInjection();
        if (!steamPath) {
            return { success: false, error: 'Steam path tidak ditemukan. Atur di Settings.' };
        }

        const pluginSteamPath = getPluginSteamPath();
        if (!pluginSteamPath) {
            return { success: false, error: 'Folder PluginSteam tidak ditemukan di assets' };
        }

        // Copy DLLs to Steam root folder
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

        return { success: true, message: 'Inject berhasil diaktifkan!' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ========================================
// GAME INJECTION - Restart Steam
// ========================================

function restartSteamForInjection() {
    return new Promise((resolve) => {
        try {
            const steamPath = getSteamPathForInjection();
            if (!steamPath) {
                resolve({ success: false, error: 'Steam path not found' });
                return;
            }

            const steamExe = path.join(steamPath, 'steam.exe');
            if (!fs.existsSync(steamExe)) {
                resolve({ success: false, error: 'Steam.exe not found' });
                return;
            }

            // Use Steam's own shutdown command
            exec(`"${steamExe}" -shutdown`, (error) => {
                setTimeout(() => {
                    exec('taskkill /IM steam.exe 2>nul', () => {
                        setTimeout(() => {
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
// GAME INJECTION - Game Info & DLC Fetching
// ========================================

function fetchUrlForInjection(url) {
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
        const response = await fetchUrlForInjection(url);
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
                    const dlcResponse = await fetchUrlForInjection(dlcUrl);
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
// GAME INJECTION - Depot Keys & Lua Generation
// ========================================

async function loadDepotKeys() {
    if (depotKeysCache) return depotKeysCache;

    try {
        const url = 'https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/main/depotkeys.json';
        const response = await fetchUrlForInjection(url);

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
            if (depotId.startsWith(appIdStr) ||
                (depotInt >= appIdInt && depotInt < appIdInt + 100)) {
                gameDepots.push({ depotId, key });
            }
        } catch (e) { }
    }

    return gameDepots;
}

function generateLuaFromDepotKeys(appId, gameName, mainDepots, dlcDepots) {
    let lua = `-- ${gameName}\n`;
    lua += `-- Generated by ValTools\n`;
    lua += `-- App ID: ${appId}\n`;

    const totalDepots = mainDepots.length + dlcDepots.reduce((sum, dlc) => sum + dlc.depots.length, 0);
    lua += `-- Total Depots: ${totalDepots}\n\n`;

    lua += `addappid(${appId})\n`;
    for (const depot of mainDepots) {
        if (depot.key && depot.key.length > 0) {
            lua += `addappid(${depot.depotId}, 0, "${depot.key}")\n`;
        } else {
            lua += `addappid(${depot.depotId}, 0, "")\n`;
        }
    }

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
        const luaResponse = await fetchUrlForInjection(luaUrl);

        if (luaResponse && luaResponse.includes('addappid')) {
            return { success: true, lua: luaResponse, source: 'ManifestHub' };
        }

        // Fallback: Generate from depot keys database
        const depotKeys = await loadDepotKeys();
        if (!depotKeys) {
            return { success: false, error: 'Could not load depot keys database' };
        }

        const mainDepots = findDepotsForApp(appId, depotKeys);

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
// GAME INJECTION - Inject/Remove Game
// ========================================

async function injectGame(gameData) {
    try {
        const steamPath = getSteamPathForInjection();
        if (!steamPath) {
            return { success: false, error: 'Steam tidak ditemukan' };
        }

        const stPluginPath = getSteamToolsPath(steamPath);

        const manifestHubResult = await fetchLuaFromManifestHub(gameData.appId, gameData.name, gameData.dlcs || []);

        if (!manifestHubResult.success) {
            return {
                success: false,
                error: `Game "${gameData.name}" tidak ditemukan di database. ${manifestHubResult.error || ''}`
            };
        }

        const luaScript = manifestHubResult.lua;
        const luaPath = path.join(stPluginPath, `${gameData.appId}.lua`);
        fs.writeFileSync(luaPath, luaScript, 'utf8');

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
        const steamPath = getSteamPathForInjection();
        if (!steamPath) {
            return { success: false, error: 'Steam tidak ditemukan' };
        }

        const stPluginPath = getSteamToolsPath(steamPath);
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
// GAME INJECTION - Injected Games List
// ========================================

async function getInjectedGames() {
    try {
        if (fs.existsSync(injectedGamesPath)) {
            return JSON.parse(fs.readFileSync(injectedGamesPath, 'utf8'));
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

    fs.writeFileSync(injectedGamesPath, JSON.stringify(games, null, 2));
}

async function removeFromInjectedList(appId) {
    let games = await getInjectedGames();
    games = games.filter(g => g.appId !== appId);
    fs.writeFileSync(injectedGamesPath, JSON.stringify(games, null, 2));
}

// ========================================
// GAME INJECTION - IPC Handlers
// ========================================

ipcMain.handle('get-steam-path-inject', () => getSteamPathForInjection());
ipcMain.handle('get-steam-tools-path', (event, steamPath) => getSteamToolsPath(steamPath));
ipcMain.handle('fetch-game-info', async (event, appId) => fetchGameInfo(appId));
ipcMain.handle('inject-game', async (event, gameData) => injectGame(gameData));
ipcMain.handle('remove-game', async (event, appId) => removeGame(appId));
ipcMain.handle('get-injected-games', async () => getInjectedGames());
ipcMain.handle('activate-inject', async () => activateInject());
ipcMain.handle('restart-steam-inject', () => restartSteamForInjection());

ipcMain.handle('browse-steam-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Steam Installation Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

app.whenReady().then(() => {
    createMainWindow();

    // Setup auto-updater
    setupAutoUpdater();

    // Check for updates silently after 2 seconds
    setTimeout(() => {
        console.log('Checking for updates (silent mode)...');
        autoUpdater.checkForUpdates().catch(err => {
            console.error('Update check failed:', err);
        });
    }, 2000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
