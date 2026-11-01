// The keyboard shortcut question: the learner types a shortcut, or presses the keys, and it is right if it is one of the shortcuts the author accepts,
// however it was written. Capturing the keys can never trap anyone: any one key ends it, Escape alone stops it, and leaving the button stops it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyMessage, grade, isAnswered } from "./grading.ts";
import { formatGraded } from "./interaction-format.ts";
import { built, courseWith, told12, told2004, type Body } from "./question-helpers.ts";
import type { QuizContent, ShortcutQuiz } from "./types.ts";

const keys = (...k: string[]): Body<ShortcutQuiz> => ({ questionType: "shortcut", keys: k });
const full = (...k: string[]): QuizContent => ({ ...keys(...k), scoring: { points: 12, attemptsAllowed: 2 }, feedback: { correct: "a", incorrect: "b" } });

test("a shortcut is right however it was typed, in any order, with any name for a key", () => {
  const q = full("Ctrl+Shift+S");
  for (const typed of ["Ctrl+Shift+S", "ctrl+shift+s", "Shift + Control + S", "control shift s", "  CTRL+SHIFT+S "]) assert.equal(grade(q, typed).correct, true, typed);
  for (const typed of ["Ctrl+S", "Ctrl+Shift+D", "Alt+Shift+S", "Ctrl+Shift", "banana", "", "Ctrl+Shift+S+D"]) assert.equal(grade(q, typed).correct, false, typed);
});

test("any one of several accepted shortcuts is right, and the author may write them as they like", () => {
  const q = full("Ctrl+S", "Command+S");
  assert.equal(grade(q, "Meta+S").correct, true);
  assert.equal(grade(q, "cmd+s").correct, true);
  assert.equal(grade(q, "Ctrl+D").correct, false);
  assert.deepEqual(grade(q, "Ctrl+D").patterns, ["Ctrl+S", "Meta+S"], "the LMS is told them in the one way");
});

test("the LMS is told the shortcut in the one way, or what was typed if it was no shortcut", () => {
  const q = full("Ctrl+Shift+S");
  assert.deepEqual([grade(q, "shift+ctrl+s").response, grade(q, "  banana  ").response], ["Ctrl+Shift+S", "banana"]);
  assert.deepEqual(formatGraded(q, grade(q, "ctrl+shift+s")), { kind: "fill-in", response: "Ctrl+Shift+S", patterns: ["Ctrl+Shift+S"] });
});

test("something typed is an answer to check; nothing is not, and the learner is told", () => {
  assert.deepEqual([isAnswered(full("F5"), null), isAnswered(full("F5"), "  "), isAnswered(full("F5"), "F4")], [false, false, true]);
  assert.equal(emptyMessage(full("F5")), "Type or capture a keyboard shortcut first.");
});

test("in the course, a wrong shortcut uses a try and a right one is full marks", () => {
  const { rt } = courseWith(keys("Alt+F4"));
  assert.equal(rt.submitQuiz("obj-0011", "", "click"), null);
  assert.equal(rt.submitQuiz("obj-0011", "Alt+F5", "click")!.locked, false);
  const right = rt.submitQuiz("obj-0011", "alt + f4", "click")!;
  assert.deepEqual([right.correct, right.score, right.locked], [true, 12, true]);
});

test("SCORM 1.2 and strict SCORM 2004 are told a fill-in", async () => {
  const a = await told12(keys("Ctrl+Shift+S"), "ctrl+shift+s");
  assert.deepEqual([a("type"), a("student_response"), a("correct_responses.0.pattern"), a("result")], ["fill-in", "Ctrl+Shift+S", "Ctrl+Shift+S", "correct"]);
  const b = await told2004(keys("Ctrl+Shift+S", "Cmd+Shift+S"), "Ctrl+D");
  assert.deepEqual([b.get("type"), b.get("learner_response"), b.get("correct_responses.0.pattern"), b.get("correct_responses.1.pattern"), b.get("result")], ["fill_in", "Ctrl+D", "Ctrl+Shift+S", "Shift+Meta+S", "incorrect"]);
  assert.deepEqual(b.warnings, []);
});

// ---- the page

function shortcut(ctx = {}) {
  const b = built(keys("Ctrl+Shift+S"), ctx);
  const box = b.root.byTag("input")[0]!;
  const button = b.root.byTag("button")[0]!;
  return { ...b, box, button };
}
const press = (el: ReturnType<typeof shortcut>["button"], key: string, code: string, mods: Record<string, boolean> = {}) => el.fire("keydown", { key, code, ...mods });

