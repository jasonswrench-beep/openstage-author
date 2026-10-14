// Grouping: objects the author ties together so they are chosen, moved, resized, copied, deleted and lined up as one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { OSObject } from "../../player/src/types.ts";
import { expandGroups, groupsOf, loneGroups, scaleBoxes, unitsOf, wholeGroup } from "./group.ts";
import { Model } from "./model.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.join(here, "..", "..", "examples", "minimal.osproj");
const text = (rel: string) => readFileSync(path.join(proj, rel), "utf-8");

function open(): Model {
  return new Model({
    dir: "D:/x",
    project: text("project.json"),
    theme: text("theme.json"),
    slides: [
      { id: "slide-001", text: text("slides/slide-001.json") },
      { id: "slide-002", text: text("slides/slide-002.json") },
    ],
  });
}

/** Add shapes at these places (x, y, width, height) and return their ids. Nothing is left selected. */
function shapes(m: Model, ...places: [number, number, number, number][]): string[] {
  const out: string[] = [];
  for (const [x, y, width, height] of places) {
    const o = m.addObject("shape")!;
    m.setGeometry(o.id, { x, y, width, height });
    out.push(o.id);
  }
  m.selectObject(null);
  return out;
}

const get = (m: Model, id: string): OSObject => m.objects.find((o) => o.id === id)!;
const ids = (m: Model) => m.selected.map((o) => o.id).sort();
const pick = (m: Model, list: string[]) => {
  m.selectObject(list[0]!);
  for (const id of list.slice(1)) m.toggleSelected(id);
};
const at = (m: Model, id: string) => ({ x: get(m, id).geometry.x, y: get(m, id).geometry.y });

// ---- the arithmetic

function obj(id: string, group?: string, x = 0, y = 0, width = 10, height = 10): OSObject {
  return { id, group, geometry: { x, y, width, height, z: 1, rotation: 0 } } as unknown as OSObject;
}

test("expandGroups adds everyone who shares a group with a chosen object", () => {
  const all = [obj("a", "g1"), obj("b", "g1"), obj("c"), obj("d", "g2"), obj("e", "g2")];
  assert.deepEqual(expandGroups(all, ["a"]), ["a", "b"]);
  assert.deepEqual(expandGroups(all, ["c"]), ["c"]);
  assert.deepEqual(expandGroups(all, ["a", "e"]), ["a", "b", "d", "e"]);
});

test("a selection is a whole group only if it is all of one group and nothing else", () => {
  const all = [obj("a", "g1"), obj("b", "g1"), obj("c", "g1"), obj("d")];
  assert.equal(wholeGroup(all, [all[0]!, all[1]!, all[2]!])?.length, 3);
  assert.equal(wholeGroup(all, [all[0]!, all[1]!]), null, "two of three is not the whole group");
  assert.equal(wholeGroup(all, [all[0]!, all[1]!, all[2]!, all[3]!]), null, "with something else is not exactly a group");
  assert.equal(wholeGroup(all, [all[3]!]), null);
});

test("units: a group chosen whole is one thing, anything else is its own", () => {
  const all = [obj("a", "g1"), obj("b", "g1"), obj("c", "g2"), obj("d", "g2"), obj("e")];
  const units = unitsOf(all, [all[0]!, all[1]!, all[2]!, all[4]!]);
  assert.deepEqual(units.map((u) => u.map((o) => o.id)), [["a", "b"], ["c"], ["e"]], "g1 is whole; only one of g2 was chosen, so it is on its own");
});

test("groups left with one object are found, and groupsOf lists members by tag", () => {
  const all = [obj("a", "g1"), obj("b", "g1"), obj("c", "g2"), obj("d")];
  assert.deepEqual(loneGroups(all), ["g2"]);
  assert.deepEqual([...groupsOf(all)].map(([t, m]) => [t, m.length]), [["g1", 2], ["g2", 1]]);
});

