// ========================================
// Steam Manifest Injector - With SteamTools
// ========================================

// State
let steamPath = null;
let steamToolsPath = null;
let currentGameInfo = null;
let injectedGames = [];

// DOM Elements
const elements = {
    gameIdInput: document.getElementById('game-id'),
    gameInfo: document.getElementById('game-info'),
    gameName: document.getElementById('game-name'),
    dlcCount: document.getElementById('dlc-count'),
    addBtn: document.getElementById('add-btn'),
    deleteBtn: document.getElementById('delete-btn'),
    statusMessage: document.getElementById('status-message'),
    injectedSection: document.getElementById('injected-section'),
    injectedList: document.getElementById('injected-list'),
    loadingOverlay: document.getElementById('loading-overlay'),
    toastContainer: document.getElementById('toast-container'),
    steamPathDisplay: document.getElementById('steam-path-display'),

    // Action buttons
    activateInjectBtn: document.getElementById('activate-inject-btn'),
    restartSteamBtn: document.getElementById('restart-steam-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    // Settings modal
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings'),
    customSteamPath: document.getElementById('custom-steam-path'),
    browsePathBtn: document.getElementById('browse-path-btn'),
    saveSettingsBtn: document.getElementById('save-settings'),

    // Download modal
    downloadModal: document.getElementById('download-modal'),
    downloadProgress: document.getElementById('download-progress'),
    progressText: document.getElementById('progress-text'),

    // Window controls
    minimizeBtn: document.getElementById('minimize-btn'),
    maximizeBtn: document.getElementById('maximize-btn'),
    closeBtn: document.getElementById('close-btn')
};

// ========================================
// Initialization
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    initWindowControls();
    initEventListeners();
    initActionButtons();
    initSettingsModal();
    await initSteam();
    await loadInjectedGames();
});

function initWindowControls() {
    elements.minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    elements.maximizeBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    elements.closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
}

function initEventListeners() {
    let debounceTimer;
    elements.gameIdInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);

        // Auto-extract App ID from Steam URL or text
        let value = e.target.value.trim();
        const extractedId = extractAppId(value);

        if (extractedId && extractedId !== value) {
            // Replace input with extracted ID
            e.target.value = extractedId;
            value = extractedId;
        }

        if (value.length >= 3) {
            debounceTimer = setTimeout(() => fetchGameInfo(value), 500);
        } else {
            hideGameInfo();
        }
    });

    elements.addBtn.addEventListener('click', addGame);
    elements.deleteBtn.addEventListener('click', deleteGame);

    elements.gameIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && currentGameInfo) {
            addGame();
        }
    });
}

// Extract App ID from Steam URL or return as-is if already an ID
function extractAppId(input) {
    // Check if it's a Steam URL
    // Patterns:
    // https://store.steampowered.com/app/2592160/Dispatch/
    // store.steampowered.com/app/2592160
    // https://store.steampowered.com/app/2592160
    const steamUrlPattern = /store\.steampowered\.com\/app\/(\d+)/i;
    const match = input.match(steamUrlPattern);

    if (match && match[1]) {
        return match[1];
    }

    // Check if it contains only numbers (already an ID)
    if (/^\d+$/.test(input)) {
        return input;
    }

    // Try to extract any number from the input
    const numberMatch = input.match(/\d+/);
    if (numberMatch) {
        return numberMatch[0];
    }

    return input;
}

function initActionButtons() {
    // Activate Inject
    elements.activateInjectBtn.addEventListener('click', activateInject);

    // Restart Steam
    elements.restartSteamBtn.addEventListener('click', async () => {
        showLoading();
        const result = await window.electronAPI.restartSteam();
        hideLoading();

        if (result.success) {
            showToast('success', 'Steam sedang direstart...');
        } else {
            showToast('error', result.error || 'Gagal restart Steam');
        }
    });

    // Settings
    elements.settingsBtn.addEventListener('click', openSettings);
}

function initSettingsModal() {
    elements.closeSettingsBtn.addEventListener('click', closeSettings);

    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            closeSettings();
        }
    });

    elements.browsePathBtn.addEventListener('click', async () => {
        const result = await window.electronAPI.browseSteamPath();
        if (result) {
            elements.customSteamPath.value = result;
            updateLuaPathDisplay(result);
        }
    });

    elements.saveSettingsBtn.addEventListener('click', async () => {
        const customPath = elements.customSteamPath.value.trim();
        await window.electronAPI.saveSettings({ customSteamPath: customPath });

        // Reinitialize Steam with new path
        await initSteam();
        closeSettings();
        showToast('success', 'Settings saved!');
    });
}

async function initSteam() {
    try {
        // Load settings first
        const settings = await window.electronAPI.loadSettings();

        if (settings.customSteamPath) {
            steamPath = settings.customSteamPath;
        } else {
            steamPath = await window.electronAPI.getSteamPath();
        }

        if (steamPath) {
            steamToolsPath = await window.electronAPI.getSteamToolsPath(steamPath);
            elements.steamPathDisplay.textContent = steamPath;
        } else {
            elements.steamPathDisplay.textContent = 'Not found - Set in Settings';
            elements.steamPathDisplay.style.color = '#ff0080';
        }
    } catch (error) {
        console.error('Error initializing Steam:', error);
    }
}

