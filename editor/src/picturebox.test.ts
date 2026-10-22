// Tests for putting a picture in a grey picture box from a layout: the box is taken away, and the picture takes its place.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CreditEntry } from "../../player/src/types.ts";
import { isPictureBox, SLIDE_LAYOUTS } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A slide with a grey picture box on it, and the box. */
function withBox(): { m: Model; box: ReturnType<typeof boxOf> } {
  const m = fresh();
  const layout = SLIDE_LAYOUTS.find((l) => l.decorations.some((d) => d.name === "Picture area"))!;
  m.addSlide(layout.id);
  return { m, box: boxOf(m) };
}
const boxOf = (m: Model) => {
  const box = m.objects.find((o) => isPictureBox(o))!;
  m.selectObject(box.id);
  return box;
};
const credit = (path: string): CreditEntry => ({ path, title: "A person", kind: "image", source: { provider: "other", url: "", creator: "Someone", creatorUrl: "", licence: "Public domain", requiresCredit: false } });

test("a layout's grey picture box is known as one, and an accent bar is not", () => {
  const { m, box } = withBox();
  assert.ok(isPictureBox(box));
  assert.equal(box.name, "Picture area");
  assert.equal(box.accessibility.decorative, true);
  const accents = SLIDE_LAYOUTS.flatMap((l) => l.decorations).filter((d) => d.name === "Accent");
  assert.ok(accents.length > 0);
  assert.ok(!m.objects.some((o) => o.name === "Accent" && isPictureBox(o)));
});

test("a picture takes the box's place, as large as fits in its own proportions, and is centred", () => {
  const { m, box } = withBox();
  const g = box.geometry;
  const wide = m.fillPictureBox(box.id, { src: "assets/images/wide.png", size: { w: g.width * 2, h: g.height / 2 }, name: "A wide picture", alt: "A wide view" })!;
  assert.ok(wide, "it was put in");
  assert.ok(!m.objects.some((o) => o.id === box.id), "the grey box is gone");
  assert.equal(wide.type, "image");
  assert.equal(wide.geometry.width, g.width, "a wide picture fills the width");
  assert.ok(wide.geometry.height < g.height);
  assert.ok(Math.abs(wide.geometry.width / wide.geometry.height - (g.width * 2) / (g.height / 2)) < 0.05, "in its own proportions");
  assert.equal(wide.geometry.x, g.x);
  assert.equal(wide.geometry.y, Math.round(g.y + (g.height - wide.geometry.height) / 2), "centred up and down");
  assert.equal(wide.geometry.z, g.z, "at the box's depth");
  assert.equal(wide.name, "A wide picture");
  assert.equal(wide.accessibility.altText, "A wide view");
  assert.equal(wide.accessibility.decorative, false);
  assert.ok((wide.accessibility.tabOrder ?? 0) >= 1, "it is in the reading order");
  assert.equal(m.object?.id, wide.id, "it is the chosen object");
});

test("a tall picture fills the height of the box and is centred across", () => {
  const { m, box } = withBox();
  const g = box.geometry;
  const tall = m.fillPictureBox(box.id, { src: "assets/images/tall.png", size: { w: g.width / 3, h: g.height * 2 }, name: "Tall", alt: "A tall view" })!;
  assert.equal(tall.geometry.height, g.height);
  assert.ok(tall.geometry.width < g.width);
  assert.equal(tall.geometry.y, g.y);
  assert.equal(tall.geometry.x, Math.round(g.x + (g.width - tall.geometry.width) / 2));
});

test("a picture whose size is not known fills the box", () => {
  const { m, box } = withBox();
  const put = m.fillPictureBox(box.id, { src: "assets/images/x.png", name: "X", alt: "" })!;
  assert.deepEqual([put.geometry.x, put.geometry.y, put.geometry.width, put.geometry.height], [box.geometry.x, box.geometry.y, box.geometry.width, box.geometry.height]);
  assert.equal(put.accessibility.altText, "", "no description is made up: the author is asked for one");
});

test("a picture that is only decoration is marked so and has no alt text", () => {
  const { m, box } = withBox();
  const put = m.fillPictureBox(box.id, { src: "assets/images/x.png", name: "Border", alt: "ignored", decorative: true })!;
  assert.equal(put.accessibility.decorative, true);
  assert.equal(put.accessibility.altText, "");
  assert.equal(put.accessibility.tabOrder, 0);
});

test("the record of where a library picture came from is kept, once", () => {
  const { m, box } = withBox();
  m.fillPictureBox(box.id, { src: "assets/images/p.png", name: "P", alt: "A person", credit: credit("assets/images/p.png") });
  assert.equal(m.pathOfCredit("A person"), "assets/images/p.png");
  const again = withBox();
  again.m.fillPictureBox(again.box.id, { src: "assets/images/p.png", name: "P", alt: "A person", credit: credit("assets/images/p.png") });
  again.m.undo();
  assert.equal(again.m.pathOfCredit("A person"), null, "undo takes the record away with the picture");
});

test("one Undo puts the grey box back, and Redo fills it again", () => {
  const { m, box } = withBox();
  const put = m.fillPictureBox(box.id, { src: "assets/images/x.png", size: { w: 100, h: 100 }, name: "X", alt: "x" })!;
  m.undo();
  assert.ok(m.objects.some((o) => o.id === box.id && isPictureBox(o)), "the box is back");
  assert.ok(!m.objects.some((o) => o.id === put.id));
  m.redo();
  assert.ok(m.objects.some((o) => o.type === "image"));
  assert.ok(!m.objects.some((o) => isPictureBox(o)));
});

test("only a picture box can be filled, and only from a file inside the project", () => {
  const { m, box } = withBox();
  const other = m.objects.find((o) => !isPictureBox(o))!;
  assert.equal(m.fillPictureBox(other.id, { src: "assets/images/x.png", name: "X", alt: "" }), null);
  assert.equal(m.fillPictureBox(box.id, { src: "C:/Users/me/x.png", name: "X", alt: "" }), null);
  assert.equal(m.fillPictureBox("obj-9999", { src: "assets/images/x.png", name: "X", alt: "" }), null);
  assert.ok(m.objects.some((o) => o.id === box.id), "nothing was changed");
});
