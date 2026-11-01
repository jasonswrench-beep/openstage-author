// The tools, run through the real protocol layer against a folder of their own: what each does, what it refuses, and what is on the disk afterwards.
// The ones that run the program's other tools (the problem check, the publisher, translation) need Python, so they run only when OPENSTAGE_PYTHON
// is set, like the other tests that need it.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Jail } from "../src/files.ts";
import { McpServer } from "../src/protocol.ts";
import { Session } from "../src/session.ts";
import { allTools } from "../src/tools/index.ts";
import { REPO } from "./client.ts";
import { objectNamed, png, read, readSlide, started, world } from "./world.ts";

const havePython = Boolean(process.env["OPENSTAGE_PYTHON"]);

test("a project is made and opened, with its files on disk, and listed", async () => {
  const w = await started();
  try {
    assert.deepEqual(readdirSync(path.join(w.folder, "Course.osproj")).sort(), ["assets", "project.json", "slides", "theme.json"]);
    const project = JSON.parse(read(w.folder, "Course", "project.json"));
    assert.deepEqual([project.meta.title, project.meta.author, project.meta.language], ["Learning to listen", "Jo", "en-GB"]);
    const listed = await w.call("list_projects");
    assert.deepEqual(listed.data, [{ name: "Course", title: "Learning to listen", language: "en-GB", slides: 1 }]);
    const course = await w.call("get_course");
    assert.equal(course.data.slides.length, 1);
    assert.equal(course.data.slides[0].name, "Title slide");
  } finally {
    w.done();
  }
});

test("a project that cannot be made says why, and makes nothing", async () => {
  const w = await started();
  try {
    assert.match((await w.call("create_project", { name: "Course", title: "Again" })).text, /already something called Course\.osproj/);
    assert.match((await w.call("create_project", { name: "../escape", title: "x" })).text, /not a name a project can have/);
    assert.match((await w.call("create_project", { name: "Second", title: "x", language: "english" })).text, /not a language code/);
    assert.match((await w.call("create_project", { name: "Third", title: "  " })).text, /title/i);
    assert.deepEqual(readdirSync(w.folder), ["Course.osproj"]);
  } finally {
    w.done();
  }
});

test("without a project open, the tools that need one say to open one", async () => {
  const w = world();
  try {
    for (const [name, args] of [["get_course", {}], ["get_slide", { slide: 1 }], ["add_slide", {}], ["check_course", {}], ["undo", {}]] as const) {
      const r = await w.call(name, args);
      assert.equal(r.ok, false, name);
      assert.match(r.text, /No project is open.*open_project.*create_project/, name);
    }
    assert.match((await w.call("open_project", { name: "Nothing" })).text, /no project called Nothing.*list_projects/);
  } finally {
    w.done();
  }
});

test("a project made by the editor is opened and read, and the example slides are all there", async () => {
  const w = world();
  try {
    cpSync(path.join(REPO, "examples", "minimal.osproj"), path.join(w.folder, "Minimal.osproj"), { recursive: true });
    const opened = await w.call("open_project", { name: "Minimal" });
    assert.ok(opened.ok, opened.text);
    const course = await w.call("get_course");
    assert.equal(course.data.slides.length, 2);
    assert.ok(course.data.narrations >= 1);
    const slide = await w.call("get_slide", { slide: 1 });
    assert.ok(slide.data.layers[0].objects.length > 0);
  } finally {
    w.done();
  }
});

test("a slide is found by number (as a number or as text), id or name, and an unknown one says what there is", async () => {
  const w = await started();
  try {
    const bySomething = [1, "1", "slide-001", "Title slide", "title SLIDE"];
    for (const which of bySomething) assert.equal((await w.call("get_slide", { slide: which })).data.id, "slide-001", String(which));
    assert.match((await w.call("get_slide", { slide: 5 })).text, /no slide "5".*1 slide, numbered 1 to 1/);
    assert.match((await w.call("get_slide", { slide: "Nothing" })).text, /no slide "Nothing"/);
    await w.call("add_slide", { name: "Same" });
    await w.call("add_slide", { name: "Same" });
    assert.match((await w.call("get_slide", { slide: "Same" })).text, /More than one slide is called "Same"/);
  } finally {
    w.done();
  }
});

