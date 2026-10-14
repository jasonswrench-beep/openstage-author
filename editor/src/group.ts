// Grouping: objects the author has tied together so they are chosen, moved, copied, deleted and lined up as one.
//
// A group is only a tag. Each member carries the same `group` id, the group is flat (a group cannot hold a group), and it lives on one
// layer. The published course ignores it, so a group costs a learner nothing. This file is the arithmetic and the bookkeeping, with no
// screen and no project in it, so all of it can be tested directly. The model applies the results.

import type { OSObject } from "../../player/src/types.ts";
import { bounds, type Box } from "./align.ts";

/** The members of each group on a layer, by tag, in the order the objects are given. */
export function groupsOf(objects: OSObject[]): Map<string, OSObject[]> {
  const out = new Map<string, OSObject[]>();
  for (const o of objects) {
    if (!o.group) continue;
    const list = out.get(o.group);
    if (list) list.push(o); else out.set(o.group, [o]);
  }
  return out;
}

/** These ids, and everyone who shares a group with one of them. */
export function expandGroups(objects: OSObject[], ids: Iterable<string>): string[] {
  const want = new Set(ids);
  const tags = new Set<string>();
  for (const o of objects) if (want.has(o.id) && o.group) tags.add(o.group);
  return objects.filter((o) => want.has(o.id) || (o.group !== undefined && tags.has(o.group))).map((o) => o.id);
}

/** The selected objects that are, exactly, one whole group: all of its members and nothing else. Null if they are not. */
export function wholeGroup(objects: OSObject[], selected: OSObject[]): OSObject[] | null {
  const tag = selected[0]?.group;
  if (!tag || selected.some((o) => o.group !== tag)) return null;
  const members = objects.filter((o) => o.group === tag);
  return members.length === selected.length && members.length >= 2 ? members : null;
}

/**
 * The selection as the things the author moves. A group whose members are all selected is one thing, and every other selected object is
 * its own. An object chosen alone out of a group (from the Objects list) is its own, because choosing it that way is asking for just it.
 */
export function unitsOf(objects: OSObject[], selected: OSObject[]): OSObject[][] {
  const chosen = new Set(selected.map((o) => o.id));
  const whole = new Set<string>();
  for (const [tag, members] of groupsOf(objects)) if (members.length >= 2 && members.every((m) => chosen.has(m.id))) whole.add(tag);
  const units: OSObject[][] = [];
  const at = new Map<string, OSObject[]>();
  for (const o of selected) {
    if (o.group && whole.has(o.group)) {
      const unit = at.get(o.group);
      if (unit) unit.push(o);
      else {
        const made = [o];
        at.set(o.group, made);
        units.push(made);
      }
    } else {
      units.push([o]);
    }
  }
  return units;
}

/** The tags that are left holding fewer than two objects. A group of one groups nothing, so these are cleared. */
export function loneGroups(objects: OSObject[]): string[] {
  return [...groupsOf(objects)].filter(([, members]) => members.length < 2).map(([tag]) => tag);
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Scale boxes as one: whatever fills `from` is stretched to fill `to`, so each box keeps its place and size relative to the whole. A box
 * never shrinks below `min` across either way. Boxes are scaled by the boxes they have, not turned, and text is not made bigger or smaller.
 */
export function scaleBoxes(boxes: Box[], from: Box, to: Box, min = 1): Box[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return boxes.map((b) => ({
    x: round(to.x + (b.x - from.x) * sx),
    y: round(to.y + (b.y - from.y) * sy),
    width: Math.max(min, round(b.width * sx)),
    height: Math.max(min, round(b.height * sy)),
  }));
}

/** The box a group fills. */
export function groupBox(members: OSObject[]): Box {
  return bounds(members.map((o) => o.geometry));
}
