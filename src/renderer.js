// ============================================
// ValTools v13 - Renderer (UI Logic)
// ============================================

// Configuration
const API_KEY = '$2a$10$rogV/OBNjQ8GYVjQbuRiRu02pxTYppJ2QF4PxFEUJzGo8il9XRyYG';
const BIN_ID = '69208b43d0ea881f40f70c06';
const STATIC_KEY = 'LDfE_w9DvToSg8P1QOk50_h-DqrtDKjJBbm2zmOl42Y=';
const FIREBASE_URL = 'https://steamguardvaltools-default-rtdb.asia-southeast1.firebasedatabase.app/';

// State
let accounts = {};
let adminHash = '';
let isAdminLoggedIn = false;
let selectedAccount = null;
let settings = { steam_path: 'C:\\Program Files (x86)\\Steam\\steam.exe' };

// Steam Guard State
let sgMasterKey = null;
let sgUserRole = null;
let sgAccounts = {};

// ============================================
// Crypto Functions (Fernet-compatible)
// ============================================

// The original Python app uses Fernet encryption
// We need to be able to decrypt that data

class FernetCompat {
    constructor(key) {
        // Fernet key is base64-encoded 32-byte key
        this.keyBase64 = key;
    }

    // Decrypt Fernet-encrypted data
    async decrypt(token) {
        try {
            // Fernet token format:
            // Version (1 byte) + Timestamp (8 bytes) + IV (16 bytes) + Ciphertext + HMAC (32 bytes)
            const tokenBytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

            // Extract components
            const iv = tokenBytes.slice(9, 25);
            const ciphertext = tokenBytes.slice(25, -32);

            // Decode the Fernet key (first 16 bytes for signing, last 16 for encryption)
            const keyBytes = Uint8Array.from(atob(this.keyBase64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
            const encryptionKey = keyBytes.slice(16, 32);

            // Import key for AES-CBC
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                encryptionKey,
                { name: 'AES-CBC' },
                false,
                ['decrypt']
            );

            // Decrypt
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-CBC', iv: iv },
                cryptoKey,
                ciphertext
            );

            // Remove PKCS7 padding
            const decryptedBytes = new Uint8Array(decrypted);
            const padLen = decryptedBytes[decryptedBytes.length - 1];
            const unpadded = decryptedBytes.slice(0, -padLen);

            return new TextDecoder().decode(unpadded);
        } catch (e) {
            console.error('Fernet decrypt error:', e);
            return null;
        }
    }

    // For new data, we'll use a simpler approach since we control both ends
    encrypt(text) {
        // Simple base64 encoding for new data (will be handled by the app)
        return btoa(unescape(encodeURIComponent(text)));
    }
}

// Create cipher instance
const cipher = new FernetCompat(STATIC_KEY);

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Update splash status
    updateSplashStatus('Memeriksa pembaruan...');

    // Initialize auto-updater first (splash screen visible)
    await initAutoUpdater();

    // Update splash status
    updateSplashStatus('Memuat data...');

    // Initialize other components
    initTitlebar();
    initNavigation();
    initModal();
    initDashboard();
    initSteamGuard();

    // Fix: Always force focus on every click to prevent keyboard input loss
    // BUT NOT during injection (which needs Steam to stay focused)
    document.addEventListener('click', () => {
        // Blur any focused button
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
            document.activeElement.blur();
        }
        // Only force re-focus if NOT injecting
        if (!window.isInjecting) {
            window.electronAPI?.focusWindow();
        }
    });

    // Also force focus when pressing any key (but not during injection)
    document.addEventListener('keydown', () => {
        if (!window.isInjecting) {
            window.electronAPI?.focusWindow();
        }
    });

    // Load settings
    if (window.electronAPI) {
        settings = await window.electronAPI.getSettings();
        updateStatusBar();
    }

    // Load cloud data then show app
    updateSplashStatus('Memuat akun...');
    await loadCloudData();

    // Hide splash and show app
    hideSplash();

    // Start monitoring internet connection
    startInternetMonitor();
});

// ============================================
// Splash Screen Control
// ============================================
function updateSplashStatus(text) {
    const statusEl = document.getElementById('splash-status');
    if (statusEl) statusEl.textContent = text;
}

function hideSplash() {
    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app-container');

    if (splash) splash.classList.add('hidden');
    if (app) app.style.display = 'flex';
}