test("every layout makes a slide, each is saved, and the answer lists the objects to fill in", async () => {
  const w = await started();
  try {
    const layouts = (await w.call("list_layouts")).data as { id: string }[];
    assert.ok(layouts.length >= 10);
    for (const l of layouts) {
      const r = await w.call("add_slide", { layout: l.id });
      assert.ok(r.ok, `${l.id}: ${r.text}`);
      assert.ok(Array.isArray(r.data.objects), l.id);
    }
    assert.equal((await w.call("get_course")).data.slides.length, layouts.length + 1);
    assert.equal(readdirSync(path.join(w.folder, "Course.osproj", "slides")).length, layouts.length + 1);
    assert.match((await w.call("add_slide", { layout: "no-such-layout" })).text, /There is no layout "no-such-layout"\. The layouts are:/);
  } finally {
    w.done();
  }
});

test("a new slide goes after the one named, or at the end", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { name: "Second" });
    await w.call("add_slide", { name: "Third" });
    await w.call("add_slide", { name: "Squeezed in", after: 1 });
    await w.call("add_slide", { name: "After Second", after: "Second" });
    const names = (await w.call("get_course")).data.slides.map((s: any) => s.name);
    assert.deepEqual(names, ["Title slide", "Squeezed in", "Second", "After Second", "Third"]);
  } finally {
    w.done();
  }
});

test("the words of a text are set, as a paragraph or a heading, and its alt text follows them, saved to disk", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { layout: "content", name: "Body" });
    const slide = await w.call("get_slide", { slide: "Body" });
    const title = objectNamed(slide.data, "Title");
    const r = await w.call("set_text", { object: title.id, text: "Why we listen & learn", block: "h2" });
    assert.ok(r.ok, r.text);
    const saved = readSlide(w.folder, "Course", 2);
    const written = saved.baseLayer.objects.find((o: any) => o.id === title.id);
    assert.equal(written.content.html, "<h2>Why we listen &amp; learn</h2>");
    assert.equal(written.accessibility.altText, "Why we listen & learn");
    // Changing only the words keeps the heading level.
    await w.call("set_text", { object: title.id, text: "Listening well" });
    assert.equal(readSlide(w.folder, "Course", 2).baseLayer.objects.find((o: any) => o.id === title.id).content.html, "<h2>Listening well</h2>");
    assert.match((await w.call("set_text", { object: title.id, text: "Listening well" })).text, /not changed/);
    assert.match((await w.call("set_text", { object: "obj-9999", text: "x" })).text, /no object obj-9999/);
    assert.ok(!(await w.call("set_text", { object: title.id, text: "x", block: "h9" })).ok);
  } finally {
    w.done();
  }
});

test("a list is a real list, with its entries escaped, and only a text can have one", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { layout: "content" });
    const body = objectNamed((await w.call("get_slide", { slide: 2 })).data, "Content");
    const r = await w.call("set_list", { object: body.id, items: ["First <b>one</b>", "Second & third"], numbered: true });
    assert.ok(r.ok, r.text);
    assert.equal(readSlide(w.folder, "Course", 2).baseLayer.objects.find((o: any) => o.id === body.id).content.html, "<ol><li>First &lt;b&gt;one&lt;/b&gt;</li><li>Second &amp; third</li></ol>");
    const shown = objectNamed((await w.call("get_slide", { slide: 2 })).data, "Content");
    assert.equal(shown.text, "First <b>one</b>\nSecond & third");
    const shape = await w.call("add_object", { slide: 2, kind: "shape", decorative: true });
    assert.match((await w.call("set_list", { object: shape.data.id, items: ["x"] })).text, /A list goes in a text object/);
  } finally {
    w.done();
  }
});

test("objects are added with their words, place and name, and a text's first words are its alt text", async () => {
  const w = await started();
  try {
    const t = await w.call("add_object", { slide: 1, kind: "text", text: "Hello there\nsecond line", block: "h3", x: 100, y: 400, width: 500, height: 80, name: "Greeting" });
    assert.ok(t.ok, t.text);
    assert.deepEqual([t.data.name, t.data.box, t.data.text, t.data.altText], ["Greeting", [100, 400, 500, 80], "Hello there\nsecond line", "Hello there"]);
    const b = await w.call("add_object", { slide: 1, kind: "button", text: "Begin" });
    assert.equal(b.data.text, "Begin");
    const sh = await w.call("add_object", { slide: 1, kind: "shape", shape: "ellipse", altText: "A round badge" });
    assert.deepEqual([sh.data.shape, sh.data.altText], ["ellipse", "A round badge"]);
    const deco = await w.call("add_object", { slide: 1, kind: "shape", decorative: true });
    assert.deepEqual([deco.data.decorative, deco.data.altText], [true, ""]);
    assert.match((await w.call("add_object", { slide: 1, kind: "shape", text: "words" })).text, /no words to set here/);
    assert.ok(!(await w.call("add_object", { slide: 1, kind: "video" })).ok);
    const onDisk = readSlide(w.folder, "Course", 1).baseLayer.objects;
    assert.equal(onDisk.find((o: any) => o.name === "Greeting").content.html, "<h3>Hello there<br>second line</h3>");
    assert.equal(onDisk.find((o: any) => o.id === b.data.id).content.label, "Begin");
  } finally {
    w.done();
  }
});

