// Course logic with no DOM in it: variables, triggers, conditions, layers, quiz scoring.
// The browser renderer (player.ts) and, later, the editor stage both drive this class, so
// the stage and the published player behave identically.

import type {
  Condition, CoursePackage, EventName, OSObject, Primitive, QuizContent, Slide, Trigger,
} from "./types.ts";

/** What the runtime asks the display layer to do. */
export interface Host {
  showSlide(slide: Slide): void;
  setLayerVisible(layerId: string, visible: boolean): void;
  playMedia(objectId: string): void;
  pauseMedia(objectId: string): void;
  setObjectState(objectId: string, state: string): void;
}

export interface QuizStatus {
  attempts: number;
  locked: boolean;
  result: "correct" | "incorrect" | null;
  score: number;
  /** The choice submitted most recently, so a resumed attempt can show it. */
  choice: string | null;
}

export type RuntimeEvent =
  | { type: "slide" }
  | { type: "state" }
  | { type: "quiz"; objectId: string; choiceId: string; correct: boolean }
  | { type: "input"; objectId: string; rowId: string; interaction: "choice" | "likert" | "true-false"; response: string };

/** Everything needed to put a learner back exactly where they were. */
export interface Snapshot {
  slide: string;
  /** Only variables that differ from their initial value. */
  vars: Record<string, Primitive>;
  /** Per quiz: attempts, locked (0 or 1), result (c, i or empty), score, last choice. */
  quiz: Record<string, [number, number, string, number, string]>;
  /** Layers showing on the current slide, other than the base layer. */
  layers: string[];
  /** One character per slide in course order: 1 if visited. */
  visited: string;
}

export interface AssessmentSummary {
  quizzes: number;
  locked: number;
  totalPoints: number;
  earnedPoints: number;
}

export interface QuizOutcome extends QuizStatus {
  correct: boolean;
}

const MAX_DEPTH = 50;

export function compare(actual: Primitive | undefined, op: Condition["operator"], expected: Primitive): boolean {
  if (actual === undefined) return false;
  switch (op) {
    case "equals": return actual === expected;
    case "notEquals": return actual !== expected;
    case "lessThan": return actual < expected;
    case "lessThanOrEqual": return actual <= expected;
    case "greaterThan": return actual > expected;
    case "greaterThanOrEqual": return actual >= expected;
  }
}

export class Runtime {
  readonly variables = new Map<string, Primitive>();
  readonly quiz = new Map<string, QuizStatus>();
  readonly visibleLayers = new Set<string>();
  readonly visited = new Set<string>();
  private readonly listeners: ((e: RuntimeEvent) => void)[] = [];
  private readonly slidesById = new Map<string, Slide>();
  private current: Slide | null = null;
  private depth = 0;

  readonly pkg: CoursePackage;
  private readonly host: Host;

  constructor(pkg: CoursePackage, host: Host) {
    this.pkg = pkg;
    this.host = host;
    for (const s of pkg.slides) this.slidesById.set(s.id, s);
    for (const v of pkg.project.variables) this.variables.set(v.id, v.initial);
  }

  get currentSlide(): Slide | null { return this.current; }

  get slideIndex(): number {
    return this.current ? this.pkg.slides.findIndex((s) => s.id === this.current!.id) : -1;
  }

  /** Every object on a slide, base layer first. */
  static objectsOf(slide: Slide): OSObject[] {
    return [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects);
  }