// ============================================
// Auto-Update System - Forced Update Mode with Internet Requirement
// ============================================
let pendingUpdate = null;
let updateDownloaded = false;
let updateResolve = null; // For Promise resolution
let internetCheckInterval = null;

// Check if internet is available
async function checkInternetConnection() {
    try {
        // Try to fetch a small file from a reliable server
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch('https://www.google.com/favicon.ico', {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return true;
    } catch (e) {
        return false;
    }
}

// Show no internet error on splash screen
function showNoInternetSplash() {
    updateSplashStatus('⚠️ Tidak ada koneksi internet');
    const percentEl = document.getElementById('splash-percent');
    if (percentEl) {
        percentEl.innerHTML = '<button class="btn-retry" id="btn-retry-connection">🔄 Coba Lagi</button>';
    }

    // Hide the loading animation
    const progressBar = document.getElementById('splash-progress-bar');
    if (progressBar) {
        progressBar.style.display = 'none';
    }

    // Add retry button listener
    document.getElementById('btn-retry-connection')?.addEventListener('click', () => {
        // Reset UI
        if (progressBar) progressBar.style.display = 'block';
        if (percentEl) percentEl.textContent = '';
        updateSplashStatus('Memeriksa koneksi...');

        // Retry connection and update check
        startUpdateCheck();
    });
}

// State for internet warning (to prevent rapid show/hide)
let isWarningVisible = false;
let warningDebounceTimer = null;

// Show internet disconnected warning as non-blocking toast
function showInternetWarning() {
    // Debounce to prevent rapid show/hide
    if (warningDebounceTimer) return;
    if (isWarningVisible) return;

    isWarningVisible = true;
    const modal = document.getElementById('internet-warning-modal');
    if (modal) {
        modal.style.display = 'flex';
    }

    // Prevent rapid toggling for 5 seconds
    warningDebounceTimer = setTimeout(() => {
        warningDebounceTimer = null;
    }, 5000);
}

// Hide internet warning modal
function hideInternetWarning() {
    if (!isWarningVisible) return;

    isWarningVisible = false;
    const modal = document.getElementById('internet-warning-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Start monitoring internet connection (less aggressive)
function startInternetMonitor() {
    // Check every 30 seconds (less aggressive)
    internetCheckInterval = setInterval(async () => {
        try {
            const online = await checkInternetConnection();
            if (!online) {
                showInternetWarning();
            } else {
                hideInternetWarning();
            }
        } catch (e) {
            // Ignore errors, don't show warning for transient issues
            console.log('Internet check error:', e);
        }
    }, 30000);

    // Listen for browser online/offline events (debounced)
    window.addEventListener('offline', () => {
        setTimeout(() => {
            if (!navigator.onLine) {
                showInternetWarning();
            }
        }, 2000); // Wait 2 seconds to confirm
    });

    window.addEventListener('online', () => {
        hideInternetWarning();
    });
}

// Update splash progress bar
function updateSplashProgress(percent) {
    const progressBar = document.getElementById('splash-progress-bar');
    const percentEl = document.getElementById('splash-percent');

    if (progressBar) {
        progressBar.classList.add('downloading');
        progressBar.style.width = `${percent}%`;
    }
    if (percentEl) {
        percentEl.textContent = `${Math.round(percent)}%`;
    }
}

// Start the update check process
async function startUpdateCheck() {
    // First check internet
    const online = await checkInternetConnection();
    if (!online) {
        showNoInternetSplash();
        return;
    }

    updateSplashStatus('Memeriksa pembaruan...');

    // Trigger update check via Electron
    window.electronAPI?.checkForUpdates();

    // Set a timeout for no response (but require internet)
    setTimeout(async () => {
        if (updateResolve && !pendingUpdate) {
            // Check internet again before allowing to proceed
            const stillOnline = await checkInternetConnection();
            if (stillOnline) {
                console.log('Update check timeout but online, proceeding...');
                const versionEl = document.getElementById('version-info');
                window.electronAPI?.getAppVersion().then(v => {
                    versionEl.textContent = `v${v} ✓`;
                });
                updateResolve();
                updateResolve = null;
            } else {
                showNoInternetSplash();
            }
        }
    }, 15000);
}

// Initialize auto-updater and wait for update check to complete
// Returns Promise that resolves when:
// - No update available AND internet is connected (user can proceed)
// Note: If no internet, user must retry. If update available, app will auto-restart after download
function initAutoUpdater() {
    return new Promise((resolve) => {
        if (!window.electronAPI) {
            resolve(); // No Electron API, proceed immediately
            return;
        }

        updateResolve = resolve;
        const versionEl = document.getElementById('version-info');
        let currentVersion = 'v1.0.0';

        // Get current version
        window.electronAPI.getAppVersion().then(version => {
            currentVersion = version;
            versionEl.textContent = `v${version}`;
        }).catch(() => {
            versionEl.textContent = 'v1.0.0';
        });

        // Listen for update available - show downloading status
        window.electronAPI.onUpdateAvailable?.((info) => {
            pendingUpdate = info;
            updateSplashStatus(`Mengunduh v${info.version}...`);
            versionEl.textContent = `⬇️ Downloading...`;
            versionEl.classList.add('version-downloading');
            // Don't resolve - wait for download to complete
        });

        // Listen for download progress
        window.electronAPI.onDownloadProgress?.((progress) => {
            const percent = progress.percent || 0;
            updateSplashProgress(percent);
            updateSplashStatus(`Mengunduh pembaruan... ${Math.round(percent)}%`);
        });

        // Listen for download complete - app will auto-restart from main process
        window.electronAPI.onUpdateDownloaded?.((info) => {
            updateDownloaded = true;
            updateSplashStatus('Menginstal pembaruan...');
            updateSplashProgress(100);
            document.getElementById('splash-percent').textContent = 'Memulai ulang...';
            // Don't resolve - app will restart automatically from main process
        });

        // Listen for no update available - user can proceed
        window.electronAPI.onUpdateNotAvailable?.(() => {
            versionEl.classList.remove('version-checking');
            versionEl.textContent = `v${currentVersion} ✓`;
            versionEl.title = 'Versi terbaru';
            if (updateResolve) {
                updateResolve();
                updateResolve = null;
            }
        });

        // Listen for update error - check internet instead of proceeding
        window.electronAPI.onUpdateError?.(async (message) => {
            console.error('Update error:', message);
            const online = await checkInternetConnection();
            if (online) {
                // Error but online, can proceed
                versionEl.classList.remove('version-checking');
                versionEl.textContent = `v${currentVersion}`;
                if (updateResolve) {
                    updateResolve();
                    updateResolve = null;
                }
            } else {
                // No internet, show retry
                showNoInternetSplash();
            }
        });

        // Start the update check
        startUpdateCheck();

        // Init Donate Modal Logic
        document.getElementById('btn-donate')?.addEventListener('click', () => {
            const donateModal = document.getElementById('donate-modal');
            if (donateModal) donateModal.style.display = 'flex';
        });

        document.getElementById('close-donate')?.addEventListener('click', () => {
            const donateModal = document.getElementById('donate-modal');
            if (donateModal) donateModal.style.display = 'none';
        });
    });
}

function downloadUpdate() {
    window.electronAPI?.downloadUpdate();
}

function installUpdate() {
    window.electronAPI?.installUpdate();
}

// ============================================
// Titlebar
// ============================================
function initTitlebar() {
    document.getElementById('btn-minimize')?.addEventListener('click', () => {
        window.electronAPI?.minimize();
    });

    document.getElementById('btn-maximize')?.addEventListener('click', () => {
        window.electronAPI?.maximize();
    });

    document.getElementById('btn-close')?.addEventListener('click', () => {
        window.electronAPI?.close();
    });
}

// ============================================
// Navigation
// ============================================
function initNavigation() {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;

            // Update active nav button
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show corresponding view
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`view-${viewId}`)?.classList.add('active');

            // Re-focus window after navigation
            setTimeout(() => window.electronAPI?.focusWindow(), 50);
        });
    });

    document.getElementById('btn-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-refresh')?.addEventListener('click', refreshData);
    document.getElementById('btn-admin-login')?.addEventListener('click', triggerAdminLogin);
}

