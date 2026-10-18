// Tests for what was made for a step, and for bringing a slide up to date without losing what the author changed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaptureBase, OSObject, Slide } from "../../player/src/types.ts";
import { baseFrom, baseOf, fieldHashes, FIELDS, hashObject, locate, mergeSlide, untouched } from "./stepbase.ts";
import { buildPracticeSlide, type LessonOptions } from "./steplessons.ts";
import { editStep, knowPicture, listFrom, parseLog, proposeFromLog, type Step, type StepList } from "./steps.ts";
import { buildStepSlide, type StepPicture } from "./stepslides.ts";

const PIC: StepPicture = { path: "assets/images/step-1.png", width: 1920, height: 1080 };

function options(existing: Record<string, string> = {}, roles: Record<string, string> = {}, over: Partial<LessonOptions> = {}): LessonOptions {
  let n = 0;
  return { recording: "Demo.capture#practice", total: 3, stage: { width: 1280, height: 720 }, newSlideId: () => "slide-x", newObjectId: () => `obj-n${++n}`, newTriggerId: () => `trg-n${++n}`, tries: "var-1", narration: (script) => ({ script, voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [], audioCache: null }), existing, roles, ...over };
}

function oneStep(): Step {
  const events = parseLog(['{"t":1000,"type":"click","x":960,"y":540,"button":"left"}', '{"t":1000,"type":"element","name":"Save","role":"button"}'].join("\n")).events;
  let list: StepList = listFrom([proposeFromLog(events, { take: 1 })]).list;
  list = knowPicture(list, "step-1", { width: 1920, height: 1080 });
  return list.steps[0]!;
}

const made = (step: Step, picture = PIC): { slide: Slide; roles: Record<string, string>; base: CaptureBase } => {
  const roles: Record<string, string> = {};
  const slide = buildPracticeSlide(step, 0, picture, options({}, roles));
  return { slide, roles, base: baseOf(slide, roles, { src: picture.path, width: picture.width, height: picture.height, take: 1, shotMs: 750 }) };
};

/** The slide as it would be made now from a changed step, with the ids its parts already have. */
const remade = (step: Step, base: CaptureBase, picture = PIC): { slide: Slide; roles: Record<string, string> } => {
  const roles: Record<string, string> = {};
  const existing = Object.fromEntries(Object.entries(base.objects).map(([role, o]) => [role, o.id]));
  return { slide: buildPracticeSlide(step, 0, picture, options(existing, roles, { newObjectId: () => "obj-new-never-used" })), roles };
};

const part = (slide: Slide, id: string): OSObject => locate(slide).get(id)!.obj;

test("an object's fingerprint is its design: moving it changes it, locking it, grouping it, a rule's id and another voice do not", () => {
  const { slide, roles } = made(oneStep());
  const words = part(slide, roles["words"]!);
  const h = hashObject(words);
  assert.equal(hashObject(structuredClone(words)), h);
  assert.notEqual(hashObject({ ...structuredClone(words), geometry: { ...words.geometry, x: words.geometry.x + 1 } }), h, "moved");
  assert.notEqual(hashObject({ ...structuredClone(words), content: { html: "<p>Other</p>" } }), h, "other words");
  assert.notEqual(hashObject({ ...structuredClone(words), accessibility: { ...words.accessibility, altText: "x" } }), h);
  assert.equal(hashObject({ ...structuredClone(words), locked: true, group: "g1" }), h, "the editor's own locked and group are not design");
  const voice = { ...structuredClone(words), narration: { ...(words.narration as object), voice: "am_adam", speed: 1.2 } };
  assert.equal(hashObject(voice), h, "another voice is not other words");
  assert.notEqual(hashObject({ ...structuredClone(words), narration: { ...(words.narration as object), script: "Other words." } }), h, "other words said");
  assert.notEqual(hashObject({ ...structuredClone(words), narration: null }), h, "narration taken away");
  const target = part(slide, roles["target"]!);
  const renumbered = { ...structuredClone(target), triggers: target.triggers.map((t, i) => ({ ...t, id: `trg-other-${i}` })) };
  assert.equal(hashObject(renumbered), hashObject(target), "a rule's id is bookkeeping");
  assert.notEqual(hashObject({ ...structuredClone(target), triggers: target.triggers.slice(1) }), hashObject(target), "a rule taken away");
});

