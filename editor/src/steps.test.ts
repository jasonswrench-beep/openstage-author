// Tests for steps: reading the interaction log, proposing steps from it, what the author does with the list, and saving it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addManual, altFor, charOf, clampBox, clickWords, deleteStep, editStep, emptyList, keepRangesOf, keyWords, knowPicture, listFrom, MAX_STEPS, mergeWithNext, MIN_BOX, moveStep, nudgeBox, parseLog, parseSteps,
  programName, proposeFromLog, serializeSteps, splitStep, startBox, stepProblems, unreviewedCount, type LogEvent, type StepList,
} from "./steps.ts";
import { createModel, type Clip, type Model as EditModel, type Track } from "../../capture-edit/src/model.ts";

const log = (...lines: string[]): LogEvent[] => parseLog(lines.join("\n")).events;
const steps = (events: LogEvent[], extra: Parameters<typeof proposeFromLog>[1] = { take: 1 }) => proposeFromLog(events, extra);
const listOf = (events: LogEvent[]): StepList => listFrom([steps(events)]).list;

test("the log is read line by line, and a line that cannot be read is counted, not guessed at", () => {
  const r = parseLog([
    '{"t":0,"type":"window","title":"Notepad","process":"notepad.exe","bounds":{"x":1,"y":2,"width":300,"height":200}}',
    '{"t":40,"type":"cursorMove","x":640,"y":470}',
    '{"t":1200,"type":"click","x":640,"y":480,"button":"left"}',
    '{"t":1200,"type":"element","name":"Save","role":"button"}',
    '{"t":2100,"type":"key","key":"s","modifiers":["ctrl"]}',
    '{"t":3400,"type":"marker","label":"look here"}',
    '{"t":3500,"type":"somethingNew","x":1}',
    '{"t":3600,"type":"click","x":"no"}',
    '{"t":-5,"type":"marker","label":"early"}',
    "not json",
    '{"t":3700,"type":"click","x":1,"y":2',
    "[1,2]",
    "",
  ].join("\r\n"));
  assert.deepEqual(r.events.map((e) => e.type), ["window", "cursorMove", "click", "element", "key", "marker"]);
  assert.equal(r.skipped, 6);
  const w = r.events[0]!;
  assert.equal(w.type === "window" && w.bounds?.width, 300);
});

test("a key press types the character a US keyboard gives, and shortcuts type nothing", () => {
  assert.equal(charOf("a", []), "a");
  assert.equal(charOf("a", ["shift"]), "A");
  assert.equal(charOf("1", ["shift"]), "!");
  assert.equal(charOf("space", []), " ");
  assert.equal(charOf("comma", []), ",");
  assert.equal(charOf("semicolon", ["shift"]), ":");
  assert.equal(charOf("numpad-5", []), "5");
  assert.equal(charOf("s", ["ctrl"]), null);
  assert.equal(charOf("enter", []), null);
  assert.equal(charOf("left", []), null);
});

test("keys that are not typing are told as a press, and the arrows and Backspace are left out", () => {
  assert.equal(keyWords("enter", []), "Press Enter.");
  assert.equal(keyWords("s", ["ctrl"]), "Press Ctrl+S.");
  assert.equal(keyWords("tab", ["shift"]), "Press Shift+Tab.");
  assert.equal(keyWords("f5", []), "Press F5.");
  assert.equal(keyWords("escape", []), "Press Esc.");
  assert.equal(keyWords("z", ["ctrl", "shift"]), "Press Ctrl+Shift+Z.");
  assert.equal(keyWords("left", []), null);
  assert.equal(keyWords("backspace", []), null);
  assert.equal(keyWords("a", []), null);
});

