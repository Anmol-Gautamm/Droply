/**
 * Web Crypto API helper for AES-GCM file encryption and decryption
 * Implements PBKDF2 key derivation (100k SHA-256 iterations) with AES-256-GCM authenticated cipher.
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;
const HEADER_BYTE_LENGTH = SALT_BYTE_LENGTH + IV_BYTE_LENGTH; // 28 bytes

/**
 * Derives a 256-bit AES symmetric key from a password string and salt using PBKDF2.
 * @param {string} password - User provided encryption password
 * @param {Uint8Array} salt - Cryptographically random 16-byte salt
 * @returns {Promise<CryptoKey>} Derived AES-GCM CryptoKey
 */
async function deriveKey(password, salt) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }

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
 * Encrypts a File or Blob payload with AES-GCM-256 using the provided password.
 * Packs [16-byte Salt] + [12-byte IV] + [Ciphertext] into an encrypted Blob.
 * @param {Blob|File} file - Source file or blob to encrypt
 * @param {string} password - Encryption passphrase
 * @returns {Promise<Blob>} Encrypted binary Blob
 */
export async function encryptFile(file, password) {
  if (!password) return file; // Return original if no password provided

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const key = await deriveKey(password, salt);

  const arrayBuffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    arrayBuffer
  );

  // Pack header: salt (16B) + IV (12B) + ciphertext
  const combined = new Uint8Array(HEADER_BYTE_LENGTH + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_BYTE_LENGTH);
  combined.set(new Uint8Array(encryptedBuffer), HEADER_BYTE_LENGTH);

  return new Blob([combined], { type: 'application/octet-stream' });
}

/**
 * Decrypts an encrypted binary Blob using the password and restores the original MIME type.
 * @param {Blob} encryptedBlob - Packed encrypted blob with 28-byte header
 * @param {string} password - Decryption passphrase
 * @param {string} [mimeType] - Target MIME type to restore
 * @returns {Promise<Blob>} Decrypted file Blob
 */
export async function decryptFile(encryptedBlob, password, mimeType) {
  try {
    if (!encryptedBlob) {
      throw new Error('Encrypted payload is missing.');
    }

    const arrayBuffer = await encryptedBlob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    if (data.byteLength < HEADER_BYTE_LENGTH) {
      throw new Error('Invalid encrypted file format or truncated payload.');
    }

    const salt = data.slice(0, SALT_BYTE_LENGTH);
    const iv = data.slice(SALT_BYTE_LENGTH, HEADER_BYTE_LENGTH);
    const encryptedData = data.slice(HEADER_BYTE_LENGTH);

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
