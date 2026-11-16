// Tests for choosing which accessibility rules stop a publish: the list the author chooses from, the setting in the model (one undo step, kept in the
// project file), and that the real checker then raises an error for exactly the rules chosen and a warning, with its WCAG criterion, for the rest.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockerRules, blockersSaid, ruleLabel } from "./a11yblockers.ts";
import type { Finding } from "./backend.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-11-16" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.selectSlide(m.slides[0]!.id);
  return m;
}

test("the list the author chooses from is the checker's own, in the order of WCAG, each with its criterion", () => {
  const rules = blockerRules();
  assert.ok(rules.length >= 25);
  const source = readFileSync(path.join(repo, "tools", "validate.py"), "utf-8");
  for (const r of rules) {
    assert.ok(source.includes(`"${r.id}"`), `${r.id} is raised by the checker`);
    assert.ok(r.wcag.length > 0 && r.title !== "");
  }
  const firsts = rules.map((r) => r.wcag[0]!.split(".").map(Number));
  for (let i = 1; i < firsts.length; i++) {
    const [a, b] = [firsts[i - 1]!, firsts[i]!];
    assert.ok(a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! <= b[2]!))), `${rules[i - 1]!.id} comes before ${rules[i]!.id}`);
  }
  const alt = rules.find((r) => r.id === "alt-text-missing")!;
  assert.match(ruleLabel(alt), /^Pictures and shapes with no description \(WCAG 1\.1\.1, level A\)$/);
  assert.match(ruleLabel(rules.find((r) => r.id === "hotspot-too-small")!), /new in 2\.2/, "a criterion from 2.2 says so");
  assert.match(ruleLabel(rules.find((r) => r.id === "media-needs-captions")!), /WCAG 1\.2\.1 and 1\.2\.2/);
});

test("no rule stops a publish until the author chooses one; choosing is one undo step and a repeat or a bad name is dropped", () => {
  const m = fresh();
  assert.deepEqual(m.accessibilityBlockers, []);
  assert.equal(m.project.accessibilityBlockers, undefined, "nothing is written into a project that has not chosen");
  assert.equal(m.setAccessibilityBlockers([]), null, "choosing none when none was chosen changes nothing");
  assert.match(m.setAccessibilityBlockers(["contrast", "alt-text-missing", "contrast", "Not A Rule", ""])!, /2 accessibility rules will stop a publish/);
  assert.deepEqual(m.accessibilityBlockers, ["contrast", "alt-text-missing"]);
  assert.equal(m.setAccessibilityBlockers(["contrast", "alt-text-missing"]), null, "the same choice again changes nothing");
  assert.match(m.setAccessibilityBlockers(["contrast"])!, /One accessibility rule will stop a publish/);
  m.undo();
  assert.deepEqual(m.accessibilityBlockers, ["contrast", "alt-text-missing"]);
  m.undo();
  assert.deepEqual(m.accessibilityBlockers, []);
  assert.equal(m.project.accessibilityBlockers, undefined, "undo takes the setting away entirely");
  m.redo();
  assert.deepEqual(m.accessibilityBlockers, ["contrast", "alt-text-missing"]);
  assert.match(m.setAccessibilityBlockers([])!, /No accessibility rule stops a publish now/);
  assert.equal(m.project.accessibilityBlockers, undefined);
  assert.equal(blockersSaid([]), "No accessibility rule stops a publish now. Accessibility problems are warnings.");
});

interface Result { findings: Finding[]; status: number | null }

function check(m: Model): Result {
  const dir = mkdtempSync(path.join(os.tmpdir(), "osa11y-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"] ?? "python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return { findings: JSON.parse(r.stdout) as Finding[], status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real checker warns by default, with the criterion, and errors only for the rules chosen", () => {
  const m = fresh();
  // An object with no description, and not marked as decorative, is an accessibility finding.
  const pic = m.addObject("text");
  assert.ok(pic);
  pic!.accessibility.altText = "";
  pic!.accessibility.decorative = false;
  const before = check(m);
  const alt = before.findings.find((f) => f.rule === "alt-text-missing");
  assert.ok(alt, JSON.stringify(before.findings));
  assert.equal(alt!.severity, "warning");
  assert.deepEqual(alt!.wcag, ["1.1.1"]);
  assert.equal(before.findings.filter((f) => f.severity === "error").length, 0);
  assert.equal(before.status, 0, "nothing stops a publish");

  m.setAccessibilityBlockers(["alt-text-missing"]);
  const after = check(m);
  assert.equal(after.findings.find((f) => f.rule === "alt-text-missing")!.severity, "error");
  assert.equal(after.status, 1, "the chosen rule stops it");
  assert.deepEqual(after.findings.find((f) => f.rule === "alt-text-missing")!.wcag, ["1.1.1"], "the criterion is still there");

  m.setAccessibilityBlockers(["alt-text-missing", "no-such-rule"]);
  // A name the checker does not know is a warning of its own and stops nothing more.
  assert.equal(m.accessibilityBlockers.length, 2);
  assert.ok(check(m).findings.some((f) => f.rule === "blocker-unknown" && f.severity === "warning"));
});