test("a click is told in the words that fit what was clicked, and without a name it points at the spot", () => {
  assert.equal(clickWords({ name: "Save", role: "button" }, "left", false), "Click the Save button.");
  assert.equal(clickWords({ name: "Open", role: "menu item" }, "left", false), "Choose Open from the menu.");
  assert.equal(clickWords({ name: "Home page", role: "link" }, "left", false), "Click the Home page link.");
  assert.equal(clickWords({ name: "Name", role: "edit" }, "left", false), "Click in the Name box.");
  assert.equal(clickWords({ name: "General", role: "tab item" }, "left", false), "Open the General tab.");
  assert.equal(clickWords({ name: "Odd thing", role: "pane" }, "left", false), "Click Odd thing.");
  assert.equal(clickWords({ name: "Save", role: "button" }, "right", false), "Right-click Save.");
  assert.equal(clickWords({ name: "Save", role: "button" }, "left", true), "Double-click Save.");
  assert.equal(clickWords(null, "left", false), "Click the highlighted spot.");
  assert.equal(clickWords({ name: "   ", role: "button" }, "left", false), "Click the highlighted spot.");
  assert.match(clickWords({ name: "x".repeat(200), role: "button" }, "left", false), /^Click the x{70,}… button\.$/);
});

test("a program's file name is said as a person would", () => {
  assert.equal(programName("notepad.exe"), "Notepad");
  assert.equal(programName("Code_Insiders.EXE"), "Code Insiders");
  assert.equal(programName(""), "another program");
});

test("each click is a step, with the name of what was clicked, the window, and a picture taken just before", () => {
  const events = log(
    '{"t":0,"type":"window","title":"Untitled - Notepad","process":"notepad.exe"}',
    '{"t":40,"type":"cursorMove","x":600,"y":400}',
    '{"t":1200,"type":"click","x":640,"y":480,"button":"left"}',
    '{"t":1200,"type":"element","name":"Save","role":"button"}',
    '{"t":5000,"type":"click","x":100,"y":50,"button":"left"}',
  );
  const s = steps(events);
  assert.equal(s.length, 2, "the cursor moving is not a step");
  assert.deepEqual([s[0]!.kind, s[0]!.text, s[0]!.atMs, s[0]!.shotMs, s[0]!.target], ["click", "Click the Save button.", 1200, 950, { x: 640, y: 480 }]);
  assert.deepEqual(s[0]!.element, { name: "Save", role: "button" });
  assert.deepEqual(s[0]!.window, { title: "Untitled - Notepad", process: "notepad.exe" });
  assert.equal(s[0]!.reviewed, false, "proposed, never approved");
  assert.equal(s[0]!.alt, "A screenshot of Untitled - Notepad, with the Save button marked.");
  assert.equal(s[1]!.text, "Click the highlighted spot.", "no name, no guess");
  assert.equal(s[1]!.element, null);
});

test("two quick clicks in one place are one double-click, and a right click says so", () => {
  const s = steps(log(
    '{"t":1000,"type":"click","x":300,"y":300,"button":"left"}',
    '{"t":1000,"type":"element","name":"Report","role":"list item"}',
    '{"t":1200,"type":"click","x":303,"y":301,"button":"left"}',
    '{"t":1200,"type":"element","name":"Report","role":"list item"}',
    '{"t":4000,"type":"click","x":300,"y":300,"button":"right"}',
    '{"t":4000,"type":"element","name":"Report","role":"list item"}',
    '{"t":9000,"type":"click","x":300,"y":300,"button":"middle"}',
  ));
  assert.deepEqual(s.map((x) => x.text), ["Double-click Report.", "Right-click Report."]);
  assert.equal(s[0]!.atMs, 1000, "the first click of the pair is where the step is");
});

test("clicks far apart in time or place are separate steps", () => {
  const s = steps(log(
    '{"t":1000,"type":"click","x":300,"y":300,"button":"left"}',
    '{"t":1200,"type":"click","x":400,"y":300,"button":"left"}',
    '{"t":2500,"type":"click","x":400,"y":300,"button":"left"}',
  ));
  assert.equal(s.length, 3);
});