// ============================================
// Modal System
// ============================================
let modalResolve = null;

function initModal() {
    document.getElementById('modal-ok')?.addEventListener('click', () => {
        const input = document.getElementById('modal-input');
        if (input.value) {
            modalResolve?.(input.value);
            closeModal();
        } else {
            input.classList.add('error');
        }
    });

    document.getElementById('modal-cancel')?.addEventListener('click', () => {
        modalResolve?.(null);
        closeModal();
    });

    document.getElementById('modal-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('modal-ok').click();
        }
    });

    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') {
            modalResolve?.(null);
            closeModal();
        }
    });
}

function showModal(title, subtitle, isPassword = false, icon = '✏️') {
    return new Promise((resolve) => {
        modalResolve = resolve;

        document.getElementById('modal-icon').textContent = icon;
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-subtitle').textContent = subtitle;

        const input = document.getElementById('modal-input');
        input.type = isPassword ? 'password' : 'text';
        input.value = '';
        input.classList.remove('error');

        document.getElementById('modal-overlay').classList.add('active');
        input.focus();
    });
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    modalResolve = null;

    // Force focus back to window after modal closes
    setTimeout(() => {
        window.electronAPI?.focusWindow();
    }, 50);
}

// ============================================
// Dashboard - Game First View
// ============================================
let searchQuery = '';
let selectedGame = null;

