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
}

async function updateActiveBadge() {
  const drops = await getAllDrops();
  const badge = document.getElementById('activeCountBadge');
  if (badge) {
    badge.textContent = drops.length;
    badge.classList.toggle('hidden', drops.length === 0);
  }
}

// Render My Drops Table
async function renderMyDrops() {
  const container = document.getElementById('dropsTableContainer');
  if (!container) return;
  const drops = await getAllDrops();

  if (drops.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-on-surface-variant">
        <span class="material-symbols-outlined text-4xl mb-2 opacity-50">folder_open</span>
        <p class="text-base font-semibold">No Active Drops Found</p>
        <p class="text-xs mt-1">Files you drop will appear here for easy management.</p>
      </div>
    `;
    return;
  }

  let html = `
    <table class="w-full border-collapse text-left text-sm">
      <thead>
        <tr class="border-b border-outline-variant/30 text-on-surface-variant font-semibold">
          <th class="py-3 px-4">Code</th>
          <th class="py-3 px-4">File Name</th>
          <th class="py-3 px-4">Size</th>
          <th class="py-3 px-4">Expiration</th>
          <th class="py-3 px-4">Downloads</th>
          <th class="py-3 px-4">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10">
  `;

  drops.forEach(drop => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?code=${drop.code}`;
    let expiryStr = 'No expiry';
    if (drop.expiryType === '1time') expiryStr = '1-time download';
    else if (drop.expiresAt) {
      const remainingMs = drop.expiresAt - Date.now();
      const mins = Math.floor(remainingMs / (1000 * 60));
      expiryStr = mins < 60 ? `${mins} mins left` : `${Math.floor(mins/60)} hrs left`;
    }

    html += `
      <tr class="hover:bg-surface-container/40 transition-colors">
        <td class="py-3 px-4"><span class="font-label-md font-bold text-primary bg-primary-container/20 border border-primary/30 px-2.5 py-1 rounded-lg">${drop.code}</span></td>
        <td class="py-3 px-4">
          <div class="font-medium text-on-surface">${drop.fileName}</div>
          ${drop.isEncrypted ? '<span class="text-[11px] text-tertiary flex items-center gap-1"><span class="material-symbols-outlined text-xs">lock</span> Encrypted</span>' : ''}
        </td>
        <td class="py-3 px-4 text-on-surface-variant">${formatBytes(drop.fileSize)}</td>
        <td class="py-3 px-4 text-secondary">${expiryStr}</td>
        <td class="py-3 px-4 font-bold text-on-surface">${drop.downloadsCount || 0}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <button onclick="copyText('${drop.code}', 'Code')" class="bg-surface-container border border-outline-variant/40 text-on-surface px-2.5 py-1 rounded-lg text-xs hover:bg-surface-bright transition-colors flex items-center gap-1">📋 Code</button>
            <button onclick="copyText('${shareUrl}', 'Link')" class="bg-surface-container border border-outline-variant/40 text-on-surface px-2.5 py-1 rounded-lg text-xs hover:bg-surface-bright transition-colors flex items-center gap-1">🔗 Link</button>
            <button onclick="handleDeleteDrop('${drop.code}')" class="bg-error-container/30 border border-error/40 text-error px-2 py-1 rounded-lg text-xs hover:bg-error-container/60 transition-colors flex items-center gap-1">🗑️ Delete</button>
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

  const expiryType = document.getElementById('expirySelect').value;
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
    document.getElementById('fileSelectionInfo').style.display = 'none';
    document.getElementById('dropPromptInfo').style.display = 'block';
    document.getElementById('optionsSection').style.display = 'none';
    document.getElementById('passInput').value = '';
    document.getElementById('enablePassCheck').checked = false;
    document.getElementById('passInputGroup').style.display = 'none';
  } catch (err) {
    console.error(err);
    showToast('Failed to drop file: ' + err.message, 'error');
  }
}

// Modal handling
function openShareModal(drop) {
  const modal = document.getElementById('shareModal');
  if (!modal) return;
  document.getElementById('modalCodeBadge').textContent = drop.code;
  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${drop.code}`;
  document.getElementById('modalShareUrl').value = shareUrl;

  modal.classList.remove('hidden');
  renderSimpleQR('modalQrCanvas', shareUrl);
}

function renderSimpleQR(containerId, text) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  try {
    if (typeof window.QRCode === 'function') {
      new window.QRCode(container, {
        text: text,
        width: 170,
        height: 170,
        colorDark: '#c0c1ff',
        colorLight: '#131315'
      });
    } else {
      console.warn('window.QRCode is not loaded yet');
    }
  } catch (err) {
    console.error('QR rendering error:', err);
  }
}