test("the record of a slide has every part by role, with its id, layer and fingerprint, and is read back from the slide", () => {
  const { slide, base } = made(oneStep());
  assert.equal(base.name, slide.name);
  assert.deepEqual(base.picture, { src: "assets/images/step-1.png", width: 1920, height: 1080, take: 1, shotMs: 750 });
  assert.deepEqual(Object.keys(base.objects).sort(), ["elsewhere", "frame", "heading", "layer-hint/button-1", "layer-hint/message", "layer-hint/panel", "layer-right/button-1", "layer-right/message", "layer-right/panel", "layer-shown/button-1", "layer-shown/message", "layer-shown/panel", "picture", "showme", "target", "words"]);
  assert.equal(base.objects["words"]!.layer, "layer-base");
  assert.equal(base.objects["layer-hint/message"]!.layer, "layer-hint");
  const at = locate(slide);
  for (const o of Object.values(base.objects)) assert.deepEqual(o.fields, fieldHashes(at.get(o.id)!.obj));
  assert.deepEqual(Object.keys(base.objects["words"]!.fields), [...FIELDS], "a fingerprint for each field of the object");
  assert.equal(baseFrom(slide), null, "a slide only carries its record once it is set on the provenance");
  slide.provenance = { sourceCapture: "Demo.capture#practice", stepId: "step-1", base };
  assert.equal(baseFrom(slide), base);
  assert.equal(untouched(slide, base), true);
});

test("a slide is untouched only if every part is there and the same, nothing was added, and the slide itself has no setting of the author's", () => {
  const { slide, base } = made(oneStep());
  assert.equal(untouched(slide, base), true);
  const moved = structuredClone(slide);
  moved.baseLayer.objects[0]!.geometry.x += 5;
  assert.equal(untouched(moved, base), false);
  const extra = structuredClone(slide);
  extra.baseLayer.objects.push({ ...structuredClone(extra.baseLayer.objects[0]!), id: "obj-mine" });
  assert.equal(untouched(extra, base), false, "something added");
  const missing = structuredClone(slide);
  missing.baseLayer.objects.pop();
  assert.equal(untouched(missing, base), false, "something taken away");
  for (const set of [(s: Slide) => { s.duration = 5000; }, (s: Slide) => { s.background = "theme:bg.dark"; }, (s: Slide) => { s.name = "Mine"; }]) {
    const c = structuredClone(slide);
    set(c);
    assert.equal(untouched(c, base), false);
  }
});

test("when the step changes and the author changed nothing, the parts it touches are made again, with their ids, and the rest stays", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  const next = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { text: "Choose Save from the File menu.", box: { x: 10, y: 10, width: 20, height: 12 } }).steps[0]!;
  const fresh = remade(next, base);
  const m = mergeSlide(slide, base, fresh.slide, fresh.roles, base.picture);
  assert.deepEqual([...m.replaced].sort(), ["elsewhere", "frame", "heading", "layer-hint/message", "target", "words"].filter((r) => m.replaced.includes(r)).sort());
  assert.ok(m.replaced.includes("words") && m.replaced.includes("frame") && m.replaced.includes("target"), m.replaced.join());
  assert.deepEqual([m.added, m.removed, m.kept], [[], [], []]);
  assert.equal(m.renamed, true);
  assert.equal(m.slide.name, "Practice 1: Choose Save from the File menu.");
  const at = locate(m.slide);
  assert.equal((at.get(base.objects["words"]!.id)!.obj.content["html"] as string).includes("Choose Save from the File menu."), true, "the same object, new words");
  assert.equal(at.get(base.objects["words"]!.id)!.obj.id, base.objects["words"]!.id);
  assert.equal(at.get(base.objects["picture"]!.id)!.obj.content["src"], "assets/images/step-1.png", "the picture was not asked to change");
  assert.deepEqual(slide, structuredClone(slide), "the slide that was given is not changed");
  assert.notEqual(JSON.stringify(m.slide), JSON.stringify(slide));
  // the new record matches what is on the slide now, part by part
  const now = locate(m.slide);
  for (const [role, o] of Object.entries(m.base.objects)) assert.deepEqual(fieldHashes(now.get(o.id)!.obj), o.fields, role);
  assert.equal(untouched(m.slide, m.base), true, "and the slide is as made, so a later removal would be safe");
});

