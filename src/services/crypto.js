/**
 * Web Crypto API helper for AES-GCM file encryption and decryption
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const ITERATIONS = 100000;

/**
 * Derives a key from a password string and salt
 */
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

/**
 * Encrypts an ArrayBuffer/Blob using a user password
 */
export async function encryptFile(file, password) {
  if (!password) return file; // no encryption required

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const arrayBuffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    arrayBuffer
  );

  // Pack salt (16 bytes) + iv (12 bytes) + encrypted content
  const combined = new Uint8Array(salt.byteLength + iv.byteLength + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(encryptedBuffer), salt.byteLength + iv.byteLength);

  return new Blob([combined], { type: 'application/octet-stream' });
}

/**
 * Decrypts an encrypted Blob using password
 */
export async function decryptFile(encryptedBlob, password, mimeType) {
  try {
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
  } catch (err) {
    console.error('Decryption failed:', err);
    throw new Error('Incorrect password or corrupted file.');
  }
}
