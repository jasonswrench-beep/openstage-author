// The tools for what a course remembers and does: its variables, the layers that open over a slide, and the rules that say what an object does
// (go to a slide, show a layer, set a variable). Each asks the editor's own Model to make the change, as the editor's Rules panel does, and checks
// by reading the result back, so a rule that did not come out as asked is undone and said, never left half made.

import { OPERATOR_LABELS, RULE_ACTIONS, eventsFor, isCourseAction, readRules, type Rule, type RuleAction, type RuleEvent } from "../../../editor/src/content.ts";
import type { Model } from "../../../editor/src/model.ts";
import type { Condition, Primitive } from "../../../player/src/types.ts";
import { ToolError, type Tool } from "../protocol.ts";
import type { Session } from "../session.ts";
import { flag, list, record, said, scalar, text, tool, whole } from "./helpers.ts";

const EVENTS: readonly RuleEvent[] = ["activate", "slideStart", "slideEnd", "mediaComplete", "timerEnd", "variableChange"];
const OPERATORS = ["equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual"] as const;
const VARIABLE_TYPES = ["number", "boolean", "string"] as const;

const WHEN: Record<RuleEvent, string> = {
  activate: "the learner presses it",
  slideStart: "the slide starts",
  slideEnd: "the slide ends",
  mediaComplete: "it finishes playing",
  timerEnd: "the timer runs out",
  variableChange: "a variable changes",
};

/** What a rule does, in words, with its target named. */
function doing(model: Model, objectId: string, rule: Rule): string {
  const target = model.targetsFor(objectId, rule.action).find((t) => t.value === rule.target)?.label ?? rule.target;
  const shown = typeof rule.value === "string" ? `"${rule.value}"` : String(rule.value);
  switch (rule.action) {
    case "jumpToSlide": return `go to slide ${target.replace(/^(\d+)\. /, "$1, ")}`;
    case "nextSlide": return "go to the next slide";
    case "previousSlide": return "go to the previous slide";
    case "replaySlide": return "replay the slide";
    case "showLayer": return `show the layer "${target}"`;
    case "hideLayer": return `hide the layer "${target}"`;
    case "setVariable": return `set "${target}" to ${shown}`;
    case "addToVariable": return `add ${shown} to "${target}"`;
    case "playMedia": return `play "${target}"`;
    case "pauseMedia": return `pause "${target}"`;
    case "stopTimer": return `stop the timer "${target}"`;
    case "changeState": return `change "${target}" to its look "${rule.value}"`;
  }
}

function sentence(model: Model, objectId: string, rule: Rule): string {
  const ifs = rule.conditions.map((c) => `"${model.variableName(c.variable)}" ${OPERATOR_LABELS[c.operator]} ${typeof c.value === "string" ? `"${c.value}"` : String(c.value)}`);
  return `When ${WHEN[rule.event]}, ${doing(model, objectId, rule)}${ifs.length > 0 ? `, if ${ifs.join(" and ")}` : ""}.`;
}

/** The rules of an object as facts, numbered from 1, and the ones the editor cannot show as a rule marked as custom. */
export function rulesData(model: Model, objectId: string): Record<string, unknown>[] {
  const triggers = model.slides.flatMap((s) => [s.baseLayer, ...s.layers]).flatMap((l) => l.objects).find((o) => o.id === objectId)?.triggers ?? [];
  return readRules(triggers).map((item, i) => {
    if (item.kind === "raw") return { number: i + 1, custom: true, why: item.why };
    const r = item.rule;
    return {
      number: i + 1,
      when: r.event,
      does: r.action,
      ...(r.target !== "" ? { target: r.target } : {}),
      ...(r.value !== undefined ? { value: r.value } : {}),
      ...(r.conditions.length > 0 ? { conditions: r.conditions.map((c) => ({ variable: model.variableName(c.variable), operator: c.operator, value: c.value })) } : {}),
      sentence: sentence(model, objectId, r),
    };
  });
}