function initDashboard() {
    document.getElementById('btn-inject')?.addEventListener('click', startInjection);
    document.getElementById('btn-add-account')?.addEventListener('click', addAccount);
    document.getElementById('btn-add-in-category')?.addEventListener('click', addAccountInCategory);
    document.getElementById('btn-edit-account')?.addEventListener('click', editAccount);
    document.getElementById('btn-delete-account')?.addEventListener('click', deleteAccount);
    document.getElementById('btn-back-to-games')?.addEventListener('click', showGameView);

    // Search input
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        if (selectedGame) {
            renderAccountList();
        } else {
            renderGameGrid();
        }
    });
}

function getGameCategories() {
    const categories = {};
    Object.entries(accounts).forEach(([name, acc]) => {
        const cat = acc.category || 'Uncategorized';
        if (!categories[cat]) {
            categories[cat] = [];
        }
        categories[cat].push(name);
    });
    return categories;
}

function renderGameGrid() {
    const container = document.getElementById('game-grid');
    if (!container) return;
    container.innerHTML = '';

    const categories = getGameCategories();
    const gameNames = Object.keys(categories);

    // Filter by search
    const filtered = gameNames.filter(name =>
        name.toLowerCase().includes(searchQuery)
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="game-empty">
                <div class="game-empty-icon">${gameNames.length === 0 ? '📭' : '🔍'}</div>
                <span>${gameNames.length === 0 ? 'Belum ada game' : 'Game tidak ditemukan'}</span>
            </div>
        `;
        return;
    }

    filtered.forEach(gameName => {
        const accountCount = categories[gameName].length;
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <span class="game-card-icon">🎮</span>
            <span class="game-card-name">${gameName}</span>
            <span class="game-card-count">${accountCount} akun</span>
        `;

        card.addEventListener('click', () => {
            selectedGame = gameName;
            showAccountPanel(gameName);
        });

        container.appendChild(card);
    });
}

function showGameView() {
    selectedGame = null;
    selectedAccount = null;
    document.querySelector('.game-view').style.display = 'flex';
    document.getElementById('account-panel').style.display = 'none';
    renderGameGrid();
    setTimeout(() => window.electronAPI?.focusWindow(), 50);
}

function showAccountPanel(gameName) {
    document.querySelector('.game-view').style.display = 'none';
    document.getElementById('account-panel').style.display = 'flex';
    document.getElementById('selected-game-title').textContent = gameName;

    renderAccountList();
    setTimeout(() => window.electronAPI?.focusWindow(), 50);
}

