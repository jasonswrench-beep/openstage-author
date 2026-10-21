// The published player: course chrome (navigation, narration controls) around the shared
// StageRenderer, wired to the course runtime. The editing stage uses the same StageRenderer.

import { Runtime, type Host, type Snapshot } from "./runtime.ts";
import { NarrationBar, itemNarrationKey } from "./narration.ts";
import { hasAnimation, reducedMotion, type Phase } from "./animation.ts";
import { Timeline, isTimed } from "./timeline.ts";
import { MediaFollower } from "./follow.ts";
import { attachTracker, courseResults } from "./scorm.ts";
import { creditParts } from "./credits.ts";
import { shouldReflow } from "./reflow.ts";
import { StageRenderer, button, el, readingOrder, type StageBehavior } from "./stage.ts";
import type { CoursePackage, Effect, ObjectAnimation, Slide } from "./types.ts";

export { readingOrder } from "./stage.ts";

export class Player implements Host {
  readonly runtime: Runtime;
  private readonly stage: StageRenderer;
  private readonly stageEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly announcer: HTMLElement;
  private readonly narration: NarrationBar;
  private readonly timeline: Timeline;
  /** Watches the video or audio clips that objects on the slide are timed to. */
  private readonly follower: MediaFollower;
  private readonly timingBar: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly showAllBtn: HTMLButtonElement;
  private readonly animateBtn: HTMLButtonElement;
  /** The animation of each object on the slide that has a timing or an entrance to play, by object id. */
  private readonly animations = new Map<string, ObjectAnimation>();
  /** The learner turned animation off with the button, whatever their device says. */
  private animationOff = false;
  private started = false;

  private readonly root: HTMLElement;
  readonly pkg: CoursePackage;