test("typing is one step with what was typed, Backspace takes a character back, and Enter is a step of its own", () => {
  const keys = (t0: number, text: string): string[] => [...text].map((c, i) => {
    const upper = c !== c.toLowerCase();
    const key = c === " " ? "space" : c === "," ? "comma" : c.toLowerCase();
    return `{"t":${t0 + i * 90},"type":"key","key":"${key}","modifiers":${upper ? '["shift"]' : "[]"}}`;
  });
  const s = steps(log(
    ...keys(1000, "Hello, worlx"),
    '{"t":2200,"type":"key","key":"backspace","modifiers":[]}',
    '{"t":2300,"type":"key","key":"d","modifiers":[]}',
    '{"t":3000,"type":"key","key":"enter","modifiers":[]}',
  ));
  assert.deepEqual(s.map((x) => [x.kind, x.text]), [["type", 'Type "Hello, world".'], ["key", "Press Enter."]]);
  assert.equal(s[0]!.typed, "Hello, world");
  assert.equal(s[0]!.atMs, 1000);
  assert.equal(s[0]!.shotMs, 850);
});

test("typing that pauses for a while is two steps, and a click in the middle ends it", () => {
  const k = (t: number, key: string) => `{"t":${t},"type":"key","key":"${key}","modifiers":[]}`;
  const s = steps(log(k(1000, "a"), k(1100, "b"), k(9000, "c"), `{"t":9500,"type":"click","x":1,"y":1,"button":"left"}`, k(10_000, "d")));
  assert.deepEqual(s.map((x) => x.typed ?? x.kind), ["ab", "c", "click", "d"]);
});

test("typing that was all taken back makes no step", () => {
  const k = (t: number, key: string) => `{"t":${t},"type":"key","key":"${key}","modifiers":[]}`;
  assert.deepEqual(steps(log(k(1000, "a"), k(1100, "backspace"))), []);
});

test("a program that comes to the front on its own is a step; one opened by a click is that click's", () => {
  const s = steps(log(
    '{"t":0,"type":"window","title":"Untitled - Notepad","process":"notepad.exe"}',
    '{"t":3000,"type":"window","title":"Untitled - Notepad (typing)","process":"notepad.exe"}',
    '{"t":6000,"type":"window","title":"Report","process":"winword.exe"}',
    '{"t":8000,"type":"click","x":10,"y":10,"button":"left"}',
    '{"t":8500,"type":"window","title":"Calculator","process":"calc.exe"}',
  ));
  assert.deepEqual(s.map((x) => x.text), ["Switch to Winword.", "Click the highlighted spot."], "a title change is not a step, and the click already explains Calculator");
  assert.equal(s[0]!.shotMs, 6600);
});

test("the author's markers are steps, with their words", () => {
  const s = steps(log('{"t":3400,"type":"marker","label":"  look   here "}', '{"t":3500,"type":"marker","label":"  "}'));
  assert.deepEqual(s.map((x) => [x.kind, x.text, x.shotMs]), [["marker", "look here", 3400]]);
});

test("a recorded part of the screen is counted from its own corner, and says how big the picture is", () => {
  const s = steps(log('{"t":1000,"type":"click","x":340,"y":260,"button":"left"}'), { take: 2, region: { x: 100, y: 200, width: 1280, height: 720 } });
  assert.deepEqual(s[0]!.target, { x: 240, y: 60 });
  assert.deepEqual(s[0]!.picture, { width: 1280, height: 720 });
  assert.equal(s[0]!.take, 2);
});

test("only what happened in a part the edit keeps gets a step", () => {
  const events = log(
    '{"t":1000,"type":"click","x":1,"y":1,"button":"left"}',
    '{"t":5000,"type":"click","x":2,"y":2,"button":"left"}',
    '{"t":9000,"type":"click","x":3,"y":3,"button":"left"}',
  );
  const s = steps(events, { take: 1, keep: [{ take: 1, startMs: 4000, endMs: 6000 }, { take: 2, startMs: 0, endMs: 99_999 }] });
  assert.deepEqual(s.map((x) => x.atMs), [5000]);
  assert.equal(steps(events, { take: 1, keep: [] }).length, 0);
});

