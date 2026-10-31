import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { checkNewProject, newProjectFiles } from "./template.ts";
import { BUILT_IN_THEMES } from "./themes.ts";

const input = { title: "Intro to <Research> & Ethics", author: " Jason ", language: "en-US", today: "2026-10-10" };

function open(files = newProjectFiles(input)): Model {
  return new Model({ dir: "x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a new project has a project file, a theme and one slide", () => {
  const files = newProjectFiles(input);
  assert.deepEqual(files.map((f) => f.path), ["project.json", "theme.json", "slides/slide-001.json"]);
  const m = open(files);
  assert.equal(m.project.schemaVersion, "0.43.0");
  assert.deepEqual(m.project.completion, { slides: "all" });
  assert.deepEqual(m.project.theme, { ref: "theme.json" });
  assert.equal(m.theme.id, "classic");
  assert.equal(m.project.meta.title, "Intro to <Research> & Ethics");
  assert.equal(m.project.meta.author, "Jason");
  assert.equal(m.project.meta.created, "2026-10-10");
  assert.equal(m.project.stage.width, 1280);
  assert.equal(m.slides.length, 1);
});

test("the first slide is a Title Slide on a dark background, and it remembers that", () => {
  const slide = open().slides[0]!;
  assert.equal(slide.layout, "title");
  assert.equal(slide.background, "theme:bg.dark");
  assert.deepEqual(slide.baseLayer.objects.map((o) => o.name), ["Accent", "Title", "Subtitle"]);
});

test("its text follows the theme: light on the dark background, in the theme's fonts", () => {
  const title = open().slides[0]!.baseLayer.objects.find((o) => o.name === "Title")!;
  assert.equal(title.style["color"], "theme:color.onDark");
  assert.equal(title.style["fontFamily"], "theme:font.heading");
});

test("the title is escaped in the heading, so it cannot become markup", () => {
  const title = open().slides[0]!.baseLayer.objects.find((o) => o.name === "Title")!;
  assert.equal(title.content["html"], "<h1>Intro to &lt;Research&gt; &amp; Ethics</h1>");
  assert.equal(title.accessibility.altText, "Intro to <Research> & Ethics");
  assert.equal(title.accessibility.decorative, false);
  assert.equal(title.accessibility.tabOrder, 1);
});

test("the author's name becomes the subtitle, escaped, and a missing name leaves the prompt", () => {
  const sub = (i: typeof input) => open(newProjectFiles(i)).slides[0]!.baseLayer.objects.find((o) => o.name === "Subtitle")!;
  assert.equal(sub(input).content["html"], "<p>Jason</p>");
  assert.equal(sub({ ...input, author: "A & B" }).content["html"], "<p>A &amp; B</p>");
  assert.equal(sub({ ...input, author: "" }).content["html"], "<p>Subtitle or your name</p>");
});

test("a project can start with any built-in theme", () => {
  for (const theme of BUILT_IN_THEMES) {
    const files = newProjectFiles({ ...input, theme });
    assert.equal(open(files).theme.id, theme.id);
    assert.equal(JSON.parse(files[1]!.text).name, theme.name);
  }
});

test("files are in the project's canonical form", () => {
  for (const f of newProjectFiles(input)) {
    assert.ok(f.text.endsWith("}\n"));
    assert.equal(f.text, JSON.stringify(JSON.parse(f.text), null, 2) + "\n");
  }
});

test("details are checked before anything is created", () => {
  assert.equal(checkNewProject({ title: "A", language: "en-US" }), null);
  assert.match(checkNewProject({ title: "   ", language: "en-US" }) ?? "", /title/);
  assert.match(checkNewProject({ title: "A", language: "English" }) ?? "", /Language/);
  assert.match(checkNewProject({ title: "A", language: "" }) ?? "", /Language/);
});