/** The id of the thing a rule points at, from how an assistant names it: its id, its name, or for a slide its number. */
function resolveTarget(model: Model, objectId: string, action: RuleAction, given: string | number | undefined): string {
  if (isCourseAction(action)) {
    if (given !== undefined && String(given).trim() !== "") throw new ToolError(`"${action}" acts on the course itself and takes no target.`);
    return "";
  }
  const choices = model.targetsFor(objectId, action);
  const names = () => choices.map((c) => c.label).join("; ") || "none";
  if (choices.length === 0) {
    const why: Partial<Record<RuleAction, string>> = {
      showLayer: "This slide has no layers. add_layer makes one.",
      hideLayer: "This slide has no layers. add_layer makes one.",
      setVariable: "The course has no variables. add_variable makes one.",
      addToVariable: "The course has no number variables. add_variable makes one.",
      playMedia: "This slide has no video or audio to play.",
      pauseMedia: "This slide has no video or audio to pause.",
      stopTimer: "This slide has no timer to stop.",
      changeState: "No object on this slide has a look to change to.",
    };
    throw new ToolError(why[action] ?? "There is nothing for it to point at.");
  }
  if (given === undefined || String(given).trim() === "") throw new ToolError(`"${action}" needs a target. The choices are: ${names()}.`);
  const g = String(given).trim().toLowerCase();
  const bare = (label: string) => label.toLowerCase().replace(/^\d+\.\s*/, "");
  const hits = choices.filter((c) => c.value === String(given) || c.label.toLowerCase() === g || bare(c.label) === g || (/^\d+$/.test(g) && c.label.startsWith(`${g}. `)));
  const one = hits.find((c) => c.value === String(given)) ?? (hits.length === 1 ? hits[0] : undefined);
  if (!one) throw new ToolError(hits.length > 1 ? `"${given}" could mean more than one thing. Use an id. The choices are: ${choices.map((c) => `${c.label} (${c.value})`).join("; ")}.` : `"${given}" is not something "${action}" can point at here. The choices are: ${names()}.`);
  return one.value;
}