function renderAccountList() {
    const container = document.getElementById('account-list');
    container.innerHTML = '';

    if (!selectedGame) return;

    const categories = getGameCategories();
    const accountNames = categories[selectedGame] || [];

    // Filter by search
    const filtered = accountNames.filter(name =>
        name.toLowerCase().includes(searchQuery)
    );

    document.getElementById('account-count').textContent = `${filtered.length} akun tersedia`;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="account-empty">
                <div class="account-empty-icon">🔍</div>
                <span>Tidak ditemukan</span>
            </div>
        `;
        return;
    }

    filtered.forEach(name => {
        const item = document.createElement('div');
        item.className = 'account-item';
        item.dataset.name = name;

        item.innerHTML = `
            <span class="account-icon">👤</span>
            <span class="account-name">${name}</span>
        `;

        item.addEventListener('click', () => {
            document.querySelectorAll('.account-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            selectedAccount = name;
        });

        container.appendChild(item);
    });
}

async function loadCloudData() {
    try {
        // Use Python backend for proper Fernet decryption
        if (window.electronAPI) {
            const result = await window.electronAPI.loadCloudData();
            console.log('Cloud data result:', result);

            if (result.success) {
                accounts = result.accounts || {};
                adminHash = result.admin_hash || '';

                renderGameGrid();
                setConnectionStatus(true);

                if (!adminHash) {
                    forceCreateAdmin();
                }
                return;
            }
        }

        // Fallback: Direct fetch (for browser testing without Electron)
        const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('Fallback - direct fetch:', data);
            renderAccountList();
            setConnectionStatus(true);
        } else {
            throw new Error('Failed to load');
        }
    } catch (e) {
        console.error('Load error:', e);
        setConnectionStatus(false);
        renderAccountList(); // Show empty state
    }
}

async function saveCloudData() {
    try {
        // Use Python backend for proper Fernet encryption
        if (window.electronAPI) {
            await window.electronAPI.saveCloudData(adminHash, accounts);
            return;
        }
    } catch (e) {
        console.error('Save error');
    }
}

function setConnectionStatus(connected) {
    const el = document.getElementById('status-connection');
    if (connected) {
        el.textContent = '🟢 Connected';
        el.className = 'status-connection connected';
    } else {
        el.textContent = '🔴 Offline';
        el.className = 'status-connection offline';
    }
}

function updateStatusBar() {
    const target = settings.steam_path?.split('\\').pop() || 'Unknown';
    document.getElementById('status-target').textContent = `🎯 Target: ${target}`;
}

function refreshData() {
    const container = document.getElementById('account-list');
    container.innerHTML = `
        <div class="account-loading">
            <div class="spinner"></div>
            <span>Loading...</span>
        </div>
    `;
    loadCloudData();
}

// ============================================
// Admin Functions
// ============================================
async function hashPassword(password) {
    // SHA256 hash to match Python's hashlib.sha256().hexdigest()
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function forceCreateAdmin() {
    const password = await showModal('Setup Admin', 'Cloud kosong. Buat password:', true, '🔐');
    if (password) {
        adminHash = await hashPassword(password);
        isAdminLoggedIn = true;
        updateAdminUI();
        saveCloudData();
    }
}

async function triggerAdminLogin() {
    if (isAdminLoggedIn) {
        alert('Sudah login sebagai Admin!');
        return;
    }

    const password = await showModal('Admin Login', 'Masukkan password:', true, '🔐');
    if (password && (await hashPassword(password)) === adminHash) {
        isAdminLoggedIn = true;
        updateAdminUI();
    } else if (password) {
        alert('Password salah!');
    }
}

function updateAdminUI() {
    const roleBadge = document.getElementById('role-badge');
    roleBadge.classList.add('admin');
    roleBadge.innerHTML = `
        <span class="role-icon">👑</span>
        <span class="role-text">Admin Mode</span>
    `;

    document.getElementById('admin-actions')?.style?.setProperty('display', 'flex');
    document.getElementById('admin-actions-panel')?.style?.setProperty('display', 'flex');
}

async function addAccount() {
    if (!isAdminLoggedIn) return;

    const alias = await showModal('Add Account', 'Nama Alias:', false, '➕');
    if (!alias) return;

    // Check for duplicate alias
    if (accounts[alias]) {
        alert(`⚠️ Alias "${alias}" sudah ada! Gunakan nama lain atau edit akun yang sudah ada.`);
        return;
    }

    const username = await showModal('Add Account', 'Username:', false, '👤');
    if (!username) return;

    const password = await showModal('Add Account', 'Password:', true, '🔐');
    if (!password) return;

    const category = await showModal('Add Account', 'Kategori/Game (contoh: Valorant):', false, '🎮');

    accounts[alias] = {
        u: username,
        p: password,
        category: category || 'Uncategorized'
    };

    renderGameGrid();
    saveCloudData();
    alert(`✅ Akun "${alias}" berhasil ditambahkan!`);
}

async function addAccountInCategory() {
    if (!isAdminLoggedIn || !selectedGame) return;

    const alias = await showModal(`Add Account - ${selectedGame}`, 'Nama Alias:', false, '➕');
    if (!alias) return;

    // Check for duplicate alias
    if (accounts[alias]) {
        alert(`⚠️ Alias "${alias}" sudah ada! Gunakan nama lain atau edit akun yang sudah ada.`);
        return;
    }

    const username = await showModal(`Add Account - ${selectedGame}`, 'Username:', false, '👤');
    if (!username) return;

    const password = await showModal(`Add Account - ${selectedGame}`, 'Password:', true, '🔐');
    if (!password) return;

    // Automatically use the current selected game as category
    accounts[alias] = {
        u: username,
        p: password,
        category: selectedGame
    };
    renderAccountList();
    saveCloudData();
    alert(`✅ Akun "${alias}" ditambahkan ke ${selectedGame}!`);
}

async function editAccount() {
    if (!isAdminLoggedIn || !selectedAccount) {
        alert('Pilih akun yang ingin diedit!');
        return;
    }

    const acc = accounts[selectedAccount];

    // Edit alias/name
    const newAlias = await showModal('Edit Account', `Nama Alias (saat ini: ${selectedAccount}):`, false, '✏️');

    // Edit username
    const newUsername = await showModal('Edit Account', `Username (saat ini: ${acc.u}):`, false, '👤');

    // Edit password (optional)
    const newPassword = await showModal('Edit Account', 'Password baru (kosongkan jika tidak ganti):', true, '🔐');

    // Edit category
    const newCategory = await showModal('Edit Account', `Kategori/Game (saat ini: ${acc.category || 'kosong'}):`, false, '🎮');

    // Apply changes
    const finalAlias = newAlias || selectedAccount;
    const finalData = {
        u: newUsername || acc.u,
        p: newPassword || acc.p,
        category: newCategory || acc.category || 'Uncategorized'
    };

    // If alias changed, delete old and create new
    if (finalAlias !== selectedAccount) {
        delete accounts[selectedAccount];
    }

    accounts[finalAlias] = finalData;
    selectedAccount = finalAlias;

    renderAccountList();
    saveCloudData();

    alert('✅ Akun berhasil diupdate!');
}

async function deleteAccount() {
    if (!isAdminLoggedIn || !selectedAccount) return;

    if (confirm(`Delete "${selectedAccount}"?`)) {
        delete accounts[selectedAccount];
        selectedAccount = null;
        renderAccountList();
        saveCloudData();
    }
}

// ============================================
// Settings
// ============================================
async function openSettings() {
    if (window.electronAPI) {
        const path = await window.electronAPI.selectSteamPath();
        if (path) {
            settings.steam_path = path;
            await window.electronAPI.saveSettings(settings);
            updateStatusBar();
            alert('Steam path updated!');
        }
    }
}

// ============================================
// Injection
// ============================================
async function startInjection() {
    if (!selectedAccount || !accounts[selectedAccount]) {
        alert('Please select an account first!');
        return;
    }

    const btn = document.getElementById('btn-inject');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span>RUNNING...</span>';

    // Set flag to prevent focusWindow from stealing focus from Steam
    window.isInjecting = true;

    try {
        if (window.electronAPI) {
            console.log('Starting injection for:', selectedAccount);
            console.log('Steam path:', settings.steam_path);

            const result = await window.electronAPI.runInjection(
                accounts[selectedAccount],
                settings.steam_path
            );

            console.log('Injection result:', result);

            if (result.success) {
                alert('✅ Login berhasil!');
            }
        } else {
            alert('Electron API not available. Running in browser mode.');
        }
    } catch (e) {
        console.error('Injection error:', e);
        alert('❌ Error: ' + e.message);
    } finally {
        // Reset flag when injection is done
        window.isInjecting = false;
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🚀</span><span>LOCK & INJECT</span>';
    }
}

// Listen for injection status updates
if (window.electronAPI) {
    window.electronAPI.onInjectionStatus?.((data) => {
        console.log('Injection status:', data);
        if (data.text) {
            window.electronAPI.updateOverlay(data.text, data.subtext || '', data.color || 'yellow');
        }
    });
}

// ============================================
// Steam Guard Module
// ============================================
function initSteamGuard() {
    // Tab switching
    document.querySelectorAll('.sg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sg-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.sg-tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`sg-tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // Login buttons
    document.getElementById('sg-guest-login')?.addEventListener('click', sgGuestLogin);
    document.getElementById('sg-admin-login')?.addEventListener('click', sgAdminLogin);
    document.getElementById('sg-logout')?.addEventListener('click', sgLogout);

    // Navigation
    document.querySelectorAll('.sg-nav-btn[data-sg-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sg-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.sg-view').forEach(v => v.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`sg-view-${btn.dataset.sgView}`).classList.add('active');
        });
    });

    // Form actions
    document.getElementById('sg-save-account')?.addEventListener('click', sgSaveAccount);
    document.getElementById('sg-cancel-add')?.addEventListener('click', () => {
        document.querySelector('.sg-nav-btn[data-sg-view="accounts"]').click();
    });
    document.getElementById('sg-generate-voucher')?.addEventListener('click', sgGenerateVoucher);
}

