import { createCipheriv, createDecipheriv } from "node:crypto";

/**
 * AES helpers for the legacy Fusion Search auth chain. The chain uses two key
 * shapes: the fixed 32-byte device key (AES-256-ECB) and the server-provided
 * 16-byte captcha secret / login cookies (AES-128). Key length picks the
 * variant instead of a separate entry point per size.
 */

export function b64encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}

export function b64decode(text) {
  return Buffer.from(String(text), "base64");
}

function pkcs7Pad(buffer) {
  const padLength = 16 - (buffer.length % 16);
  return Buffer.concat([buffer, Buffer.alloc(padLength, padLength)]);
}

function pkcs7Unpad(buffer) {
  if (buffer.length === 0 || buffer.length % 16 !== 0) {
    throw new Error("invalid PKCS7 block length");
  }
  const padLength = buffer[buffer.length - 1];
  if (padLength < 1 || padLength > 16 || padLength > buffer.length) {
    throw new Error("invalid PKCS7 padding");
  }
  for (let offset = buffer.length - padLength; offset < buffer.length; offset += 1) {
    if (buffer[offset] !== padLength) throw new Error("invalid PKCS7 padding");
  }
  return buffer.subarray(0, buffer.length - padLength);
}

function keyBits(key) {
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, "utf8");
  const bits = keyBuffer.length * 8;
  if (![128, 192, 256].includes(bits)) {
    throw new Error(`AES key must be 16, 24, or 32 bytes (got ${keyBuffer.length})`);
  }
  return { keyBuffer, bits };
}

export function aesEcbEncryptBase64(plainText, key) {
  const { keyBuffer, bits } = keyBits(key);
  const cipher = createCipheriv(`aes-${bits}-ecb`, keyBuffer, null);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plainText, "utf8"));
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function aesEcbDecrypt(encrypted, key) {
  const { keyBuffer, bits } = keyBits(key);
  const decipher = createDecipheriv(`aes-${bits}-ecb`, keyBuffer, null);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted)), decipher.final()]);
  return pkcs7Unpad(plain);
}

export function aesCbcEncryptBase64(plainText, key, iv) {
  const { keyBuffer, bits } = keyBits(key);
  const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, "utf8");
  if (ivBuffer.length !== 16) {
    throw new Error("AES-CBC iv must be exactly 16 bytes");
  }
  const cipher = createCipheriv(`aes-${bits}-cbc`, keyBuffer, ivBuffer);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plainText, "utf8"));
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function aesCbcDecryptBase64(encryptedBase64, key, iv) {
  const { keyBuffer, bits } = keyBits(key);
  const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, "utf8");
  if (ivBuffer.length !== 16) {
    throw new Error("AES-CBC iv must be exactly 16 bytes");
  }
  const decipher = createDecipheriv(`aes-${bits}-cbc`, keyBuffer, ivBuffer);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return pkcs7Unpad(plain).toString("utf8");
}

/** Seconds until the JWT expires, without signature verification. */
export function jwtExpiry(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  // The payload segment is base64url and may arrive without padding.
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    return exp;
  } catch {
    return null;
  }
}