test("an object's name, alt text and place are changed, and a mistake changes nothing", async () => {
  const w = await started();
  try {
    const sh = (await w.call("add_object", { slide: 1, kind: "shape", altText: "A box" })).data;
    const r = await w.call("set_object", { object: sh.id, name: "Frame", altText: "A frame round the title", x: 10, y: 20, width: 300, height: 150 });
    assert.ok(r.ok, r.text);
    const now = objectNamed((await w.call("get_slide", { slide: 1 })).data, "Frame");
    assert.deepEqual([now.altText, now.box], ["A frame round the title", [10, 20, 300, 150]]);
    assert.match((await w.call("set_object", { object: sh.id, decorative: true, altText: "x" })).text, /not both/);
    assert.match((await w.call("set_object", { object: sh.id })).text, /Nothing was asked for/);
    assert.match((await w.call("set_object", { object: sh.id, width: -5 })).text, /at least 0/);
    const deco = await w.call("set_object", { object: sh.id, decorative: true });
    assert.ok(deco.ok);
    const after = objectNamed((await w.call("get_slide", { slide: 1 })).data, "Frame");
    assert.deepEqual([after.decorative, after.altText], [true, ""]);
  } finally {
    w.done();
  }
});

test("deleting asks for confirmation, and undo brings the object back", async () => {
  const w = await started();
  try {
    const sh = (await w.call("add_object", { slide: 1, kind: "shape", decorative: true })).data;
    const before = (await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length;
    const no = await w.call("delete_object", { object: sh.id, confirm: false });
    assert.match(no.text, /confirm: true/);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before);
    assert.ok((await w.call("delete_object", { object: sh.id, confirm: true })).ok);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before - 1);
    assert.match((await w.call("undo")).text, /Undone/);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before);
    assert.equal(readSlide(w.folder, "Course", 1).baseLayer.objects.length, before, "undo is saved too");
    assert.match((await w.call("redo")).text, /Redone/);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before - 1);
    assert.match((await w.call("redo")).text, /nothing to redo/);
  } finally {
    w.done();
  }
});

test("a picture inside the folder is copied into the project, sized, and asked to be described", async () => {
  const w = await started();
  try {
    mkdirSync(path.join(w.folder, "pictures"));
    writeFileSync(path.join(w.folder, "pictures", "map.png"), png(600, 300));
    const r = await w.call("add_picture", { slide: 1, file: "pictures/map.png", width: 300, x: 50, y: 60 });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /no alt text yet/);
    assert.deepEqual([r.data.picture, r.data.box], ["assets/images/map.png", [50, 60, 300, 150]]);
    assert.ok(existsSync(path.join(w.folder, "Course.osproj", "assets", "images", "map.png")));
    const described = await w.call("set_object", { object: r.data.id, altText: "A map of the campus" });
    assert.ok(described.ok);
    const second = await w.call("add_picture", { slide: 1, file: "pictures/map.png", decorative: true, height: 100 });
    assert.deepEqual([second.data.picture, second.data.box[2], second.data.box[3], second.data.decorative], ["assets/images/map-2.png", 200, 100, true]);
    assert.doesNotMatch(second.text, /no alt text yet/);
  } finally {
    w.done();
  }
});

test("a picture from outside the folder, of the wrong kind or in conflict is refused, and nothing is copied", async () => {
  const w = await started();
  try {
    writeFileSync(path.join(w.root, "outside.png"), png(10, 10));
    writeFileSync(path.join(w.folder, "notes.txt"), "x");
    writeFileSync(path.join(w.folder, "ok.png"), png(10, 10));
    assert.match((await w.call("add_picture", { slide: 1, file: "../outside.png", altText: "x" })).text, /outside the folder an assistant may use/);
    assert.match((await w.call("add_picture", { slide: 1, file: path.join(w.root, "outside.png"), altText: "x" })).text, /outside the folder/);
    assert.match((await w.call("add_picture", { slide: 1, file: "notes.txt", altText: "x" })).text, /not a kind of picture/);
    assert.match((await w.call("add_picture", { slide: 1, file: "missing.png" })).text, /There is no file missing\.png/);
    assert.match((await w.call("add_picture", { slide: 1, file: "ok.png", decorative: true, altText: "x" })).text, /not both/);
    assert.deepEqual(readdirSync(path.join(w.folder, "Course.osproj", "assets", "images")), []);
  } finally {
    w.done();
  }
});

