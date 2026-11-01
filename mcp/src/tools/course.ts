// The tools that read and change a course. Each one finds what it was asked about, asks the editor's own Model to make the change (so it
// means exactly what it means in the editor, with the same checks), saves, and says what happened in a sentence with the ids that the
// next call will need. A call that cannot be done changes nothing and says why.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SLIDE_LAYOUTS } from "../../../editor/src/factory.ts";
import { VOICES, voiceOption, SPEED_MAX, SPEED_MIN } from "../../../editor/src/narration.ts";
import { buildSimpleText, parseSimpleText, TEXT_BLOCKS, type TextBlock } from "../../../editor/src/content.ts";
import { MAX_ANSWERS, MAX_QUESTIONS, type ImportedQuestion } from "../../../editor/src/questionimport.ts";
import { audioKey, narrationFacts, objectSummary, plain, slideSummary } from "../summary.ts";
import { ToolError, type Tool } from "../protocol.ts";
import { listProjectNames, importPicture } from "../files.ts";
import type { Session } from "../session.ts";
import type { Timing } from "../../../player/src/types.ts";
import { EFFECTS } from "../../../player/src/animation.ts";
import { flag, list, number, okMessage, record, said, text, tool, whole, type Environment } from "./helpers.ts";

const LAYOUT_IDS = SLIDE_LAYOUTS.map((l) => l.id);
const ADDABLE = ["text", "button", "shape", "table", "scrollingText", "results", "certificate"] as const;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const TEXTLESS = new Set(["shape", "table", "results", "certificate"]);

/** A slide named by its number, its id or its name. A number may be given as a number. */
const slideRef = (description: string) => text(description, { minLength: 1, maxLength: 200, orNumber: true });

/** The first line of some words, short enough to be an object's alt text. */
const firstLine = (words: string): string => (plain(words).split("\n")[0] ?? "").slice(0, 120);