function sgConsoleLog(text, type = 'info') {
    const console = document.getElementById('sg-console');
    const line = document.createElement('div');
    line.className = `sg-console-line ${type}`;
    line.textContent = text;
    console.appendChild(line);
    console.scrollTop = console.scrollHeight;
}

function sgClearConsole() {
    document.getElementById('sg-console').innerHTML = '';
}

async function sgGuestLogin() {
    const code = document.getElementById('sg-voucher-code').value.toUpperCase();
    if (!code) return;

    try {
        // Use Python backend for proper Fernet decryption
        if (window.electronAPI) {
            const result = await window.electronAPI.sgLoginGuest(code);
            console.log('SG Guest login result:', result);

            if (result.success) {
                sgAccounts = result.accounts || {};
                sgMasterKey = result.master_key;
                sgUserRole = 'GUEST';
                sgShowDashboard();
                return;
            } else {
                alert(result.error || 'Login error!');
                return;
            }
        }

        // Fallback for browser testing
        alert('Electron API not available. Run in Electron app.');
    } catch (e) {
        console.error('Guest login error:', e);
        alert('Login error: ' + e.message);
    }
}

async function sgAdminLogin() {
    const password = document.getElementById('sg-admin-password').value;
    if (!password) return;

    try {
        // Use Python backend for proper Fernet decryption
        if (window.electronAPI) {
            const result = await window.electronAPI.sgLoginAdmin(password);
            console.log('SG Admin login result:', result);

            if (result.success) {
                sgAccounts = result.accounts || {};
                sgMasterKey = result.master_key;
                sgUserRole = 'ADMIN';
                sgShowDashboard();
                return;
            } else if (result.new_db) {
                if (confirm('Database kosong. Buat database baru?')) {
                    await sgSetupNewAdmin(password);
                }
                return;
            } else {
                alert(result.error || 'Wrong password!');
                return;
            }
        }

        // Fallback
        alert('Electron API not available. Run in Electron app.');
    } catch (e) {
        console.error('Admin login error:', e);
        alert('Login error: ' + e.message);
    }
}