export function logicTools(s: Session): Tool[] {
  /** Save what changed, and say in a few words that it was. */
  const done = (): string => {
    const r = s.save();
    return r.written + r.removed === 0 ? "" : " Saved.";
  };

  return [
    tool(
      "add_variable",
      "Add a variable: something the course remembers, such as a score, a choice or whether a layer was seen. Rules set and test it, and a text can show it by writing {{Name}}.",
      {
        name: text("Its name, which must not be used by another variable.", { minLength: 1, maxLength: 60 }),
        type: text("number, boolean (true or false) or string (text).", { enum: VARIABLE_TYPES }),
        initial: scalar("What it is when the course starts, of its own kind. 0, false or empty text if left out."),
      },
      ["name", "type"],
      true,
      (a) => {
        const { model } = s.require();
        const name = (a["name"] as string).trim();
        if (name === "") throw new ToolError("A variable needs a name.");
        if (model.variables.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`There is already a variable called ${name}.`);
        const type = a["type"] as (typeof VARIABLE_TYPES)[number];
        const initial = a["initial"] as Primitive | undefined;
        if (initial !== undefined && typeof initial !== type) throw new ToolError(`The starting value of a ${type} variable must be ${type === "number" ? "a number" : type === "boolean" ? "true or false" : "text"}.`);
        const v = s.attempt(() => {
          const made = model.addVariable(type, name);
          if (initial !== undefined) model.setVariableInitial(made.id, initial);
          return made;
        });
        return { text: `Added the ${type} variable ${v.name}, starting as ${String(model.variables.find((x) => x.id === v.id)!.initial)}.${done()}`, data: { id: v.id, name: v.name, type } };
      },
    ),

    tool(
      "set_variable",
      "Rename a variable, or change what it starts as. A text that shows it by {{Name}} is changed to match a new name.",
      { variable: text("The variable's name or id.", { minLength: 1 }), name: text("A new name.", { minLength: 1, maxLength: 60 }), initial: scalar("What it starts as, of its own kind.") },
      ["variable"],
      true,
      (a) => {
        const { model } = s.require();
        const v = s.variable(a["variable"] as string);
        const notes: string[] = [];
        s.attempt(() => {
          if (typeof a["name"] === "string") {
            const r = model.renameVariable(v.id, a["name"]);
            if (r === null) throw new ToolError(`${v.name} is already called that.`);
            if (!r.startsWith("Variable renamed")) throw new ToolError(r);
            notes.push(r);
          }
          if (a["initial"] !== undefined) {
            const r = model.setVariableInitial(v.id, a["initial"] as Primitive);
            if (r === null) throw new ToolError(`${v.name} already starts as that, or the value is not of its kind (${v.type}).`);
            if (!r.endsWith(String(a["initial"]))) throw new ToolError(r);
            notes.push(r);
          }
        });
        if (notes.length === 0) throw new ToolError("Nothing was asked for. Give name or initial.");
        return { text: `${notes.join(". ")}.${done()}` };
      },
    ),

    tool("delete_variable", "Delete a variable that nothing uses. One a rule, an input or a text uses is refused, and the answer says where it is used.", { variable: text("The variable's name or id.", { minLength: 1 }), confirm: flag("Must be true.") }, ["variable", "confirm"], true, (a) => {
      if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to delete the variable.");
      const { model } = s.require();
      const v = s.variable(a["variable"] as string);
      const message = said(model.deleteVariable(v.id)).text;
      if (model.variables.some((x) => x.id === v.id)) throw new ToolError(message);
      return { text: `${message}.${done()}` };
    }),

    tool("add_layer", "Add a layer to a slide: a set of objects that opens over the slide when a rule shows it (for feedback, a pop-up, extra detail). Objects go on it with add_object's layer argument.", { slide: text("The slide's number, id or name.", { minLength: 1, maxLength: 200, orNumber: true }), name: text("The layer's name. Layer 1, Layer 2... if left out.", { maxLength: 120 }) }, ["slide"], true, (a) => {
      const { model } = s.require();
      s.focusSlide(a["slide"] as string);
      const layer = model.addLayer();
      if (!layer) throw new ToolError("The layer could not be added.");
      if (typeof a["name"] === "string" && a["name"].trim() !== "") model.renameLayer(layer.id, a["name"].trim());
      const now = model.slides.flatMap((x) => x.layers).find((l) => l.id === layer.id && model.slide?.layers.includes(l));
      return { text: `Added the layer ${now?.name ?? layer.name} (${layer.id}) to the slide.${done()}`, data: { id: layer.id, name: now?.name ?? layer.name } };
    }),

    tool("rename_layer", "Rename a layer of a slide.", { slide: text("The slide's number, id or name.", { minLength: 1, maxLength: 200, orNumber: true }), layer: text("The layer's name or id.", { minLength: 1 }), name: text("The new name.", { minLength: 1, maxLength: 120 }) }, ["slide", "layer", "name"], true, (a) => {
      const { layer } = s.focusLayer(a["slide"] as string, a["layer"] as string);
      const r = said(s.require().model.renameLayer(layer.id, (a["name"] as string).trim()), "The name was not changed. It may be empty or the same.");
      return { text: `${r.text}.${done()}` };
    }),

    tool("delete_layer", "Delete a layer of a slide and everything on it. The base layer cannot be deleted. This asks for confirm: true.", { slide: text("The slide's number, id or name.", { minLength: 1, maxLength: 200, orNumber: true }), layer: text("The layer's name or id.", { minLength: 1 }), confirm: flag("Must be true.") }, ["slide", "layer", "confirm"], true, (a) => {
      if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to delete the layer.");
      const { slide, layer } = s.focusLayer(a["slide"] as string, a["layer"] as string);
      if (layer === slide.baseLayer) throw new ToolError("The base layer cannot be deleted.");
      const message = said(s.require().model.deleteLayer(layer.id)).text;
      if (s.require().model.slide?.layers.some((l) => l.id === layer.id)) throw new ToolError(message);
      return { text: `${message}.${done()}` };
    }),

    tool(
      "get_rules",
      "List what an object does, as the editor's Rules panel shows it: each rule in words, numbered from 1, with its parts. Rules run in order.",
      { object: text("The object's id, from get_slide.", { minLength: 1 }) },
      ["object"],
      false,
      (a) => {
        const { model } = s.require();
        const { object } = s.focus(a["object"] as string);
        const data = rulesData(model, object.id);
        return { text: `${object.name} has ${data.length} ${data.length === 1 ? "rule" : "rules"}.`, data };
      },
    ),

    tool(
      "add_rule",
      "Say what an object does: for example when a button is pressed, go to a slide, show a layer, or add to a variable, optionally only if a variable has a value. A button's rule works with the mouse and the keyboard. Events that an object cannot cause (a text box is never pressed) are refused.",
      {
        object: text("The object's id, from get_slide.", { minLength: 1 }),
        event: text("When: activate (the learner presses it, for a button, hotspot or question), slideStart, slideEnd, mediaComplete (a video or sound ends), timerEnd, variableChange. activate if left out and the object can be pressed, otherwise slideStart.", { enum: EVENTS }),
        action: text(`What it does: ${RULE_ACTIONS.join(", ")}.`, { enum: RULE_ACTIONS }),
        target: text("What it points at: for jumpToSlide a slide's number or name; for showLayer and hideLayer a layer's name on the object's slide; for setVariable and addToVariable a variable's name; for playMedia, pauseMedia, stopTimer and changeState an object's id. Not for nextSlide, previousSlide or replaySlide.", { maxLength: 200, orNumber: true }),
        value: scalar("For setVariable what to set it to (of the variable's kind); for addToVariable the number to add; for changeState the name of the look."),
        conditions: list(
          "Only do it if all of these hold.",
          record("One condition.", { variable: text("A variable's name.", { minLength: 1 }), operator: text("equals, notEquals, lessThan, lessThanOrEqual, greaterThan or greaterThanOrEqual. Only equals and notEquals for text and true or false.", { enum: OPERATORS }), value: scalar("What to compare it with, of the variable's kind.") }, ["variable", "operator", "value"]),
          { maxItems: 8 },
        ),
      },
      ["object", "action"],
      true,
      (a) => {
        const { model } = s.require();
        const { object } = s.focus(a["object"] as string);
        const action = a["action"] as RuleAction;
        const allowed = eventsFor(object.type);
        const event = ((a["event"] as RuleEvent | undefined) ?? (allowed.includes("activate") ? "activate" : "slideStart"));
        if (!allowed.includes(event)) throw new ToolError(`A ${object.type} cannot cause "${event}". It can cause: ${allowed.join(", ")}.`);
        const target = resolveTarget(model, object.id, action, a["target"] as string | number | undefined);
        const value = a["value"] as Primitive | undefined;
        if ((action === "setVariable" || action === "addToVariable" || action === "changeState") && value === undefined) throw new ToolError(`"${action}" needs a value.`);
        if (!["setVariable", "addToVariable", "changeState"].includes(action) && value !== undefined) throw new ToolError(`"${action}" takes no value.`);
        const conditions = ((a["conditions"] as { variable: string; operator: Condition["operator"]; value: Primitive }[] | undefined) ?? []).map((c) => ({ ...c, id: s.variable(c.variable).id }));
        const made = s.attempt(() => {
          said(model.addRule(object.id), "A rule could not be added.");
          const index = model.rulesOf(object.id).length - 1;
          const step = (patch: Parameters<Model["updateRule"]>[2]): void => {
            const r = model.updateRule(object.id, index, patch);
            if (r !== null && r !== "Rule changed") throw new ToolError(r);
          };
          step({ event, action });
          if (target !== "") step({ target });
          if (value !== undefined) step({ value });
          conditions.forEach((c, at) => {
            said(model.addCondition(object.id, index), "A condition could not be added.");
            const set = model.updateCondition(object.id, index, at, { variable: c.id });
            if (set !== null && set !== "Condition changed") throw new ToolError(set);
            for (const patch of [{ operator: c.operator }, { value: c.value }] as const) {
              const r = model.updateCondition(object.id, index, at, patch);
              if (r !== null && r !== "Condition changed") throw new ToolError(r);
            }
          });
          // Read it back: it must be what was asked for.
          const item = readRules(model.slides.flatMap((x) => [x.baseLayer, ...x.layers]).flatMap((l) => l.objects).find((o) => o.id === object.id)!.triggers)[index];
          if (!item || item.kind !== "rule" || item.rule.event !== event || item.rule.action !== action || item.rule.target !== target || (value !== undefined && item.rule.value !== value) || item.rule.conditions.length !== conditions.length) {
            throw new ToolError("The rule did not come out as asked (a value may not be of the variable's kind, or a look may not exist), so it was not added.");
          }
          for (const [at, c] of conditions.entries()) {
            const got = item.rule.conditions[at]!;
            if (got.variable !== c.id || got.operator !== c.operator || got.value !== c.value) throw new ToolError(`Condition ${at + 1} did not come out as asked: "${c.operator}" with that value does not suit the variable's kind, so the rule was not added.`);
          }
          return { index, rule: item.rule };
        });
        return { text: `Added rule ${made.index + 1} to ${object.name}: ${sentence(model, object.id, made.rule)}${done()}`, data: rulesData(model, object.id) };
      },
    ),

    tool(
      "delete_rule",
      "Delete one of an object's rules, by its number from get_rules. The others keep their order.",
      { object: text("The object's id.", { minLength: 1 }), rule: whole("The rule's number, from 1.", { minimum: 1 }) },
      ["object", "rule"],
      true,
      (a) => {
        const { object } = s.focus(a["object"] as string);
        const r = said(s.require().model.deleteRule(object.id, (a["rule"] as number) - 1), `${object.name} has no rule ${a["rule"]}, or that one is a custom rule the editor keeps as it is.`);
        return { text: `${r.text}.${done()}` };
      },
    ),
  ];
}
