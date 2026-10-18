// Tests for suggested descriptions of boxes and arrows put in at a click: finding the take's moment, the named click nearest it, and the words that are offered (never used until the author says).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModel, type Clip, type Item, type Model as EditModel, type Track } from "../../capture-edit/src/model.ts";
import { memoryFolder } from "../../capture-timeline/src/project.ts";
import { AFTER_MS, BEFORE_MS, namedClickNear, suggestCalloutAlt, takeTimeAt } from "./calloutalt.ts";
import { parseLog } from "./steps.ts";
import { readClickLogs } from "./stepsource.ts";

const clip = (id: string, take: number, startMs: number, sourceStartMs: number, sourceEndMs: number): Clip => ({
  id, name: id, source: { kind: "take", take, media: "screen" }, sourceStartMs, sourceEndMs, startMs, muted: false, volumeDb: 0, fadeInMs: 0, fadeOutMs: 0,
});
const model = (...screen: Clip[]): EditModel => ({ ...createModel(), tracks: [{ id: "track-1", kind: "screen", name: "Screen", clips: screen, items: [] } as Track] });
const shape = (startMs: number, kind: "rectangle" | "ellipse" = "rectangle"): Item => ({ id: "i1", name: "Box", kind: "shape", startMs, durationMs: 3000, shape: kind, rect: { x: 0, y: 0, width: 1000, height: 1000 }, outline: "#FF0000", fill: null, lineWidthBp: 30 }) as Item;
const arrow = (startMs: number): Item => ({ id: "i2", name: "Arrow", kind: "arrow", startMs, durationMs: 3000, from: { x: 0, y: 0 }, to: { x: 5000, y: 5000 }, color: "#FF0000", lineWidthBp: 30 }) as Item;
const logOf = (...lines: string[]) => parseLog(lines.join("\n")).events;
const ELEMENT = (t: number, name: string, role = "button") => `{"t":${t},"type":"element","name":"${name}","role":"${role}"}`;
const CLICK = (t: number) => `{"t":${t},"type":"click","x":10,"y":10,"button":"left"}`;

test("a moment of the edit is found in the take the screen clip shows, with the clip's own offset", () => {
  const m = model(clip("a", 1, 0, 0, 4000), clip("b", 2, 4000, 10_000, 15_000));
  assert.deepEqual(takeTimeAt(m, 1500), { take: 1, ms: 1500 });
  assert.deepEqual(takeTimeAt(m, 4000), { take: 2, ms: 10_000 });
  assert.deepEqual(takeTimeAt(m, 6500), { take: 2, ms: 12_500 });
  assert.equal(takeTimeAt(m, 9000), null, "past the last clip");
  assert.equal(takeTimeAt(createModel(), 0), null, "no screen track");
});

test("the named click nearest a moment is chosen, within a short time before and after", () => {
  const events = logOf(CLICK(1000), ELEMENT(1000, "Save"), CLICK(3000), ELEMENT(3000, "Cancel"), ELEMENT(9000, "Far away"));
  assert.deepEqual(namedClickNear(events, 1200), { t: 1000, name: "Save", role: "button" });
  assert.deepEqual(namedClickNear(events, 2600), { t: 3000, name: "Cancel", role: "button" });
  assert.equal(namedClickNear(logOf(ELEMENT(1000, "Save")), 1000 + BEFORE_MS + 100), null, "too long after the click");
  assert.equal(namedClickNear(logOf(ELEMENT(1000, "Save")), 1000 - AFTER_MS - 100), null, "too long before the click");
  assert.equal(namedClickNear(logOf(CLICK(1000)), 1000), null, "a click with no name");
  assert.equal(namedClickNear(logOf(ELEMENT(1000, "   ")), 1000), null, "a blank name");
});

test("a box, a circle and an arrow are each offered words that name what was clicked, and say where that came from", () => {
  const logs = new Map([[1, logOf(CLICK(1000), ELEMENT(1000, "Save"))]]);
  const m = model(clip("a", 1, 0, 0, 8000));
  const box = suggestCalloutAlt(m, logs, shape(1200))!;
  assert.equal(box.text, "A box around the Save button.");
  assert.match(box.basis, /The name of what was clicked at 0:01 in take 1 \(Save, button\)/);
  assert.match(box.basis, /not been checked against the picture/);
  assert.equal(suggestCalloutAlt(m, logs, shape(1200, "ellipse"))!.text, "A circle around the Save button.");
  assert.equal(suggestCalloutAlt(m, logs, arrow(800))!.text, "An arrow pointing to the Save button.");
});

test("nothing is suggested without a named click near enough, a log for that take, or a screen picture at that moment", () => {
  const logs = new Map([[1, logOf(CLICK(1000), ELEMENT(1000, "Save"))]]);
  const m = model(clip("a", 1, 0, 0, 20_000));
  assert.equal(suggestCalloutAlt(m, logs, shape(15_000)), null, "the click was long before");
  assert.equal(suggestCalloutAlt(m, new Map(), shape(1000)), null, "no log");
  assert.equal(suggestCalloutAlt(model(clip("a", 2, 0, 0, 5000)), logs, shape(1000)), null, "another take has no log");
  assert.equal(suggestCalloutAlt(model(clip("a", 1, 0, 0, 500)), logs, shape(1000)), null, "the screen clip ends before");
  const text = { id: "t", name: "t", kind: "text", startMs: 1000, durationMs: 1000, text: "Hi", rect: { x: 0, y: 0, width: 1, height: 1 }, fontSizeBp: 500, color: "#fff", background: null, bold: false, align: "left" } as Item;
  assert.equal(suggestCalloutAlt(m, logs, text), null, "only a box, circle or arrow has alt text to suggest");
});

test("a suggestion from a part of a take that was cut and moved earlier uses the take's own time, not the edit's", () => {
  // The edit keeps 10 to 15 seconds of take 2 from 4 seconds on, so edit time 6000 is take time 12000.
  const logs = new Map([[2, logOf(CLICK(12_000), ELEMENT(12_000, "OK", "button"))]]);
  const m = model(clip("a", 1, 0, 0, 4000), clip("b", 2, 4000, 10_000, 15_000));
  assert.equal(suggestCalloutAlt(m, logs, shape(6000))!.text, "A box around the OK button.");
  assert.equal(suggestCalloutAlt(m, logs, shape(2000)), null);
});

test("the names of what was clicked are read from every take's log, and only those lines are kept", async () => {
  const folder = memoryFolder("Demo.capture", {
    "takes/take-001/events.jsonl": [CLICK(1000), ELEMENT(1000, "Save"), '{"t":1100,"type":"cursorMove","x":1,"y":2}', '{"t":1200,"type":"key","key":"a","modifiers":[]}'].join("\n"),
    "takes/take-002/events.jsonl": "not a line that can be read\n" + ELEMENT(300, "File", "menu item"),
    "takes/take-003/take.json": "{}",
  });
  const logs = await readClickLogs(folder);
  assert.deepEqual([...logs.keys()], [1, 2]);
  assert.deepEqual(logs.get(1)!.map((e) => e.type), ["element"]);
  assert.deepEqual(logs.get(2)!.map((e) => (e.type === "element" ? e.name : "")), ["File"]);
});
