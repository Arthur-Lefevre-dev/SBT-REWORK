/**
 * Encrypt/decrypt sensitive settings (e.g. steam_api_key) at rest in DB.
 * Uses AES-256-GCM. Key derived from ENCRYPTION_KEY or SESSION_SECRET.
 */

import crypto from 'node:crypto';

const PREFIX = 'enc.v1.';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'steam-ban-tracker-default-change-me';
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypt a plaintext string for storage. Returns PREFIX + base64(iv || tag || ciphertext).
 * @param {string} plaintext
 * @returns {string}
 */
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + combined.toString('base64');
}

/**
 * Decrypt a value stored by encryptSecret. Returns plaintext or null if invalid/not encrypted.
 * @param {string} stored
 * @returns {string|null}
 */
export function decryptSecret(stored) {
  if (stored == null || typeof stored !== 'string' || !stored.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const key = getEncryptionKey();
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch (_) {
    return null;
  }
}

/** Key used for settings that must be encrypted at rest. */
export const SECRET_SETTING_KEYS = new Set(['steam_api_key']);
