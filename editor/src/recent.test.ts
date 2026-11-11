// The list of projects opened lately, for the welcome page: what is kept, in what order, and what the cards say. The page itself was
// driven in the browser (docs/handoff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecent, findRecent, openedText, parseRecent, RECENT_MAX, recentDetails, recentTitle, removeRecent, sameFolder, slidesText, type RecentProject } from "./recent.ts";
import { parseSettings, serializeSettings } from "./stock.ts";

const p = (dir: string, title = "A course", slides = 3, opened = "2026-11-10T09:00:00.000Z"): RecentProject => ({ dir, title, slides, opened });

test("the same folder however it is written: case, slashes, a slash at the end", () => {
  assert.ok(sameFolder("D:\\Courses\\Safety", "d:/courses/safety/"));
  assert.ok(sameFolder("D:\\Courses\\Safety\\", "D:\\Courses\\Safety"));
  assert.ok(!sameFolder("D:\\Courses\\Safety", "D:\\Courses\\Safety two"));
});

test("an opened project goes to the top, once, and the list keeps at most eight", () => {
  let list: RecentProject[] = [];
  for (let i = 1; i <= 10; i++) list = addRecent(list, p(`D:\\c${i}`, `Course ${i}`));
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0]!.title, "Course 10");
  assert.equal(list[7]!.title, "Course 3");
  list = addRecent(list, p("d:/C5/", "Course 5 again"));
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0]!.title, "Course 5 again");
  assert.equal(list.filter((x) => sameFolder(x.dir, "D:\\c5")).length, 1, "the older entry for the same folder is gone");
});

test("taking one off, and finding one", () => {
  const list = [p("D:\\a", "A"), p("D:\\b", "B"), p("D:\\c", "C")];
  assert.deepEqual(removeRecent(list, "d:/B").map((x) => x.title), ["A", "C"]);
  assert.equal(findRecent(list, "D:\\c\\")?.title, "C");
  assert.equal(findRecent(list, "D:\\z"), undefined);
});

test("the list from the settings file keeps only entries that make sense", () => {
  const list = parseRecent([
    p("D:\\a", "A", 6),
    { dir: "", title: "No folder" },
    "not an entry",
    { dir: "D:\\b", title: 7, slides: "many", opened: "not a date" },
    p("d:/a/", "A twice"),
    null,
  ]);
  assert.deepEqual(list, [p("D:\\a", "A", 6), { dir: "D:\\b", title: "", slides: 0, opened: "" }]);
  assert.deepEqual(parseRecent("nothing"), []);
  assert.equal(parseRecent(Array.from({ length: 12 }, (_, i) => p(`D:\\c${i}`))).length, RECENT_MAX);
});

test("when it was opened, by the calendar: today, yesterday, days ago in the week, then the date", () => {
  const now = new Date(2026, 10, 10, 9, 0); // 10 November 2026, 9 in the morning
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
  assert.equal(openedText(at(2026, 10, 10, 1), now), "Opened today");
  assert.equal(openedText(at(2026, 10, 9, 23), now), "Opened yesterday", "late last night is yesterday, not today");
  assert.equal(openedText(at(2026, 10, 7), now), "Opened 3 days ago");
  assert.equal(openedText(at(2026, 10, 4), now), "Opened 6 days ago");
  assert.equal(openedText(at(2026, 10, 3), now), "Opened November 3, 2026");
  assert.equal(openedText(at(2026, 10, 11), now), "Opened today", "a clock that has gone back does not say a date in the future");
  assert.equal(openedText("", now), "");
  assert.equal(openedText("not a date", now), "");
});

test("what a card says", () => {
  const now = new Date(2026, 10, 10, 9, 0);
  assert.equal(slidesText(1), "1 slide");
  assert.equal(slidesText(24), "24 slides");
  assert.equal(recentDetails(p("D:\\a", "A", 24, new Date(2026, 10, 9, 15).toISOString()), now), "24 slides, opened yesterday");
  assert.equal(recentDetails(p("D:\\a", "A", 1, ""), now), "1 slide");
  assert.equal(recentTitle(p("D:\\Courses\\Safety first\\", "")), "Safety first", "no title: the folder's name");
  assert.equal(recentTitle(p("D:\\Courses\\Safety", "Safety first: the lab")), "Safety first: the lab");
});

test("the settings file keeps the list and the choice not to keep one, and settings without them do not gain them", () => {
  const before = parseSettings("{}");
  assert.equal(before.recent, undefined);
  assert.equal(before.keepRecent, undefined);
  assert.ok(!serializeSettings(before).includes("recent"));
  const saved = serializeSettings({ ...before, recent: [p("D:\\a", "A", 6)], keepRecent: false });
  const again = parseSettings(saved);
  assert.deepEqual(again.recent, [p("D:\\a", "A", 6)]);
  assert.equal(again.keepRecent, false);
  // Writing other settings (a key, the publish folder) keeps the list, because every writer reads the file first.
  const other = parseSettings(serializeSettings({ ...again, publishFolder: "D:\\out" }));
  assert.deepEqual(other.recent, [p("D:\\a", "A", 6)]);
  assert.equal(parseSettings(JSON.stringify({ keepRecent: true })).keepRecent, undefined, "only false is kept: absent means on");
});
