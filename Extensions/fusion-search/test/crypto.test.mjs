import assert from "node:assert/strict";
import test from "node:test";

import {
  aesEcbEncryptBase64,
  aesEcbDecrypt,
  aesCbcEncryptBase64,
  aesCbcDecryptBase64,
  jwtExpiry,
  b64decode,
} from "../src/auth/crypto.mjs";

const KEY16 = "0123456789abcdef";
const IV16 = "fedcba9876543210";
const KEY32 = "C661489473A6FBD1F427BF252ECB7344";

test("AES output matches the legacy PyCryptodome PKCS7 vectors", () => {
  assert.equal(
    aesEcbEncryptBase64("hello world", KEY16),
    "gWm+1O9JqIdFWcWyANqt5w==",
  );
  assert.equal(
    aesEcbEncryptBase64('{"x":120,"y":5}', KEY32),
    "nue2t4/xMUlBmL/h+A79Vg==",
  );
  assert.equal(
    aesCbcEncryptBase64("hello world", KEY16, IV16),
    "EjCqBOVHpEbXXDjOe20Q1g==",
  );
});

test("AES-128-ECB encrypts and decrypts with PKCS7 padding", () => {
  const encrypted = aesEcbEncryptBase64("hello world", KEY16);
  const plain = aesEcbDecrypt(b64decode(encrypted), KEY16);
  assert.equal(plain.toString("utf8"), "hello world");
});

test("AES-256-ECB accepts the 32-byte legacy device key", () => {
  const encrypted = aesEcbEncryptBase64('{"x":120,"y":5}', KEY32);
  const plain = aesEcbDecrypt(b64decode(encrypted), KEY32);
  assert.equal(plain.toString("utf8"), '{"x":120,"y":5}');
  assert.ok(b64decode(encrypted).length % 16 === 0);
});

test("AES-128-CBC round-trips", () => {
  const text = "username=MTg4NzIyODc1NjM&password=eGV4dA==";
  const encrypted = aesCbcEncryptBase64(text, KEY16, IV16);
  assert.equal(aesCbcDecryptBase64(encrypted, KEY16, IV16), text);
});

test("AES helpers reject invalid key sizes", () => {
  assert.throws(() => aesEcbEncryptBase64("x", "short"), /16, 24, or 32 bytes/);
  assert.throws(() => aesCbcEncryptBase64("x", KEY16, "short-iv"), /16 bytes/);
});

test("jwtExpiry reads exp without signature verification", () => {
  const payload = b64decode(
    Buffer.from(JSON.stringify({ exp: 2000000000, userId: "u1" })).toString("base64"),
  );
  const token = `header.${payload.toString("base64url")}.signature`;
  assert.equal(jwtExpiry(token), 2000000000);
  assert.equal(jwtExpiry("not-a-jwt"), null);
  assert.equal(jwtExpiry("a.b.c"), null);
});