test("scaling boxes as one keeps each one's place and size relative to the whole", () => {
  const from = { x: 100, y: 100, width: 200, height: 100 };
  const boxes = [{ x: 100, y: 100, width: 100, height: 100 }, { x: 200, y: 100, width: 100, height: 50 }];
  assert.deepEqual(scaleBoxes(boxes, from, { x: 100, y: 100, width: 400, height: 200 }), [
    { x: 100, y: 100, width: 200, height: 200 },
    { x: 300, y: 100, width: 200, height: 100 },
  ]);
  assert.deepEqual(scaleBoxes(boxes, from, { x: 10, y: 20, width: 200, height: 100 })[1], { x: 110, y: 20, width: 100, height: 50 }, "moving only shifts");
  assert.equal(scaleBoxes([{ x: 0, y: 0, width: 4, height: 4 }], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 1, height: 1 })[0]!.width, 1, "never below the minimum");
});

// ---- grouping and ungrouping

test("grouping ties the selected objects together, and says so", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  assert.equal(m.canGroup, false, "nothing is selected");
  m.selectObject(a);
  assert.match(m.group()!, /Choose two or more objects/);
  pick(m, [a, b]);
  assert.equal(m.canGroup, true);
  assert.match(m.group()!, /^Grouped 2 objects\./);
  assert.equal(get(m, a).group, get(m, b).group);
  assert.ok(get(m, a).group);
  assert.equal(get(m, c).group, undefined, "an object not chosen is not in it");
  assert.equal(m.selectedGroup?.length, 2);
  assert.match(m.describeSelection(), /^Group of 2 objects selected: /);
  assert.equal(m.canGroup, false, "already exactly one group");
  assert.match(m.group()!, /already a group/);
  assert.equal(m.groupSize(a), 2);
  assert.equal(m.groupSize(c), 0);
});

test("grouping is one undo step, and so is ungrouping", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  assert.ok(get(m, a).group);
  m.undo();
  assert.equal(get(m, a).group, undefined);
  assert.equal(get(m, b).group, undefined);
  m.redo();
  assert.ok(get(m, b).group);
  m.ungroup();
  assert.equal(get(m, a).group, undefined);
  assert.equal(get(m, b).group, undefined);
  m.undo();
  assert.ok(get(m, a).group, "undo puts the group back");
});

test("an object that is not in a group has no group field at all", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.ungroup();
  assert.equal("group" in get(m, a), false, "no empty or null field is left behind");
});

test("ungrouping keeps everything that was in the group selected", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b, c]);
  m.group();
  m.selectObject(b);
  assert.equal(m.canUngroup, true);
  assert.match(m.ungroup()!, /^Ungrouped 3 objects\./);
  assert.deepEqual(ids(m), [a, b, c].sort(), "choosing one member and ungrouping selects the lot, so it is plain what happened");
  assert.equal(m.canUngroup, false);
  assert.match(m.ungroup()!, /None of the selected objects is in a group/);
});

test("pulling objects out of a group into a new one leaves the rest as a group only if two remain", () => {
  const m = open();
  const [a, b, c, d] = shapes(m, [0, 0, 50, 50], [100, 0, 50, 50], [200, 0, 50, 50], [300, 0, 50, 50]) as [string, string, string, string];
  pick(m, [a, b, c]);
  m.group();
  const old = get(m, a).group;
  // Take c and d into a new group: the old one keeps a and b.
  pick(m, [c, d]);
  m.group();
  assert.equal(get(m, a).group, old);
  assert.equal(get(m, b).group, old);
  assert.notEqual(get(m, c).group, old);
  assert.equal(get(m, c).group, get(m, d).group);
  // Take b and d into a new group: a is left alone in the old one, so the old one is gone.
  pick(m, [b, d]);
  m.group();
  assert.equal(get(m, a).group, undefined, "a group of one groups nothing");
  assert.equal(get(m, c).group, undefined, "and so for c");
  assert.equal(get(m, b).group, get(m, d).group);
});