test("slides are renamed, moved, copied and deleted, and the last one cannot be", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { name: "B" });
    await w.call("add_slide", { name: "C" });
    const names = async () => (await w.call("get_course")).data.slides.map((s: any) => s.name);
    assert.ok((await w.call("rename_slide", { slide: "B", name: "Bee" })).ok);
    assert.match((await w.call("move_slide", { slide: "C", to: 1 })).text, /now slide 1 of 3/);
    assert.deepEqual(await names(), ["C", "Title slide", "Bee"]);
    assert.ok((await w.call("move_slide", { slide: "C", to: 3 })).ok);
    assert.deepEqual(await names(), ["Title slide", "Bee", "C"]);
    assert.match((await w.call("move_slide", { slide: 1, to: 9 })).text, /only 3 slides/);
    const copy = await w.call("duplicate_slide", { slide: "Bee" });
    assert.ok(copy.ok, copy.text);
    assert.equal(copy.data.slide.number, 3);
    assert.equal((await names()).length, 4);
    assert.match((await w.call("delete_slide", { slide: 3, confirm: false })).text, /confirm: true/);
    assert.equal((await names()).length, 4);
    assert.ok((await w.call("delete_slide", { slide: 3, confirm: true })).ok);
    assert.equal((await names()).length, 3);
    assert.equal(readdirSync(path.join(w.folder, "Course.osproj", "slides")).length, 3, "the deleted slide's file is gone");
    await w.call("delete_slide", { slide: 3, confirm: true });
    await w.call("delete_slide", { slide: 2, confirm: true });
    const last = await w.call("delete_slide", { slide: 1, confirm: true });
    assert.match(last.text, /at least one slide/);
    assert.equal((await names()).length, 1);
  } finally {
    w.done();
  }
});

test("a slide's own settings: moving on by itself, hiding Back and Next, and its background", async () => {
  const w = await started();
  try {
    assert.match((await w.call("set_slide", { slide: 1, durationSeconds: 12.5 })).text, /moves on after 12\.5 seconds/);
    assert.equal(readSlide(w.folder, "Course", 1).duration, 12500);
    assert.match((await w.call("set_slide", { slide: 1, durationSeconds: null, hideNavigation: true })).text, /stays until the learner moves on, hides Back and Next/);
    const s = readSlide(w.folder, "Course", 1);
    assert.deepEqual([s.duration, s.hideNavigation], [null, true]);
    assert.ok((await w.call("set_slide", { slide: 1, background: "#1a3c6e" })).ok);
    assert.equal(readSlide(w.folder, "Course", 1).background, "#1a3c6e");
    assert.match((await w.call("set_slide", { slide: 1, background: "blue-ish" })).text, /not a background/);
    assert.ok((await w.call("set_slide", { slide: 1, background: "default" })).ok);
    assert.match((await w.call("set_slide", { slide: 1 })).text, /Nothing was asked for/);
  } finally {
    w.done();
  }
});

test("narration is written, listed with its voice and whether audio is made, changed and removed", async () => {
  const w = await started();
  try {
    const title = objectNamed((await w.call("get_slide", { slide: 1 })).data, "Title");
    const r = await w.call("set_narration", { object: title.id, script: "Welcome to the course." });
    assert.ok(r.ok, r.text);
    const listed = await w.call("get_narration");
    assert.equal(listed.data.length, 1);
    assert.deepEqual([listed.data[0].script, listed.data[0].audio, listed.data[0].speed], ["Welcome to the course.", "not made yet", 1]);
    assert.match(listed.text, /1 without audio/);
    const voices = (await w.call("list_voices")).data as { id: string }[];
    assert.ok(voices.length > 10);
    const other = voices.find((v) => v.id !== listed.data[0].voice)!.id;
    assert.ok((await w.call("set_narration", { object: title.id, voice: other, speed: 1.25 })).ok);
    const n = (await w.call("get_narration")).data[0];
    assert.deepEqual([n.voice, n.speed], [other, 1.25]);
    assert.match((await w.call("set_narration", { object: title.id, voice: "not-a-voice" })).text, /not a voice/);
    assert.match((await w.call("set_narration", { object: title.id, speed: 5 })).text, /at most 2/);
    assert.match((await w.call("set_narration", { object: title.id })).text, /Nothing was changed/);
    assert.match((await w.call("set_narration", { object: "obj-9999", script: "x" })).text, /no object obj-9999/);
    assert.ok((await w.call("set_narration", { object: title.id, script: "" })).ok);
    assert.equal((await w.call("get_narration")).data.length, 0);
    assert.match((await w.call("set_narration", { object: title.id, script: "" })).text, /no narration to remove/);
    const saved = readSlide(w.folder, "Course", 1).baseLayer.objects.find((o: any) => o.id === title.id);
    assert.equal(saved.narration, null);
  } finally {
    w.done();
  }
});

