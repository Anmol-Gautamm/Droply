/**
 * Droply Standalone Application Logic
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
  toast.className = 'toast-item';
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
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
    badge.style.display = drops.length > 0 ? 'inline-block' : 'none';
  }
}

// Render My Drops Table
async function renderMyDrops() {
  const container = document.getElementById('dropsTableContainer');
  if (!container) return;
  const drops = await getAllDrops();

  if (drops.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
        <p style="font-size: 1.1rem; font-weight: 600;">No Active Drops Found</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">Files you drop will appear here for easy management.</p>
      </div>
    `;
    return;
  }

  let html = `
    <table class="drops-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>File Name</th>
          <th>Size</th>
          <th>Expiration</th>
          <th>Downloads</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
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
      <tr>
        <td><span class="code-badge" style="font-size: 0.95rem; padding: 4px 10px;">${drop.code}</span></td>
        <td>
          <div style="font-weight: 600; color: var(--text-main);">${drop.fileName}</div>
          ${drop.isEncrypted ? '<span style="font-size:0.75rem; color:var(--color-secondary);">🔒 Encrypted</span>' : ''}
        </td>
        <td style="color: var(--text-muted);">${formatBytes(drop.fileSize)}</td>
        <td style="color: var(--color-warning);">${expiryStr}</td>
        <td><strong>${drop.downloadsCount || 0}</strong></td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button onclick="copyText('${drop.code}', 'Code')" class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;">📋 Code</button>
            <button onclick="copyText('${shareUrl}', 'Link')" class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;">🔗 Link</button>
            <button onclick="handleDeleteDrop('${drop.code}')" class="btn-danger" style="padding: 6px 10px; font-size: 0.8rem;">🗑️ Delete</button>
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

  // Show modal first so layout dimensions are active
  modal.classList.remove('hidden');

  // Render QR Code immediately
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
        colorDark: '#06b6d4',
        colorLight: '#070a12',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  } catch (err) {
    console.error('QR rendering error:', err);
  }
}

// Claim File Lookup
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
  document.getElementById('claimDisplayCode').textContent = drop.code;
  document.getElementById('claimFileName').textContent = drop.fileName;
  document.getElementById('claimFileInfo').textContent = `Size: ${formatBytes(drop.fileSize)} • Downloads: ${drop.downloadsCount || 0}`;

  if (drop.isEncrypted) {
    document.getElementById('passwordUnlockForm').style.display = 'block';
    document.getElementById('claimPreviewSection').style.display = 'none';
    currentDecryptedBlob = null;
  } else {
    document.getElementById('passwordUnlockForm').style.display = 'none';
    document.getElementById('claimPreviewSection').style.display = 'block';
    currentDecryptedBlob = drop.fileBlob;
    renderFilePreview('claimPreviewBox', drop.fileBlob, drop.fileName, drop.fileType);
  }

  resultContainer.style.display = 'block';
}

function renderFilePreview(containerId, blob, fileName, fileType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const url = URL.createObjectURL(blob);

  if (fileType && fileType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'preview-image';
    container.appendChild(img);
  } else if (fileType && fileType.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.className = 'preview-video';
    container.appendChild(video);
  } else if (fileType && fileType.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = url;
    audio.controls = true;
    audio.className = 'preview-audio';
    container.appendChild(audio);
  } else if (fileType && fileType.startsWith('text/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.textContent = e.target.result;
      container.appendChild(pre);
    };
    reader.readAsText(blob.slice(0, 3000));
  } else {
    container.innerHTML = `<p style="color:var(--text-muted); font-size:0.9rem;">Preview not available for this format. Click download below!</p>`;
  }
}

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
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
        document.getElementById('claimPreviewSection').style.display = 'block';
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
      updateActiveBadge();
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