  onEvent(listener: (e: RuntimeEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(e: RuntimeEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Totals across every quiz in the course, answered or not. */
  assessment(): AssessmentSummary {
    const sum: AssessmentSummary = { quizzes: 0, locked: 0, totalPoints: 0, earnedPoints: 0 };
    for (const slide of this.pkg.slides) {
      for (const obj of Runtime.objectsOf(slide)) {
        if (obj.type !== "quizQuestion") continue;
        const q = obj.content as unknown as QuizContent;
        const st = this.quiz.get(obj.id);
        sum.quizzes += 1;
        sum.totalPoints += q.scoring.points;
        if (st?.locked) sum.locked += 1;
        sum.earnedPoints += st?.score ?? 0;
      }
    }
    return sum;
  }

  /** The quiz object with this id, on any slide. */
  findQuiz(objectId: string): OSObject | null {
    for (const slide of this.pkg.slides) {
      const hit = Runtime.objectsOf(slide).find((o) => o.id === objectId && o.type === "quizQuestion");
      if (hit) return hit;
    }
    return null;
  }

  snapshot(): Snapshot {
    const vars: Snapshot["vars"] = {};
    for (const v of this.pkg.project.variables) {
      const now = this.variables.get(v.id);
      if (now !== undefined && now !== v.initial) vars[v.id] = now;
    }
    const quiz: Snapshot["quiz"] = {};
    for (const [id, st] of this.quiz) {
      const result = st.result === "correct" ? "c" : st.result === "incorrect" ? "i" : "";
      quiz[id] = [st.attempts, st.locked ? 1 : 0, result, st.score, st.choice ?? ""];
    }
    const base = this.current?.baseLayer.id;
    return {
      slide: this.current?.id ?? "",
      vars,
      quiz,
      layers: [...this.visibleLayers].filter((l) => l !== base),
      visited: this.pkg.slides.map((s) => (this.visited.has(s.id) ? "1" : "0")).join(""),
    };
  }

  /** Put the course back as the snapshot describes. Unknown ids are ignored, so a course
   *  that was edited since the learner left still opens. Returns false if the slide is gone. */
  restore(snap: Snapshot): boolean {
    if (!this.slidesById.has(snap.slide)) return false;
    for (const [id, value] of Object.entries(snap.vars)) if (this.variables.has(id)) this.variables.set(id, value);
    for (const [id, [attempts, locked, result, score, choice]] of Object.entries(snap.quiz)) {
      if (!this.findQuiz(id)) continue;
      this.quiz.set(id, {
        attempts,
        locked: locked === 1,
        score,
        choice: choice || null,
        result: result === "c" ? "correct" : result === "i" ? "incorrect" : null,
      });
    }
    if (snap.visited.length === this.pkg.slides.length) {
      this.pkg.slides.forEach((s, i) => {
        if (snap.visited[i] === "1") this.visited.add(s.id);
      });
    }
    const slide = this.slidesById.get(snap.slide)!;
    const known = new Set(slide.layers.map((l) => l.id));
    this.visibleLayers.clear();
    for (const l of snap.layers) if (known.has(l)) this.visibleLayers.add(l);
    this.goTo(snap.slide, true);
    return true;
  }

  /** `resume` shows the slide without running its slideStart triggers or resetting layers,
   *  because the learner has already been through that. */
  goTo(slideId: string, resume = false): void {
    const next = this.slidesById.get(slideId);
    if (!next) return;
    if (this.current && !resume) this.fireSlideEvent(this.current, "slideEnd");
    this.current = next;
    if (!resume) this.visibleLayers.clear();
    this.visibleLayers.add(next.baseLayer.id);
    this.visited.add(next.id);
    this.host.showSlide(next);
    if (!resume) this.fireSlideEvent(next, "slideStart");
    this.emit({ type: "slide" });
  }

  /** Run the triggers on one object for one event. Returns how many ran. */
  fire(objectId: string, event: EventName): number {
    const obj = this.current && Runtime.objectsOf(this.current).find((o) => o.id === objectId);
    if (!obj) return 0;
    return this.runTriggers(obj.triggers, event);
  }

  /**
   * A learner changes an input. The chosen value goes into the input's variable, which can fire
   * triggers, and if the input is set to report, the answer is also sent on as an interaction.
   */
  setInput(objectId: string, rowId: string, variable: string, value: Primitive, interaction: "choice" | "likert" | "true-false", response: string): void {
    const obj = this.current && Runtime.objectsOf(this.current).find((o) => o.id === objectId);
    if (!obj || obj.type !== "input") return;
    this.setVariable(variable, value);
    if ((obj.content as { report?: boolean }).report) this.emit({ type: "input", objectId, rowId, interaction, response });
  }

  setVariable(id: string, value: Primitive): void {
    if (!this.variables.has(id)) return;
    if (this.variables.get(id) === value) return;
    this.variables.set(id, value);
    this.emit({ type: "state" });
    if (this.current) this.fireSlideEvent(this.current, "variableChange");
  }

  /**
   * A learner submits a quiz answer. `via` is the activation that submitted it, so the
   * object's own click and keyActivate triggers run as well as the built-in scoring.
   */
  submitQuiz(objectId: string, choiceId: string | null, via: "click" | "keyActivate"): QuizOutcome | null {
    const obj = this.current && Runtime.objectsOf(this.current).find((o) => o.id === objectId);
    if (!obj || obj.type !== "quizQuestion" || choiceId === null) return null;
    const q = obj.content as unknown as QuizContent;
    const status: QuizStatus = this.quiz.get(objectId) ?? { attempts: 0, locked: false, result: null, score: 0, choice: null };
    if (status.locked) return { ...status, correct: status.result === "correct" };

    const correct = q.choices.some((c) => c.id === choiceId && c.correct);
    status.attempts += 1;
    status.choice = choiceId;
    if (correct) {
      status.locked = true;
      status.result = "correct";
      status.score = q.scoring.points;
    } else {
      status.result = "incorrect";
      status.locked = status.attempts >= q.scoring.attemptsAllowed;
    }
    this.quiz.set(objectId, status);

    this.setLayer(q.feedback.correct, correct);
    this.setLayer(q.feedback.incorrect, !correct);
    this.fire(objectId, via);
    this.emit({ type: "quiz", objectId, choiceId, correct });
    return { ...status, correct };
  }

  // ---- internals

  private fireSlideEvent(slide: Slide, event: EventName): void {
    for (const obj of Runtime.objectsOf(slide)) this.runTriggers(obj.triggers, event);
  }

  private runTriggers(triggers: Trigger[], event: EventName): number {
    if (this.depth >= MAX_DEPTH) return 0;
    this.depth += 1;
    let ran = 0;
    try {
      for (const t of triggers) {
        if (t.event !== event) continue;
        if (!t.conditions.every((c) => compare(this.variables.get(c.variable), c.operator, c.value))) continue;
        ran += 1;
        // Rules run in order. A jump to another slide ends the list, so when several rules could send the
        // learner somewhere, the first one whose conditions hold decides, and the rest are left alone.
        if (this.act(t)) break;
      }
    } finally {
      this.depth -= 1;
    }
    return ran;
  }

  /** Do what a trigger says. Returns true if it moved the learner to another slide. */
  private act(t: Trigger): boolean {
    switch (t.action) {
      case "jumpToSlide": this.goTo(t.target); return true;
      case "showLayer": this.setLayer(t.target, true); break;
      case "hideLayer": this.setLayer(t.target, false); break;
      // A setVariable with no value means "set it to true". Only booleans make sense here.
      case "setVariable": this.setVariable(t.target, t.value ?? true); break;
      case "playMedia": this.host.playMedia(t.target); break;
      case "pauseMedia": this.host.pauseMedia(t.target); break;
      // The state name travels in `value`; "normal" returns to the object's own style.
      case "changeState": this.host.setObjectState(t.target, String(t.value ?? "normal")); break;
    }
    return false;
  }

  private setLayer(layerId: string, visible: boolean): void {
    if (this.current && layerId === this.current.baseLayer.id) return;
    if (visible === this.visibleLayers.has(layerId)) return;
    if (visible) this.visibleLayers.add(layerId);
    else this.visibleLayers.delete(layerId);
    this.host.setLayerVisible(layerId, visible);
    this.emit({ type: "state" });
  }
}