test("a narration made before is seen as made: audio in the project's cache is found by the narration's hash", async () => {
  const w = world();
  try {
    cpSync(path.join(REPO, "examples", "lms-test-lesson.osproj"), path.join(w.folder, "Lesson.osproj"), { recursive: true });
    await w.call("open_project", { name: "Lesson" });
    const listed = await w.call("get_narration");
    assert.ok(listed.data.length >= 20);
    assert.ok(listed.data.every((n: any) => n.audio === "made"), "the example's audio is all in its cache");
    assert.match(listed.text, /all with audio/);
  } finally {
    w.done();
  }
});

test("when an object appears and how it arrives are set, and a mistake is said in the editor's own words", async () => {
  const w = await started();
  try {
    const sh = (await w.call("add_object", { slide: 1, kind: "text", text: "Later" })).data;
    assert.ok((await w.call("set_timing", { object: sh.id, appear: "time", startMs: 2000, visibleForMs: 5000 })).ok);
    assert.ok((await w.call("set_animation", { object: sh.id, phase: "enter", effect: "fade", durationMs: 600 })).ok);
    const on = readSlide(w.folder, "Course", 1).baseLayer.objects.find((o: any) => o.id === sh.id);
    assert.deepEqual([on.timing.appear, on.timing.start, on.timing.visibleFor, on.animation.enter], ["time", 2000, 5000, { effect: "fade", duration: 600 }]);
    const shown = objectNamed((await w.call("get_slide", { slide: 1 })).data, sh.name);
    assert.deepEqual(shown.timing, { appear: "time", startMs: 2000, visibleForMs: 5000 });
    assert.deepEqual(shown.animation, { enter: "fade", exit: "none" });
    assert.ok((await w.call("set_timing", { object: sh.id, visibleForMs: null })).ok);
    assert.match((await w.call("set_timing", { object: sh.id })).text, /Nothing was asked for/);
    assert.ok(!(await w.call("set_timing", { object: sh.id, appear: "sometime" })).ok);
    assert.ok(!(await w.call("set_animation", { object: sh.id, phase: "enter", effect: "explode" })).ok);
    assert.match((await w.call("set_animation", { object: sh.id, phase: "enter" })).text, /Nothing was asked for/);
  } finally {
    w.done();
  }
});

test("questions become slides: one each, with their right answers, feedback and points", async () => {
  const w = await started();
  try {
    const r = await w.call("add_questions", {
      questions: [
        { type: "mc", question: "What is a channel?", answers: ["A route", "A mood", "A rule"], correct: [1], points: 5, rightFeedback: "Yes.", wrongFeedback: "No." },
        { type: "mr", question: "Which are rich channels?", answers: ["Face to face", "Video call", "Memo"], correct: [1, 2] },
        { type: "tf", question: "Email is the richest channel.", correct: [2] },
        { type: "short", question: "Name one channel.", answers: ["email", "phone"] },
      ],
      shuffleAnswers: true,
    });
    assert.ok(r.ok, r.text);
    assert.equal(r.data.length, 4);
    assert.equal((await w.call("get_course")).data.slides.length, 5);
    const first = (await w.call("get_slide", { slide: 2 })).data;
    const quiz = first.layers[0].objects.find((o: any) => o.type === "quizQuestion");
    assert.equal(quiz.question.kind, "multipleChoice");
    assert.deepEqual(quiz.question.choices, [{ label: "A route", correct: true }, { label: "A mood", correct: false }, { label: "A rule", correct: false }]);
    const tf = (await w.call("get_slide", { slide: 4 })).data.layers[0].objects.find((o: any) => o.type === "quizQuestion");
    assert.deepEqual(tf.question.choices.map((c: any) => [c.label, c.correct]), [["True", false], ["False", true]]);
    const short = (await w.call("get_slide", { slide: 5 })).data.layers[0].objects.find((o: any) => o.type === "quizQuestion");
    assert.deepEqual(short.question.accepted, ["email", "phone"]);
    assert.equal(readdirSync(path.join(w.folder, "Course.osproj", "slides")).length, 5);
  } finally {
    w.done();
  }
});

