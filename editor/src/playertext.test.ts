// A course's own words for the player (`playerText`, added in 0.46.0) are the translation tool's to write and the player's to read. The editor
// only has to carry them: opening a course and saving it must not lose them, and a new course starts with none.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const WORDS = { "nav.next": "Suivant", "nav.slideOf": "Diapositive {n} sur {total}" };

function open(extra: object): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "fr-FR", today: "2026-10-31" });
  const project = { ...(JSON.parse(files[0]!.text) as object), ...extra };
  return new Model({ dir: "D:/x", project: JSON.stringify(project), theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const saved = (m: Model): { playerText?: Record<string, string>; schemaVersion: string } => JSON.parse(m.dirtyFiles().find((f) => f.path === "project.json")!.text);

test("a new course has no words of its own for the player, and says which format it is", () => {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-31" });
  const project = JSON.parse(files[0]!.text) as { playerText?: unknown; schemaVersion: string };
  assert.equal(project.playerText, undefined);
  assert.equal(project.schemaVersion, "0.46.0");
});

test("a course's own words for the player survive opening, a change and saving", () => {
  const m = open({ playerText: WORDS });
  m.excludeFromPackage("captures"); // a change that has the project file written
  assert.deepEqual(saved(m).playerText, WORDS);
});