  constructor(root: HTMLElement, pkg: CoursePackage) {
    this.root = root;
    this.pkg = pkg;
    this.runtime = new Runtime(pkg, this);

    const doc = root.ownerDocument;
    doc.documentElement.lang = pkg.project.meta.language;
    doc.title = pkg.project.meta.title;

    root.classList.add("os-player");
    root.innerHTML = "";
    const main = el(doc, "main", "os-main");
    const viewport = el(doc, "div", "os-viewport");
    this.stageEl = el(doc, "div", "os-stage");
    this.stageEl.style.width = `${pkg.project.stage.width}px`;
    this.stageEl.style.height = `${pkg.project.stage.height}px`;
    viewport.appendChild(this.stageEl);
    main.appendChild(viewport);

    const nav = el(doc, "nav", "os-nav");
    nav.setAttribute("aria-label", "Course navigation");
    this.backBtn = button(doc, "Back", "os-nav-btn");
    this.nextBtn = button(doc, "Next", "os-nav-btn");
    this.labelEl = el(doc, "span", "os-nav-label");
    nav.append(this.backBtn, this.labelEl, this.nextBtn);
    if (pkg.project.credits && pkg.credits && pkg.credits.length > 0) nav.appendChild(this.creditsButton(doc, pkg.credits));
    this.backBtn.addEventListener("click", () => this.step(-1));
    this.nextBtn.addEventListener("click", () => this.step(1));

    this.announcer = el(doc, "div", "os-sr-only");
    this.announcer.setAttribute("role", "status");

    // Timing: things that appear, disappear or move on by themselves. A learner can always pause it and can always show
    // everything at once (WCAG 2.2.1 and 2.2.2), so these controls come early in the page, with the narration controls.
    this.timeline = new Timeline({
      show: (id, instant) => this.stage.setObjectTimed(id, true, instant ? undefined : this.motion(id, "enter")),
      hide: (id, wasShowing) => this.stage.setObjectTimed(id, false, wasShowing ? this.motion(id, "exit") : undefined),
      advance: () => this.step(1),
      changed: () => this.syncTimingBar(),
    });
    this.follower = new MediaFollower({
      time: (id, ms) => this.timeline.clipTime(id, ms),
      failed: (id) => this.timeline.clipFailed(id),
    });
    this.timingBar = el(doc, "section", "os-timing");
    this.timingBar.setAttribute("aria-label", "Timing");
    this.timingBar.hidden = true;
    this.pauseBtn = button(doc, "Pause timing", "os-nav-btn");
    this.showAllBtn = button(doc, "Show everything now", "os-nav-btn");
    this.animateBtn = button(doc, "Turn off animation", "os-nav-btn");
    this.animateBtn.setAttribute("aria-pressed", "false");
    this.timingBar.append(this.pauseBtn, this.showAllBtn, this.animateBtn);
    this.animateBtn.addEventListener("click", () => {
      this.animationOff = !this.animationOff;
      if (this.animationOff) this.stage.endAnimations();
      this.syncTimingBar();
      this.say(this.animationOff ? "Animation turned off." : "Animation turned on.");
    });
    this.pauseBtn.addEventListener("click", () => {
      // Pausing the timing also pauses a clip that is playing, so everything holds still; resuming plays it again.
      if (this.timeline.paused) {
        this.timeline.resume();
        const played = this.follower.release();
        this.say(played > 0 ? "Timing resumed. The video or audio plays again." : "Timing resumed.");
      } else {
        this.timeline.pause();
        const stopped = this.follower.hold();
        this.say(stopped > 0 ? "Timing paused. The video or audio is paused too." : "Timing paused.");
      }
    });
    this.showAllBtn.addEventListener("click", () => {
      this.timeline.showEverything();
      this.say("Everything on this slide is now showing.");
    });

    // The stage draws; the runtime decides what objects do. This is where they meet.
    const behavior: StageBehavior = {
      onActivate: (obj, via) => this.runtime.fire(obj.id, via),
      onQuizSubmit: (obj, choice, via) => this.runtime.submitQuiz(obj.id, choice, via),
      quizStatus: (id) => this.runtime.quiz.get(id),
      onInput: (obj, c) => this.runtime.setInput(obj.id, c.rowId, c.variable, c.value, c.type, c.response),
      variableValue: (id) => this.runtime.variables.get(id),
      results: () => courseResults(this.runtime),
      course: () => ({ title: pkg.project.meta.title, language: pkg.project.meta.language }),
      fileSize: (path) => pkg.fileSizes?.[path],
      itemAudio: (objectId, itemId) => Boolean(pkg.narration[itemNarrationKey(objectId, itemId)]?.audio),
      descriptionAudio: (objectId, cueId) => pkg.narration[itemNarrationKey(objectId, cueId)]?.audio ?? null,
      playItem: (objectId, itemId) => {
        const key = itemNarrationKey(objectId, itemId);
        const asset = pkg.narration[key];
        if (asset) this.narration.playNow([{ id: key, asset }]);
      },
      playItems: (objectId, itemIds) => {
        const items = itemIds.flatMap((itemId) => {
          const key = itemNarrationKey(objectId, itemId);
          const asset = pkg.narration[key];
          return asset ? [{ id: key, asset }] : [];
        });
        this.narration.playNow(items);
      },
      characters: () => pkg.project.characters ?? [],
      scenarioPath: (objectId) => this.runtime.scenarioPath(objectId),
      onScenarioMove: (obj, move) => this.runtime.scenarioMove(obj.id, move),
      announce: (msg) => {
        this.announcer.textContent = "";
        requestAnimationFrame(() => (this.announcer.textContent = msg));
      },
      onMediaEnded: (id) => this.runtime.fire(id, "mediaComplete"),
    };
    this.stage = new StageRenderer(doc, this.stageEl, behavior, pkg.theme);
    // A variable changed (a rule, a choice in a scenario, a choice of character): a scenario on screen shows it.
    this.runtime.onEvent((e) => { if (e.type === "state") this.stage.refreshScenarios(); });

    // Narration controls come first in the page so the pause control is easy to reach (WCAG 1.4.2).
    this.narration = new NarrationBar(doc, {
      onStart: (id) => this.timeline.narrationStarted(id),
      onBlocked: () => this.timeline.narrationBlocked(),
    });
    root.append(this.narration.el, this.timingBar, main, nav, this.announcer);
    this.fitStage(viewport);
    new ResizeObserver(() => this.fitStage(viewport)).observe(root);
  }