test("grouping gives each group an id no other group uses", () => {
  const m = open();
  const [a, b, c, d] = shapes(m, [0, 0, 50, 50], [100, 0, 50, 50], [200, 0, 50, 50], [300, 0, 50, 50]) as [string, string, string, string];
  pick(m, [a, b]);
  m.group();
  pick(m, [c, d]);
  m.group();
  assert.notEqual(get(m, a).group, get(m, c).group);
  assert.match(get(m, a).group!, /^group-\d+$/);
});

// ---- choosing

test("clicking one member chooses the whole group; the Objects list route chooses just the one", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(null);
  assert.match(m.selectWithGroup(a)!, /^Group of 2 objects selected/);
  assert.deepEqual(ids(m), [a, b].sort());
  m.selectObject(b);
  assert.deepEqual(ids(m), [b], "a keyboard user or Alt and click chooses a single member");
  assert.equal(m.canSelectGroup, true);
  assert.match(m.selectGroup()!, /^Group of 2 objects selected/);
  assert.deepEqual(ids(m), [a, b].sort());
  assert.equal(m.canSelectGroup, false);
  assert.match(m.selectGroup()!, /already selected/);
  m.selectWithGroup(c);
  assert.deepEqual(ids(m), [c], "an object in no group is chosen alone");
  assert.match(m.selectGroup()!, /not in a group/);
});

test("Shift and click adds or removes a whole group", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(c);
  m.toggleGroupSelected(a);
  assert.deepEqual(ids(m), [a, b, c].sort(), "the whole group joined the selection");
  m.toggleGroupSelected(b);
  assert.deepEqual(ids(m), [c], "and the whole group left it together");
});

test("a box dragged round part of a group chooses the whole group", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [900, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(null);
  assert.equal(m.expandGroups([a]).length, 2);
  m.selectIds(m.expandGroups([a, c]));
  assert.deepEqual(ids(m), [a, b, c].sort());
});

// ---- moving and resizing

test("moving a selected group moves every member together", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 200, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  assert.match(m.nudge(10, 5)!, /^Group of 2 objects, at 110, 105$/);
  assert.deepEqual(at(m, a), { x: 110, y: 105 });
  assert.deepEqual(at(m, b), { x: 310, y: 205 });
});

test("a locked object in a group holds the whole group in place", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 200, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(b);
  m.setLocked(true);
  m.selectWithGroup(a);
  assert.match(m.nudge(10, 0)!, /locked object holds its group/);
  assert.deepEqual(at(m, a), { x: 100, y: 100 }, "the unlocked member did not move either");
  // Chosen with a free object, the group stays and the free one moves.
  m.toggleGroupSelected(c);
  assert.match(m.nudge(10, 0)!, new RegExp(`^${get(m, c).name}, at 610, 300\\. 1 locked item stayed where it was\\.$`));
  assert.deepEqual(at(m, a), { x: 100, y: 100 });
  assert.deepEqual(at(m, c), { x: 610, y: 300 });
  const { free, held, heldUnits, groups } = m.movable();
  assert.deepEqual([free.length, held.length, heldUnits, groups], [1, 2, 1, true]);
});

test("resizing a group scales every member, keeping its place and size relative to the rest", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 100], [200, 100, 100, 50]) as [string, string];
  pick(m, [a, b]);
  m.group();
  // The group is 200 by 100. Make it 400 by 200.
  assert.match(m.setGroupBox({ width: 400, height: 200 })!, /^Group of 2 objects, at 100, 100, size 400 by 200$/);
  assert.deepEqual(get(m, a).geometry.width, 200);
  assert.deepEqual(get(m, a).geometry.height, 200);
  assert.deepEqual(at(m, b), { x: 300, y: 100 });
  assert.deepEqual([get(m, b).geometry.width, get(m, b).geometry.height], [200, 100]);
});