test("the stretches an edit keeps come from its screen track, and an edit with none keeps everything", () => {
  const clip = (id: string, take: number, a: number, b: number): Clip => ({ id, name: id, source: { kind: "take", take, media: "screen.mp4" }, sourceStartMs: a, sourceEndMs: b, startMs: 0, muted: false, volumeDb: 0, fadeInMs: 0, fadeOutMs: 0 });
  const track = (kind: Track["kind"], clips: Clip[]): Track => ({ id: `t-${kind}`, kind, name: kind, clips, items: [] });
  const model: EditModel = { ...createModel(), tracks: [track("screen", [clip("a", 1, 0, 3000), clip("b", 1, 5000, 8000), clip("c", 2, 0, 1000)]), track("audio", [clip("m", 1, 0, 9000)])] };
  assert.deepEqual(keepRangesOf(model), [{ take: 1, startMs: 0, endMs: 3000 }, { take: 1, startMs: 5000, endMs: 8000 }, { take: 2, startMs: 0, endMs: 1000 }]);
  assert.equal(keepRangesOf({ ...createModel(), tracks: [track("audio", [])] }), null);
});

test("steps get ids that are never reused, take by take in order, and stop at the limit", () => {
  const a = steps(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}', '{"t":3000,"type":"click","x":2,"y":2,"button":"left"}'));
  const b = steps(log('{"t":500,"type":"click","x":3,"y":3,"button":"left"}'), { take: 2 });
  const { list, cut } = listFrom([a, b]);
  assert.deepEqual(list.steps.map((s) => [s.id, s.take]), [["step-1", 1], ["step-2", 1], ["step-3", 2]]);
  assert.equal(list.nextId, 4);
  assert.equal(cut, 0);
  const many = Array.from({ length: MAX_STEPS + 3 }, () => a[0]!);
  const big = listFrom([many]);
  assert.equal(big.list.steps.length, MAX_STEPS);
  assert.equal(big.cut, 3);
});

test("editing a step changes only what was asked, and moving and deleting keep the ids", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}', '{"t":3000,"type":"click","x":2,"y":2,"button":"left"}', '{"t":5000,"type":"click","x":3,"y":3,"button":"left"}'));
  list = editStep(list, "step-2", { text: "Press the big red button.", reviewed: true, shotMs: 2500.4 });
  assert.deepEqual([list.steps[1]!.text, list.steps[1]!.reviewed, list.steps[1]!.shotMs, list.steps[1]!.alt], ["Press the big red button.", true, 2500, "A screenshot of the screen, with the place to click marked."]);
  assert.equal(editStep(list, "step-9", { text: "x" }), list, "an id that is not there changes nothing");
  list = moveStep(list, "step-3", -1);
  assert.deepEqual(list.steps.map((s) => s.id), ["step-1", "step-3", "step-2"]);
  assert.equal(moveStep(list, "step-1", -1), list, "the first cannot go earlier");
  assert.equal(moveStep(list, "step-2", 1), list, "the last cannot go later");
  list = deleteStep(list, "step-3");
  assert.deepEqual(list.steps.map((s) => s.id), ["step-1", "step-2"]);
  assert.equal(list.nextId, 4, "a deleted step's id is not given out again");
  assert.equal(addManual(list, { take: 1, atMs: 100 }).steps.at(-1)!.id, "step-4");
});

test("two steps merge into one that keeps the first's id, and splitting it brings them back", () => {
  const events = log(
    '{"t":1000,"type":"key","key":"h","modifiers":[]}', '{"t":1100,"type":"key","key":"i","modifiers":[]}',
    '{"t":2000,"type":"key","key":"enter","modifiers":[]}',
    '{"t":4000,"type":"click","x":5,"y":5,"button":"left"}',
  );
  let list = listOf(events);
  assert.deepEqual(list.steps.map((s) => s.text), ['Type "hi".', "Press Enter.", "Click the highlighted spot."]);
  list = editStep(list, "step-1", { reviewed: true });
  list = mergeWithNext(list, "step-1");
  assert.equal(list.steps.length, 2);
  const m = list.steps[0]!;
  assert.deepEqual([m.id, m.text, m.reviewed, m.atMs, m.typed], ["step-1", 'Type "hi". Press Enter.', false, 1000, "hi"], "it has to be checked again");
  assert.equal(m.from!.length, 2);
  assert.equal(mergeWithNext(list, "step-3"), list, "nothing after the last");
  list = splitStep(list, "step-1");
  assert.deepEqual(list.steps.map((s) => [s.id, s.text]), [["step-1", 'Type "hi".'], ["step-4", "Press Enter."], ["step-3", "Click the highlighted spot."]]);
  assert.equal(list.steps.every((s) => s.from === undefined), true);
  assert.equal(list.nextId, 5);
});