  /** A button that opens the credits for the images and media in the course. It is a native dialog, so focus is kept inside it and Escape closes it. */
  private creditsButton(doc: Document, credits: NonNullable<CoursePackage["credits"]>): HTMLElement {
    const open = button(doc, "Credits", "os-nav-btn");
    const dialog = el(doc, "dialog", "os-credits") as HTMLDialogElement;
    dialog.setAttribute("aria-labelledby", "os-credits-title");
    const h = el(doc, "h2", "");
    h.id = "os-credits-title";
    h.textContent = "Credits";
    const list = el(doc, "ul", "os-credits-list");
    for (const c of credits) {
      const li = el(doc, "li", "");
      for (const part of creditParts(c)) {
        if (!("href" in part)) { li.append(doc.createTextNode(part.text)); continue; }
        const a = el(doc, "a", "") as HTMLAnchorElement;
        a.href = part.href;
        a.textContent = part.text;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(a);
      }
      list.appendChild(li);
    }
    const close = button(doc, "Close", "os-nav-btn");
    close.addEventListener("click", () => dialog.close());
    dialog.append(h, list, close);
    open.addEventListener("click", () => dialog.showModal());
    const wrap = el(doc, "span", "os-credits-wrap");
    wrap.append(open, dialog);
    return wrap;
  }

  /** Open the course, at the start or where a saved snapshot says the learner left off. */
  start(resume: Snapshot | null = null): void {
    if (resume && this.runtime.restore(resume)) return;
    const first = this.pkg.slides[0];
    if (first) this.runtime.goTo(first.id);
  }

  // ---- Host: what the runtime asks for

  showSlide(slide: Slide): void {
    // Layers already showing (a resumed slide with its feedback layer open) are built visible.
    const section = this.stage.render(slide, this.runtime.visibleLayers);

    // Set up the timing before the narration starts, so the first object's narration is heard by it.
    this.timeline.reset();
    this.animations.clear();
    // Objects timed to a video or audio clip follow that clip's own time. A clip that is not on the slide counts as one that cannot play.
    this.follower.detach();
    const followed = new Set<string>();
    for (const o of [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects)) {
      if (o.timing.appear === "media" && o.timing.media) followed.add(o.timing.media);
    }
    for (const clipId of followed) this.follower.attach(clipId, this.stage.mediaElement(clipId));
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      if (layer === slide.baseLayer || this.runtime.visibleLayers.has(layer.id)) this.timeLayer(layer);
    }
    this.timeline.setAdvance(slide.duration);

    this.narration.load(
      readingOrder(slide.baseLayer.objects).flatMap((o) => {
        const asset = this.pkg.narration[o.id];
        return asset ? [{ id: o.id, asset }] : [];
      }),
    );

    const idx = this.runtime.slideIndex;
    const total = this.pkg.slides.length;
    this.labelEl.textContent = `Slide ${idx + 1} of ${total}`;
    this.backBtn.disabled = idx <= 0;
    this.nextBtn.disabled = idx >= total - 1;
    this.root.ownerDocument.title = `${slide.name} - ${this.pkg.project.meta.title}`;