test("an essay, a choose-a-word and a shortcut question are made by the editor's own rules, with their own words and tries", async () => {
  const w = await started();
  try {
    const r = await w.call("add_questions", {
      questions: [
        { type: "essay", question: "Why does the channel matter?", minWords: 30 },
        { type: "word", question: "Which word is the route?", passage: "A message travels along a [channel] to the receiver." },
        { type: "shortcut", question: "How do you save?", shortcuts: ["ctrl + s", "Cmd+S", "CTRL+S"], points: 4 },
        { type: "essay", question: "Say anything." },
      ],
    });
    assert.ok(r.ok, r.text);
    assert.equal(r.data.length, 4);
    const quizOf = async (slide: number) => (await w.call("get_slide", { slide })).data.layers[0].objects.find((o: any) => o.type === "quizQuestion");
    const essay = await quizOf(2);
    assert.deepEqual([essay.question.kind, essay.question.minWords], ["essay", 30]);
    const word = await quizOf(3);
    assert.deepEqual([word.question.kind, word.question.passage], ["whichWord", "A message travels along a [channel] to the receiver."]);
    const keys = await quizOf(4);
    assert.deepEqual([keys.question.kind, keys.question.shortcuts], ["shortcut", ["Ctrl+S", "Meta+S"]], "written the one way, repeats dropped");
    assert.equal((await quizOf(5)).question.minWords, 20, "the editor's own starting number when none is given");
    const saved = JSON.parse(readFileSync(path.join(w.folder, "Course.osproj", "slides", "slide-002.json"), "utf-8"));
    const content = saved.baseLayer.objects.find((o: any) => o.type === "quizQuestion").content;
    assert.deepEqual([content.scoring, content.minWords], [{ points: 10, attemptsAllowed: 1 }, 30], "an essay has one try");
    assert.match(JSON.stringify(saved.layers), /Thank you\. Your answer has been kept\./, "its feedback does not talk about a right or wrong answer");
    const kept = JSON.parse(readFileSync(path.join(w.folder, "Course.osproj", "slides", "slide-004.json"), "utf-8"));
    assert.deepEqual(kept.baseLayer.objects.find((o: any) => o.type === "quizQuestion").content.scoring, { points: 4, attemptsAllowed: 2 });
  } finally {
    w.done();
  }
});

test("the new kinds of question pass the check, and a browser-kept shortcut is a warning, not an error", { skip: !havePython }, async () => {
  const w = await started();
  try {
    await w.call("add_questions", {
      questions: [
        { type: "essay", question: "Why does the channel matter?", minWords: 30 },
        { type: "word", question: "Which word is the route?", passage: "A message travels along a [channel] to the receiver." },
        { type: "shortcut", question: "How do you close a tab?", shortcuts: ["Ctrl+W"] },
      ],
    });
    const result = await w.call("check_course");
    assert.equal(result.data.errors, 0, JSON.stringify(result.data.findings, null, 1));
    assert.ok(result.data.findings.some((f: any) => f.rule === "quiz-shortcut-reserved"), "the browser-kept shortcut is said");
  } finally {
    w.done();
  }
});

test("a passage or a shortcut that cannot be a question is refused in the editor's words, by number, and nothing is added", async () => {
  const w = await started();
  try {
    const bad = (questions: unknown[]) => w.call("add_questions", { questions });
    assert.match((await bad([{ type: "word", question: "Q?", passage: "No marks here." }])).text, /Question 1: Put square brackets round the right word/);
    assert.match((await bad([{ type: "word", question: "Q?" }])).text, /Question 1: The passage needs some words/);
    assert.match((await bad([{ type: "word", question: "Q?", passage: "A mark across [two words] here" }])).text, /Question 1: A mark holds one word/);
    assert.match((await bad([{ type: "shortcut", question: "Q?", shortcuts: ["Ctrl+Banana"] }])).text, /Question 1: "Ctrl\+Banana" is not a keyboard shortcut/);
    assert.match((await bad([{ type: "shortcut", question: "Q?" }])).text, /Question 1: Write at least one shortcut that is right/);
    assert.match((await bad([{ type: "mc", question: "Fine?", answers: ["a", "b"], correct: [1] }, { type: "word", question: "Q?", passage: "x" }])).text, /Question 2: Put square brackets/);
    const tooMany = await bad([{ type: "essay", question: "Q?", minWords: 5000 }]);
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.text, /minWords/);
    assert.equal((await w.call("get_course")).data.slides.length, 1);
  } finally {
    w.done();
  }
});

