import assert from "node:assert/strict";
import { test } from "node:test";
import { SAVED_KEY_PREFIX, isSavedKey } from "./savedkeys.ts";

test("a saved key's stand-in is told from a typed key", () => {
  assert.equal(SAVED_KEY_PREFIX, "OPENSTAGE-SAVED-KEY-", "the same as MARK_PREFIX in secrets.rs");
  assert.equal(isSavedKey("OPENSTAGE-SAVED-KEY-PIXABAY"), true);
  assert.equal(isSavedKey(" OPENSTAGE-SAVED-KEY-OPENAI "), true);
  assert.equal(isSavedKey("12345-abcdef"), false);
  assert.equal(isSavedKey(""), false);
});