test("the arrow keys with Alt resize a group by that much, and one undo undoes the run", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 100], [200, 100, 100, 50]) as [string, string];
  pick(m, [a, b]);
  m.group();
  const msg = m.resizeBy(20, 0)!;
  assert.match(msg, /size 220 by 100$/);
  assert.equal(get(m, b).geometry.x, 210, "the right-hand member moved with the scaling");
  m.undo();
  assert.deepEqual([get(m, a).geometry.width, get(m, b).geometry.x], [100, 200]);
});

test("a group is moved to a typed place without being resized, and a locked member refuses", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 100], [200, 100, 100, 50]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.setGroupBox({ x: 0, y: 40 });
  assert.deepEqual(at(m, a), { x: 0, y: 40 });
  assert.deepEqual(at(m, b), { x: 100, y: 40 });
  assert.equal(get(m, a).geometry.width, 100, "moving does not change sizes");
  assert.equal(m.setGroupBox({ x: 0, y: 40 }), null, "no change says nothing");
  assert.equal(m.setGroupBox({ width: 0 }), null, "a group cannot be made nothing");
  m.selectObject(a);
  m.setLocked(true);
  m.selectWithGroup(a);
  assert.match(m.setGroupBox({ x: 500 })!, /locked object/);
  assert.equal(at(m, a).x, 0);
});

test("a group set on one member is not a group to resize", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 100], [200, 100, 100, 50]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(a);
  assert.equal(m.setGroupBox({ width: 500 }), null);
  assert.equal(get(m, a).geometry.width, 100);
});

// ---- lining up

