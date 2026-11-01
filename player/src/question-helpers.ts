// Shared by the tests of the kinds of question: a question as an author writes it, built on a stand-in page, and played in the example course.
import { FakeLms } from "./fake-lms.ts";
import { FakeLms2004 } from "./fake-lms-2004.ts";
import { FakeEl, asDoc } from "./fake-dom.ts";
import { buildQuestion, type QuestionContext, type QuestionView } from "./questions.ts";
import { Tracker } from "./scorm.ts";
import { Scorm2004Tracker } from "./scorm2004.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { OSObject, QuizContent } from "./types.ts";

export const tick = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));
export const feedback = { correct: "layer-correct", incorrect: "layer-retry" };

/** A question as an author writes it: everything but the scoring and the feedback layers, whichever kind it is. */
export type Body<T = QuizContent> = T extends QuizContent ? Omit<T, "scoring" | "feedback"> : never;

/** The example course with its one question replaced by this one: 12 points, two tries. */
export function courseWith(content: Body) {
  const pkg = examplePackage();
  const slide = pkg.slides.find((s) => s.id === "slide-002")!;
  const quiz = [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).find((o) => o.id === "obj-0011")!;
  quiz.content = { scoring: { points: 12, attemptsAllowed: 2 }, feedback, ...content } as unknown as Record<string, unknown>;
  const { rt, log } = newRuntime(pkg);
  rt.goTo("slide-002");
  return { rt, log, pkg };
}

/** What SCORM 1.2 is told for the question once it is answered. */
export async function told12(content: Body, answer: string) {
  const { rt } = courseWith(content);
  const lms = new FakeLms();
  const tracker = new Tracker(lms, rt);
  tracker.begin();
  rt.submitQuiz("obj-0011", answer, "click");
  await tick();
  return (key: string) => lms.data[`cmi.interactions.0.${key}`];
}

/** What SCORM 2004 is told, by a fake LMS that refuses an answer written the wrong way for its type. */
export async function told2004(content: Body, answer: string) {
  const { rt } = courseWith(content);
  const lms = new FakeLms2004();
  const tracker = new Scorm2004Tracker(lms, rt);
  tracker.begin();
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    rt.submitQuiz("obj-0011", answer, "click");
    await tick();
  } finally {
    console.warn = realWarn;
  }
  return { get: (key: string) => lms.data[`cmi.interactions.0.${key}`], warnings };
}

/** The object a question sits in on a slide. */
export const questionObject = (content: Body): OSObject => ({
  id: "obj-0040", type: "quizQuestion", name: "Question", geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0, z: 0 },
  content: { scoring: { points: 1, attemptsAllowed: 1 }, feedback, ...content },
  style: {}, accessibility: { altText: "Q", role: "group", tabOrder: 1, decorative: false }, states: {}, triggers: [],
  timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
}) as unknown as OSObject;

/** A question built on the stand-in page, with what it announced. */
export function built(content: Body, ctx: Partial<QuestionContext> = {}) {
  const said: string[] = [];
  const view: QuestionView = buildQuestion(asDoc(), questionObject(content), { editing: false, announce: (m) => said.push(m), ...ctx });
  return { view, root: view.el as unknown as FakeEl, said };
}
