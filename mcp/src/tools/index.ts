import type { Tool } from "../protocol.ts";
import type { Session } from "../session.ts";
import { courseTools } from "./course.ts";
import { outputTools } from "./output.ts";
import type { Environment } from "./helpers.ts";

/** What an assistant is told about this server when it connects. */
export const INSTRUCTIONS = [
  "OpenStage Author makes accessible eLearning courses: slides of text, pictures, buttons and questions, with narration, that publish as packages for an LMS.",
  "You work on one project folder (ending in .osproj) inside one folder you were given. Every change is saved as you make it, so there is no save step, and undo takes back the last change.",
  "A good order: list_projects, then create_project or open_project; get_course; list_layouts; add_slide with a layout and fill the slide's objects with set_text (get_slide shows their ids); add_object, add_picture and add_questions for more; set_narration for what each slide says aloud; check_course and fix every error; publish_course.",
  "Accessibility is required, not extra: every picture needs alt text that says what it shows (or decorative: true), headings should be real headings (block h1 to h3), and text that a learner is meant to read should have narration. check_course says what is missing.",
  "A call that cannot be done says why and changes nothing. Deleting asks for confirm: true. Slide numbers count from 1. Places and sizes are in pixels on the stage get_course reports.",
].join("\n");

export function allTools(session: Session, env: Environment): Tool[] {
  return [...courseTools(session, env), ...outputTools(session, env)];
}