test("a part the author changed stays as they left it, even when the step would change it; what the author added is never touched", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  const mine = structuredClone(slide);
  const ownWords = locate(mine).get(base.objects["words"]!.id)!.obj;
  (ownWords.content as Record<string, unknown>)["html"] = "<p>My own wording.</p>";
  const picture = locate(mine).get(base.objects["picture"]!.id)!.obj;
  picture.accessibility = { ...picture.accessibility, altText: "My own description." };
  mine.baseLayer.objects.push({ ...structuredClone(picture), id: "obj-mine", name: "My note", type: "text", content: { html: "<p>My note</p>" } });
  const next = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { text: "Choose Save from the File menu.", reviewed: true, alt: "The File menu." }).steps[0]!;
  const fresh = remade(next, base);
  const m = mergeSlide(mine, base, fresh.slide, fresh.roles, base.picture);
  const at = locate(m.slide);
  assert.equal((at.get(base.objects["words"]!.id)!.obj.content["html"] as string), "<p>My own wording.</p>", "the author's words stay");
  assert.equal(at.get(base.objects["picture"]!.id)!.obj.accessibility.altText, "My own description.", "the author's description stays");
  assert.ok(at.has("obj-mine"), "what the author added stays");
  assert.deepEqual([...m.kept].sort(), ["picture", "words"]);
  assert.ok(m.replaced.includes("target"), "a part the author did not change is still brought up to date: its name is the step's words");
  // the record now says what the step would make, so the next time the author's part is still seen as theirs
  assert.deepEqual(m.base.objects["words"]!.fields, fieldHashes(part(fresh.slide, fresh.roles["words"]!)));
  assert.notEqual(m.base.objects["words"]!.fields["content"], fieldHashes(at.get(base.objects["words"]!.id)!.obj)["content"]);
  assert.equal(untouched(m.slide, m.base), false, "a slide with the author's work in it is never removed for them");
});

test("a change the author made to one field of a part does not stop another field being brought up to date: their description stays and the new picture is used", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  const mine = structuredClone(slide);
  const picture = locate(mine).get(base.objects["picture"]!.id)!.obj;
  picture.accessibility = { ...picture.accessibility, altText: "My own description." };
  const newPicture: StepPicture = { path: "assets/images/step-1-b.png", width: 1280, height: 720 };
  const next = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { reviewed: true, alt: "The generated description." }).steps[0]!;
  const fresh = remade(next, base, newPicture);
  const m = mergeSlide(mine, base, fresh.slide, fresh.roles, { src: newPicture.path, width: 1280, height: 720, take: 1, shotMs: 900 });
  const now = locate(m.slide).get(base.objects["picture"]!.id)!.obj;
  assert.equal(now.content["src"], "assets/images/step-1-b.png", "the new picture is used");
  assert.equal(now.accessibility.altText, "My own description.", "and their description is theirs");
  assert.deepEqual(m.replaced.includes("picture"), true);
  assert.deepEqual(m.kept.includes("picture"), true, "and they are told that the step's description was not used");
  assert.ok(now.geometry.height > 0 && Math.abs(now.geometry.width / now.geometry.height - 1280 / 720) < 0.02, "sized for the new picture, since they did not move it");
  // if they had also moved the picture, the new picture would still be used, in their place
  const moved = structuredClone(mine);
  const mp = locate(moved).get(base.objects["picture"]!.id)!.obj;
  mp.geometry = { ...mp.geometry, x: 5, y: 6 };
  const m2 = mergeSlide(moved, base, fresh.slide, fresh.roles, { src: newPicture.path, width: 1280, height: 720, take: 1, shotMs: 900 });
  const now2 = locate(m2.slide).get(base.objects["picture"]!.id)!.obj;
  assert.deepEqual([now2.content["src"], now2.geometry.x, now2.geometry.y], ["assets/images/step-1-b.png", 5, 6]);
});