test("merging three steps keeps every original, and a merge of merges comes apart in one go", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}', '{"t":3000,"type":"click","x":2,"y":2,"button":"left"}', '{"t":5000,"type":"click","x":3,"y":3,"button":"left"}'));
  list = mergeWithNext(mergeWithNext(list, "step-1"), "step-1");
  assert.equal(list.steps.length, 1);
  assert.equal(list.steps[0]!.from!.length, 3);
  assert.equal(splitStep(list, "step-1").steps.length, 3);
});

test("a step that was not merged splits into two: a second at the same moment, with no words to be written", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}'));
  list = editStep(list, "step-1", { reviewed: true });
  list = splitStep(list, "step-1");
  assert.deepEqual(list.steps.map((s) => [s.id, s.text === "", s.atMs, s.reviewed]), [["step-1", false, 1000, true], ["step-2", true, 1000, false]]);
  assert.deepEqual(list.steps[1]!.target, list.steps[0]!.target);
});

test("a step added by hand starts empty, after the one named or at the end", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}', '{"t":3000,"type":"click","x":2,"y":2,"button":"left"}'));
  list = addManual(list, { take: 1, atMs: 1500, after: "step-1" });
  assert.deepEqual(list.steps.map((s) => s.id), ["step-1", "step-3", "step-2"]);
  assert.deepEqual([list.steps[1]!.kind, list.steps[1]!.text, list.steps[1]!.target], ["manual", "", null]);
  list = addManual(list, { take: 1, atMs: 9000 });
  assert.equal(list.steps.at(-1)!.id, "step-4");
});

test("what still needs the author is said in words, and a checked step is not listed", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":1,"y":1,"button":"left"}', '{"t":3000,"type":"click","x":2,"y":2,"button":"left"}'));
  list = addManual(list, { take: 1, atMs: 4000 });
  list = editStep(list, "step-1", { reviewed: true });
  assert.deepEqual(stepProblems(list), ["Step 2 has not been checked.", "Step 3 has no words yet."]);
  assert.equal(unreviewedCount(list), 2);
});

test("a picture description is proposed from the window and what was clicked, never from nothing", () => {
  assert.equal(altFor("click", { name: "Save", role: "Button" }, { title: "Notes", process: "n.exe" }), "A screenshot of Notes, with the Save button marked.");
  assert.equal(altFor("click", null, null), "A screenshot of the screen, with the place to click marked.");
  assert.equal(altFor("window", null, { title: "", process: "calc.exe" }), "A screenshot of Calc.");
});

test("steps are saved and read back the same, and a file that is not steps is refused in words", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":640,"y":480,"button":"left"}', '{"t":1000,"type":"element","name":"Save","role":"button"}', '{"t":2000,"type":"key","key":"enter","modifiers":[]}'));
  list = mergeWithNext(list, "step-1");
  list = editStep(list, "step-1", { text: "Save it.", reviewed: true });
  const back = parseSteps(serializeSteps(list));
  assert.equal(back.ok, true);
  assert.deepEqual(back.ok && back.list, list);
  assert.equal(parseSteps("{").ok, false);
  const bad = parseSteps('{"format":"nope"}');
  assert.deepEqual(bad.ok === false && bad.message, "That file is not a list of steps.");
  const old = parseSteps('{"format":"openstage-capture-steps","schemaVersion":"9.9.9","nextId":1,"steps":[]}');
  assert.match(old.ok === false ? old.message : "", /different version \(9\.9\.9\)/);
  assert.equal(parseSteps('{"format":"openstage-capture-steps","schemaVersion":"0.1.0","nextId":1,"steps":[{"id":"x"}]}').ok, false);
  const next = parseSteps('{"format":"openstage-capture-steps","schemaVersion":"0.1.0","nextId":1,"steps":[{"id":"step-7","kind":"manual","take":1,"atMs":0,"shotMs":0,"text":"a","alt":"b"}]}');
  assert.equal(next.ok && next.list.nextId, 8, "a next number that is too low is raised past the highest id");
  assert.equal(emptyList().steps.length, 0);
});