test("a whole group lines up with other objects as one object", () => {
  const m = open();
  const [a, b, c] = shapes(m, [200, 100, 100, 60], [400, 300, 100, 60], [100, 500, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  m.toggleGroupSelected(c);
  const r = m.align("left")!;
  assert.equal(r.changed, true);
  assert.match(r.message, /^Lined up 2 items by their left edges\. Each group counts as one\.$/);
  // The group's left edge is 200 and c's is 100, so the left edge both line up to is 100: the group moves by -100, as one.
  assert.deepEqual(at(m, a), { x: 100, y: 100 });
  assert.deepEqual(at(m, b), { x: 300, y: 300 }, "the members kept their places relative to each other");
  assert.deepEqual(at(m, c), { x: 100, y: 500 });
});

test("one whole group lines up with the slide as a unit", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 300, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  const r = m.align("left")!;
  assert.match(r.message, /^Moved the group of 2 objects against the left edge of the slide\.$/);
  assert.deepEqual(at(m, a), { x: 0, y: 100 });
  assert.deepEqual(at(m, b), { x: 200, y: 300 });
  assert.match(m.align("left")!.message, /^The group of 2 objects is already there\.$/);
});

test("a group counts as one when spacing things out", () => {
  const m = open();
  const [a, b, c, d] = shapes(m, [0, 0, 100, 60], [150, 200, 100, 60], [200, 400, 100, 60], [1000, 0, 100, 60]) as [string, string, string, string];
  pick(m, [b, c]);
  m.group();
  pick(m, [a, b, c, d]);
  // Three things: a, the group of b and c (150 wide, from 150 to 300), and d. Evenly spaced across 0 to 1100.
  const r = m.distribute("horizontal")!;
  assert.equal(r.changed, true);
  assert.match(r.message, /^Spaced 3 items evenly across the slide\. Each group counts as one\.$/);
  // Gap = (1100 - 100 - 150 - 100) / 2 = 375; the group's left edge goes to 100 + 375 = 475, and its members keep their 50 apart.
  assert.equal(get(m, b).geometry.x, 475);
  assert.equal(get(m, c).geometry.x, 525);
  assert.equal(m.selectedUnits, 3);
});

test("two things, one of them a group, are too few to space out, and the message says a group counts as one", () => {
  const m = open();
  const [a, b, c] = shapes(m, [0, 0, 100, 60], [150, 200, 100, 60], [900, 0, 100, 60]) as [string, string, string];
  pick(m, [b, c]);
  m.group();
  pick(m, [a, b, c]);
  assert.match(m.distribute("horizontal")!.message, /three or more objects or groups.*counts as one/);
});

test("a group with a locked object in it is held back when lining up, and the message says so", () => {
  const m = open();
  const [a, b, c, d] = shapes(m, [200, 100, 100, 60], [400, 300, 100, 60], [100, 500, 100, 60], [700, 600, 100, 60]) as [string, string, string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(b);
  m.setLocked(true);
  m.selectWithGroup(a);
  assert.match(m.align("left")!.message, /^The group of 2 objects has a locked object in it\. Unlock it first to move it\.$/);
  m.toggleGroupSelected(c);
  // The left edge both would line up to is 100, c's. The group would have to move by -100 and is held, so nothing moves and it says why.
  const r = m.align("left")!;
  assert.equal(r.changed, false);
  assert.match(r.message, /^1 locked item would have had to move, so nothing changed\./);
  assert.deepEqual(at(m, a), { x: 200, y: 100 });
  // With d chosen too, d moves and the held group is reported.
  m.toggleGroupSelected(d);
  const more = m.align("left")!;
  assert.equal(more.changed, true);
  assert.match(more.message, /^Lined up 3 items by their left edges\. Each group counts as one\. 1 locked item stayed where it was\.$/);
  assert.equal(get(m, d).geometry.x, 100);
  assert.deepEqual(at(m, a), { x: 200, y: 100 }, "the group did not move");
  assert.deepEqual(at(m, b), { x: 400, y: 300 }, "and neither did its unlocked member");
});

test("objects with no groups still say objects, not items", () => {
  const m = open();
  const [a, b, c] = shapes(m, [0, 0, 100, 60], [150, 200, 100, 60], [900, 0, 100, 60]) as [string, string, string];
  pick(m, [a, b, c]);
  assert.match(m.align("top")!.message, /^Lined up 3 objects by their top edges\.$/);
  assert.match(m.distribute("horizontal")!.message, /^Spaced 3 objects evenly across the slide\.$/);
});

// ---- deleting

test("deleting a whole group removes every member, as one undo step", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  assert.match(m.deleteSelected()!, /^Deleted 2 objects/);
  assert.deepEqual(m.objects.map((o) => o.id).filter((id) => [a, b, c].includes(id)), [c]);
  m.undo();
  assert.equal(get(m, a).group, get(m, b).group, "undo brings the group back as it was");
});

test("deleting one member of a group of two leaves the other ungrouped, not in a group of one", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(a);
  m.deleteObject(a);
  assert.equal(get(m, b).group, undefined);
});

test("deleting one member of a group of three leaves the other two grouped", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b, c]);
  m.group();
  const tag = get(m, a).group;
  m.selectObject(a);
  m.deleteObject(a);
  assert.equal(get(m, b).group, tag);
  assert.equal(get(m, c).group, tag);
});

test("a locked member that is kept leaves no group of one behind", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.selectObject(b);
  m.setLocked(true);
  m.selectWithGroup(a);
  assert.match(m.deleteSelected()!, /1 locked object was kept/);
  assert.equal(get(m, b).group, undefined);
});

// ---- copying

test("duplicating a whole group makes a group of its own", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  const before = get(m, a).group;
  m.duplicate();
  const copies = m.selected;
  assert.equal(copies.length, 2);
  assert.ok(copies[0]!.group);
  assert.equal(copies[0]!.group, copies[1]!.group);
  assert.notEqual(copies[0]!.group, before, "the copy has a group id of its own");
  assert.equal(get(m, a).group, before, "the original is untouched");
  assert.equal(m.selectedGroup?.length, 2, "and the copies are selected as a group");
});

