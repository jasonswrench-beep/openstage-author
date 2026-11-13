// The tools that check a course and make things from it: the problem check, the narration audio, the published packages, the Word copy for
// reviewers and the translation files. Each runs one of the program's own tools as a separate program, exactly as the editor's buttons do, and
// everything it writes goes inside the folder the assistant may use, in "Published courses" or "Translations".

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { ToolError, type Tool } from "../protocol.ts";
import type { Session } from "../session.ts";
import { flag, lastJson, list, pythonOf, run, text, tool, wholeJson, type Environment } from "./helpers.ts";

const TARGETS = ["scorm12", "scorm2004", "xapi", "review", "mp4"] as const;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

interface Finding {
  severity: "error" | "warning";
  file: string;
  object_id: string;
  rule: string;
  message: string;
  detail: string;
}

interface Said {
  ok: boolean;
  message?: string;
}

/** What a tool that answered with ok: false said, as a sentence. */
const refusal = (what: string, r: { stdout: string; stderr: string }, answer: Said | null): ToolError =>
  new ToolError(answer?.message ? `${what}: ${answer.message}` : `${what}. ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`.trim());

export function outputTools(s: Session, e: Environment): Tool[] {
  const tools = (name: string) => path.join(e.root, "tools", name);

  /** A folder inside the assistant's own where results go, made if it is not there. */
  const resultsFolder = (name: string): string => {
    const folder = s.jail.resolve(name);
    mkdirSync(folder, { recursive: true });
    return folder;
  };

  return [
    tool("check_course", "Check the open course for problems, as the editor's Problems list does: missing alt text, too little contrast, narration with no words, broken links between slides and more. Errors stop a course being published. Run this after changes, and fix every error.", {}, [], false, async () => {
      const { dir } = s.require();
      const r = await run(pythonOf(e), [tools("validate.py"), dir, "--json"], e);
      const findings = wholeJson<Finding[]>(r.stdout);
      if (!findings) throw new ToolError(`The problem check did not give a result. ${r.stderr.trim().split("\n").slice(-2).join(" ")}`.trim());
      const errors = findings.filter((f) => f.severity === "error").length;
      const warnings = findings.length - errors;
      const shown = [...findings.filter((f) => f.severity === "error"), ...findings.filter((f) => f.severity !== "error")].slice(0, 80);
      return {
        text: errors === 0 ? `No errors${warnings > 0 ? `, ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}. The course can be published.` : `${errors} ${errors === 1 ? "error" : "errors"} and ${warnings} ${warnings === 1 ? "warning" : "warnings"}. The errors must be fixed before the course can be published.`,
        data: { errors, warnings, findings: shown.map((f) => ({ severity: f.severity, where: f.file, object: f.object_id === "-" ? undefined : f.object_id, rule: f.rule, problem: f.message, detail: f.detail || undefined })), ...(findings.length > shown.length ? { shown: shown.length, more: findings.length - shown.length } : {}) },
      };
    }),

    tool("make_audio", "Make the narration audio that is missing, with the speech engine installed for the program. It can take minutes the first time. Courses are published with whatever audio exists, and publishing makes missing audio too if an engine is set up.", {}, [], true, async () => {
      const { dir, model } = s.require();
      const engine = e.env["OPENSTAGE_KOKORO_PYTHON"];
      if (!engine) throw new ToolError("No speech engine is set up for this connection, so no audio can be made. In OpenStage Author choose Narration and install the narration voice, then connect the assistant again with the lines MCP access gives (they name the engine).");
      if (model.narratedObjects().length === 0) throw new ToolError("The course has no narration yet. Use set_narration to write what an object says.");
      const r = await run(engine, [tools("narrate.py"), dir, "--json"], e);
      const info = wholeJson<Record<string, { audio: string | null }>>(r.stdout);
      if (r.status !== 0 || !info) throw new ToolError(`The speech engine did not finish. ${r.stderr.trim().split("\n").slice(-3).join(" ")}`.trim());
      const all = Object.values(info);
      const withAudio = all.filter((i) => i.audio).length;
      return { text: `${withAudio} of ${all.length} narrated ${all.length === 1 ? "object has" : "objects have"} audio now.${withAudio < all.length ? " The rest could not be made; check_course and the scripts may say why." : ""}`, data: { narrated: all.length, withAudio } };
    }),

    tool(
      "publish_course",
      "Publish the open course into the folder's \"Published courses\" folder: the packages for an LMS (SCORM 1.2, SCORM 2004 and xAPI), the same course as web files, and a Word copy for reviewers. It refuses if the course has errors (see check_course). Making a video takes minutes more.",
      {
        targets: list("Which to make, from scorm12, scorm2004, xapi, review (the Word copy) and mp4 (a video with captions). All the packages and the Word copy if left out.", text("One target.", { enum: TARGETS }), { minItems: 1, maxItems: TARGETS.length }),
        video: flag("True also makes the MP4 video (Windows only; it needs Microsoft Edge or Chrome)."),
        source: flag("True also puts an editable copy of the course in each zip (only its own files: the project, slides, theme and the assets it uses). Off if left out."),
      },
      [],
      true,
      async (a) => {
        const { dir, name } = s.require();
        const out = path.join(resultsFolder("Published courses"), name);
        if (existsSync(out) && readdirSync(out).length > 0 && !(existsSync(path.join(out, "index.html")) && existsSync(path.join(out, "player.js")))) {
          throw new ToolError(`There is already a folder called ${name} in Published courses with other things in it, so it was not replaced. Move it away first.`);
        }
        const asked = [...new Set([...((a["targets"] as string[] | undefined) ?? ["scorm12", "scorm2004", "xapi", "review"]), ...(a["video"] === true ? ["mp4"] : [])])];
        const player = path.join(e.root, "player");
        const r = await run(process.execPath, [path.join(player, "publish.ts"), dir, out, "--json", `--targets=${asked.join(",")}`, ...(a["source"] === true ? ["--include-source"] : [])], e, player);
        const answer = lastJson<{ ok: boolean; message?: string; findings: Finding[]; slides?: number; indexHtml?: string; zips?: Record<string, string>; review?: string | null; video?: { file: string; captions: string | null; seconds: number; notes: string[] } | null; videoError?: string | null }>(r.stdout);
        if (!answer) throw new ToolError(`The publishing tool stopped without a result. ${r.stderr.trim().split("\n").slice(-3).join(" ")}`.trim());
        if (!answer.ok) {
          const errors = answer.findings.filter((f) => f.severity === "error");
          throw new ToolError(`${answer.message ?? "It was not published."}${errors.length > 0 ? ` ${errors.slice(0, 5).map((f) => `${f.object_id !== "-" ? `${f.object_id}: ` : ""}${f.message}`).join(" ")}` : ""}`);
        }
        const files = [...Object.values(answer.zips ?? {}), ...(answer.review ? [answer.review] : []), ...(answer.video ? [answer.video.file, ...(answer.video.captions ? [answer.video.captions] : [])] : [])];
        return {
          text: `Published ${answer.slides ?? 0} ${answer.slides === 1 ? "slide" : "slides"}.${answer.videoError ? ` The video could not be made: ${answer.videoError}` : ""}`,
          data: { folder: path.dirname(out), course: answer.indexHtml ? path.dirname(answer.indexHtml) : out, files, warnings: answer.findings.length, videoNotes: answer.video?.notes },
        };
      },
    ),

    tool("export_review_document", "Make a Word copy of the open course for colleagues and accessibility reviewers: each slide's words, alt text, narration scripts, quiz answers and the problems the check found. It goes in \"Published courses\".", {}, [], true, async () => {
      const { dir, name } = s.require();
      const out = path.join(resultsFolder("Published courses"), `${name}-review.docx`);
      const r = await run(pythonOf(e), [tools("review_doc.py"), dir, out, "--json"], e);
      const answer = lastJson<Said & { slides?: number; errors?: number; warnings?: number }>(r.stdout);
      if (!answer?.ok) throw refusal("The Word document could not be made", r, answer);
      const slides = answer.slides ?? 0;
      return { text: `Made the Word document for ${slides} ${slides === 1 ? "slide" : "slides"}.`, data: { file: out } };
    }),

    tool(
      "export_translation",
      "Make a file for a translator (XLIFF 1.2, which most translation tools read) with every word of the course in it, including the player's own words such as Next and Listen. The course itself is not changed. It goes in \"Translations\".",
      {
        language: text("The language to translate into, as a code such as fr-FR.", { minLength: 2, maxLength: 20 }),
        pseudo: flag("True fills the file with made-up translations (every word accented and in brackets), to show where longer words will not fit."),
      },
      ["language"],
      true,
      async (a) => {
        const { dir, name } = s.require();
        const lang = a["language"] as string;
        if (!LANGUAGE.test(lang)) throw new ToolError(`"${lang}" is not a language code. Use one such as fr-FR or es-MX.`);
        const out = path.join(resultsFolder("Translations"), `${name}-${lang}.xlf`);
        const r = await run(pythonOf(e), [tools("xliff.py"), "export", dir, out, "--to", lang, ...(a["pseudo"] === true ? ["--pseudo"] : []), "--json"], e);
        const answer = lastJson<Said & { units?: number; words?: number }>(r.stdout);
        if (!answer?.ok) throw refusal("The translation file could not be made", r, answer);
        return { text: `Made a translation file of ${answer.units ?? 0} pieces of text (${answer.words ?? 0} words) for ${lang}.`, data: { file: out } };
      },
    ),

    tool(
      "import_translation",
      "Bring a translated XLIFF file back as a new course project in the folder, named after the language. The original course is never changed. Anything that could not be put back safely stays in the original language and is listed.",
      { file: text("The translated file's path inside the folder, such as Translations/Intro-fr-FR.xlf.", { minLength: 1, maxLength: 400 }), language: text("The language, as a code, if the file does not say.", { maxLength: 20 }) },
      ["file"],
      true,
      async (a) => {
        const { dir } = s.require();
        const file = s.jail.resolve(a["file"] as string);
        if (!existsSync(file)) throw new ToolError(`There is no file ${a["file"]}.`);
        const lang = typeof a["language"] === "string" ? a["language"] : undefined;
        if (lang !== undefined && !LANGUAGE.test(lang)) throw new ToolError(`"${lang}" is not a language code.`);
        const r = await run(pythonOf(e), [tools("xliff.py"), "import", dir, file, "--into", s.jail.root, ...(lang ? ["--language", lang] : []), "--json"], e);
        const answer = lastJson<Said & { out?: string; language?: string; translated?: number; untranslated?: number; refused?: { id: string; reason: string }[] }>(r.stdout);
        if (!answer?.ok) throw refusal("The translation could not be brought in", r, answer);
        const name = answer.out ? path.basename(answer.out).replace(/\.osproj$/i, "") : "";
        return {
          text: `Made the project ${name} (${answer.language ?? ""}): ${answer.translated ?? 0} pieces put back, ${answer.untranslated ?? 0} left in the original language.${(answer.refused?.length ?? 0) > 0 ? ` ${answer.refused!.length} were refused; they are listed.` : ""} Open it with open_project.`,
          data: { project: name, refused: answer.refused },
        };
      },
    ),
  ];
}
