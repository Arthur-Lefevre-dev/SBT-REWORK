import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret } from "./secrets.js";

test("encryptSecret / decryptSecret round-trip", () => {
  const cipher = encryptSecret("steam-api-key-xyz");
  assert.ok(cipher.startsWith("enc.v1."));
  assert.equal(decryptSecret(cipher), "steam-api-key-xyz");
});

test("decryptSecret rejects plaintext and garbage", () => {
  assert.equal(decryptSecret("plain"), null);
  assert.equal(decryptSecret("enc.v1.%%%"), null);
});