async function sgSetupNewAdmin(password) {
    try {
        if (window.electronAPI) {
            const result = await window.electronAPI.sgSetupAdmin(password);
            console.log('SG Setup admin result:', result);

            if (result.success) {
                sgMasterKey = result.master_key;
                sgAccounts = {};
                sgUserRole = 'ADMIN';
                sgShowDashboard();
            } else {
                alert(result.error || 'Setup failed!');
            }
        }
    } catch (e) {
        console.error('Setup admin error:', e);
        alert('Setup error: ' + e.message);
    }
}

function sgShowDashboard() {
    document.getElementById('sg-login-panel').style.display = 'none';
    document.getElementById('sg-dashboard').style.display = 'flex';

    if (sgUserRole === 'ADMIN') {
        document.getElementById('sg-dashboard').classList.add('admin');
    }

    sgRenderAccounts();
    sgConsoleLog(`Login sebagai ${sgUserRole}.`, 'info');
}

function sgLogout() {
    sgUserRole = null;
    sgAccounts = {};
    sgClearConsole();

    document.getElementById('sg-dashboard').style.display = 'none';
    document.getElementById('sg-dashboard').classList.remove('admin');
    document.getElementById('sg-login-panel').style.display = 'flex';

    document.getElementById('sg-voucher-code').value = '';
    document.getElementById('sg-admin-password').value = '';
}

