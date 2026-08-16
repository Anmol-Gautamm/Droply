/**
 * Droply Application Logic
 * Powered by Web Crypto API, IndexedDB, and BroadcastChannel
 */

// --- Database & Storage Service ---
const DB_NAME = 'DroplyDB';
const DB_VERSION = 1;
const STORE_NAME = 'drops';

const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('droply_channel') 
  : null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'code' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let numPart = '';
  for (let i = 0; i < 4; i++) {
    numPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `DROP-${numPart}`;
}

// --- Web Crypto API Encryption/Decryption ---
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const ITERATIONS = 100000;

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: KEY_DERIVATION_ALGORITHM,
      salt: salt,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: ENCRYPTION_ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptFile(file, password) {
  if (!password) return file;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const arrayBuffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    arrayBuffer
  );

  const combined = new Uint8Array(salt.byteLength + iv.byteLength + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(encryptedBuffer), salt.byteLength + iv.byteLength);

  return new Blob([combined], { type: 'application/octet-stream' });
}

async function decryptFile(encryptedBlob, password, mimeType) {
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  if (data.byteLength < 28) {
    throw new Error('Invalid encrypted file format.');
  }

  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const encryptedData = data.slice(28);

  const key = await deriveKey(password, salt);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    encryptedData
  );

  return new Blob([decryptedBuffer], { type: mimeType || 'application/octet-stream' });
}

