// Question banks and the learner's random choices. A bank is a run of slides of which each learner is shown some, picked at random, and
// perhaps in a mixed order, so two learners (or two tries) do not get the same questions. The picking is done once, when the learner
// begins, and is kept with their progress, so coming back gives the same slides. Everything here is plain data in, plain data out, and
// the same seed always gives the same result, so every rule can be tested.

import type { Bank } from "./types.ts";

/** Which slides each bank showed this learner, by bank id, in the order they are shown. */
export type Draws = Record<string, string[]>;

/** The most likely way to get a number that is hard to guess, and never 0 (0 means no seed was kept). */
export function newSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  const n = c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0]! : Math.floor(Math.random() * 4294967296);
  return n === 0 ? 1 : n;
}

/** A generator of numbers from 0 up to but not including 1 that gives the same numbers for the same seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The slides a bank holds that are in the course, in course order. */
function membersOf(bank: Bank, courseOrder: readonly string[]): string[] {
  const own = new Set(bank.slides);
  return courseOrder.filter((id) => own.has(id));
}

/**
 * Pick the slides every bank will show. `courseOrder` is the slide ids as the author ordered them. A bank shows `draw` of its slides (all of
 * them, if it has fewer), in the author's order unless it mixes them.
 */
export function drawBanks(banks: readonly Bank[], courseOrder: readonly string[], seed: number): Draws {
  const rand = seededRandom(seed);
  const draws: Draws = {};
  for (const bank of banks) {
    const members = membersOf(bank, courseOrder);
    const pool = [...members];
    const n = Math.min(Math.max(1, Math.floor(bank.draw)), pool.length);
    // Take n at random: a partial shuffle, which gives every slide the same chance.
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rand() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const picked = pool.slice(0, n);
    draws[bank.id] = bank.shuffle ? picked : members.filter((id) => picked.includes(id));
  }
  return draws;
}

/** Are these draws still right for these banks and this course: each bank drawn, from its own slides that exist, none twice, the right number? */
export function drawsFit(banks: readonly Bank[], draws: unknown, courseOrder: readonly string[]): draws is Draws {
  if (draws === null || typeof draws !== "object") return false;
  const given = draws as Record<string, unknown>;
  const known = new Set(courseOrder);
  for (const bank of banks) {
    const list = given[bank.id];
    if (!Array.isArray(list) || !list.every((id) => typeof id === "string")) return false;
    const members = membersOf(bank, courseOrder);
    const want = Math.min(Math.max(1, Math.floor(bank.draw)), members.length);
    if (list.length !== want || new Set(list).size !== list.length) return false;
    if (!list.every((id: string) => known.has(id) && bank.slides.includes(id))) return false;
  }
  return Object.keys(given).every((id) => banks.some((b) => b.id === id));
}

/**
 * The slides the learner is shown: the slides that are in no bank stay where they are, and the place of a bank's first slide
 * is taken by the slides drawn from it, in the order drawn. The rest of the bank's slides are not shown.
 */
export function applyDraws<T extends { id: string }>(slides: readonly T[], banks: readonly Bank[], draws: Draws): T[] {
  const bankOf = new Map<string, Bank>();
  for (const bank of banks) for (const id of bank.slides) if (!bankOf.has(id)) bankOf.set(id, bank);
  const byId = new Map(slides.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: T[] = [];
  for (const slide of slides) {
    const bank = bankOf.get(slide.id);
    if (!bank) {
      out.push(slide);
      continue;
    }
    if (done.has(bank.id)) continue;
    done.add(bank.id);
    for (const id of draws[bank.id] ?? []) {
      const hit = byId.get(id);
      if (hit) out.push(hit);
    }
  }
  return out;
}