// ========================================
// Activate Inject
// ========================================

async function activateInject() {
    showLoading();

    try {
        const result = await window.electronAPI.activateInject();

        hideLoading();

        if (result.success) {
            showToast('success', 'Inject berhasil diaktifkan! Restart Steam.');
        } else {
            showToast('error', result.error || 'Gagal mengaktifkan inject');
        }
    } catch (error) {
        hideLoading();
        showToast('error', 'Error: ' + error.message);
    }
}

// ========================================
// Settings Modal
// ========================================

async function openSettings() {
    const settings = await window.electronAPI.loadSettings();
    elements.customSteamPath.value = settings.customSteamPath || '';
    elements.settingsModal.classList.add('active');
}

function closeSettings() {
    elements.settingsModal.classList.remove('active');
}

// ========================================
// Game Info Fetching
// ========================================

async function fetchGameInfo(appId) {
    try {
        showLoading();

        const result = await window.electronAPI.fetchGameInfo(appId);

        if (result.success) {
            currentGameInfo = result.data;
            showGameInfo(result.data);
        } else {
            hideGameInfo();
            showStatus('error', result.error || 'Game tidak ditemukan');
        }
    } catch (error) {
        hideGameInfo();
        showStatus('error', 'Gagal mengambil info game');
    } finally {
        hideLoading();
    }
}

function showGameInfo(data) {
    elements.gameName.textContent = data.name;
    elements.dlcCount.textContent = `${data.dlcs?.length || 0} DLC detected`;
    elements.gameInfo.style.display = 'block';
    clearStatus();
}

function hideGameInfo() {
    elements.gameInfo.style.display = 'none';
    currentGameInfo = null;
}

// ========================================
// Add/Delete Game
// ========================================

async function addGame() {
    const gameId = elements.gameIdInput.value.trim();

    if (!gameId) {
        showStatus('error', 'Masukkan Game ID terlebih dahulu');
        return;
    }

    if (!steamPath) {
        showStatus('error', 'Steam path belum diset. Buka Settings.');
        return;
    }

    try {
        showLoading();

        if (!currentGameInfo) {
            const result = await window.electronAPI.fetchGameInfo(gameId);
            if (!result.success) {
                showStatus('error', result.error || 'Game tidak ditemukan');
                hideLoading();
                return;
            }
            currentGameInfo = result.data;
        }

        const injectResult = await window.electronAPI.injectGame({
            appId: gameId,
            name: currentGameInfo.name,
            dlcs: currentGameInfo.dlcs || [],
            depots: currentGameInfo.depots || {}
        });

        if (injectResult.success) {
            showStatus('success', `✅ ${currentGameInfo.name} berhasil ditambahkan!`);
            showToast('success', `Game ditambahkan: ${currentGameInfo.name}`);

            elements.gameIdInput.value = '';
            hideGameInfo();

            await loadInjectedGames();
        } else {
            showStatus('error', injectResult.error || 'Gagal menambahkan game');
        }
    } catch (error) {
        showStatus('error', 'Terjadi kesalahan: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function deleteGame() {
    const gameId = elements.gameIdInput.value.trim();

    if (!gameId) {
        showStatus('error', 'Masukkan Game ID yang akan dihapus');
        return;
    }

    try {
        showLoading();

        const result = await window.electronAPI.removeGame(gameId);

        if (result.success) {
            showStatus('success', `🗑️ Game ${gameId} berhasil dihapus!`);
            showToast('success', 'Game berhasil dihapus');

            elements.gameIdInput.value = '';
            hideGameInfo();

            await loadInjectedGames();
        } else {
            showStatus('error', result.error || 'Gagal menghapus game');
        }
    } catch (error) {
        showStatus('error', 'Terjadi kesalahan: ' + error.message);
    } finally {
        hideLoading();
    }
}

// ========================================
// Injected Games List
// ========================================

async function loadInjectedGames() {
    try {
        injectedGames = await window.electronAPI.getInjectedGames();
        renderInjectedGames();
    } catch (error) {
        console.error('Error loading injected games:', error);
    }
}

function renderInjectedGames() {
    if (injectedGames.length === 0) {
        elements.injectedSection.style.display = 'none';
        return;
    }

    elements.injectedSection.style.display = 'block';
    elements.injectedList.innerHTML = injectedGames.map(game => `
        <div class="injected-item">
            <div class="injected-item-info">
                <span class="injected-item-name">${game.name}</span>
                <span class="injected-item-id">ID: ${game.appId} • ${game.dlcCount || 0} DLC</span>
            </div>
            <button class="injected-item-btn" onclick="quickDelete('${game.appId}')">Remove</button>
        </div>
    `).join('');
}

window.quickDelete = async function (appId) {
    elements.gameIdInput.value = appId;
    await deleteGame();
};

// ========================================
// UI Helpers
// ========================================

function showStatus(type, message) {
    elements.statusMessage.className = `status-message ${type}`;
    elements.statusMessage.textContent = message;
    elements.statusMessage.style.display = 'block';
}

function clearStatus() {
    elements.statusMessage.style.display = 'none';
}

function showLoading() {
    elements.loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    elements.loadingOverlay.style.display = 'none';
}

function showToast(type, message) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : '❌'}</span>
        <span>${message}</span>
    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}
