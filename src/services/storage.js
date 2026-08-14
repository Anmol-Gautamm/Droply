/**
 * IndexedDB & Cross-tab broadcast service for Droply
 */

const DB_NAME = 'DroplyDB';
const DB_VERSION = 1;
const STORE_NAME = 'drops';

const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('droply_channel') 
  : null;

/**
 * Open IndexedDB database
 */
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

/**
 * Generate a random 6-character short code like DROP-8492 or 739281
 */
export function generateShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let numPart = '';
  for (let i = 0; i < 4; i++) {
    numPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `DROP-${numPart}`;
}

/**
 * Save a new file drop into IndexedDB
 */
export async function saveDrop({ fileBlob, fileName, fileSize, fileType, expiryType, isEncrypted, password }) {
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
  // expiryType === '1time' -> expiresAt remains null, but deleted after 1 download

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
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'DROP_CREATED', code });
      }
      resolve(dropRecord);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Fetch a file drop by code
 */
export async function getDrop(code) {
  if (!code) return null;
  const db = await openDB();
  const formattedCode = code.toUpperCase().trim();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(formattedCode);

    request.onsuccess = () => {
      const drop = request.result;
      if (!drop) {
        resolve(null);
        return;
      }

      // Check time-based expiration
      if (drop.expiresAt && Date.now() > drop.expiresAt) {
        deleteDrop(formattedCode);
        resolve({ expired: true });
        return;
      }

      resolve(drop);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Increment download count and handle 1-time download deletion
 */
export async function incrementDownload(code) {
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
        // Delete after 1 download
        store.delete(formattedCode);
        if (broadcastChannel) {
          broadcastChannel.postMessage({ type: 'DROP_DELETED', code: formattedCode });
        }
        resolve({ ...drop, deletedAfterDownload: true });
      } else {
        store.put(drop);
        if (broadcastChannel) {
          broadcastChannel.postMessage({ type: 'DROP_UPDATED', code: formattedCode });
        }
        resolve(drop);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all active drops for the user's dashboard
 */
export async function getAllDrops() {
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

      // Sort newest first
      activeDrops.sort((a, b) => b.createdAt - a.createdAt);
      resolve(activeDrops);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Manually delete a drop
 */
export async function deleteDrop(code) {
  const db = await openDB();
  const formattedCode = code.toUpperCase().trim();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(formattedCode);

    request.onsuccess = () => {
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'DROP_DELETED', code: formattedCode });
      }
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Subscribe to cross-tab updates
 */
export function subscribeToBroadcast(callback) {
  if (!broadcastChannel) return () => {};

  const listener = (event) => callback(event.data);
  broadcastChannel.addEventListener('message', listener);

  return () => {
    broadcastChannel.removeEventListener('message', listener);
  };
}

/**
 * Helper to encode small files directly into standalone URLs for cross-device links
 */
export async function encodeFileToUrlHash(file) {
  if (file.size > 800 * 1024) return null; // Max 800KB for direct URL payload
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64;
}

/**
 * Decode base64 payload from URL hash back to Blob
 */
export function decodeUrlHashToFile(base64, fileType) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: fileType || 'application/octet-stream' });
  } catch (err) {
    console.error('Failed to decode URL hash payload:', err);
    return null;
  }
}