test("copying only part of a group copies the objects ungrouped, and says so", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b, c]);
  m.group();
  m.selectObject(a);
  const msg = m.duplicate()!;
  assert.match(msg, /Only part of a group was copied, so the copy is not grouped\./);
  assert.equal(m.object!.group, undefined);
  assert.equal(get(m, a).group !== undefined, true, "the original keeps its group");
});

test("a copy of a group pasted on another slide is a group, with an id no group in the project has", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  const original = get(m, a).group;
  m.copy();
  m.selectSlide("slide-002");
  m.paste();
  const pasted = m.selected;
  assert.equal(pasted.length, 2);
  assert.equal(m.selectedGroup?.length, 2);
  assert.notEqual(pasted[0]!.group, original, "ids are not reused across the project, so a group can never be mistaken for another");
});

test("cutting a group and pasting it brings it back as a group", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  m.cut();
  assert.equal(m.objects.some((o) => o.id === a), false);
  m.paste();
  assert.equal(m.selectedGroup?.length, 2);
});

// ---- timing and animation for everything chosen

test("timing set once applies to every selected object, as one undo step", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  const r = m.setTimingForSelected({ start: 2000 });
  assert.equal(r.ok, true);
  assert.match(r.message, /^Timing set on 2 objects: Appears 2 seconds after the slide opens, then stays\.$/);
  assert.equal(get(m, a).timing.start, 2000);
  assert.equal(get(m, b).timing.start, 2000);
  assert.equal(get(m, c).timing.start, 0, "an object that is not selected is left alone");
  m.undo();
  assert.equal(get(m, a).timing.start, 0);
  assert.equal(get(m, b).timing.start, 0, "one undo puts both back");
});

test("timing that none of the objects can take changes nothing and says why", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  const none = m.setTimingForSelected({ appear: "narration" });
  assert.equal(none.ok, false, "neither has narration to follow");
  assert.match(none.message, /narration first/);
  assert.equal(get(m, a).timing.appear, "time", "nothing changed");
  assert.equal(get(m, b).timing.appear, "time");
});

test("timing that only some of the objects can take is applied to those, and the message names the rest", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  // Give only the first something to follow.
  m.selectObject(a);
  m.setNarrationScript(a, "Something to say.");
  pick(m, [a, b]);
  const r = m.setTimingForSelected({ appear: "narration" });
  assert.equal(r.ok, true);
  assert.match(r.message, /1 object was left as it was: Write this object's narration first/);
  assert.equal(get(m, a).timing.appear, "narration");
  assert.equal(get(m, b).timing.appear, "time");
});

test("an effect set once applies to every selected object, as one undo step", () => {
  const m = open();
  const [a, b] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60]) as [string, string];
  pick(m, [a, b]);
  m.group();
  const r = m.setAnimationForSelected("enter", { effect: "fade" });
  assert.equal(r.ok, true);
  assert.match(r.message, /^Animation set on 2 objects: Arrives: fade in/);
  assert.equal(get(m, a).animation.enter.effect, "fade");
  assert.equal(get(m, b).animation.enter.effect, "fade");
  m.undo();
  assert.equal(get(m, a).animation.enter.effect, "none");
  assert.equal(get(m, b).animation.enter.effect, "none");
  assert.deepEqual(m.setAnimationForSelected("enter", { duration: 5000 }).ok, false, "a duration the format does not allow is refused");
});

// ---- what is saved

test("a group is saved as the same group tag on each member and nothing else", () => {
  const m = open();
  const [a, b, c] = shapes(m, [100, 100, 100, 60], [300, 100, 100, 60], [600, 300, 100, 60]) as [string, string, string];
  pick(m, [a, b]);
  m.group();
  const saved = JSON.parse(JSON.stringify(m.slide)) as { baseLayer: { objects: OSObject[] } };
  const byId = new Map(saved.baseLayer.objects.map((o) => [o.id, o]));
  assert.ok(byId.get(a)!.group);
  assert.equal(byId.get(a)!.group, byId.get(b)!.group);
  assert.equal("group" in byId.get(c)!, false);
});