function sgRenderAccounts() {
    const container = document.getElementById('sg-account-list');
    container.innerHTML = '';

    const names = Object.keys(sgAccounts);

    if (names.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted);">Belum ada akun tersimpan.</p>';
        return;
    }

    names.forEach(name => {
        const acc = sgAccounts[name];
        const item = document.createElement('div');
        item.className = 'sg-account-item';

        const showEmail = sgUserRole === 'ADMIN';

        item.innerHTML = `
            <div class="sg-account-info">
                <span class="sg-account-name">${name}</span>
                ${showEmail ? `<span class="sg-account-email">${acc.email}</span>` : ''}
            </div>
            <div class="sg-account-actions">
                <button class="btn btn-primary btn-sm" onclick="sgCheckCode('${name}')">LIHAT KODE</button>
                ${sgUserRole === 'ADMIN' ? `<button class="btn btn-danger btn-sm" onclick="sgDeleteAccount('${name}')">X</button>` : ''}
            </div>
        `;

        container.appendChild(item);
    });
}

async function sgCheckCode(name) {
    const acc = sgAccounts[name];
    sgClearConsole();
    sgConsoleLog(`🔍 CONNECTING TO ${name}...`, 'info');

    // Note: IMAP requires backend - show message
    sgConsoleLog('⚠️ IMAP email checking requires Python backend.', 'warning');
    sgConsoleLog('Please use the original Python Steam Guard for full functionality.', 'warning');
}

window.sgCheckCode = sgCheckCode;

async function sgDeleteAccount(name) {
    if (confirm(`Hapus ${name}?`)) {
        delete sgAccounts[name];
        await sgSaveCloud();
        sgRenderAccounts();
        sgConsoleLog(`✅ Deleted: ${name}`, 'success');
    }
}

window.sgDeleteAccount = sgDeleteAccount;

async function sgSaveAccount() {
    const name = document.getElementById('sg-acc-name').value;
    const email = document.getElementById('sg-acc-email').value;
    const pass = document.getElementById('sg-acc-pass').value;

    if (!name || !email || !pass) {
        sgConsoleLog('❌ Data kurang!', 'error');
        return;
    }

    const server = email.includes('yahoo') ? 'imap.mail.yahoo.com' : 'imap.gmail.com';

    sgAccounts[name] = { email, pass, server };
    await sgSaveCloud();

    document.getElementById('sg-acc-name').value = '';
    document.getElementById('sg-acc-email').value = '';
    document.getElementById('sg-acc-pass').value = '';

    sgConsoleLog(`✅ Disimpan: ${name}`, 'success');
    document.querySelector('.sg-nav-btn[data-sg-view="accounts"]').click();
    sgRenderAccounts();
}

async function sgSaveCloud() {
    try {
        if (window.electronAPI && sgMasterKey) {
            const result = await window.electronAPI.sgSaveAccounts(sgMasterKey, sgAccounts);
            console.log('SG Save result:', result);
            if (!result.success) {
                sgConsoleLog('❌ Save error: ' + result.error, 'error');
            }
        }
    } catch (e) {
        console.error('Save error:', e);
        sgConsoleLog('❌ Save error: ' + e.message, 'error');
    }
}

async function sgGenerateVoucher() {
    const days = parseInt(document.getElementById('sg-voucher-days').value) || 7;

    try {
        if (window.electronAPI && sgMasterKey) {
            const result = await window.electronAPI.sgCreateVoucher(sgMasterKey, days);
            console.log('SG Voucher result:', result);

            if (result.success) {
                document.getElementById('sg-voucher-code-result').value = result.code;
                document.getElementById('sg-voucher-expiry').textContent = `Exp: ${result.expiry}`;
                document.getElementById('sg-voucher-result').style.display = 'block';
                sgConsoleLog(`✅ Voucher created: ${result.code}`, 'success');
            } else {
                sgConsoleLog('❌ Failed: ' + result.error, 'error');
            }
        } else {
            sgConsoleLog('❌ Not logged in as admin', 'error');
        }
    } catch (e) {
        console.error('Voucher error:', e);
        sgConsoleLog('❌ Failed to create voucher: ' + e.message, 'error');
    }
}
