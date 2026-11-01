// The tools for what a learner explores: interactions (tabs, flip cards, accordions, timelines, a labeled picture and the rest) and branching
// scenarios. An interaction is made by the editor's own Model, item by item. A scenario is built whole from a description, because its parts point at
// one another (see scenario.ts), and put on the slide the same way the editor puts one.

import { INTERACTIONS, interactionById } from "../../../editor/src/factory.ts";
import { ITEM_LIMITS } from "../../../player/src/interactions.ts";
import type { InteractionContent, InteractionItem } from "../../../player/src/types.ts";
import { importPicture } from "../files.ts";
import { ToolError, type Tool } from "../protocol.ts";
import { buildScenario, type ScenarioSpec } from "../scenario.ts";
import type { Session } from "../session.ts";
import { flag, list, number, record, said, text, tool } from "./helpers.ts";
import { objectSummary } from "../summary.ts";

const KINDS = ["clickReveal", "accordion", "flipCards", "tabs", "steps", "carousel", "glossary", "timeline", "processCircle", "pyramidStack", "pyramidMatrix", "circleMatrix", "labeledGraphic"] as const;

const slideRef = (description: string) => text(description, { minLength: 1, maxLength: 200, orNumber: true });

const itemSpec = record(
  "One item.",
  {
    title: text("Its heading: a tab's label, a card's front, a term, a step's name.", { minLength: 1, maxLength: 200 }),
    body: text("Its words: what opens, the back of a card, a definition. A blank line starts a new paragraph.", { minLength: 1, maxLength: 5000 }),
    x: number("Only for labeledGraphic: where its marker sits across the picture, as a percentage (0 to 100).", { minimum: 0, maximum: 100 }),
    y: number("Only for labeledGraphic: where its marker sits down the picture, as a percentage (0 to 100).", { minimum: 0, maximum: 100 }),
  },
  ["title", "body"],
);

const lineSpec = record("One line of what is said.", { text: text("The words.", { minLength: 1, maxLength: 1000 }), speaker: text("A person of the cast, by name or id. Nobody if left out.", { maxLength: 80 }) }, ["text"]);