test("the box has its label and its hint, and the button says what it does", () => {
  const { root, box, button } = shortcut();
  assert.equal(root.byTag("label")[0]!.getAttribute("for"), box.id);
  const hint = root.all((e) => e.id === box.getAttribute("aria-describedby"))[0]!;
  assert.match(hint.textContent, /To answer Escape, type it/);
  assert.equal(button.textContent, "Capture the keys");
  assert.equal(button.getAttribute("type"), "button");
});

test("capturing: modifiers alone wait, the first other key is the answer, and the button goes back to being a button", () => {
  const { box, button, said } = shortcut();
  button.fire("click");
  assert.deepEqual([button.textContent, button.getAttribute("aria-pressed")], ["Press the keys now. Escape stops.", "true"]);
  assert.deepEqual(said, ["Press the keys now. Escape stops."]);
  const ctrl = press(button, "Control", "ControlLeft", { ctrlKey: true });
  assert.equal(ctrl.defaultPrevented, false, "a modifier on its own does nothing");
  assert.equal(button.textContent, "Press the keys now. Escape stops.");
  const s = press(button, "S", "KeyS", { ctrlKey: true, shiftKey: true });
  assert.deepEqual([s.defaultPrevented, s.propagationStopped], [true, true], "the browser does not also act on it");
  assert.equal(box.value, "Ctrl+Shift+S");
  assert.deepEqual([button.textContent, button.hasAttribute("aria-pressed")], ["Capture the keys", false]);
  assert.equal(said.at(-1), "Captured Ctrl+Shift+S.");
});

test("when the keys are not capturing, they are just keys", () => {
  const { button, box } = shortcut();
  const e = press(button, "Enter", "Enter");
  assert.deepEqual([e.defaultPrevented, box.value], [false, ""]);
});

test("it records the key under the finger, not what a keyboard layout writes on it", () => {
  const { button, box } = shortcut();
  button.fire("click");
  press(button, "!", "Digit1", { shiftKey: true });
  assert.equal(box.value, "Shift+1");
});

test("it cannot trap: Escape alone stops, Tab is an answer and then Tab moves on, leaving stops, and pressing again stops", () => {
  const { button, box, said } = shortcut();
  button.fire("click");
  const esc = press(button, "Escape", "Escape");
  assert.deepEqual([box.value, button.textContent, said.at(-1)], ["", "Capture the keys", "Capture stopped. Nothing was captured."]);
  assert.equal(esc.defaultPrevented, true);

  button.fire("click");
  press(button, "Tab", "Tab");
  assert.deepEqual([box.value, button.textContent], ["Tab", "Capture the keys"]);
  assert.equal(press(button, "Tab", "Tab").defaultPrevented, false, "the next Tab leaves the button as it always does");

  button.fire("click");
  const before = said.length;
  button.fire("blur");
  assert.deepEqual([button.textContent, said.length], ["Capture the keys", before], "leaving stops it quietly");
  assert.equal(press(button, "Q", "KeyQ").defaultPrevented, false);

  button.fire("click");
  button.fire("click");
  assert.deepEqual([button.textContent, said.at(-1)], ["Capture the keys", "Capture stopped. Nothing was captured."]);
});

test("Escape with another key held is a shortcut like any other", () => {
  const { button, box } = shortcut();
  button.fire("click");
  press(button, "Escape", "Escape", { shiftKey: true });
  assert.equal(box.value, "Shift+Escape");
});

test("a key it does not know ends the capture and says to type instead", () => {
  const { button, box, said } = shortcut();
  button.fire("click");
  press(button, "Unidentified", "IntlRo");
  assert.deepEqual([box.value, button.textContent, said.at(-1)], ["", "Capture the keys", "That key could not be read. Type the shortcut instead."]);
});

test("typing and capturing give one answer, and an earlier one comes back", () => {
  const { box, view, button } = shortcut();
  assert.equal(view.answer(), null);
  box.value = "ctrl+shift+s";
  assert.equal(view.answer(), "ctrl+shift+s");
  button.fire("click");
  press(button, "F5", "F5");
  assert.equal(view.answer(), "F5");
  view.setAnswer("Alt+F4");
  assert.equal(box.value, "Alt+F4");
  box.value = "  ";
  assert.equal(view.answer(), null);
});

test("a finished question takes no more, and the author's canvas does nothing", () => {
  const done = shortcut();
  done.view.lock();
  assert.deepEqual([done.box.disabled, done.button.disabled], [true, true]);
  const canvas = shortcut({ editing: true });
  canvas.button.fire("click");
  assert.equal(canvas.button.textContent, "Capture the keys");
});