test("a part the author deleted stays deleted, and the narration's voice the author chose is kept when its words change", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  const mine = structuredClone(slide);
  const showMe = base.objects["showme"]!;
  mine.baseLayer.objects = mine.baseLayer.objects.filter((o) => o.id !== showMe.id);
  const words = locate(mine).get(base.objects["words"]!.id)!.obj;
  words.narration = { ...(words.narration as object), voice: "am_adam", speed: 1.25 };
  const next = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { text: "Choose Save." }).steps[0]!;
  const fresh = remade(next, base);
  const m = mergeSlide(mine, base, fresh.slide, fresh.roles, base.picture);
  const at = locate(m.slide);
  assert.equal(at.has(showMe.id), false, "Show me stays deleted");
  const said = at.get(base.objects["words"]!.id)!.obj.narration as { script: string; voice: string; speed: number };
  assert.deepEqual([said.script, said.voice, said.speed], ["Choose Save.", "am_adam", 1.25], "new words, the author's voice");
});

test("a part that is no longer made goes if the author never changed it, and stays if they did; a part that is new is added; an emptied layer goes", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  // the step loses its place to point at: Practice falls back to a Watch slide, so most parts go and some are new
  const noPlace = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { box: null }).steps[0]!;
  const rolesNew: Record<string, string> = {};
  const existing = Object.fromEntries(Object.entries(base.objects).map(([role, o]) => [role, o.id]));
  const fresh = buildStepSlide(noPlace, 0, PIC, { ...options(existing, rolesNew), namePrefix: "Practice" });
  const mine = structuredClone(slide);
  locate(mine).get(base.objects["elsewhere"]!.id)!.obj.accessibility.altText = "My name for it";
  const m = mergeSlide(mine, base, fresh, rolesNew, base.picture);
  const at = locate(m.slide);
  assert.equal(at.has(base.objects["target"]!.id), false, "the hotspot is no longer made, and the author never changed it");
  assert.equal(at.has(base.objects["elsewhere"]!.id), true, "but this one the author renamed");
  assert.ok(m.removed.includes("target") && m.kept.includes("elsewhere"));
  assert.equal(m.slide.layers.length, 0, "the hint, show and right layers are empty, so they go");
  const walks = m.base.objects;
  assert.deepEqual(Object.keys(walks).sort(), ["heading", "picture", "words"], "the record is what the step makes now");
});

test("a part the author deleted that the step would change stays deleted, and a layer the author put something in stays", () => {
  const step = oneStep();
  const { slide, base } = made(step);
  const mine = structuredClone(slide);
  mine.baseLayer.objects = mine.baseLayer.objects.filter((o) => o.id !== base.objects["picture"]!.id);
  const hint = mine.layers.find((l) => l.id === "layer-hint")!;
  hint.objects.push({ ...structuredClone(hint.objects[0]!), id: "obj-mine-in-layer", name: "Mine" });
  const noPlace = editStep({ format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 2, steps: [step] }, "step-1", { box: null }).steps[0]!;
  const rolesNew: Record<string, string> = {};
  const existing = Object.fromEntries(Object.entries(base.objects).map(([role, o]) => [role, o.id]));
  const fresh = buildStepSlide(noPlace, 0, { ...PIC, path: "assets/images/step-9.png" }, { ...options(existing, rolesNew), namePrefix: "Practice" });
  const m = mergeSlide(mine, base, fresh, rolesNew, base.picture);
  assert.equal(locate(m.slide).has(base.objects["picture"]!.id), false, "the picture the author deleted is not brought back");
  assert.ok(m.kept.includes("picture"));
  assert.equal(m.slide.layers.map((l) => l.id).join(), "layer-hint", "the layer with the author's own object stays; the others went");
  assert.equal(m.slide.layers[0]!.objects.map((o) => o.id).join(), "obj-mine-in-layer", "and only the author's object is left in it");
});