export function interactTools(s: Session): Tool[] {
  const done = (): string => {
    const r = s.save();
    return r.written + r.removed === 0 ? "" : " Saved.";
  };

  /** An interaction on the slide being worked on, found by its id, with its content. */
  const interaction = (id: string) => {
    const found = s.focus(id);
    if (found.object.type !== "interaction") throw new ToolError(`${found.object.name} is a ${found.object.type}, not an interaction.`);
    return { ...found, c: found.object.content as unknown as InteractionContent };
  };

  /** An item of an interaction: by its number (from 1), its id or its title. */
  const item = (c: InteractionContent, which: string | number): InteractionItem => {
    const asNumber = typeof which === "number" ? which : /^\d+$/.test(which) ? Number(which) : NaN;
    const hit = c.items.find((i) => i.id === which) ?? (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= c.items.length ? c.items[asNumber - 1] : undefined) ?? c.items.find((i) => i.title.toLowerCase() === String(which).trim().toLowerCase());
    if (!hit) throw new ToolError(`There is no item "${which}". The items are: ${c.items.map((i, k) => `${k + 1}. ${i.title}`).join("; ")}.`);
    return hit;
  };

  const summary = (objectId: string) => {
    const { model } = s.require();
    const slide = model.slides.find((x) => [x.baseLayer, ...x.layers].some((l) => l.objects.some((o) => o.id === objectId)))!;
    const layer = [slide.baseLayer, ...slide.layers].find((l) => l.objects.some((o) => o.id === objectId))!;
    return objectSummary(layer.objects.find((o) => o.id === objectId)!, layer.name);
  };

  return [
    tool(
      "add_interaction",
      "Put an interaction on a slide: content a learner opens, turns, steps through or explores. Give each item a title and its words. All of it is real text, keyboard operable, and read by a screen reader. Narration for the items can be made with narrate: true.",
      {
        slide: slideRef("The slide's number, id or name."),
        layer: text("The layer to put it on, by name or id. The slide's base layer if left out.", { maxLength: 120 }),
        kind: text(`${INTERACTIONS.map((i) => `${i.kind}: ${i.description}`).filter((d, k, all) => all.findIndex((x) => x.split(":")[0] === d.split(":")[0]) === k).join(" ")}`, { enum: KINDS }),
        items: list("The items, in order. The kinds take different numbers of them (timelines at least 2, process circles 3 to 8, pyramids 3 to 7).", itemSpec, { minItems: 1, maxItems: 50 }),
        orientation: text("horizontal or vertical, for the kinds that have both (click and reveal, flip cards, tabs). The usual one if left out.", { enum: ["horizontal", "vertical"] }),
        name: text("What a screen reader says for the whole group: what it is about, such as \"Four channels compared\".", { maxLength: 200 }),
        multiple: flag("For click and reveal: whether several items can be open at once."),
        guided: flag("For a labeled graphic: also step through the markers in order with Previous and Next buttons."),
        picture: text("For labeledGraphic: the picture's path inside the folder.", { maxLength: 400 }),
        pictureAlt: text("For labeledGraphic: what the whole picture shows.", { maxLength: 500 }),
        narrate: flag("True gives every item narration read from its title and words, to be made into audio later."),
        x: number("Distance from the left, in pixels."),
        y: number("Distance from the top, in pixels."),
        width: number("Width in pixels.", { minimum: 1 }),
        height: number("Height in pixels.", { minimum: 1 }),
      },
      ["slide", "kind", "items"],
      true,
      (a) => {
        const { model, dir } = s.require();
        const kind = a["kind"] as (typeof KINDS)[number];
        const items = a["items"] as { title: string; body: string; x?: number; y?: number }[];
        const limits = ITEM_LIMITS[kind];
        if (items.length < limits.min || items.length > limits.max) throw new ToolError(`A ${kind} needs ${limits.min} to ${limits.max} items and ${items.length} were given.`);
        const orientations = INTERACTIONS.filter((i) => i.kind === kind).map((i) => i.orientation);
        const orientation = (a["orientation"] as "horizontal" | "vertical" | undefined) ?? orientations[0]!;
        const choice = interactionById(`${kind}:${orientation}`);
        if (!choice) throw new ToolError(`A ${kind} comes only ${orientations.join(" or ")}, not ${orientation}.`);
        if (kind === "labeledGraphic" && (typeof a["picture"] !== "string" || typeof a["pictureAlt"] !== "string" || a["pictureAlt"].trim() === "")) throw new ToolError("A labeled graphic needs picture (a file in the folder) and pictureAlt (what the whole picture shows).");
        if (kind !== "labeledGraphic" && (a["picture"] !== undefined || a["guided"] !== undefined || items.some((i) => i.x !== undefined || i.y !== undefined))) throw new ToolError("picture, guided and markers (x and y) are only for a labeled graphic.");
        const picture = typeof a["picture"] === "string" ? s.jail.resolve(a["picture"]) : undefined;
        const made = s.attempt(() => {
          s.focusLayer(a["slide"] as string, a["layer"] as string | undefined);
          const obj = model.addInteraction(choice.id);
          if (!obj) throw new ToolError("The interaction could not be added.");
          const c = obj.content as unknown as InteractionContent;
          // The items it starts with become the ones asked for: written over, added to, or taken away.
          const starting = c.items.map((i) => i.id);
          items.forEach((it, k) => {
            let id = starting[k];
            if (id === undefined) {
              said(model.addItem(obj.id), "An item could not be added.");
              id = c.items[c.items.length - 1]!.id;
            }
            model.setItemTitle(obj.id, id, it.title.trim());
            model.setItemBody(obj.id, id, it.body);
            if (it.x !== undefined && it.y !== undefined) model.setItemPosition(obj.id, id, it.x, it.y);
          });
          for (let k = starting.length - 1; k >= items.length; k--) {
            const r = model.deleteItem(obj.id, starting[k]!);
            if (r !== null && !r.startsWith("Deleted")) throw new ToolError(r);
          }
          if (typeof a["multiple"] === "boolean") model.setInteractionMultiple(obj.id, a["multiple"]);
          if (picture !== undefined) {
            model.setGraphic(obj.id, importPicture(dir, picture).src);
            model.setGraphicAlt(obj.id, a["pictureAlt"] as string);
          }
          if (a["guided"] === true) model.setInteractionGuided(obj.id, true);
          if (typeof a["name"] === "string" && a["name"].trim() !== "") model.setAccessibility(obj.id, { altText: a["name"].trim() });
          const geometry: Record<string, number> = {};
          for (const key of ["x", "y", "width", "height"] as const) if (typeof a[key] === "number") geometry[key] = a[key] as number;
          if (Object.keys(geometry).length > 0) model.setGeometry(obj.id, geometry);
          if (a["narrate"] === true) model.narrateItemsFromText(obj.id);
          return obj.id;
        });
        const slide = model.slides.find((x) => [x.baseLayer, ...x.layers].some((l) => l.objects.some((o) => o.id === made)))!;
        return { text: `Added the ${kind} ${made} to slide ${model.slides.indexOf(slide) + 1}, with ${items.length} ${items.length === 1 ? "item" : "items"}.${a["narrate"] === true ? " Each item has narration; make_audio makes the audio." : " Its items have no narration yet; narrate_items gives them some."}${done()}`, data: summary(made) };
      },
    ),

    tool(
      "set_item",
      "Change one item of an interaction: its title, its words, or (for a labeled graphic) where its marker sits.",
      {
        object: text("The interaction's id.", { minLength: 1 }),
        item: text("The item's number (from 1), id or title.", { minLength: 1, orNumber: true }),
        title: text("A new title.", { minLength: 1, maxLength: 200 }),
        body: text("New words. A blank line starts a new paragraph.", { minLength: 1, maxLength: 5000 }),
        x: number("Marker position across the picture, percent.", { minimum: 0, maximum: 100 }),
        y: number("Marker position down the picture, percent.", { minimum: 0, maximum: 100 }),
      },
      ["object", "item"],
      true,
      (a) => {
        const { model } = s.require();
        const { object, c } = interaction(a["object"] as string);
        const it = item(c, a["item"] as string);
        const done_: string[] = [];
        if (typeof a["title"] === "string" && model.setItemTitle(object.id, it.id, a["title"].trim()) !== null) done_.push("title");
        if (typeof a["body"] === "string" && model.setItemBody(object.id, it.id, a["body"]) !== null) done_.push("words");
        if (a["x"] !== undefined || a["y"] !== undefined) {
          if (c.kind !== "labeledGraphic") throw new ToolError("Only a labeled graphic has markers to place.");
          const x = (a["x"] as number | undefined) ?? it.x ?? 50;
          const y = (a["y"] as number | undefined) ?? it.y ?? 50;
          said(model.setItemPosition(object.id, it.id, x, y), "The marker was not moved.");
          done_.push("marker");
        }
        if (done_.length === 0) throw new ToolError("Nothing was changed. Give title, body, x or y (they may already be that way).");
        return { text: `Changed the ${done_.join(" and ")} of item "${it.title}" in ${object.name}.${done()}` };
      },
    ),

    tool(
      "add_item",
      "Add an item to the end of an interaction, up to the most that kind can have.",
      { object: text("The interaction's id.", { minLength: 1 }), title: text("Its title.", { minLength: 1, maxLength: 200 }), body: text("Its words.", { minLength: 1, maxLength: 5000 }) },
      ["object", "title", "body"],
      true,
      (a) => {
        const { model } = s.require();
        const { object, c } = interaction(a["object"] as string);
        s.attempt(() => {
          const r = model.addItem(object.id);
          if (r === null || !r.startsWith("Added")) throw new ToolError(r ?? "The item could not be added.");
          const id = c.items[c.items.length - 1]!.id;
          model.setItemTitle(object.id, id, (a["title"] as string).trim());
          model.setItemBody(object.id, id, a["body"] as string);
        });
        return { text: `Added item ${c.items.length}, "${(a["title"] as string).trim()}", to ${object.name}.${done()}` };
      },
    ),

    tool(
      "delete_item",
      "Delete an item of an interaction. A kind needs a least number of items (a timeline two, a process circle three). This asks for confirm: true.",
      { object: text("The interaction's id.", { minLength: 1 }), item: text("The item's number (from 1), id or title.", { minLength: 1, orNumber: true }), confirm: flag("Must be true.") },
      ["object", "item", "confirm"],
      true,
      (a) => {
        if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to delete the item.");
        const { model } = s.require();
        const { object, c } = interaction(a["object"] as string);
        const it = item(c, a["item"] as string);
        const r = said(model.deleteItem(object.id, it.id));
        if (c.items.some((i) => i.id === it.id)) throw new ToolError(r.text);
        return { text: `${r.text}.${done()}` };
      },
    ),

    tool(
      "set_interaction",
      "Change how an interaction behaves: horizontal or vertical, whether several items can be open at once, or (for a labeled graphic) whether the markers are stepped through in order.",
      {
        object: text("The interaction's id.", { minLength: 1 }),
        orientation: text("horizontal or vertical.", { enum: ["horizontal", "vertical"] }),
        multiple: flag("Whether several items can be open at once."),
        guided: flag("For a labeled graphic: whether the markers are stepped through with Previous and Next."),
        name: text("What a screen reader says for the whole group.", { maxLength: 200 }),
      },
      ["object"],
      true,
      (a) => {
        const { model } = s.require();
        const { object } = interaction(a["object"] as string);
        const done_: string[] = [];
        if (typeof a["orientation"] === "string" && model.setInteractionOrientation(object.id, a["orientation"] as "horizontal" | "vertical") !== null) done_.push(`now ${a["orientation"]}`);
        if (typeof a["multiple"] === "boolean" && model.setInteractionMultiple(object.id, a["multiple"]) !== null) done_.push(a["multiple"] ? "several items can be open" : "one item open at a time");
        if (typeof a["guided"] === "boolean") {
          if ((object.content as unknown as InteractionContent).kind !== "labeledGraphic") throw new ToolError("Only a labeled graphic can be guided.");
          if (model.setInteractionGuided(object.id, a["guided"]) !== null) done_.push(a["guided"] ? "stepped through in order" : "not stepped through");
        }
        if (typeof a["name"] === "string" && model.setAccessibility(object.id, { altText: a["name"].trim() }) !== null) done_.push("named");
        if (done_.length === 0) throw new ToolError("Nothing was changed. Give orientation, multiple, guided or name (they may already be that way).");
        return { text: `${object.name}: ${done_.join(", ")}.${done()}` };
      },
    ),

    tool("narrate_items", "Give every item of an interaction that has no narration its own, read from its title and words. Items that already have narration are left alone. The audio is made later, by make_audio or when the course is published.", { object: text("The interaction's id.", { minLength: 1 }) }, ["object"], true, (a) => {
      const { object } = interaction(a["object"] as string);
      const r = s.require().model.narrateItemsFromText(object.id);
      if (r.message === "") throw new ToolError("Nothing was changed.");
      return { text: `${r.message}${done()}` };
    }),

    tool(
      "add_scenario",
      "Put a branching scenario on a slide: the learner is in a situation, makes a choice, sees what happens, and goes on. Describe the whole thing at once: the situations, what is said in each (by people of the cast if you like), and the choices, each leading to another situation. A situation with no choices is an ending. Choices can change number variables that meters show. Every line can be spoken.",
      {
        slide: slideRef("The slide's number, id or name."),
        layer: text("The layer to put it on, by name or id. The slide's base layer if left out.", { maxLength: 120 }),
        situations: list(
          "The situations. Their numbers (from 1) are what a choice's goesTo can use; titles work too.",
          record(
            "One situation.",
            {
              title: text("Its title.", { minLength: 1, maxLength: 200 }),
              prompt: text("The question above the choices, such as \"What do you do?\".", { maxLength: 500 }),
              lines: list("What is said or happens, in order (up to 12).", lineSpec, { maxItems: 12 }),
              choices: list(
                "What the learner can do (up to 6). None makes this situation an ending.",
                record(
                  "One choice.",
                  {
                    label: text("The words on the choice.", { minLength: 1, maxLength: 500 }),
                    goesTo: text("The situation it leads to: its number or title.", { minLength: 1, maxLength: 200, orNumber: true }),
                    response: list("What is said straight after the choice, before the next situation (up to 6).", lineSpec, { maxItems: 6 }),
                    effects: list("What the choice changes: a number variable and how much to add (may be negative).", record("One change.", { variable: text("A number variable's name.", { minLength: 1 }), add: number("The amount to add.", { minimum: -1000, maximum: 1000 }) }, ["variable", "add"]), { maxItems: 6 }),
                  },
                  ["label", "goesTo"],
                ),
                { maxItems: 6 },
              ),
            },
            ["title"],
          ),
          { minItems: 1, maxItems: 40 },
        ),
        start: text("The situation it begins in: its number or title. The first if left out.", { maxLength: 200, orNumber: true }),
        meters: list("Bars that show a number variable as the learner chooses.", record("One meter.", { label: text("What it shows, such as \"Trust\".", { minLength: 1, maxLength: 80 }), variable: text("A number variable's name.", { minLength: 1 }), min: number("Its smallest value. 0 if left out."), max: number("Its largest value. 100 if left out.") }, ["label", "variable"]), { maxItems: 6 }),
        allowRetry: flag("Whether the learner can try again from the start. True if left out."),
        finishedVariable: text("A true or false variable that is set to true when the learner reaches an ending.", { maxLength: 80 }),
        reflection: text("Words shown at an ending, for the learner to think about what happened.", { maxLength: 2000 }),
        spoken: flag("Whether every line is spoken, in its person's voice if they have one. True if left out; the audio is made later."),
        name: text("What a screen reader says for the whole scenario.", { maxLength: 200 }),
        x: number("Distance from the left, in pixels."),
        y: number("Distance from the top, in pixels."),
        width: number("Width in pixels.", { minimum: 1 }),
        height: number("Height in pixels.", { minimum: 1 }),
      },
      ["slide", "situations"],
      true,
      (a) => {
        const { model } = s.require();
        const content = buildScenario({ ...(a as unknown as ScenarioSpec), spoken: a["spoken"] !== false }, { cast: model.characters, variables: model.variables, like: model.narratedObjects().at(-1)?.narration });
        const made = s.attempt(() => {
          s.focusLayer(a["slide"] as string, a["layer"] as string | undefined);
          const obj = model.addScenario();
          if (!obj) throw new ToolError("The scenario could not be added.");
          obj.content = content as unknown as Record<string, unknown>;
          const name = typeof a["name"] === "string" && a["name"].trim() !== "" ? a["name"].trim() : content.nodes[0]!.title;
          model.setAccessibility(obj.id, { altText: name });
          const geometry: Record<string, number> = {};
          for (const key of ["x", "y", "width", "height"] as const) if (typeof a[key] === "number") geometry[key] = a[key] as number;
          if (Object.keys(geometry).length > 0) model.setGeometry(obj.id, geometry);
          return obj.id;
        });
        const endings = content.nodes.filter((n) => n.choices.length === 0).length;
        return { text: `Added a scenario ${made} with ${content.nodes.length} situations and ${endings} ${endings === 1 ? "ending" : "endings"}.${(a["spoken"] !== false) ? " Every line is spoken; make_audio makes the audio." : ""}${done()}`, data: summary(made) };
      },
    ),
  ];
}