    // Move focus to the new slide so a screen reader announces it, and keyboard users
    // continue from its start. Not on first load, which must not steal focus.
    if (this.started) section.focus({ preventScroll: true });
    this.started = true;
  }

  /** Start timing the timed objects of a layer that is now showing. */
  private timeLayer(layer: Slide["baseLayer"]): void {
    // An object with an entrance to play is listed even when it is there from the start, so its arrival can be animated.
    const timed = layer.objects.filter((o) => isTimed(o.timing) || o.animation.enter.effect !== "none");
    for (const o of timed) this.animations.set(o.id, o.animation);
    if (timed.length > 0) this.timeline.addLayer(layer.id, timed.map((o) => ({ id: o.id, timing: o.timing, hasAudio: Boolean(this.pkg.narration[o.id]?.audio) })));
  }

  /** Say something to a screen reader. Emptying the region first makes it read the same words twice in a row; a short wait, not a frame, so it also works when the page is not being drawn. */
  private say(message: string): void {
    this.announcer.textContent = "";
    setTimeout(() => (this.announcer.textContent = message), 50);
  }

  /** The effect to play for an object arriving or leaving, or nothing if animation is off or the learner's device asks for less motion. */
  private motion(id: string, phase: Phase): Effect | undefined {
    if (this.animationOff || reducedMotion()) return undefined;
    const effect = this.animations.get(id)?.[phase];
    return effect && effect.effect !== "none" ? effect : undefined;
  }

  /** The timing controls show only on a slide that has timing, and the animation button only where something animates. */
  private syncTimingBar(): void {
    const timed = this.timeline.active;
    const animated = !reducedMotion() && [...this.animations.values()].some(hasAnimation);
    this.timingBar.hidden = !timed && !animated;
    this.pauseBtn.hidden = !timed;
    this.showAllBtn.hidden = !timed;
    this.animateBtn.hidden = !animated;
    this.animateBtn.textContent = this.animationOff ? "Turn on animation" : "Turn off animation";
    this.animateBtn.setAttribute("aria-pressed", String(this.animationOff));
    this.pauseBtn.textContent = this.timeline.paused ? "Resume timing" : "Pause timing";
    this.pauseBtn.setAttribute("aria-pressed", String(this.timeline.paused));
    this.showAllBtn.toggleAttribute("disabled", this.timeline.allShown);
  }

  setLayerVisible(layerId: string, visible: boolean, narrate = true): void {
    this.stage.setLayerVisible(layerId, visible);
    const layer = this.runtime.currentSlide && [this.runtime.currentSlide.baseLayer, ...this.runtime.currentSlide.layers].find((l) => l.id === layerId);
    if (layer) {
      if (visible) this.timeLayer(layer); else this.timeline.removeLayer(layerId);
    }
    if (visible && narrate) {
      const slide = this.runtime.currentSlide;
      const layer = slide && [slide.baseLayer, ...slide.layers].find((l) => l.id === layerId);
      this.narration.playNow(
        (layer ? readingOrder(layer.objects) : []).flatMap((o) => {
          const asset = this.pkg.narration[o.id];
          return asset ? [{ id: o.id, asset }] : [];
        }),
      );
    }
  }

  playMedia(objectId: string): void {
    this.stage.playMedia(objectId);
  }

  pauseMedia(objectId: string): void {
    this.stage.pauseMedia(objectId);
  }

  setObjectState(objectId: string, state: string, quiet = false): void {
    const said = this.stage.setObjectState(objectId, state);
    if (said && !quiet) this.say(said);
  }

  private step(delta: number): void {
    const next = this.pkg.slides[this.runtime.slideIndex + delta];
    if (next) this.runtime.goTo(next.id);
  }

  private fitStage(viewport: HTMLElement): void {
    const { width, height } = this.pkg.project.stage;
    // Subtract the 12px of padding on each side of the player.
    const room = (this.root.clientWidth || width + 24) - 24;
    // On a narrow window, or a page zoomed in, a shrunken stage cannot be read and a full-size one needs scrolling sideways, so
    // the objects are shown in one column instead (WCAG 1.4.10).
    const reflow = shouldReflow(room, width);
    viewport.classList.toggle("os-reflow", reflow);
    viewport.parentElement?.classList.toggle("os-reflow", reflow);
    this.stage.setReflow(reflow);
    if (reflow) {
      this.stageEl.style.width = "";
      this.stageEl.style.height = "";
      this.stageEl.style.transform = "";
      viewport.style.width = "";
      viewport.style.height = "";
      return;
    }
    this.stageEl.style.width = `${width}px`;
    this.stageEl.style.height = `${height}px`;
    const scale = Math.min(1, room / width);
    this.stageEl.style.transform = `scale(${scale})`;
    viewport.style.width = `${width * scale}px`;
    viewport.style.height = `${height * scale}px`;
  }
}

/** Entry point used by the published page. */
export function mount(): void {
  const data = document.getElementById("openstage-project");
  const root = document.getElementById("openstage");
  if (!data || !root) return;
  const pkg = JSON.parse(data.textContent ?? "") as CoursePackage;
  const player = new Player(root, pkg);
  // If an LMS is there, report to it and pick up where the learner left off. If not
  // (a preview opened straight from disk), the course just runs.
  const lms = attachTracker(window, player.runtime);
  player.start(lms?.resume ?? null);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
}