test("a question that does not make sense is refused by number, and nothing is added", async () => {
  const w = await started();
  try {
    const bad = (questions: unknown[]) => w.call("add_questions", { questions });
    assert.match((await bad([{ type: "mc", question: "Q?", answers: ["a"], correct: [1] }])).text, /Question 1 needs at least two answers/);
    assert.match((await bad([{ type: "mc", question: "Q?", answers: ["a", "b"], correct: [] }])).text, /Question 1: correct must name answers that exist, by number from 1 to 2/);
    assert.match((await bad([{ type: "mc", question: "Q?", answers: ["a", "b"], correct: [3] }])).text, /Question 1: correct must name answers that exist/);
    assert.match((await bad([{ type: "mc", question: "Q?", answers: ["a", "b"], correct: [1, 2] }])).text, /exactly one answer is right.*Use mr/);
    assert.match((await bad([{ type: "tf", question: "Q?", correct: [3] }])).text, /Question 1 is true or false/);
    assert.match((await bad([{ type: "short", question: "Q?" }])).text, /at least one accepted answer/);
    assert.match((await bad([{ type: "mc", question: "Fine?", answers: ["a", "b"], correct: [1] }, { type: "mc", question: " ", answers: ["a", "b"], correct: [1] }])).text, /Question 2 has no words/);
    assert.match((await bad([{ type: "hotspot", question: "Q?" }])).text, /type must be one of: mc, mr, tf, short, essay, word, shortcut/);
    assert.match((await bad([])).text, /at least 1 item/);
    assert.equal((await w.call("get_course")).data.slides.length, 1);
  } finally {
    w.done();
  }
});

test("what an assistant changed is there for the next one: a new session reads it from disk", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { layout: "content", name: "Kept" });
    const body = objectNamed((await w.call("get_slide", { slide: "Kept" })).data, "Content");
    await w.call("set_text", { object: body.id, text: "Remembered words" });
    await w.call("set_narration", { object: body.id, script: "Remembered speech." });
    const later = w.another();
    await later.call("open_project", { name: "Course" });
    const kept = objectNamed((await later.call("get_slide", { slide: "Kept" })).data, "Content");
    assert.deepEqual([kept.text, kept.narration], ["Remembered words", "Remembered speech."]);
  } finally {
    w.done();
  }
});

test("opening another project lets the first go, with everything already saved", async () => {
  const w = await started();
  try {
    await w.call("add_slide", { name: "In the first" });
    await w.call("create_project", { name: "Other", title: "Other" });
    assert.equal((await w.call("get_course")).data.project, "Other");
    await w.call("open_project", { name: "Course" });
    assert.equal((await w.call("get_course")).data.slides.length, 2);
    assert.deepEqual((await w.call("list_projects")).data.map((p: any) => p.name), ["Course", "Other"]);
  } finally {
    w.done();
  }
});

test("a table's cells are set by row and column from 1, and anything that is not a cell is said", async () => {
  const w = await started();
  try {
    const table = (await w.call("add_object", { slide: 1, kind: "table", altText: "Channels compared" })).data;
    assert.ok((await w.call("set_table_cell", { object: table.id, row: 1, column: 1, text: "Channel" })).ok);
    assert.match((await w.call("set_table_cell", { object: table.id, row: 99, column: 1, text: "x" })).text, /no such cell/);
    assert.match((await w.call("set_table_cell", { object: table.id, row: 0, column: 1, text: "x" })).text, /at least 1/);
    const written = readSlide(w.folder, "Course", 1).baseLayer.objects.find((o: any) => o.id === table.id);
    assert.equal(written.content.rows[0][0], "Channel");
  } finally {
    w.done();
  }
});

// ---- the tools that run the program's other tools

test("the check finds nothing wrong with a fresh course, then names a picture with no alt text as an error", { skip: !havePython }, async () => {
  const w = await started();
  try {
    const clean = await w.call("check_course");
    assert.ok(clean.ok, clean.text);
    assert.equal(clean.data.errors, 0, JSON.stringify(clean.data.findings));
    writeFileSync(path.join(w.folder, "p.png"), png(100, 100));
    const pic = (await w.call("add_picture", { slide: 1, file: "p.png" })).data;
    const bad = await w.call("check_course");
    assert.equal(bad.data.errors, 1, JSON.stringify(bad.data));
    assert.match(bad.text, /1 error.*must be fixed/);
    assert.equal(bad.data.findings[0].object, pic.id);
    assert.match(bad.data.findings[0].problem, /alt text/i);
    await w.call("set_object", { object: pic.id, altText: "A square" });
    assert.equal((await w.call("check_course")).data.errors, 0);
  } finally {
    w.done();
  }
});