// Claim File Lookup & Metadata Sidebar Populator
async function lookupClaimCode(codeToSearch) {
  const code = (codeToSearch || document.getElementById('claimCodeInput').value).trim().toUpperCase();
  if (!code) {
    showToast('Please enter a 6-character code!', 'error');
    return;
  }

  const resultContainer = document.getElementById('claimResultContainer');
  const notFoundBox = document.getElementById('claimNotFound');
  notFoundBox.style.display = 'none';
  resultContainer.style.display = 'none';

  const drop = await getDrop(code);
  if (!drop || drop.expired) {
    notFoundBox.style.display = 'block';
    showToast('No active drop found for code: ' + code, 'error');
    return;
  }

  currentClaimDrop = drop;

  // Populate Sidebar Metadata
  document.getElementById('previewWindowFilename').textContent = drop.fileName;
  document.getElementById('sidebarFileName').textContent = drop.fileName;
  document.getElementById('sidebarFileIcon').textContent = getFileIcon(drop.fileType, drop.fileName);
  
  const dateStr = new Date(drop.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('sidebarDateAdded').textContent = `Added ${dateStr}`;
  
  document.getElementById('sidebarFileSize').textContent = formatBytes(drop.fileSize);
  document.getElementById('sidebarDownloads').textContent = drop.downloadsCount || 0;

  // Expiration Progress Bar
  const expiryBar = document.getElementById('sidebarExpiryBar');
  const expiryText = document.getElementById('sidebarExpiryText');
  if (drop.expiryType === '1time') {
    expiryText.textContent = '1-time download';
    expiryBar.style.width = '100%';
  } else if (drop.expiresAt) {
    const totalMs = drop.expiresAt - drop.createdAt;
    const remainingMs = drop.expiresAt - Date.now();
    const pct = Math.max(5, Math.min(100, Math.round((remainingMs / totalMs) * 100)));
    expiryBar.style.width = `${pct}%`;
    const mins = Math.floor(remainingMs / (1000 * 60));
    expiryText.textContent = mins < 60 ? `${mins} mins` : `${Math.floor(mins / 60)} hours`;
  } else {
    expiryText.textContent = 'No expiry';
    expiryBar.style.width = '100%';
  }

  // Encryption badge
  const encBadge = document.getElementById('sidebarEncryptedBadge');
  if (encBadge) {
    encBadge.style.display = drop.isEncrypted ? 'flex' : 'none';
  }

  if (drop.isEncrypted) {
    document.getElementById('passwordUnlockForm').style.display = 'block';
    currentDecryptedBlob = null;
  } else {
    document.getElementById('passwordUnlockForm').style.display = 'none';
    currentDecryptedBlob = drop.fileBlob;
    renderFilePreview('claimPreviewBox', drop.fileBlob, drop.fileName, drop.fileType);
  }

  resultContainer.style.display = 'flex';
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
    document.getElementById('dropPromptInfo').style.display = 'none';
    document.getElementById('fileSelectionInfo').style.display = 'block';
    document.getElementById('selectedFileName').textContent = file.name;
    document.getElementById('selectedMeta').textContent = `${formatBytes(file.size)} • ${file.type || 'Unknown type'}`;
    document.getElementById('optionsSection').style.display = 'block';
  }

  // Password Checkbox
  const passCheck = document.getElementById('enablePassCheck');
  if (passCheck) {
    passCheck.addEventListener('change', (e) => {
      document.getElementById('passInputGroup').style.display = e.target.checked ? 'block' : 'none';
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

  // Check URL query parameter `?code=DROP-XXXX`
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  if (codeParam) {
    document.getElementById('claimCodeInput').value = codeParam.toUpperCase();
    switchTab('claim');
    lookupClaimCode(codeParam);
  }

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

  updateActiveBadge();
});