export function courseTools(s: Session, e: Environment): Tool[] {
  /** Save what changed, and say in a few words that it was. */
  const saved = (): string => {
    const r = s.save();
    return r.written + r.removed === 0 ? "" : " Saved.";
  };

  /** The objects a slide has now, with their ids, for the answer to a change that makes some. */
  const objectsOf = (slideId: string) => {
    const slide = s.require().model.slides.find((x) => x.id === slideId)!;
    return [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects.map((o) => objectSummary(o, l.name)));
  };

  return [
    // ---- projects
    tool("list_projects", "List the course projects in the folder you may use. Each is a folder ending in .osproj.", {}, [], false, () => {
      const names = listProjectNames(s.jail);
      const data = names.map((name) => {
        try {
          const p = JSON.parse(readFileSync(path.join(s.jail.root, `${name}.osproj`, "project.json"), "utf-8")) as { meta?: { title?: string; language?: string }; scenes?: { slides?: string[] }[] };
          return { name, title: p.meta?.title ?? "", language: p.meta?.language ?? "", slides: new Set((p.scenes ?? []).flatMap((x) => x.slides ?? [])).size };
        } catch {
          return { name, title: "", language: "", slides: 0, problem: "project.json could not be read" };
        }
      });
      return { text: names.length === 0 ? "There are no projects in the folder yet. Use create_project to make one." : `${names.length} ${names.length === 1 ? "project" : "projects"} in the folder.`, data };
    }),

    tool(
      "create_project",
      "Make a new course project in the folder and open it. It starts with one title slide. Then use add_slide, set_text and the other tools to build the course.",
      {
        name: text("The project's name, which is its folder's name: letters, numbers, spaces, dots, dashes, brackets and underscores, up to 80 characters.", { minLength: 1, maxLength: 120 }),
        title: text("The course's title, shown on its title slide.", { minLength: 1, maxLength: 200 }),
        language: text("The course's language as a code such as en-US, fr-FR or es-MX. en-US if left out.", { maxLength: 20 }),
        author: text("Who made it, shown on the title slide. Left empty if not given.", { maxLength: 200 }),
      },
      ["name", "title"],
      true,
      (a) => {
        if ((a["title"] as string).trim() === "") throw new ToolError("The course needs a title: some words that are not only spaces.");
        const language = (a["language"] as string | undefined)?.trim() || "en-US";
        if (!LANGUAGE.test(language)) throw new ToolError(`"${language}" is not a language code. Use one such as en-US, fr-FR or es-MX.`);
        const p = s.create(a["name"] as string, { title: (a["title"] as string).trim(), author: ((a["author"] as string | undefined) ?? "").trim(), language });
        return { text: `Made and opened the project ${p.name}. It has one slide, the title slide.`, data: { slides: p.model.slides.map(slideSummary) } };
      },
    ),

    tool("open_project", "Open a course project from the folder, to read or change it. Only one project is open at a time; opening another closes the first (what was changed is already saved).", { name: text("The project's name, as list_projects gives it.", { minLength: 1, maxLength: 120 }) }, ["name"], false, (a) => {
      const p = s.open(a["name"] as string);
      return { text: `Opened ${p.name}: ${p.model.project.meta.title}, ${p.model.slides.length} ${p.model.slides.length === 1 ? "slide" : "slides"}.` };
    }),

    // ---- reading
    tool("get_course", "Describe the open course: its title, language, slides in order, variables and how it counts as complete. Start here after opening a project.", {}, [], false, () => {
      const { name, model } = s.require();
      const meta = model.project.meta;
      return {
        text: `${meta.title} (${name}): ${model.slides.length} ${model.slides.length === 1 ? "slide" : "slides"}, language ${meta.language}.`,
        data: {
          project: name,
          title: meta.title,
          author: meta.author,
          language: meta.language,
          stage: model.project.stage,
          completion: model.completion === "all" ? "every slide must be seen" : "only the last slide must be seen",
          slides: model.slides.map(slideSummary),
          variables: model.variables.map((v) => ({ id: v.id, name: v.name, type: v.type, initial: v.initial })),
          narrations: model.narratedObjects().length,
        },
      };
    }),

    tool(
      "get_slide",
      "Describe one slide: every object on it, on each layer, with its id, kind, words, place and size, alt text, timing and narration. Use the ids with set_text, set_object, set_narration and the other tools.",
      { slide: slideRef("The slide's number (1 is the first), its id, or its name.") },
      ["slide"],
      false,
      (a) => {
        const { slide, index } = s.slide(a["slide"] as string);
        return {
          text: `Slide ${index + 1}, ${slide.name}: ${[slide.baseLayer, ...slide.layers].reduce((n, l) => n + l.objects.length, 0)} objects. Places are in pixels on a stage ${s.require().model.project.stage.width} wide and ${s.require().model.project.stage.height} high.`,
          data: {
            ...slideSummary(slide, index),
            background: slide.background,
            layers: [slide.baseLayer, ...slide.layers].map((l) => ({ id: l.id, name: l.name, base: l === slide.baseLayer, objects: l.objects.map((o) => objectSummary(o, l.name)) })),
          },
        };
      },
    ),

    tool("list_layouts", "List the slide layouts add_slide can make a slide from: Title Slide, Title and Content, two columns, picture layouts and more.", {}, [], false, () => ({
      text: `${SLIDE_LAYOUTS.length} layouts.`,
      data: SLIDE_LAYOUTS.map((l) => ({ id: l.id, group: l.group, label: l.label, description: l.description })),
    })),

    tool("list_voices", "List the narration voices that can be chosen, with their ids. The id goes in set_narration.", {}, [], false, () => ({
      text: `${VOICES.length} voices on this computer.`,
      data: VOICES.map((id) => voiceOption(id)),
    })),

    // ---- slides
    tool(
      "add_slide",
      "Add a slide made from a layout. It goes after the slide named in `after`, or at the end. The answer lists the new slide's objects with their ids; fill them in with set_text.",
      {
        layout: text(`The layout's id (list_layouts lists them). blank if left out. One of: ${LAYOUT_IDS.join(", ")}.`, { maxLength: 60 }),
        after: text("The slide to add it after: its number, id or name. The end of the course if left out.", { maxLength: 200, orNumber: true }),
        name: text("The slide's name. The layout's own name if left out.", { maxLength: 200 }),
      },
      [],
      true,
      (a) => {
        const { model } = s.require();
        const layout = (a["layout"] as string | undefined) ?? "blank";
        if (!LAYOUT_IDS.includes(layout)) throw new ToolError(`There is no layout "${layout}". The layouts are: ${LAYOUT_IDS.join(", ")}.`);
        if (a["after"] !== undefined) s.focusSlide(a["after"] as string);
        else model.selectSlide(model.slides[model.slides.length - 1]!.id);
        const slide = model.addSlide(layout);
        if (typeof a["name"] === "string" && a["name"].trim() !== "") model.renameSlide(slide.id, a["name"].trim());
        const index = model.slides.findIndex((x) => x.id === slide.id);
        return { text: `Added slide ${index + 1}, ${slide.name}, from the ${layout} layout.${saved()}`, data: { slide: slideSummary(slide, index), objects: objectsOf(slide.id) } };
      },
    ),

    tool("rename_slide", "Change a slide's name.", { slide: slideRef("The slide's number, id or name."), name: text("The new name.", { minLength: 1, maxLength: 200 }) }, ["slide", "name"], true, (a) => {
      const { slide } = s.slide(a["slide"] as string);
      const r = said(s.require().model.renameSlide(slide.id, (a["name"] as string).trim()), "The name was not changed. It may be empty or the same.");
      return { text: `${r.text}.${saved()}` };
    }),

    tool("move_slide", "Move a slide to another place in the course.", { slide: slideRef("The slide's number, id or name."), to: whole("Its new number: 1 puts it first.", { minimum: 1 }) }, ["slide", "to"], true, (a) => {
      const { model } = s.require();
      const { slide, index } = s.slide(a["slide"] as string);
      const to = a["to"] as number;
      if (to > model.slides.length) throw new ToolError(`There are only ${model.slides.length} slides, so it cannot go to number ${to}.`);
      for (let at = index + 1; at !== to; at += at < to ? 1 : -1) model.moveSlide(slide.id, at < to ? 1 : -1);
      return { text: `${slide.name} is now slide ${model.slides.findIndex((x) => x.id === slide.id) + 1} of ${model.slides.length}.${saved()}` };
    }),

    tool("duplicate_slide", "Copy a slide, with everything on it. The copy goes right after it.", { slide: slideRef("The slide's number, id or name.") }, ["slide"], true, (a) => {
      const { model } = s.require();
      const { slide } = s.slide(a["slide"] as string);
      const before = new Set(model.slides.map((x) => x.id));
      said(model.duplicateSlide(slide.id));
      const copy = model.slides.find((x) => !before.has(x.id));
      if (!copy) throw new ToolError("The slide was not copied.");
      const index = model.slides.indexOf(copy);
      return { text: `Copied ${slide.name} to slide ${index + 1}.${saved()}`, data: { slide: slideSummary(copy, index), objects: objectsOf(copy.id) } };
    }),

    tool("delete_slide", "Delete a slide and everything on it. It can be brought back with undo straight afterwards, but not later, so this asks for confirm: true.", { slide: slideRef("The slide's number, id or name."), confirm: flag("Must be true.") }, ["slide", "confirm"], true, (a) => {
      if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to delete the slide.");
      const { model } = s.require();
      const { slide } = s.slide(a["slide"] as string);
      const message = said(model.deleteSlide(slide.id)).text;
      // The model answers with a sentence either way; if the slide is still there, it was refused (the last slide cannot be deleted).
      if (model.slides.some((x) => x.id === slide.id)) throw new ToolError(message);
      return { text: `${message}.${saved()}` };
    }),

    tool(
      "set_slide",
      "Change a slide's own settings: how long it stays before moving on by itself, whether the course's Back and Next buttons show, and its background.",
      {
        slide: slideRef("The slide's number, id or name."),
        durationSeconds: number("Seconds before the slide moves on by itself, or null to stay until the learner moves on.", { minimum: 0.1, maximum: 3600, nullable: true }),
        hideNavigation: flag("True hides Back and Next on this slide (the way on is then a button on the slide itself)."),
        background: text("A theme background such as theme:bg.dark or theme:bg.accent, a colour as #RRGGBB, or the word default.", { maxLength: 40 }),
      },
      ["slide"],
      true,
      (a) => {
        const { model } = s.require();
        const { slide } = s.focusSlide(a["slide"] as string);
        const done: string[] = [];
        if (a["durationSeconds"] !== undefined) {
          const ms = a["durationSeconds"] === null ? null : Math.round((a["durationSeconds"] as number) * 1000);
          const r = model.setSlideDuration(ms);
          if (!r.ok) throw new ToolError(r.message);
          done.push(ms === null ? "stays until the learner moves on" : `moves on after ${(ms / 1000).toFixed(1)} seconds`);
        }
        if (typeof a["hideNavigation"] === "boolean") {
          model.setHideNavigation(slide.id, a["hideNavigation"]);
          done.push(a["hideNavigation"] ? "hides Back and Next" : "shows Back and Next");
        }
        if (typeof a["background"] === "string") {
          const value = a["background"] === "default" ? null : a["background"];
          if (model.setSlideBackground(slide.id, value) === null && slide.background !== value) throw new ToolError(`"${a["background"]}" is not a background this course has. Use default, a colour such as #1a3c6e, or one of theme:bg.dark, theme:bg.accent.`);
          done.push("background changed");
        }
        if (done.length === 0) throw new ToolError("Nothing was asked for. Give durationSeconds, hideNavigation or background.");
        return { text: `${slide.name}: ${done.join(", ")}.${saved()}` };
      },
    ),

    // ---- objects
    tool(
      "add_object",
      "Put a new object on a slide: text, a button, a shape, a table, a scrolling text box, a results box or a certificate. Give text for the ones that have words. For a picture use add_picture; for questions use add_questions.",
      {
        slide: slideRef("The slide's number, id or name."),
        layer: text("The layer to put it on, by name or id (add_layer makes one). The slide's base layer if left out.", { maxLength: 120 }),
        kind: text(`What to add: ${ADDABLE.join(", ")}.`, { enum: ADDABLE }),
        text: text("The words: a text's words, a button's label, a scrolling text's words.", { maxLength: 20000 }),
        block: text(`For a text: ${TEXT_BLOCKS.join(", ")}. p is a paragraph; h1 to h6 are headings, whose sizes follow their level. p if left out.`, { enum: TEXT_BLOCKS }),
        shape: text("For a shape: rectangle, ellipse, triangle, line, arrow and so on, as in the editor's Shape list. A rectangle if left out.", { maxLength: 40 }),
        x: number("Distance from the left, in pixels."),
        y: number("Distance from the top, in pixels."),
        width: number("Width in pixels.", { minimum: 0 }),
        height: number("Height in pixels.", { minimum: 0 }),
        name: text("A name for the object, shown in the editor's lists.", { maxLength: 120 }),
        altText: text("What a screen reader says for it (for a shape or table). A text's own first words are used if left out.", { maxLength: 500 }),
        decorative: flag("True for a shape that only decorates: a screen reader skips it. It then has no alt text."),
      },
      ["slide", "kind"],
      true,
      (a) => {
        const { model } = s.require();
        const kind = a["kind"] as (typeof ADDABLE)[number];
        const words = a["text"] as string | undefined;
        if (words !== undefined && TEXTLESS.has(kind)) throw new ToolError(`A ${kind} has no words to set here. Leave text out.`);
        s.focusLayer(a["slide"] as string, a["layer"] as string | undefined);
        const object = model.addObject(kind, a["shape"] !== undefined ? { shape: a["shape"] as string } : {});
        if (!object) throw new ToolError("The object could not be added.");
        const id = object.id;
        if (words !== undefined) {
          if (kind === "text") model.setText(id, { block: ((a["block"] as TextBlock | undefined) ?? "p"), text: words });
          else if (kind === "button") model.setLabel(id, words);
          else model.setScrollText(id, words);
        } else if (a["block"] !== undefined && kind === "text") model.setBlock(id, a["block"] as TextBlock, "New text");
        const geometry: Record<string, number> = {};
        for (const key of ["x", "y", "width", "height"] as const) if (typeof a[key] === "number") geometry[key] = a[key] as number;
        if (Object.keys(geometry).length > 0) model.setGeometry(id, geometry);
        if (typeof a["name"] === "string" && a["name"].trim() !== "") model.setName(id, a["name"].trim());
        const alt = typeof a["altText"] === "string" ? a["altText"] : words !== undefined && kind !== "button" ? firstLine(words) : undefined;
        if (a["decorative"] === true) model.setAccessibility(id, { decorative: true, altText: "" });
        else if (alt !== undefined) model.setAccessibility(id, { altText: alt });
        const now = model.slides.find((x) => [x.baseLayer, ...x.layers].some((l) => l.objects.some((o) => o.id === id)))!;
        const on = [now.baseLayer, ...now.layers].find((l) => l.objects.some((o) => o.id === id))!;
        return { text: `Added ${kind} ${id} to ${on === now.baseLayer ? "" : `the layer ${on.name} of `}slide ${model.slides.indexOf(now) + 1}.${saved()}`, data: objectSummary(on.objects.find((o) => o.id === id)!, on.name) };
      },
    ),

    tool(
      "set_text",
      "Replace the words of a text object, a button's label, or a scrolling text box. For a text you can also choose paragraph or heading level. The text's old words, and any bold or links in them, are replaced.",
      {
        object: text("The object's id, from get_slide.", { minLength: 1 }),
        text: text("The new words. A new line starts a line break inside the same paragraph.", { maxLength: 20000 }),
        block: text(`For a text: ${TEXT_BLOCKS.join(", ")}. The text's own level if left out.`, { enum: TEXT_BLOCKS }),
      },
      ["object", "text"],
      true,
      (a) => {
        const { model } = s.require();
        const { object } = s.focus(a["object"] as string);
        const words = a["text"] as string;
        const oldWords = firstLine(String(object.content["html"] ?? ""));
        let sentence: string | null;
        if (object.type === "text") {
          const current = parseSimpleText(String(object.content["html"] ?? ""));
          const block = (a["block"] as TextBlock | undefined) ?? current?.block ?? "p";
          sentence = block !== current?.block && current ? model.setBlock(object.id, block, words) : model.setText(object.id, { block, text: words });
        } else if (object.type === "button") sentence = model.setLabel(object.id, words);
        else if (object.type === "scrollingText") sentence = model.setScrollText(object.id, words);
        else throw new ToolError(`${object.name} is a ${object.type}, which has no words to set here.`);
        said(sentence, "The words were not changed. They may be the same, empty, or the object may be locked.");
        // A text's alt text follows its first words, as the layouts do, unless a person has written something else.
        if (object.type === "text" && (object.accessibility.altText === "" || object.accessibility.altText === "New text" || object.accessibility.altText === oldWords)) model.setAccessibility(object.id, { altText: firstLine(buildSimpleText({ block: "p", text: words })) });
        return { text: `Updated ${object.name}.${saved()}` };
      },
    ),

    tool(
      "set_list",
      "Make a text object a bulleted or numbered list.",
      { object: text("The id of a text object.", { minLength: 1 }), items: list("The list's entries, one each.", text("One entry.", { minLength: 1, maxLength: 1000 }), { minItems: 1, maxItems: 60 }), numbered: flag("True for a numbered list. Bulleted if left out.") },
      ["object", "items"],
      true,
      (a) => {
        const { model } = s.require();
        const { object } = s.focus(a["object"] as string);
        if (object.type !== "text") throw new ToolError(`${object.name} is a ${object.type}. A list goes in a text object.`);
        const tag = a["numbered"] === true ? "ol" : "ul";
        const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const items = (a["items"] as string[]).map((i) => `<li>${esc(i)}</li>`).join("");
        said(model.setHtml(object.id, `<${tag}>${items}</${tag}>`), "The list was not changed. It may be the same.");
        return { text: `${object.name} is now a ${a["numbered"] === true ? "numbered" : "bulleted"} list of ${(a["items"] as string[]).length} entries.${saved()}` };
      },
    ),

    tool(
      "set_object",
      "Change an object's name, alt text, place or size. A picture needs alt text (what it shows) unless it only decorates; give decorative: true for that.",
      {
        object: text("The object's id, from get_slide.", { minLength: 1 }),
        name: text("A new name.", { maxLength: 120 }),
        altText: text("What a screen reader says for it.", { maxLength: 500 }),
        decorative: flag("True: a screen reader skips it, and it has no alt text. False: it is read, and needs alt text."),
        x: number("Distance from the left, in pixels."),
        y: number("Distance from the top, in pixels."),
        width: number("Width in pixels.", { minimum: 0 }),
        height: number("Height in pixels.", { minimum: 0 }),
      },
      ["object"],
      true,
      (a) => {
        const { model } = s.require();
        const { object } = s.focus(a["object"] as string);
        const done: string[] = [];
        if (typeof a["name"] === "string" && a["name"].trim() !== "") {
          model.setName(object.id, a["name"].trim());
          done.push("named");
        }
        const patch: Partial<typeof object.accessibility> = {};
        if (a["decorative"] === true) Object.assign(patch, { decorative: true, altText: "" });
        else {
          if (a["decorative"] === false) patch.decorative = false;
          if (typeof a["altText"] === "string") patch.altText = a["altText"];
        }
        if (a["decorative"] === true && typeof a["altText"] === "string" && a["altText"] !== "") throw new ToolError("A decorative object has no alt text. Either give alt text or say decorative: true, not both.");
        if (Object.keys(patch).length > 0) {
          model.setAccessibility(object.id, patch);
          done.push("alt text");
        }
        const geometry: Record<string, number> = {};
        for (const key of ["x", "y", "width", "height"] as const) if (typeof a[key] === "number") geometry[key] = a[key] as number;
        if (Object.keys(geometry).length > 0) {
          if (model.setGeometry(object.id, geometry) === null) throw new ToolError("The place or size was not changed. It may be the same, negative, or the object may be locked.");
          done.push("place or size");
        }
        if (done.length === 0) throw new ToolError("Nothing was asked for. Give name, altText, decorative, x, y, width or height.");
        return { text: `Updated ${object.name} (${done.join(", ")}).${saved()}` };
      },
    ),

    tool("delete_object", "Delete an object from its slide. It can be brought back with undo straight afterwards, so this asks for confirm: true.", { object: text("The object's id.", { minLength: 1 }), confirm: flag("Must be true.") }, ["object", "confirm"], true, (a) => {
      if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to delete the object.");
      const { model } = s.require();
      s.focus(a["object"] as string);
      const r = said(model.deleteObject(a["object"] as string), "The object was not deleted. It may be locked.");
      return { text: `${r.text}.${saved()}` };
    }),

    tool(
      "add_picture",
      "Put a picture on a slide. The picture file must be inside the folder you may use (PNG, JPEG, GIF, WebP or SVG, up to 25 MB); it is copied into the project. A picture needs alt text that says what it shows, or decorative: true if it only decorates.",
      {
        slide: slideRef("The slide's number, id or name."),
        layer: text("The layer to put it on, by name or id. The slide's base layer if left out.", { maxLength: 120 }),
        file: text("The picture's path inside the folder, such as pictures/map.png.", { minLength: 1, maxLength: 400 }),
        altText: text("What the picture shows, for someone who cannot see it.", { maxLength: 500 }),
        decorative: flag("True if the picture only decorates. Then give no alt text."),
        name: text("A name for the object.", { maxLength: 120 }),
        x: number("Distance from the left, in pixels."),
        y: number("Distance from the top, in pixels."),
        width: number("Width in pixels. The picture's own proportions are kept if you give only one of width and height.", { minimum: 1 }),
        height: number("Height in pixels.", { minimum: 1 }),
      },
      ["slide", "file"],
      true,
      (a) => {
        const { model, dir } = s.require();
        if (a["decorative"] === true && typeof a["altText"] === "string" && a["altText"] !== "") throw new ToolError("A decorative picture has no alt text. Either give alt text or say decorative: true, not both.");
        const source = s.jail.resolve(a["file"] as string);
        s.focusLayer(a["slide"] as string, a["layer"] as string | undefined);
        const pic = importPicture(dir, source);
        const object = model.addObject("image", { imageSrc: pic.src, size: { w: pic.width, h: pic.height } });
        if (!object) throw new ToolError("The picture could not be added.");
        const geometry: Record<string, number> = {};
        const ratio = pic.width / pic.height;
        if (typeof a["x"] === "number") geometry["x"] = a["x"];
        if (typeof a["y"] === "number") geometry["y"] = a["y"];
        if (typeof a["width"] === "number") {
          geometry["width"] = a["width"];
          geometry["height"] = typeof a["height"] === "number" ? a["height"] : Math.round(a["width"] / ratio);
        } else if (typeof a["height"] === "number") {
          geometry["height"] = a["height"];
          geometry["width"] = Math.round(a["height"] * ratio);
        }
        if (Object.keys(geometry).length > 0) model.setGeometry(object.id, geometry);
        if (typeof a["name"] === "string" && a["name"].trim() !== "") model.setName(object.id, a["name"].trim());
        if (a["decorative"] === true) model.setAccessibility(object.id, { decorative: true, altText: "" });
        else if (typeof a["altText"] === "string") model.setAccessibility(object.id, { altText: a["altText"] });
        const slide = model.slides.find((x) => [x.baseLayer, ...x.layers].some((l) => l.objects.some((o) => o.id === object.id)))!;
        const on = [slide.baseLayer, ...slide.layers].find((l) => l.objects.some((o) => o.id === object.id))!;
        const missing = a["decorative"] !== true && (typeof a["altText"] !== "string" || a["altText"].trim() === "");
        return {
          text: `Added picture ${object.id} (${pic.src}, ${pic.width} by ${pic.height}) to ${on === slide.baseLayer ? "" : `the layer ${on.name} of `}slide ${model.slides.indexOf(slide) + 1}.${missing ? " It has no alt text yet: use set_object to say what it shows, or mark it decorative." : ""}${saved()}`,
          data: objectSummary(on.objects.find((o) => o.id === object.id)!, on.name),
        };
      },
    ),

    tool(
      "set_table_cell",
      "Set the words in one cell of a table. Rows and columns count from 1.",
      { object: text("The table's id.", { minLength: 1 }), row: whole("Row, from 1.", { minimum: 1 }), column: whole("Column, from 1.", { minimum: 1 }), text: text("The cell's words.", { maxLength: 2000 }) },
      ["object", "row", "column", "text"],
      true,
      (a) => {
        s.focus(a["object"] as string);
        const r = said(s.require().model.setTableCell(a["object"] as string, (a["row"] as number) - 1, (a["column"] as number) - 1, a["text"] as string), "The cell was not changed. It may be the same, or there is no such cell, or the object is not a table.");
        return { text: `${r.text}.${saved()}` };
      },
    ),

    // ---- narration
    tool("get_narration", "List every narration in the course in the order it plays: which object says it, the words, the voice, language and speed, and whether its audio has been made.", {}, [], false, () => {
      const { dir, model } = s.require();
      const facts = narrationFacts(model).map((f, i) => {
        const n = model.narratedObjects()[i]!.narration;
        return { ...f, audio: existsSync(path.join(dir, ".cache", "narration", `${audioKey(n)}.wav`)) ? "made" : "not made yet" };
      });
      const missing = facts.filter((f) => f.audio !== "made").length;
      return { text: `${facts.length} ${facts.length === 1 ? "narration" : "narrations"}${facts.length > 0 ? `, ${missing === 0 ? "all with audio" : `${missing} without audio (make_audio makes it)`}` : ""}.`, data: facts };
    }),

    tool(
      "set_narration",
      "Write or change what an object says aloud. The first script is read in the voice and speed of the narration before it, so a course keeps one voice. An empty script removes the narration. The audio is made later with make_audio, or when the course is published.",
      {
        object: text("The object's id (or objectId/itemId for an interaction item).", { minLength: 1 }),
        script: text("The words to say. They should read well aloud: write numbers and symbols as they are said.", { maxLength: 20000 }),
        voice: text("A voice id from list_voices.", { maxLength: 80 }),
        language: text("The script's language code, such as en-US. Only for a voice that speaks many languages.", { maxLength: 20 }),
        speed: number(`How fast, from ${SPEED_MIN} to ${SPEED_MAX}. 1 is normal.`, { minimum: SPEED_MIN, maximum: SPEED_MAX }),
      },
      ["object"],
      true,
      (a) => {
        const { model } = s.require();
        const key = a["object"] as string;
        s.focus(key.split("/")[0]!);
        const done: string[] = [];
        if (typeof a["script"] === "string") {
          const r = model.setNarrationScript(key, a["script"]);
          const same = model.narratedObjects().some((n) => n.key === key && n.narration.script === (a["script"] as string).trim());
          if (r === null && !same) throw new ToolError(a["script"].trim() === "" ? `${key} has no narration to remove.` : `There is nothing called ${key} to give narration to.`);
          if (r !== null) done.push(r.toLowerCase());
        }
        if (typeof a["voice"] === "string") {
          const r = model.setNarrationVoice(key, a["voice"]);
          if (r === null) throw new ToolError(`"${a["voice"]}" is not a voice, or the object has no narration yet, or it already uses it. list_voices lists the voices.`);
          done.push(r.toLowerCase());
        }
        if (typeof a["language"] === "string") {
          const r = model.setNarrationLang(key, a["language"]);
          if (r === null) throw new ToolError(`The language was not changed. It must be a code such as en-US, and the voice must be one that speaks many languages.`);
          done.push(r.toLowerCase());
        }
        if (typeof a["speed"] === "number") {
          const r = model.setNarrationSpeed(key, a["speed"]);
          if (!r.ok) throw new ToolError(r.message || `There is no narration on ${key}.`);
          if (r.message) done.push(r.message.toLowerCase());
        }
        if (done.length === 0) throw new ToolError("Nothing was changed. Give script, voice, language or speed (the narration may already be that way).");
        return { text: `${key}: ${done.join("; ")}.${saved()}` };
      },
    ),

    // ---- timing
    tool(
      "set_timing",
      "Say when an object appears and goes: after a delay, when its own narration starts, or when the learner presses Show next item. Times are in milliseconds from when the slide opens (or from the narration or the press).",
      {
        object: text("The object's id.", { minLength: 1 }),
        appear: text("time: after startMs. narration: when its own narration starts, plus startMs. click: when the learner shows step `step`, plus startMs.", { enum: ["time", "narration", "click"] }),
        startMs: whole("Delay in milliseconds, from 0.", { minimum: 0, maximum: 3600000 }),
        visibleForMs: whole("How long it stays before it goes again, in milliseconds. null: it stays.", { minimum: 100, maximum: 3600000, nullable: true }),
        step: whole("For appear click: which press shows it, from 1. Objects with the same step come together.", { minimum: 1, maximum: 99 }),
      },
      ["object"],
      true,
      (a) => {
        const { model } = s.require();
        s.focus(a["object"] as string);
        const patch: Partial<Timing> = {};
        if (a["appear"] !== undefined) patch.appear = a["appear"] as Timing["appear"];
        if (a["startMs"] !== undefined) patch.start = a["startMs"] as number;
        if (a["visibleForMs"] !== undefined) patch.visibleFor = a["visibleForMs"] as number | null;
        if (a["step"] !== undefined) patch.step = a["step"] as number;
        if (Object.keys(patch).length === 0) throw new ToolError("Nothing was asked for. Give appear, startMs, visibleForMs or step.");
        const r = okMessage(model.setTiming(a["object"] as string, patch));
        return { text: `${r.text}.${saved()}` };
      },
    ),

    tool(
      "set_animation",
      "Choose the effect an object has as it arrives (enter) or leaves (exit). Learners can turn effects off, and some devices ask for less motion, so they are never needed to understand a slide.",
      {
        object: text("The object's id.", { minLength: 1 }),
        phase: text("enter or exit.", { enum: ["enter", "exit"] }),
        effect: text(`One of: ${EFFECTS.join(", ")}.`, { enum: EFFECTS }),
        durationMs: whole("How long it lasts, from 100 to 2000 milliseconds.", { minimum: 100, maximum: 2000 }),
      },
      ["object", "phase"],
      true,
      (a) => {
        s.focus(a["object"] as string);
        const patch: { effect?: (typeof EFFECTS)[number]; duration?: number } = {};
        if (a["effect"] !== undefined) patch.effect = a["effect"] as (typeof EFFECTS)[number];
        if (a["durationMs"] !== undefined) patch.duration = a["durationMs"] as number;
        if (Object.keys(patch).length === 0) throw new ToolError("Nothing was asked for. Give effect or durationMs.");
        const r = okMessage(s.require().model.setAnimation(a["object"] as string, a["phase"] as "enter" | "exit", patch));
        return { text: `${r.text}.${saved()}` };
      },
    ),

    // ---- questions
    tool(
      "add_questions",
      "Make a question slide for each question, after a slide (or at the end). Each slide has the question as a heading, the question itself, and feedback for a right and a wrong answer. Question kinds: mc (one right answer), mr (several right answers), tf (true or false), short (a typed answer).",
      {
        after: text("The slide to add them after: its number, id or name. The end of the course if left out.", { maxLength: 200, orNumber: true }),
        questions: list(
          "The questions, in order.",
          record(
            "One question.",
            {
              type: text("mc, mr, tf or short.", { enum: ["mc", "mr", "tf", "short"] }),
              question: text("The question's words.", { minLength: 1, maxLength: 1000 }),
              answers: list("The answers to choose from, in order (2 to 8). For short: the answers that are accepted. Leave out for tf.", text("One answer.", { minLength: 1, maxLength: 500 }), { maxItems: MAX_ANSWERS }),
              correct: list("Which answers are right, as numbers starting at 1. mc: one number. mr: one or more. tf: 1 means True and 2 means False. short: leave out.", whole("An answer's number.", { minimum: 1, maximum: MAX_ANSWERS }), { maxItems: MAX_ANSWERS }),
              points: whole("Points for a right answer. 10 if left out.", { minimum: 0, maximum: 1000 }),
              attempts: whole("How many tries the learner has.", { minimum: 1, maximum: 10 }),
              rightFeedback: text("What a learner who is right is told.", { maxLength: 1000 }),
              wrongFeedback: text("What a learner who is wrong is told.", { maxLength: 1000 }),
            },
            ["type", "question"],
          ),
          { minItems: 1, maxItems: MAX_QUESTIONS },
        ),
        shuffleAnswers: flag("True makes each question show its answers in a different order to each learner."),
      },
      ["questions"],
      true,
      (a) => {
        const { model } = s.require();
        const raw = a["questions"] as Record<string, unknown>[];
        const questions: ImportedQuestion[] = raw.map((q, i) => {
          const n = `Question ${i + 1}`;
          const type = q["type"] as ImportedQuestion["type"];
          const words = (q["question"] as string).trim();
          if (words === "") throw new ToolError(`${n} has no words.`);
          let answers = (q["answers"] as string[] | undefined)?.map((x) => x.trim()) ?? [];
          let correct = ((q["correct"] as number[] | undefined) ?? []).map((x) => x - 1);
          if (type === "tf") {
            if (correct.length !== 1 || ![0, 1].includes(correct[0]!)) throw new ToolError(`${n} is true or false: correct must be [1] for True or [2] for False.`);
            answers = ["True", "False"];
          } else if (type === "short") {
            if (answers.length < 1) throw new ToolError(`${n} is a short answer: give at least one accepted answer.`);
            correct = [];
          } else {
            if (answers.length < 2) throw new ToolError(`${n} needs at least two answers.`);
            if (correct.length < 1 || correct.some((c) => c < 0 || c >= answers.length)) throw new ToolError(`${n}: correct must name answers that exist, by number from 1 to ${answers.length}.`);
            if (type === "mc" && correct.length !== 1) throw new ToolError(`${n} is multiple choice, so exactly one answer is right. Use mr if several are.`);
          }
          return {
            row: i + 1,
            type,
            question: words,
            answers,
            correct,
            points: typeof q["points"] === "number" ? q["points"] : null,
            attempts: typeof q["attempts"] === "number" ? q["attempts"] : null,
            category: "",
            value: null,
            rightFeedback: typeof q["rightFeedback"] === "string" ? q["rightFeedback"] : "",
            wrongFeedback: typeof q["wrongFeedback"] === "string" ? q["wrongFeedback"] : "",
          };
        });
        if (a["after"] !== undefined) s.focusSlide(a["after"] as string);
        else model.selectSlide(model.slides[model.slides.length - 1]!.id);
        const before = new Set(model.slides.map((x) => x.id));
        const message = model.addQuestionSlides(questions, { bank: null, shuffleAnswers: a["shuffleAnswers"] === true });
        const made = model.slides.filter((x) => !before.has(x.id));
        if (made.length === 0) throw new ToolError(message ?? "No question slides were made.");
        return { text: `${message ?? `Added ${made.length} question slides.`}${saved()}`, data: made.map((x) => ({ ...slideSummary(x, model.slides.indexOf(x)), objects: objectsOf(x.id) })) };
      },
    ),

    // ---- undo
    tool("undo", "Undo the last change to the open course, as the editor's Undo does. What was undone is saved.", {}, [], true, () => {
      const { model } = s.require();
      if (!model.undo()) throw new ToolError("There is nothing to undo.");
      return { text: `Undone.${saved()}` };
    }),

    tool("redo", "Redo what undo undid.", {}, [], true, () => {
      const { model } = s.require();
      if (!model.redo()) throw new ToolError("There is nothing to redo.");
      return { text: `Redone.${saved()}` };
    }),
  ];
}