async function saveDrop({ fileBlob, fileName, fileSize, fileType, expiryType, isEncrypted }) {
  const db = await openDB();
  const code = generateShareCode();
  const now = Date.now();

  let expiresAt = null;
  if (expiryType === '10m') expiresAt = now + 10 * 60 * 1000;
  else if (expiryType === '1h') expiresAt = now + 60 * 60 * 1000;
  else if (expiryType === '24h') expiresAt = now + 24 * 60 * 60 * 1000;
  else if (expiryType === '7d') expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  else if (expiryType === '30d') expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  else if (expiryType === '1y') expiresAt = now + 365 * 24 * 60 * 60 * 1000;
  else if (expiryType === 'never') expiresAt = null;

  const dropRecord = {
    code,
    fileName,
    fileSize,
    fileType,
    fileBlob,
    createdAt: now,
    expiresAt,
    expiryType,
    isEncrypted: Boolean(isEncrypted),
    downloadsCount: 0
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(dropRecord);
    request.onsuccess = () => {
      if (broadcastChannel) broadcastChannel.postMessage({ type: 'DROP_CREATED', code });
      resolve(dropRecord);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getDrop(code) {
  if (!code) return null;
  const db = await openDB();
  const formattedCode = code.toUpperCase().trim();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(formattedCode);
    request.onsuccess = () => {
      const drop = request.result;
      if (!drop) return resolve(null);
      if (drop.expiresAt && Date.now() > drop.expiresAt) {
        deleteDrop(formattedCode);
        return resolve({ expired: true });
      }
      resolve(drop);
    };
    request.onerror = () => reject(request.error);
  });
}

async function incrementDownload(code) {
  const db = await openDB();
  const formattedCode = code.toUpperCase().trim();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(formattedCode);
    request.onsuccess = async () => {
      const drop = request.result;
      if (!drop) return resolve(null);
      drop.downloadsCount += 1;

      if (drop.expiryType === '1time') {
        store.delete(formattedCode);
        if (broadcastChannel) broadcastChannel.postMessage({ type: 'DROP_DELETED', code: formattedCode });
        resolve({ ...drop, deletedAfterDownload: true });
      } else {
        store.put(drop);
        if (broadcastChannel) broadcastChannel.postMessage({ type: 'DROP_UPDATED', code: formattedCode });
        resolve(drop);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAllDrops() {
  const db = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const drops = request.result || [];
      const activeDrops = [];
      drops.forEach((drop) => {
        if (drop.expiresAt && now > drop.expiresAt) {
          store.delete(drop.code);
        } else {
          activeDrops.push(drop);
        }
      });
      activeDrops.sort((a, b) => b.createdAt - a.createdAt);
      resolve(activeDrops);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deleteDrop(code) {
  const db = await openDB();
  const formattedCode = code.toUpperCase().trim();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(formattedCode);
    request.onsuccess = () => {
      if (broadcastChannel) broadcastChannel.postMessage({ type: 'DROP_DELETED', code: formattedCode });
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

// --- UI Application Logic ---

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Limit toasts to a maximum of 2 notices at a time
  const existingToasts = container.querySelectorAll('div');
  if (existingToasts.length >= 2) {
    existingToasts[0].remove();
  }

  const toast = document.createElement('div');
  toast.className = 'bg-surface-container-high border border-primary/40 text-on-surface px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 font-medium text-sm transition-all duration-300 transform translate-y-2';
  
  let icon = 'info';
  if (type === 'success') icon = 'check_circle';
  if (type === 'error') icon = 'warning';

  toast.innerHTML = `<span class="material-symbols-outlined ${type === 'success' ? 'text-tertiary' : type === 'error' ? 'text-error' : 'text-primary'}">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(type, filename) {
  if (type?.includes('pdf') || filename?.endsWith('.pdf')) return 'picture_as_pdf';
  if (type?.startsWith('image/')) return 'image';
  if (type?.startsWith('video/')) return 'movie';
  if (type?.startsWith('audio/')) return 'audio_file';
  if (type?.startsWith('text/') || type?.includes('json') || type?.includes('js') || type?.includes('html')) return 'code';
  if (type?.includes('zip') || type?.includes('archive') || type?.includes('tar')) return 'folder_zip';
  return 'description';
}

// Global App State
let selectedFile = null;
let currentClaimDrop = null;
let currentDecryptedBlob = null;

// Tab Management
function switchTab(tabId) {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });

  if (tabId === 'drops') {
    renderMyDrops();
  }

  // Smooth Auto-Scroll to the active tab screen
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) {
    const navHeaderHeight = 90;
    const elementTop = targetTab.getBoundingClientRect().top + window.pageYOffset;
    const targetScrollPosition = Math.max(0, elementTop - navHeaderHeight);

    window.scrollTo({
      top: targetScrollPosition,
      behavior: 'smooth'
    });
  }
}

async function updateActiveBadge() {
  const drops = await getAllDrops();
  const badge = document.getElementById('activeCountBadge');
  if (badge) {
    badge.textContent = drops.length;
    badge.classList.toggle('hidden', drops.length === 0);
  }
}

// Dashboard Filter State
let currentDashboardFilter = 'all';
let dashboardSearchQuery = '';

// Render My Drops Table & Stats Dashboard
async function renderMyDrops() {
  const container = document.getElementById('dropsTableContainer');
  if (!container) return;
  const allDrops = await getAllDrops();

  // Update Stats Cards
  const activeCountEl = document.getElementById('dashboardStatActive');
  const downloadsCountEl = document.getElementById('dashboardStatDownloads');
  const encryptedCountEl = document.getElementById('dashboardStatEncrypted');
  const storageCountEl = document.getElementById('dashboardStatStorage');

  if (activeCountEl) activeCountEl.textContent = allDrops.length;
  if (downloadsCountEl) {
    const totalDLs = allDrops.reduce((acc, d) => acc + (d.downloadsCount || 0), 0);
    downloadsCountEl.textContent = totalDLs;
  }
  if (encryptedCountEl) {
    const totalEnc = allDrops.filter(d => d.isEncrypted).length;
    encryptedCountEl.textContent = totalEnc;
  }
  if (storageCountEl) {
    const totalBytes = allDrops.reduce((acc, d) => acc + (d.fileSize || 0), 0);
    storageCountEl.innerHTML = `${formatBytes(totalBytes)}`;
  }

  // Filter Drops
  let filteredDrops = allDrops.filter(drop => {
    if (dashboardSearchQuery) {
      const q = dashboardSearchQuery.toLowerCase();
      const matchName = drop.fileName.toLowerCase().includes(q);
      const matchCode = drop.code.toLowerCase().includes(q);
      if (!matchName && !matchCode) return false;
    }
    if (currentDashboardFilter === 'encrypted') {
      return drop.isEncrypted;
    }
    if (currentDashboardFilter === 'active') {
      return !drop.expiresAt || drop.expiresAt > Date.now();
    }
    return true;
  });

  if (filteredDrops.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div class="w-16 h-16 rounded-2xl bg-surface-container-highest flex items-center justify-center mb-4 text-on-surface-variant">
          <span class="material-symbols-outlined text-3xl">folder_open</span>
        </div>
        <h3 class="font-headline-sm text-lg font-bold text-on-surface mb-1">No drops found</h3>
        <p class="font-body-md text-xs text-on-surface-variant max-w-sm mb-6">No drops match your current filter or search query. Create a new drop to get started.</p>
        <button onclick="switchTab('upload')" class="bg-primary text-on-primary py-2.5 px-6 rounded-xl font-semibold text-xs hover:bg-primary-fixed transition-colors shadow-sm inline-flex items-center gap-1.5">
          <span class="material-symbols-outlined text-sm">add</span> Create First Drop
        </button>
      </div>
    `;
    return;
  }

  let html = `
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="bg-surface-container-low border-b border-outline-variant/30 text-on-surface-variant text-xs uppercase font-semibold">
          <th class="py-3 px-4">Type</th>
          <th class="py-3 px-4">Filename</th>
          <th class="py-3 px-4">Drop Code</th>
          <th class="py-3 px-4">Expires</th>
          <th class="py-3 px-4">DLs</th>
          <th class="py-3 px-4">Encryption</th>
          <th class="py-3 px-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10 text-sm">
  `;

  filteredDrops.forEach(drop => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?code=${drop.code}`;
    let expiryStr = 'No expiry';
    let isExpired = false;

    if (drop.expiryType === '1time') expiryStr = '1-time download';
    else if (drop.expiryType === 'never') expiryStr = 'Permanent';
    else if (drop.expiresAt) {
      const remainingMs = drop.expiresAt - Date.now();
      if (remainingMs <= 0) {
        expiryStr = 'Expired';
        isExpired = true;
      } else {
        const mins = Math.floor(remainingMs / (1000 * 60));
        if (mins < 60) expiryStr = `${mins} mins`;
        else if (mins < 2880) expiryStr = `${Math.floor(mins / 60)} hrs`;
        else expiryStr = `${Math.floor(mins / (60 * 24))} days`;
      }
    }

    const iconName = getFileIcon(drop.fileType, drop.fileName);

    html += `
      <tr class="hover:bg-surface-container-lowest/50 transition-colors group">
        <td class="py-3 px-4">
          <div class="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary">
            <span class="material-symbols-outlined text-base">${iconName}</span>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="font-semibold text-on-surface break-all">${drop.fileName}</div>
          <div class="text-xs text-on-surface-variant">${formatBytes(drop.fileSize)}</div>
        </td>
        <td class="py-3 px-4">
          <span class="font-label-md text-xs bg-surface-container-high px-2.5 py-1 rounded-lg text-primary font-bold">${drop.code}</span>
        </td>
        <td class="py-3 px-4 text-xs font-medium ${isExpired ? 'text-error font-bold' : 'text-on-surface-variant'}">${expiryStr}</td>
        <td class="py-3 px-4 font-bold text-on-surface">${drop.downloadsCount || 0}</td>
        <td class="py-3 px-4">
          ${drop.isEncrypted ? `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-tertiary/10 text-tertiary text-xs font-semibold">
              <span class="material-symbols-outlined text-[14px]">lock</span> AES-256
            </span>
          ` : `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant text-xs">
              <span class="material-symbols-outlined text-[14px]">lock_open</span> None
            </span>
          `}
        </td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <button onclick="copyText('${shareUrl}', 'Link')" class="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Copy Link">
              <span class="material-symbols-outlined text-[18px]">content_copy</span>
            </button>
            <button onclick="handleDeleteDrop('${drop.code}')" class="p-1.5 text-on-surface-variant hover:text-error hover:bg-error/10 rounded-lg transition-colors" title="Delete Drop">
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

window.copyText = function(text, label) {
  navigator.clipboard.writeText(text);
  showToast(`${label} copied to clipboard!`, 'success');
};

window.handleDeleteDrop = async function(code) {
  await deleteDrop(code);
  showToast(`Drop ${code} deleted`, 'info');
  renderMyDrops();
  updateActiveBadge();
};

// Handle Drop creation
async function processCreateDrop() {
  if (!selectedFile) {
    showToast('Please select or drop a file first!', 'error');
    return;
  }

  let expiryType = document.getElementById('expirySelect').value;
  const checkDeleteAfter = document.getElementById('checkDeleteAfter');
  if (checkDeleteAfter && checkDeleteAfter.checked) {
    expiryType = '1time';
  }

  const enablePass = document.getElementById('enablePassCheck').checked;
  const password = document.getElementById('passInput').value;

  try {
    let fileToStore = selectedFile;
    let isEncrypted = false;

    if (enablePass && password.trim()) {
      fileToStore = await encryptFile(selectedFile, password.trim());
      isEncrypted = true;
    }

    const drop = await saveDrop({
      fileBlob: fileToStore,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      expiryType,
      isEncrypted
    });

    showToast('File dropped successfully! Share code generated.', 'success');
    openShareModal(drop);
    updateActiveBadge();

    // Reset upload state
    selectedFile = null;
    const fileSelectionInfo = document.getElementById('fileSelectionInfo');
    if (fileSelectionInfo) fileSelectionInfo.style.display = 'none';

    const dropPromptInfo = document.getElementById('dropPromptInfo');
    if (dropPromptInfo) dropPromptInfo.style.display = 'block';

    const optionsSection = document.getElementById('optionsSection');
    if (optionsSection) optionsSection.style.display = 'none';

    const passIn = document.getElementById('passInput');
    if (passIn) {
      passIn.value = '';
      passIn.type = 'password';
    }
    const passIcon = document.getElementById('passVisibilityIcon');
    if (passIcon) passIcon.textContent = 'visibility';
    const toggleBtn = document.getElementById('togglePassVisibility');
    if (toggleBtn) {
      toggleBtn.setAttribute('title', 'Show password');
      toggleBtn.setAttribute('aria-label', 'Show password');
    }
    const enablePassCheckEl = document.getElementById('enablePassCheck');
    if (enablePassCheckEl) enablePassCheckEl.checked = false;

    const passInputGroup = document.getElementById('passInputGroup');
    if (passInputGroup) passInputGroup.style.display = 'none';
  } catch (err) {
    console.error(err);
    showToast('Failed to drop file: ' + err.message, 'error');
  }
}

/**
 * Generates the shareable URL for a drop code.
 *
 * DEVELOPER & LOCAL NETWORK TESTING NOTE:
 * When testing on localhost (127.0.0.1:5500), scanning a QR code with a phone's camera
 * will attempt to connect to 127.0.0.1 on the phone itself (which fails).
 * For local network testing across multiple devices, set window.DROPLY_LAN_IP = '192.168.X.X'
 * in index.html, or access your dev server using your PC's Wi-Fi / LAN IP address directly.
 *
 * In production deployments, window.location.origin dynamically resolves to your
 * live HTTPS domain (e.g. https://droply.app/index.html?code=DROP-XXXX).
 */
function getShareableUrl(code) {
  let origin = window.location.origin;

  // Optional local network LAN IP override for mobile phone testing during development
  if ((origin.includes('127.0.0.1') || origin.includes('localhost')) && window.DROPLY_LAN_IP) {
    const port = window.location.port ? `:${window.location.port}` : '';
    origin = `http://${window.DROPLY_LAN_IP}${port}`;
  }

  const pathname = window.location.pathname.endsWith('.html') || window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`;

  return `${origin}${pathname}?code=${encodeURIComponent(code)}`;
}

// Modal handling
function openShareModal(drop) {
  const modal = document.getElementById('shareModal');
  if (!modal) return;
  const modalCodeBadge = document.getElementById('modalCodeBadge');
  if (modalCodeBadge) modalCodeBadge.textContent = drop.code;
  const shareUrl = getShareableUrl(drop.code);
  const modalShareUrl = document.getElementById('modalShareUrl');
  if (modalShareUrl) modalShareUrl.value = shareUrl;

  const expiryTitle = document.getElementById('modalExpiryTitle');
  if (expiryTitle) {
    if (drop.expiryType === '1time') expiryTitle.textContent = 'Expires after 1 download';
    else if (drop.expiryType === '10m') expiryTitle.textContent = 'Expires in 10 minutes';
    else if (drop.expiryType === '1h') expiryTitle.textContent = 'Expires in 1 hour';
    else if (drop.expiryType === '24h') expiryTitle.textContent = 'Expires in 24 hours';
    else if (drop.expiryType === '7d') expiryTitle.textContent = 'Expires in 7 days';
    else if (drop.expiryType === '30d') expiryTitle.textContent = 'Expires in 30 days';
    else if (drop.expiryType === '1y') expiryTitle.textContent = 'Expires in 1 year';
    else if (drop.expiryType === 'never') expiryTitle.textContent = 'Permanent (No Expiration)';
    else expiryTitle.textContent = 'Expires in 24 hours';
  }

  const encTitle = document.getElementById('modalEncryptedTitle');
  if (encTitle) {
    encTitle.textContent = drop.isEncrypted ? 'End-to-End Encrypted' : 'Standard Protection';
  }

  modal.classList.remove('hidden');
}

// Recent Codes Storage & Chip Management
function getRecentCodes() {
  try {
    return JSON.parse(localStorage.getItem('droply_recent_codes') || '[]');
  } catch (e) {
    return [];
  }
}

function saveRecentCode(code) {
  if (!code) return;
  let list = getRecentCodes();
  list = list.filter(c => c !== code);
  list.unshift(code);
  if (list.length > 5) list = list.slice(0, 5);
  localStorage.setItem('droply_recent_codes', JSON.stringify(list));
  renderRecentCodes();
}

function renderRecentCodes() {
  const container = document.getElementById('recentCodesContainer');
  const section = document.getElementById('recentCodesSection');
  if (!container || !section) return;

  const list = getRecentCodes();
  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = '';

  list.forEach(code => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'px-3 py-1.5 bg-surface-container border border-outline-variant/30 rounded-full hover:bg-surface-container-high hover:border-primary/50 transition-colors group flex items-center gap-1.5 text-xs';
    chip.innerHTML = `
      <span class="font-label-md text-on-surface-variant group-hover:text-primary transition-colors font-semibold">${code}</span>
      <span class="material-symbols-outlined text-[14px] text-outline group-hover:text-primary">history</span>
    `;
    chip.addEventListener('click', () => {
      const input = document.getElementById('claimCodeInput');
      if (input) input.value = code;
      lookupClaimCode(code);
    });
    container.appendChild(chip);
  });
}

// Claim File Lookup & Metadata Sidebar Populator
async function lookupClaimCode(codeToSearch) {
  const codeInput = document.getElementById('claimCodeInput');
  const code = (codeToSearch || (codeInput ? codeInput.value : '')).trim().toUpperCase();
  if (!code) {
    showToast('Please enter a 6-character code!', 'error');
    return;
  }

  const resultContainer = document.getElementById('claimResultContainer');
  const notFoundBox = document.getElementById('claimNotFound');
  if (notFoundBox) notFoundBox.style.display = 'none';
  if (resultContainer) resultContainer.style.display = 'none';

  const drop = await getDrop(code);
  if (!drop || drop.expired) {
    if (notFoundBox) notFoundBox.style.display = 'block';
    showToast('No active drop found for code: ' + code, 'error');
    return;
  }

  // Save to recent codes
  saveRecentCode(drop.code);

  currentClaimDrop = drop;

  // Populate Sidebar Metadata
  const previewWindowFilename = document.getElementById('previewWindowFilename');
  if (previewWindowFilename) previewWindowFilename.textContent = drop.fileName;

  const sidebarFileName = document.getElementById('sidebarFileName');
  if (sidebarFileName) sidebarFileName.textContent = drop.fileName;

  const sidebarFileIcon = document.getElementById('sidebarFileIcon');
  if (sidebarFileIcon) sidebarFileIcon.textContent = getFileIcon(drop.fileType, drop.fileName);
  
  const dateStr = new Date(drop.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const sidebarDateAdded = document.getElementById('sidebarDateAdded');
  if (sidebarDateAdded) sidebarDateAdded.textContent = `Added ${dateStr}`;
  
  const sidebarFileSize = document.getElementById('sidebarFileSize');
  if (sidebarFileSize) sidebarFileSize.textContent = formatBytes(drop.fileSize);

  const sidebarDownloads = document.getElementById('sidebarDownloads');
  if (sidebarDownloads) sidebarDownloads.textContent = drop.downloadsCount || 0;

  // Expiration Progress Bar
  const expiryBar = document.getElementById('sidebarExpiryBar');
  const expiryText = document.getElementById('sidebarExpiryText');
  if (expiryText && expiryBar) {
    if (drop.expiryType === '1time') {
      expiryText.textContent = '1-time download';
      expiryBar.style.width = '100%';
    } else if (drop.expiryType === 'never') {
      expiryText.textContent = 'Permanent (No Expiration)';
      expiryBar.style.width = '100%';
    } else if (drop.expiresAt) {
      const totalMs = drop.expiresAt - drop.createdAt;
      const remainingMs = drop.expiresAt - Date.now();
      const pct = Math.max(5, Math.min(100, Math.round((remainingMs / totalMs) * 100)));
      expiryBar.style.width = `${pct}%`;
      const mins = Math.floor(remainingMs / (1000 * 60));
      if (mins < 60) expiryText.textContent = `${mins} mins`;
      else if (mins < 2880) expiryText.textContent = `${Math.floor(mins / 60)} hours`;
      else expiryText.textContent = `${Math.floor(mins / (60 * 24))} days`;
    } else {
      expiryText.textContent = 'No expiry';
      expiryBar.style.width = '100%';
    }
  }

  // Encryption badge
  const encBadge = document.getElementById('sidebarEncryptedBadge');
  if (encBadge) {
    encBadge.style.display = drop.isEncrypted ? 'flex' : 'none';
  }

  const pwUnlockForm = document.getElementById('passwordUnlockForm');
  if (drop.isEncrypted) {
    if (pwUnlockForm) pwUnlockForm.style.display = 'block';
    currentDecryptedBlob = null;
  } else {
    if (pwUnlockForm) pwUnlockForm.style.display = 'none';
    currentDecryptedBlob = drop.fileBlob;
    renderFilePreview('claimPreviewBox', drop.fileBlob, drop.fileName, drop.fileType);
  }

  if (resultContainer) {
    resultContainer.style.display = 'flex';
  }

  // Automatically scroll down to the file preview and metadata section
  setTimeout(() => {
    const navHeaderHeight = 90;
    const targetElement = drop.isEncrypted ? document.getElementById('passwordUnlockForm') : resultContainer;
    if (targetElement) {
      const elementTop = targetElement.getBoundingClientRect().top + window.pageYOffset;
      const targetScrollPosition = Math.max(0, elementTop - navHeaderHeight);

      window.scrollTo({
        top: targetScrollPosition,
        behavior: 'smooth'
      });
    }
  }, 120);
}

function renderFilePreview(containerId, blob, fileName, fileType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const url = URL.createObjectURL(blob);

  if (fileType && fileType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'max-w-full max-h-[360px] rounded-lg object-contain shadow-lg border border-outline-variant/30';
    container.appendChild(img);
  } else if (fileType && fileType.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.className = 'w-full max-h-[360px] rounded-lg shadow-lg';
    container.appendChild(video);
  } else if (fileType && fileType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.controls = true;
    audio.className = 'w-full max-w-md';
    container.appendChild(audio);
  } else if (fileType && fileType.startsWith('text/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const pre = document.createElement('pre');
      pre.className = 'font-mono text-xs text-on-surface bg-surface border border-outline-variant/30 p-4 rounded-lg w-full max-h-[340px] overflow-auto whitespace-pre-wrap';
      pre.textContent = e.target.result;
      container.appendChild(pre);
    };
    reader.readAsText(blob.slice(0, 3000));
  } else {
    // Stylized document card preview for PDFs, zips, docs
    container.innerHTML = `
      <div class="bg-surface border border-outline-variant/20 shadow-lg p-6 rounded-lg w-full max-w-sm flex flex-col gap-3 relative z-10">
        <div class="h-3 w-1/3 bg-surface-container-high rounded-sm"></div>
        <div class="text-xl font-bold text-on-surface border-b border-outline-variant/30 pb-2 truncate">${fileName}</div>
        <div class="flex flex-col gap-2 my-2">
          <div class="h-2.5 w-full bg-surface-container-high rounded-sm"></div>
          <div class="h-2.5 w-full bg-surface-container-high rounded-sm"></div>
          <div class="h-2.5 w-4/5 bg-surface-container-high rounded-sm"></div>
        </div>
        <div class="flex justify-end mt-2">
          <span class="material-symbols-outlined text-secondary text-4xl">${getFileIcon(fileType, fileName)}</span>
        </div>
      </div>
    `;
  }
}

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Hero Action Buttons
  const heroBtnUpload = document.getElementById('heroBtnUpload');
  if (heroBtnUpload) {
    heroBtnUpload.addEventListener('click', () => {
      switchTab('upload');
      document.getElementById('tab-upload')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const heroBtnRetrieve = document.getElementById('heroBtnRetrieve');
  if (heroBtnRetrieve) {
    heroBtnRetrieve.addEventListener('click', () => {
      switchTab('claim');
      document.getElementById('tab-claim')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Navigation Tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(btn.dataset.tab);
    });
  });

  // Drag & Drop File Handling
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target.id !== 'btnChangeFile') {
        fileInput.click();
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelected(e.target.files[0]);
      }
    });
  }

  const changeBtn = document.getElementById('btnChangeFile');
  if (changeBtn) {
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  function handleFileSelected(file) {
    selectedFile = file;
    const dropPromptInfo = document.getElementById('dropPromptInfo');
    if (dropPromptInfo) dropPromptInfo.style.display = 'none';

    const fileSelectionInfo = document.getElementById('fileSelectionInfo');
    if (fileSelectionInfo) fileSelectionInfo.style.display = 'block';

    const selectedFileName = document.getElementById('selectedFileName');
    if (selectedFileName) selectedFileName.textContent = file.name;

    const selectedMeta = document.getElementById('selectedMeta');
    if (selectedMeta) selectedMeta.textContent = `${formatBytes(file.size)} • ${file.type || 'Unknown type'}`;

    const optionsSection = document.getElementById('optionsSection');
    if (optionsSection) optionsSection.style.display = 'block';
  }

  // Password Checkbox
  const passCheck = document.getElementById('enablePassCheck');
  if (passCheck) {
    passCheck.addEventListener('change', (e) => {
      document.getElementById('passInputGroup').style.display = e.target.checked ? 'block' : 'none';
      if (!e.target.checked) {
        const passIn = document.getElementById('passInput');
        if (passIn) passIn.type = 'password';
        const passIcon = document.getElementById('passVisibilityIcon');
        if (passIcon) passIcon.textContent = 'visibility';
        const toggleBtn = document.getElementById('togglePassVisibility');
        if (toggleBtn) {
          toggleBtn.setAttribute('title', 'Show password');
          toggleBtn.setAttribute('aria-label', 'Show password');
        }
      }
    });
  }

  // Password Visibility Toggle (Create Drop)
  const togglePassBtn = document.getElementById('togglePassVisibility');
  const passInput = document.getElementById('passInput');
  const passVisibilityIcon = document.getElementById('passVisibilityIcon');
  if (togglePassBtn && passInput && passVisibilityIcon) {
    togglePassBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPassword = passInput.type === 'password';
      passInput.type = isPassword ? 'text' : 'password';
      passVisibilityIcon.textContent = isPassword ? 'visibility_off' : 'visibility';
      togglePassBtn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
      togglePassBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // Password Visibility Toggle (Unlock Drop)
  const toggleUnlockPassBtn = document.getElementById('toggleUnlockPassVisibility');
  const unlockPassInput = document.getElementById('unlockPassInput');
  const unlockPassVisibilityIcon = document.getElementById('unlockPassVisibilityIcon');
  if (toggleUnlockPassBtn && unlockPassInput && unlockPassVisibilityIcon) {
    toggleUnlockPassBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPassword = unlockPassInput.type === 'password';
      unlockPassInput.type = isPassword ? 'text' : 'password';
      unlockPassVisibilityIcon.textContent = isPassword ? 'visibility_off' : 'visibility';
      toggleUnlockPassBtn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
      toggleUnlockPassBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // Create Drop Button
  const btnCreateDrop = document.getElementById('btnCreateDrop');
  if (btnCreateDrop) {
    btnCreateDrop.addEventListener('click', processCreateDrop);
  }

  // Claim Code Search Button
  const btnLookupCode = document.getElementById('btnLookupCode');
  if (btnLookupCode) {
    btnLookupCode.addEventListener('click', () => lookupClaimCode());
  }

  const claimCodeInput = document.getElementById('claimCodeInput');
  if (claimCodeInput) {
    claimCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') lookupClaimCode();
    });
  }

  // Password Unlock Submit
  const btnUnlockFile = document.getElementById('btnUnlockFile');
  if (btnUnlockFile) {
    btnUnlockFile.addEventListener('click', async () => {
      const password = document.getElementById('unlockPassInput').value;
      if (!password.trim() || !currentClaimDrop) return;

      try {
        const blob = await decryptFile(currentClaimDrop.fileBlob, password.trim(), currentClaimDrop.fileType);
        currentDecryptedBlob = blob;
        showToast('File unlocked!', 'success');
        document.getElementById('passwordUnlockForm').style.display = 'none';
        renderFilePreview('claimPreviewBox', blob, currentClaimDrop.fileName, currentClaimDrop.fileType);

        // Smooth scroll to preview window
        setTimeout(() => {
          const previewElem = document.getElementById('claimResultContainer');
          if (previewElem) {
            const navHeaderHeight = 90;
            const elementTop = previewElem.getBoundingClientRect().top + window.pageYOffset;
            window.scrollTo({
              top: Math.max(0, elementTop - navHeaderHeight),
              behavior: 'smooth'
            });
          }
        }, 100);
      } catch (err) {
        showToast('Incorrect password. Try again.', 'error');
      }
    });
  }

  // Download Trigger
  const btnDownloadFile = document.getElementById('btnDownloadFile');
  if (btnDownloadFile) {
    btnDownloadFile.addEventListener('click', async () => {
      if (!currentDecryptedBlob || !currentClaimDrop) return;

      const url = URL.createObjectURL(currentDecryptedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentClaimDrop.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const updated = await incrementDownload(currentClaimDrop.code);
      if (updated?.deletedAfterDownload) {
        showToast('File downloaded! Note: 1-time drop removed.', 'info');
      } else {
        showToast('Download started!', 'success');
      }
      if (updated) {
        document.getElementById('sidebarDownloads').textContent = updated.downloadsCount || 0;
      }
      updateActiveBadge();
    });
  }

  // Sidebar Buttons
  const btnCopyLinkSidebar = document.getElementById('btnCopyLinkSidebar');
  if (btnCopyLinkSidebar) {
    btnCopyLinkSidebar.addEventListener('click', () => {
      if (!currentClaimDrop) return;
      const shareUrl = `${window.location.origin}${window.location.pathname}?code=${currentClaimDrop.code}`;
      copyText(shareUrl, 'Share Link');
    });
  }

  const btnShareAgainSidebar = document.getElementById('btnShareAgainSidebar');
  if (btnShareAgainSidebar) {
    btnShareAgainSidebar.addEventListener('click', () => {
      if (!currentClaimDrop) return;
      openShareModal(currentClaimDrop);
    });
  }

  const btnDeleteSidebar = document.getElementById('btnDeleteSidebar');
  if (btnDeleteSidebar) {
    btnDeleteSidebar.addEventListener('click', async () => {
      if (!currentClaimDrop) return;
      await handleDeleteDrop(currentClaimDrop.code);
      document.getElementById('claimResultContainer').style.display = 'none';
    });
  }

  // Copy Buttons in Modal
  const btnCopyCodeModal = document.getElementById('btnCopyCodeModal');
  if (btnCopyCodeModal) {
    btnCopyCodeModal.addEventListener('click', () => {
      const code = document.getElementById('modalCodeBadge').textContent;
      copyText(code, 'Share Code');
    });
  }

  const btnCopyUrlModal = document.getElementById('btnCopyUrlModal');
  if (btnCopyUrlModal) {
    btnCopyUrlModal.addEventListener('click', () => {
      const url = document.getElementById('modalShareUrl').value;
      copyText(url, 'Share Link');
    });
  }

  const btnCloseModal = document.getElementById('btnCloseModal');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      document.getElementById('shareModal').classList.add('hidden');
    });
  }

  // Backdrop click listener to return to web page
  const shareModalOverlay = document.getElementById('shareModal');
  if (shareModalOverlay) {
    shareModalOverlay.addEventListener('click', (e) => {
      if (e.target === shareModalOverlay) {
        shareModalOverlay.classList.add('hidden');
      }
    });
  }



  // Share Another File Action
  const btnShareAnotherModal = document.getElementById('btnShareAnotherModal');
  if (btnShareAnotherModal) {
    btnShareAnotherModal.addEventListener('click', () => {
      document.getElementById('shareModal').classList.add('hidden');
      switchTab('upload');
    });
  }

  // Return to Dashboard Action
  const btnReturnDashboardModal = document.getElementById('btnReturnDashboardModal');
  if (btnReturnDashboardModal) {
    btnReturnDashboardModal.addEventListener('click', () => {
      document.getElementById('shareModal').classList.add('hidden');
      switchTab('drops');
    });
  }

  // Check URL query parameter `?code=DROP-XXXX`
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  if (codeParam) {
    const claimInput = document.getElementById('claimCodeInput');
    if (claimInput) {
      claimInput.value = codeParam.toUpperCase();
      switchTab('claim');
      lookupClaimCode(codeParam);
    }
  }

  // Theme Toggle Engine
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const themeToggleIcon = document.getElementById('themeToggleIcon');

  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.classList.add('dark');
      if (themeToggleIcon) themeToggleIcon.textContent = 'light_mode';
    } else {
      document.documentElement.classList.remove('dark');
      if (themeToggleIcon) themeToggleIcon.textContent = 'dark_mode';
    }
    localStorage.setItem('droply_theme', isDark ? 'dark' : 'light');


  }

  // Initial Theme load
  const savedTheme = localStorage.getItem('droply_theme');
  if (savedTheme) {
    applyTheme(savedTheme === 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark);
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const isDarkNow = document.documentElement.classList.contains('dark');
      applyTheme(!isDarkNow);
      showToast(!isDarkNow ? 'Dark Mode Enabled' : 'Light Mode Enabled', 'info');
    });
  }

  // Dashboard Sidebar Navigation Buttons
  const sidebarNavBtns = {
    all: document.getElementById('sidebarNavAll'),
    shared: document.getElementById('sidebarNavShared'),
    starred: document.getElementById('sidebarNavStarred'),
    trash: document.getElementById('sidebarNavTrash')
  };

  function updateSidebarActive(activeKey) {
    Object.keys(sidebarNavBtns).forEach(key => {
      const btn = sidebarNavBtns[key];
      if (btn) {
        const isActive = key === activeKey;
        btn.className = isActive
          ? 'w-full flex items-center gap-3 bg-primary/10 text-primary rounded-xl px-4 py-2.5 font-medium text-xs transition-all text-left font-bold'
          : 'w-full flex items-center gap-3 text-on-surface-variant hover:bg-surface-container-high rounded-xl px-4 py-2.5 font-medium text-xs transition-all text-left';
      }
    });
  }

  if (sidebarNavBtns.all) {
    sidebarNavBtns.all.addEventListener('click', () => {
      currentDashboardFilter = 'all';
      updateSidebarActive('all');
      renderMyDrops();
    });
  }
  if (sidebarNavBtns.shared) {
    sidebarNavBtns.shared.addEventListener('click', () => {
      currentDashboardFilter = 'active';
      updateSidebarActive('shared');
      renderMyDrops();
    });
  }
  if (sidebarNavBtns.starred) {
    sidebarNavBtns.starred.addEventListener('click', () => {
      updateSidebarActive('starred');
      showToast('Starred drops view active', 'info');
    });
  }
  if (sidebarNavBtns.trash) {
    sidebarNavBtns.trash.addEventListener('click', () => {
      currentDashboardFilter = 'expired';
      updateSidebarActive('trash');
      renderMyDrops();
    });
  }

  // Fullscreen Preview Lightbox
  const btnExpandPreview = document.getElementById('btnExpandPreview');
  if (btnExpandPreview) {
    btnExpandPreview.addEventListener('click', () => {
      if (!currentClaimDrop || !currentDecryptedBlob) {
        showToast('No active file preview to expand!', 'info');
        return;
      }

      let lightbox = document.getElementById('previewLightboxModal');
      if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'previewLightboxModal';
        lightbox.className = 'fixed inset-0 bg-background/90 backdrop-blur-lg z-[99999] flex flex-col p-6 overflow-hidden';
        lightbox.innerHTML = `
          <div class="flex justify-between items-center pb-4 border-b border-outline-variant/30">
            <h3 id="lightboxFilename" class="font-headline-sm text-lg font-bold text-on-surface"></h3>
            <button id="btnCloseLightbox" class="p-2 rounded-full hover:bg-surface-container-high text-on-surface transition-colors">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
          <div id="lightboxContentBox" class="flex-1 w-full h-full flex items-center justify-center p-4 overflow-auto"></div>
        `;
        document.body.appendChild(lightbox);

        document.getElementById('btnCloseLightbox').addEventListener('click', () => {
          lightbox.style.display = 'none';
        });
      }

      lightbox.style.display = 'flex';
      document.getElementById('lightboxFilename').textContent = currentClaimDrop.fileName;
      renderFilePreview('lightboxContentBox', currentDecryptedBlob, currentClaimDrop.fileName, currentClaimDrop.fileType);
    });
  }

  // Footer Buttons
  const footerPrivacy = document.getElementById('footerPrivacy');
  if (footerPrivacy) {
    footerPrivacy.addEventListener('click', () => {
      showToast('Privacy Guarantee: Zero-Knowledge client-side encryption. No logs.', 'success');
    });
  }

  const footerTerms = document.getElementById('footerTerms');
  if (footerTerms) {
    footerTerms.addEventListener('click', () => {
      showToast('Terms: Temporary file drops decay automatically upon expiration.', 'info');
    });
  }

  const footerStatus = document.getElementById('footerStatus');
  if (footerStatus) {
    footerStatus.addEventListener('click', () => {
      showToast('System Status: Client-side Engine Ready & Operational.', 'success');
    });
  }

  // Dashboard Search Input Listener
  const searchInput = document.getElementById('dashboardSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      dashboardSearchQuery = e.target.value;
      renderMyDrops();
    });
  }

  // Dashboard Filter Category Buttons
  const filterBtns = {
    all: document.getElementById('filterBtnAll'),
    active: document.getElementById('filterBtnActive'),
    encrypted: document.getElementById('filterBtnEncrypted')
  };

  Object.keys(filterBtns).forEach(key => {
    const btn = filterBtns[key];
    if (btn) {
      btn.addEventListener('click', () => {
        currentDashboardFilter = key;
        Object.keys(filterBtns).forEach(k => {
          if (filterBtns[k]) {
            const isActive = k === key;
            filterBtns[k].className = isActive
              ? 'filter-tab-btn flex-1 sm:flex-none px-4 py-2 border border-primary/50 bg-primary/10 text-primary rounded-lg text-xs font-semibold transition-colors'
              : 'filter-tab-btn flex-1 sm:flex-none px-4 py-2 border border-outline-variant/30 text-on-surface-variant rounded-lg text-xs font-medium hover:bg-surface-container-high transition-colors';
          }
        });
        renderMyDrops();
      });
    }
  });

  // Multi-tab broadcast updates
  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', () => {
      updateActiveBadge();
      const activeTabBtn = document.querySelector('.nav-tab-btn.active');
      if (activeTabBtn && activeTabBtn.dataset.tab === 'drops') {
        renderMyDrops();
      }
    });
  }

  // Smart Auto-Hiding / Revealing Floating Header Engine
  const floatingHeader = document.getElementById('floatingHeader');
  let lastScrollY = window.pageYOffset;
  let isHeaderHidden = false;

  window.addEventListener('scroll', () => {
    const currentScrollY = window.pageYOffset;

    if (currentScrollY <= 30) {
      if (isHeaderHidden && floatingHeader) {
        floatingHeader.classList.remove('header-hidden');
        floatingHeader.classList.add('header-visible');
        isHeaderHidden = false;
      }
      lastScrollY = currentScrollY;
      return;
    }

    // Scroll Down -> Hide Header
    if (currentScrollY > lastScrollY + 8 && !isHeaderHidden && currentScrollY > 90) {
      if (floatingHeader) {
        floatingHeader.classList.remove('header-visible');
        floatingHeader.classList.add('header-hidden');
        isHeaderHidden = true;
      }
    } 
    // Scroll Up -> Reveal Header
    else if (currentScrollY < lastScrollY - 6 && isHeaderHidden) {
      if (floatingHeader) {
        floatingHeader.classList.remove('header-hidden');
        floatingHeader.classList.add('header-visible');
        isHeaderHidden = false;
      }
    }

    lastScrollY = currentScrollY;
  }, { passive: true });

  // Initial Recent Codes render
  renderRecentCodes();

  updateActiveBadge();
});
