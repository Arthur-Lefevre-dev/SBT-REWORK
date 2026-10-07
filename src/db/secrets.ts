import crypto from "node:crypto";
import { env, requireSessionSecret } from "../env.js";

const PREFIX = "enc.v1.";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const secret = env.ENCRYPTION_KEY || requireSessionSecret();
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(stored: string): string | null {
  if (!stored?.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const key = getKey();
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv, {
      authTagLength: TAG_LEN,
    });
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    return null;
  }
}

export const SECRET_KEYS = new Set(["steam_api_key"]);
