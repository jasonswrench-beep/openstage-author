// The tools for how a course looks and who is in it: the theme (its colours and fonts) and the cast (the people who speak in scenarios and can be
// chosen by the learner). The editor's own checks decide what is allowed, as they do in its Themes and Cast dialogs.

import { BUILT_IN_THEMES } from "../../../editor/src/themes.ts";
import { CAST_LIMIT, cloneCast, newPerson } from "../../../editor/src/characters.ts";
import { VOICES, voiceOption } from "../../../editor/src/narration.ts";
import type { Character } from "../../../player/src/types.ts";
import { importPicture } from "../files.ts";
import { ToolError, type Tool } from "../protocol.ts";
import type { Session } from "../session.ts";
import { flag, text, tool } from "./helpers.ts";

export function lookTools(s: Session): Tool[] {
  const done = (): string => {
    const r = s.save();
    return r.written + r.removed === 0 ? "" : " Saved.";
  };

  const person = (which: string): Character => {
    const { model } = s.require();
    const wanted = which.trim().toLowerCase();
    const hit = model.characters.find((p) => p.id === which) ?? model.characters.find((p) => p.name.toLowerCase() === wanted);
    if (!hit) throw new ToolError(`There is no person "${which}" in the cast. ${model.characters.length > 0 ? `The cast is: ${model.characters.map((p) => p.name).join(", ")}.` : "The cast is empty; add_character adds a person."}`);
    return hit;
  };

  /** Change the cast as the editor's dialog does, and say what it said. The model answers with a sentence either way; only "The cast has" is a success. */
  const setCast = (draft: Character[]): string => {
    const r = s.require().model.setCharacters(draft);
    if (r === null) throw new ToolError("Nothing was changed. It may already be that way.");
    if (!r.startsWith("The cast has")) throw new ToolError(r);
    return r;
  };

  const info = (p: Character) => ({ id: p.id, name: p.name, role: p.role, voice: voiceOption(p.voice).label, voiceId: p.voice, ...(p.picture ? { picture: p.picture.src, altText: p.picture.alt, decorative: p.picture.decorative } : {}) });

  return [
    tool("list_themes", "List the themes a course can take its colours and fonts from, and which one this course has now.", {}, [], false, () => {
      const { model } = s.require();
      return {
        text: `This course uses the theme ${model.theme.name}. ${BUILT_IN_THEMES.length} are built in.`,
        data: { current: { id: model.theme.id, name: model.theme.name }, themes: BUILT_IN_THEMES.map((t) => ({ id: t.id, name: t.name })) },
      };
    }),

    tool(
      "set_theme",
      "Change the course's theme: its colours and fonts. Text that follows the theme stays readable, and the high-contrast theme is there for learners who need it. Colours a person chose by hand are left alone.",
      { theme: text("The theme's id or name, from list_themes.", { minLength: 1, maxLength: 80 }), keepLogo: flag("Keep the logo the course has now if the new theme has none.") },
      ["theme"],
      true,
      (a) => {
        const { model } = s.require();
        const wanted = (a["theme"] as string).trim().toLowerCase();
        const hit = BUILT_IN_THEMES.find((t) => t.id === a["theme"]) ?? BUILT_IN_THEMES.find((t) => t.name.toLowerCase() === wanted);
        if (!hit) throw new ToolError(`There is no theme "${a["theme"]}". The themes are: ${BUILT_IN_THEMES.map((t) => `${t.name} (${t.id})`).join(", ")}.`);
        const r = model.setTheme(hit, a["keepLogo"] === true);
        if (r === null) throw new ToolError(`The course already has the theme ${hit.name}.`);
        return { text: `${r}.${done()}` };
      },
    ),

    tool("get_cast", "List the people in the course's cast: the speakers of scenario lines, with their voices and pictures.", {}, [], false, () => {
      const { model } = s.require();
      return { text: `${model.characters.length} ${model.characters.length === 1 ? "person" : "people"} in the cast (at most ${CAST_LIMIT}).`, data: model.characters.map(info) };
    }),

    tool(
      "add_character",
      "Add a person to the cast. A scenario line can then be spoken by them, in their own voice. A picture is optional; if there is one it needs alt text (or decorative: true).",
      {
        name: text("Their name.", { minLength: 1, maxLength: 60 }),
        role: text("A few words on who they are, such as \"the manager\".", { maxLength: 120 }),
        voice: text("A voice id from list_voices. One no one else in the cast has, if left out, so they can be told apart by ear.", { maxLength: 80 }),
        picture: text("A picture of them: a path inside the folder.", { maxLength: 400 }),
        altText: text("What the picture shows.", { maxLength: 300 }),
        decorative: flag("True if the picture only decorates; then give no altText."),
      },
      ["name"],
      true,
      (a) => {
        const { model, dir } = s.require();
        const cast = cloneCast(model.characters);
        const base = newPerson(cast);
        const name = (a["name"] as string).trim();
        if (name === "") throw new ToolError("A person needs a name.");
        if (cast.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`There is already a person called ${name} in the cast.`);
        if (typeof a["voice"] === "string" && !VOICES.includes(a["voice"])) throw new ToolError(`"${a["voice"]}" is not a voice. list_voices lists them.`);
        const source = typeof a["picture"] === "string" ? s.jail.resolve(a["picture"]) : undefined;
        if (source === undefined && (a["altText"] !== undefined || a["decorative"] !== undefined)) throw new ToolError("altText and decorative are for a picture; give picture too.");
        if (a["decorative"] === true && typeof a["altText"] === "string" && a["altText"].trim() !== "") throw new ToolError("A decorative picture has no alt text. Either give altText or say decorative: true, not both.");
        const made = s.attempt(() => {
          const p: Character = { ...base, id: base.id, name, role: typeof a["role"] === "string" ? a["role"].trim() : "", voice: typeof a["voice"] === "string" ? a["voice"] : base.voice };
          // The id follows the name, not the placeholder name newPerson started with.
          p.id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "") || "person";
          for (let n = 2; cast.some((x) => x.id === p.id) || p.id === "you"; n++) p.id = `${p.id.replace(/-\d+$/, "")}-${n}`;
          if (source !== undefined) {
            const pic = importPicture(dir, source);
            p.picture = { src: pic.src, alt: a["decorative"] === true ? "" : ((a["altText"] as string | undefined) ?? "").trim(), decorative: a["decorative"] === true };
          }
          setCast([...cast, p]);
          return p;
        });
        return { text: `Added ${made.name} to the cast (id ${made.id}, voice ${voiceOption(made.voice).label}).${source !== undefined && !made.picture?.decorative && made.picture?.alt === "" ? " Their picture has no alt text yet; set_character gives it one." : ""}${done()}`, data: info(made) };
      },
    ),

    tool(
      "set_character",
      "Change a person of the cast: their name, role, voice or picture. A new voice changes the voice of every line they speak.",
      {
        character: text("The person's name or id.", { minLength: 1, maxLength: 80 }),
        name: text("A new name.", { minLength: 1, maxLength: 60 }),
        role: text("A few words on who they are.", { maxLength: 120 }),
        voice: text("A voice id from list_voices.", { maxLength: 80 }),
        picture: text("A new picture: a path inside the folder.", { maxLength: 400 }),
        altText: text("What the picture shows.", { maxLength: 300 }),
        decorative: flag("Whether the picture only decorates."),
      },
      ["character"],
      true,
      (a) => {
        const { model, dir } = s.require();
        const who = person(a["character"] as string);
        const cast = cloneCast(model.characters);
        const p = cast.find((x) => x.id === who.id)!;
        if (typeof a["name"] === "string") {
          const name = a["name"].trim();
          if (cast.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`There is already a person called ${name}.`);
          p.name = name;
        }
        if (typeof a["role"] === "string") p.role = a["role"].trim();
        if (typeof a["voice"] === "string") {
          if (!VOICES.includes(a["voice"])) throw new ToolError(`"${a["voice"]}" is not a voice. list_voices lists them.`);
          p.voice = a["voice"];
        }
        if (a["decorative"] === true && typeof a["altText"] === "string" && a["altText"].trim() !== "") throw new ToolError("A decorative picture has no alt text. Either give altText or say decorative: true, not both.");
        if (typeof a["picture"] === "string") {
          const pic = importPicture(dir, s.jail.resolve(a["picture"]));
          p.picture = { src: pic.src, alt: a["decorative"] === true ? "" : typeof a["altText"] === "string" ? a["altText"].trim() : "", decorative: a["decorative"] === true };
        } else if (p.picture && (typeof a["altText"] === "string" || typeof a["decorative"] === "boolean")) {
          const decorative = typeof a["decorative"] === "boolean" ? a["decorative"] : p.picture.decorative && typeof a["altText"] !== "string";
          p.picture = { ...p.picture, decorative, alt: decorative ? "" : typeof a["altText"] === "string" ? a["altText"].trim() : p.picture.alt };
        } else if (typeof a["altText"] === "string" || typeof a["decorative"] === "boolean") {
          throw new ToolError(`${p.name} has no picture to describe. Give picture too.`);
        }
        const r = setCast(cast);
        return { text: `${p.name}: ${r}${done()}`, data: info(p) };
      },
    ),

    tool("delete_character", "Take a person out of the cast. One who still speaks in a scenario is refused, and the answer says where. This asks for confirm: true.", { character: text("The person's name or id.", { minLength: 1, maxLength: 80 }), confirm: flag("Must be true.") }, ["character", "confirm"], true, (a) => {
      if (a["confirm"] !== true) throw new ToolError("Nothing was deleted. Say confirm: true to take the person out of the cast.");
      const { model } = s.require();
      const who = person(a["character"] as string);
      const r = setCast(cloneCast(model.characters).filter((p) => p.id !== who.id));
      return { text: `${who.name} is out of the cast. ${r}${done()}` };
    }),
  ];
}
