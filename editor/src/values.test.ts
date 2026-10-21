// Showing a value in a text: what the author can choose, putting a reference into words, renaming a variable that a text shows, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILT_IN_VALUES } from "../../player/src/valuetext.ts";
import type { Variable } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { canBeReferenced, insertReference, referenceFor, referencesVariable, renameReferences, valueChoices } from "./values.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("the author is offered the values the course works out first, then each variable of their own by name", () => {
  const variables: Variable[] = [{ id: "var-1", name: "Tries", type: "number", initial: 0 }, { id: "var-2", name: "Bad {name}", type: "number", initial: 0 }];
  const choices = valueChoices(variables);
  assert.deepEqual(choices.slice(0, BUILT_IN_VALUES.length).map((c) => c.value), BUILT_IN_VALUES.map((v) => v.name));
  assert.deepEqual(choices.slice(BUILT_IN_VALUES.length), [{ value: "Tries", label: "Tries (a variable)" }], "a name with a brace cannot be written in a reference, so it is not offered");
  assert.ok(choices.every((c) => c.label.length > 3));
});

test("a name can be written in a reference if it has no brace or line break and is not too long", () => {
  assert.deepEqual(["Tries", "Cats & dogs", "{x}", "a\nb", "", "x".repeat(81), "x".repeat(80)].map(canBeReferenced), [true, true, false, false, false, false, true]);
});

test("a reference goes in where the cursor is, or in place of what is chosen, or at the end", () => {
  assert.equal(referenceFor("Score"), "{{Score}}");
  assert.equal(insertReference("Score: ", "$score", 7), "Score: {{$score}}");
  assert.equal(insertReference("Score: ", "$score", 3), "Sco{{$score}}re: ");
  assert.equal(insertReference("Score: XX", "$score", 7, 9), "Score: {{$score}}");
  assert.equal(insertReference("Hi", "$score", 99), "Hi{{$score}}");
  assert.equal(insertReference("", "$score", 0), "{{$score}}");
});

test("a text is found to show a variable by its name, whatever the capitals, tags and entities round it", () => {
  assert.equal(referencesVariable("<p>Tries: {{tries}}</p>", "Tries"), true);
  assert.equal(referencesVariable("<p>{{ Cats &amp; dogs }}</p>", "Cats & dogs"), true);
  assert.equal(referencesVariable("<p><strong>{{Tries}}</strong></p>", "Tries"), true);
  assert.equal(referencesVariable("<p>{{Tr<b>ies</b>}}</p>", "Tries"), false, "a tag in the middle breaks it, as in the player");
  assert.equal(referencesVariable("<p>{{$score}}</p>", "Tries"), false);
  assert.equal(referencesVariable("<p>Tries</p>", "Tries"), false);
});

test("renaming a variable writes the new name in its references, and only in its references", () => {
  assert.equal(renameReferences("<p>{{Tries}} of {{Lives}} and {{tries}}</p>", "Tries", "Goes"), "<p>{{Goes}} of {{Lives}} and {{Goes}}</p>");
  assert.equal(renameReferences("<p>{{Tries}}</p>", "Tries", "Cats & <dogs>"), "<p>{{Cats &amp; &lt;dogs&gt;}}</p>");
  assert.equal(renameReferences('<a href="{{Tries}}">{{Tries}}</a>', "Tries", "Goes"), '<a href="{{Tries}}">{{Goes}}</a>', "a tag's own words are left alone");
  assert.equal(renameReferences("<p>Tries</p>", "Tries", "Goes"), "<p>Tries</p>");
});

function withShownVariable(): { m: Model; id: string; textId: string; otherSlideText: string } {
  const m = fresh();
  const v = m.addVariable("number", "Tries");
  const t = m.addObject("text")!;
  m.setText(t.id, { block: "p", text: "Tries so far: {{Tries}}" });
  m.addSlide("blank");
  const b = m.addObject("text", { bubble: "speech" })!;
  m.setText(b.id, { block: "p", text: "You have used {{tries}}." });
  return { m, id: v.id, textId: t.id, otherSlideText: b.id };
}

test("renaming a variable changes every text that shows it, on every slide, in the same undo step, and says how many", () => {
  const { m, id } = withShownVariable();
  const msg = m.renameVariable(id, "Goes")!;
  assert.match(msg, /2 texts that show it were changed to match/);
  const texts = m.slides.flatMap((s) => s.baseLayer.objects).filter((o) => o.type === "text" && String(o.content["html"]).includes("{{"));
  assert.deepEqual(texts.map((o) => o.content["html"]), ["<p>Tries so far: {{Goes}}</p>", "<p>You have used {{Goes}}.</p>"]);
  m.undo();
  const back = m.slides.flatMap((s) => s.baseLayer.objects).filter((o) => o.type === "text" && String(o.content["html"]).includes("{{"));
  assert.deepEqual(back.map((o) => o.content["html"]), ["<p>Tries so far: {{Tries}}</p>", "<p>You have used {{tries}}.</p>"]);
  assert.equal(m.variableName(id), "Tries", "the name is back too");
});

test("renaming a variable no text shows changes nothing else and says nothing about texts", () => {
  const m = fresh();
  const v = m.addVariable("number", "Lonely");
  assert.equal(m.renameVariable(v.id, "Alone"), "Variable renamed to Alone");
});

test("a variable that a text shows cannot be deleted, and the message names the text", () => {
  const { m, id } = withShownVariable();
  const msg = m.deleteVariable(id)!;
  assert.match(msg, /is used by .+ on .+, so it cannot be deleted/);
  assert.ok(m.variables.some((v) => v.id === id));
  assert.ok(m.variableUsage(id).length >= 2);
});

type Finding = { severity: string; rule: string; message: string; detail?: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-values-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts texts that show a variable or a built-in value, and names a reference to nothing", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m } = withShownVariable();
  const t = m.addObject("text")!;
  m.setText(t.id, { block: "p", text: "Score {{$score}} of {{$possible}} ({{$percent}} percent)" });
  assert.deepEqual(validate(m).filter((f) => f.severity === "error"), []);
  m.setText(t.id, { block: "p", text: "Lives {{Lives}}" });
  const hits = validate(m).filter((f) => f.rule === "value-text-unknown");
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.detail ?? "", /\{\{Lives\}\}/);
});