test("a box is kept inside the picture and never smaller than it can be seen", () => {
  assert.deepEqual(clampBox({ x: -5, y: 120, width: 10, height: 10 }), { x: 0, y: 90, width: 10, height: 10 });
  assert.deepEqual(clampBox({ x: 95, y: 0, width: 20, height: 0 }), { x: 80, y: 0, width: 20, height: MIN_BOX });
  assert.deepEqual(clampBox({ x: Number.NaN, y: 1, width: 300, height: -4 }), { x: 0, y: 1, width: 100, height: MIN_BOX });
  assert.deepEqual(clampBox({ x: 10.123456, y: 20, width: 5, height: 5 }), { x: 10.12, y: 20, width: 5, height: 5 });
});

test("the starting box is button-sized, centred on the click, and needs the picture's size", () => {
  assert.equal(startBox({ x: 100, y: 100 }, null), null);
  assert.equal(startBox(null, { width: 1000, height: 500 }), null);
  const b = startBox({ x: 500, y: 250 }, { width: 1000, height: 500 })!;
  assert.deepEqual(b, { x: 43, y: 44.4, width: 14, height: 11.2 });
  const corner = startBox({ x: 5, y: 3 }, { width: 1000, height: 500 })!;
  assert.deepEqual([corner.x, corner.y], [0, 0], "kept inside the picture");
});

test("a box can be moved and resized in small steps, and stays inside", () => {
  const b = { x: 40, y: 40, width: 10, height: 10 };
  assert.deepEqual(nudgeBox(b, 1, -1), { x: 41, y: 39, width: 10, height: 10 });
  assert.deepEqual(nudgeBox(b, 5, 5, true), { x: 40, y: 40, width: 15, height: 15 });
  assert.deepEqual(nudgeBox(b, -100, 0), { x: 0, y: 40, width: 10, height: 10 });
  assert.deepEqual(nudgeBox(b, 500, 500, true), { x: 0, y: 0, width: 100, height: 100 });
});

test("once the picture's size is known a click step gets its box, and one the author moved is left where it is", () => {
  let list = listOf(log('{"t":1000,"type":"click","x":640,"y":360,"button":"left"}', '{"t":3000,"type":"key","key":"enter","modifiers":[]}'));
  assert.equal(list.steps[0]!.box, null, "the size of a whole screen is not in the log");
  list = knowPicture(list, "step-1", { width: 1280, height: 720 });
  assert.deepEqual(list.steps[0]!.picture, { width: 1280, height: 720 });
  assert.deepEqual(list.steps[0]!.box, { x: 44.53, y: 46.11, width: 10.94, height: 7.78 });
  list = editStep(list, "step-1", { box: { x: 10, y: 10, width: 20, height: 20 } });
  list = knowPicture(list, "step-1", { width: 1280, height: 720 });
  assert.deepEqual(list.steps[0]!.box, { x: 10, y: 10, width: 20, height: 20 });
  list = knowPicture(list, "step-2", { width: 1280, height: 720 });
  assert.equal(list.steps[1]!.box, null, "a key press has no place to point at");
  assert.equal(knowPicture(list, "step-9", { width: 1, height: 1 }), list);
});

test("a recorded part of the screen gives its steps a box straight away, and the box is saved and read back", () => {
  const s = steps(log('{"t":1000,"type":"click","x":340,"y":260,"button":"left"}'), { take: 1, region: { x: 100, y: 200, width: 1280, height: 720 } });
  assert.deepEqual(s[0]!.box, { x: 13.28, y: 4.44, width: 10.94, height: 7.78 });
  let list = listFrom([s]).list;
  list = editStep(list, "step-1", { box: { x: 1, y: 2, width: 3, height: 4 } });
  const back = parseSteps(serializeSteps(list));
  assert.deepEqual(back.ok && back.list.steps[0]!.box, { x: 1, y: 2, width: 3, height: 4 });
  const merged = mergeWithNext(listFrom([[...s, ...steps(log('{"t":2000,"type":"key","key":"enter","modifiers":[]}'))]]).list, "step-1");
  assert.deepEqual(merged.steps[0]!.box, s[0]!.box, "a merged step keeps the first step's box");
});
