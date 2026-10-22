// Tests for the short description every dialog gets, so a screen reader says what it is for and not every word in it (found in the NVDA pass of 2026-10-21).
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBriefly } from "./dialogdesc.ts";

interface P { textContent: string; id: string; role?: string; className?: string; matches(sel: string): boolean }
const para = (text: string, over: Partial<P> = {}): P => ({
  textContent: text, id: "", ...over,
  matches(sel: string) { return sel.split(",").map((s) => s.trim()).some((s) => (s === '[role="status"]' && this.role === "status") || (s === '[role="alert"]' && this.role === "alert") || (s === ".dialog-error" && this.className === "dialog-error")); },
});
const dialog = (paragraphs: P[], attrs: Record<string, string> = {}) => {
  const set = new Map(Object.entries(attrs));
  return {
    querySelectorAll: () => paragraphs,
    hasAttribute: (k: string) => set.has(k),
    getAttribute: (k: string) => set.get(k) ?? null,
    setAttribute: (k: string, v: string) => { set.set(k, v); },
    attrs: set,
  };
};
const run = (d: ReturnType<typeof dialog>) => describeBriefly(d as unknown as HTMLDialogElement);

test("a dialog is described by its first paragraph, which is given an id if it has none", () => {
  const intro = para("What this is for.");
  const d = dialog([intro, para("Some help for a field.")], { "aria-labelledby": "vr-title" });
  run(d);
  assert.equal(intro.id, "vr-title-intro");
  assert.equal(d.attrs.get("aria-describedby"), "vr-title-intro");
});

test("a paragraph that already has an id keeps it", () => {
  const intro = para("What this is for.", { id: "mine" });
  const d = dialog([intro]);
  run(d);
  assert.equal(intro.id, "mine");
  assert.equal(d.attrs.get("aria-describedby"), "mine");
});

test("empty paragraphs, status lines and error lines are not the description", () => {
  const intro = para("The real words.");
  const d = dialog([para("   "), para("Saved.", { role: "status" }), para("Not allowed.", { role: "alert" }), para("Oops", { className: "dialog-error" }), intro], { "aria-labelledby": "t" });
  run(d);
  assert.equal(d.attrs.get("aria-describedby"), "t-intro");
  assert.equal(intro.id, "t-intro");
});

test("a dialog that already says what describes it is left alone, and one with no paragraph is too", () => {
  const given = dialog([para("Words.")], { "aria-describedby": "elsewhere" });
  run(given);
  assert.equal(given.attrs.get("aria-describedby"), "elsewhere");
  const bare = dialog([]);
  run(bare);
  assert.equal(bare.attrs.has("aria-describedby"), false);
});