test("a course built by the tools passes the check: slides of every layout, questions, narration, timing and a list", { skip: !havePython }, async () => {
  const w = await started();
  try {
    for (const l of ["content", "two-column", "section", "blank"]) await w.call("add_slide", { layout: l });
    const body = objectNamed((await w.call("get_slide", { slide: 2 })).data, "Content");
    await w.call("set_list", { object: body.id, items: ["One", "Two"] });
    await w.call("set_narration", { object: body.id, script: "Two points." });
    await w.call("set_timing", { object: body.id, appear: "time", startMs: 500 });
    await w.call("add_questions", { questions: [{ type: "mc", question: "Pick.", answers: ["a", "b"], correct: [2] }, { type: "tf", question: "True?", correct: [1] }] });
    const result = await w.call("check_course");
    assert.equal(result.data.errors, 0, JSON.stringify(result.data.findings, null, 1));
  } finally {
    w.done();
  }
});

test("publishing makes the packages in Published courses, refuses a course with errors, and never replaces a folder that is not a published course", { skip: !havePython }, async () => {
  const w = await started();
  try {
    const r = await w.call("publish_course", { targets: ["scorm12", "review"] });
    assert.ok(r.ok, r.text);
    const out = path.join(w.folder, "Published courses");
    assert.ok(existsSync(path.join(out, "Course-scorm12.zip")));
    assert.ok(existsSync(path.join(out, "Course-review.docx")));
    assert.ok(existsSync(path.join(out, "Course", "index.html")));
    assert.ok(r.data.files.every((f: string) => f.startsWith(w.folder)), "everything is inside the folder");
    // A course with an error is refused, with the error.
    writeFileSync(path.join(w.folder, "p.png"), png(100, 100));
    await w.call("add_picture", { slide: 1, file: "p.png" });
    const refused = await w.call("publish_course", { targets: ["scorm12"] });
    assert.equal(refused.ok, false);
    assert.match(refused.text, /error/i);
    // A folder of the same name that is not a published course is left alone.
    rmSync(path.join(out, "Course"), { recursive: true });
    mkdirSync(path.join(out, "Course"));
    writeFileSync(path.join(out, "Course", "mine.txt"), "mine");
    const kept = await w.call("publish_course", { targets: ["scorm12"] });
    assert.match(kept.text, /other things in it, so it was not replaced/);
    assert.equal(readFileSync(path.join(out, "Course", "mine.txt"), "utf-8"), "mine");
    assert.ok(!(await w.call("publish_course", { targets: ["pdf"] })).ok);
  } finally {
    w.done();
  }
});

test("the Word copy is made inside the folder", { skip: !havePython }, async () => {
  const w = await started();
  try {
    const r = await w.call("export_review_document");
    assert.ok(r.ok, r.text);
    assert.equal(r.data.file, path.join(w.folder, "Published courses", "Course-review.docx"));
    assert.ok(readFileSync(r.data.file).subarray(0, 2).toString() === "PK", "a Word file is a zip");
  } finally {
    w.done();
  }
});

test("a translation file is made, and the translated course comes back as a new project of its own", { skip: !havePython }, async () => {
  const w = await started();
  try {
    const made = await w.call("export_translation", { language: "fr-FR", pseudo: true });
    assert.ok(made.ok, made.text);
    assert.equal(made.data.file, path.join(w.folder, "Translations", "Course-fr-FR.xlf"));
    assert.match((await w.call("export_translation", { language: "French" })).text, /not a language code/);
    const back = await w.call("import_translation", { file: "Translations/Course-fr-FR.xlf", language: "fr-FR" });
    assert.ok(back.ok, back.text);
    assert.match(back.text, /Open it with open_project/);
    assert.ok(existsSync(path.join(w.folder, `${back.data.project}.osproj`, "project.json")));
    const names = (await w.call("list_projects")).data.map((p: any) => p.name);
    assert.ok(names.includes(back.data.project) && names.includes("Course"));
    assert.match((await w.call("import_translation", { file: "Translations/nothing.xlf" })).text, /There is no file/);
    assert.match((await w.call("import_translation", { file: "../x.xlf" })).text, /outside the folder/);
  } finally {
    w.done();
  }
});

test("making audio says how to set up an engine when there is none, and that nothing is narrated when nothing is", async () => {
  const w = await started();
  try {
    const none = await w.call("make_audio");
    assert.match(none.text, /No speech engine is set up|no narration yet/);
  } finally {
    w.done();
  }
});
