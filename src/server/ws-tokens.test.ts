import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeToken, createToken } from "./ws-tokens.js";

test("createToken / consumeToken round-trip once", () => {
  const token = createToken("76561198011775992");
  assert.equal(typeof token, "string");
  assert.equal(token.length > 20, true);
  assert.equal(consumeToken(token), "76561198011775992");
  assert.equal(consumeToken(token), null);
});

test("consumeToken rejects unknown", () => {
  assert.equal(consumeToken("nope"), null);
});
