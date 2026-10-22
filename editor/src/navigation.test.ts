// Tests for leaving the course's Back and Next out of a slide, and what the editor says about it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.addSlide();
  m.selectSlide(m.slides[0]!.id);
  return m;
}

test("Back and Next can be left out of a slide, and put back, as one undo step each", () => {
  const m = fresh();
  const id = m.slides[0]!.id;
  assert.equal(m.slides[0]!.hideNavigation, undefined);
  assert.match(m.setHideNavigation(id, true)!, /Back and Next are left out of this slide\./);
  assert.equal(m.slides[0]!.hideNavigation, true);
  assert.equal(m.setHideNavigation(id, true), null, "no change");
  assert.match(m.setHideNavigation(id, false)!, /shown on this slide again/);
  assert.ok(!("hideNavigation" in m.slides[0]!), "no leftover setting");
  m.undo();
  assert.equal(m.slides[0]!.hideNavigation, true);
  m.undo();
  assert.equal(m.slides[0]!.hideNavigation, undefined);
  assert.equal(m.setHideNavigation("slide-999", true), null);
});

test("the editor warns, in the message, when nothing on the slide goes anywhere", () => {
  const m = fresh();
  const id = m.slides[0]!.id;
  assert.match(m.setHideNavigation(id, true)!, /Nothing on it goes to another slide yet, so a learner would be stuck/);
  m.setHideNavigation(id, false);
  m.addObject("button");
  const button = m.object!;
  m.addRule(button.id);
  assert.doesNotMatch(m.setHideNavigation(id, true)!, /stuck/, "a button that jumps to a slide is a way out");
});

test("a slide that moves on by itself has a way out", () => {
  const m = fresh();
  const id = m.slides[0]!.id;
  m.setSlideDuration(5000);
  assert.doesNotMatch(m.setHideNavigation(id, true)!, /stuck/);
});

test("the setting is saved in the slide's file and read back", () => {
  const m = fresh();
  const id = m.slides[0]!.id;
  m.setHideNavigation(id, true);
  const file = m.allFiles().find((f) => f.path === `slides/${id}.json`)!;
  assert.equal((JSON.parse(file.text) as { hideNavigation?: boolean }).hideNavigation, true);
  const other = m.allFiles().find((f) => f.path === `slides/${m.slides[1]!.id}.json`)!;
  assert.ok(!("hideNavigation" in JSON.parse(other.text)), "a slide that shows them has no setting");
});
