// The page the video maker opens in a browser that has no window (video.ts). It is the course's own renderer, the one the player and the
// editor use, with nothing around it: no navigation, no narration bar, no learner. The video maker asks it to draw a slide, says what is
// timed on it, and then puts the slide in any state it asks for (which timed objects are showing, how far each effect has got), so a
// picture of that state can be taken. Nothing moves by itself: every effect is held at the point asked for.

import { StageRenderer, readingOrder, type StageBehavior } from "./stage.ts";
import { layerTiming } from "./layertiming.ts";
import { clampDuration } from "./animation.ts";
import { setPlayerText } from "./playertext.ts";
import type { FrameState, PreparedSlide } from "./videoplan.ts";
import type { CoursePackage } from "./types.ts";

const pkg = JSON.parse(document.getElementById("openstage-project")!.textContent ?? "{}") as CoursePackage;
setPlayerText(pkg.project.playerText);
document.documentElement.lang = pkg.project.meta.language;

// Nothing may move on its own while a picture is being taken.
const still = document.createElement("style");
still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; } html, body { margin: 0; background: #fff; } ::-webkit-scrollbar { display: none; }";
document.head.appendChild(still);

const { width, height } = pkg.project.stage;
const root = document.getElementById("openstage")!;
root.className = "os-player";
root.style.cssText = `padding: 0; gap: 0; min-height: 0; display: block; width: ${width}px; height: ${height}px;`;
const viewport = document.createElement("div");
viewport.className = "os-viewport";
viewport.style.cssText = `width: ${width}px; height: ${height}px; box-shadow: none;`;
const stageEl = document.createElement("div");
stageEl.className = "os-stage";
stageEl.style.width = `${width}px`;
stageEl.style.height = `${height}px`;
viewport.appendChild(stageEl);
root.replaceChildren(viewport);

const initial = (id: string) => pkg.project.variables.find((v) => v.id === id)?.initial;
const behavior: StageBehavior = {
  variables: () => pkg.project.variables,
  variableValue: initial,
  course: () => ({ title: pkg.project.meta.title, language: pkg.project.meta.language }),
  characters: () => pkg.project.characters ?? [],
  fileSize: (path) => pkg.fileSizes?.[path],
  itemAudio: () => false,
  descriptionAudio: () => null,
};
const stage = new StageRenderer(document, stageEl, behavior, pkg.theme);
let drawn = -1;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Until what is drawn is ready to be photographed: fonts, pictures, the first picture of each video, and two turns of drawing. */
async function settle(): Promise<void> {
  await document.fonts.ready;
  await Promise.all(Array.from(stageEl.querySelectorAll("img")).map((img) => img.decode().catch(() => undefined)));
  await Promise.all(
    Array.from(stageEl.querySelectorAll("video")).map((v) => {
      if (v.readyState >= 2) return undefined;
      return new Promise<void>((resolve) => {
        v.addEventListener("loadeddata", () => resolve(), { once: true });
        v.addEventListener("error", () => resolve(), { once: true });
        v.preload = "auto";
        v.load();
        setTimeout(resolve, 3000);
      });
    }),
  );
  await Promise.race([new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), wait(300)]);
}

function prepare(index: number): PreparedSlide {
  const slide = pkg.slides[index];
  if (!slide) throw new Error(`There is no slide ${index + 1}.`);
  stage.render(slide, new Set());
  drawn = index;
  const timing = layerTiming(slide.baseLayer, {
    hasAudio: (id) => Boolean(pkg.narration[id]?.audio),
    paragraphCount: (id) => stage.paragraphCount(id),
  });
  const followed = new Set<string>();
  for (const o of slide.baseLayer.objects) if (o.timing.appear === "media" && o.timing.media) followed.add(o.timing.media);
  const enter = slide.transition?.enter;
  return {
    id: slide.id,
    name: slide.name,
    entries: timing.entries,
    animations: [...timing.animations],
    followedClips: [...followed],
    narrated: readingOrder(slide.baseLayer.objects).flatMap((o) => (pkg.narration[o.id]?.audio ? [o.id] : [])),
    advanceMs: slide.duration,
    autoSteps: slide.autoSteps ?? null,
    arrives: Boolean(enter && enter.effect !== "none"),
  };
}

async function show(index: number, state: FrameState): Promise<void> {
  if (drawn !== index) prepare(index);
  // Everything is put as it stands, with no effect; then each effect that is partway is started and held at its point.
  stage.endAnimations();
  for (const [id, visible] of Object.entries(state.visible)) stage.setObjectTimed(id, visible);
  const setTimeoutNow = window.setTimeout;
  // An effect asks for a timer that would finish it a little after its time. A picture is not taken in effect time, so none is wanted.
  window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
  try {
    for (const f of state.flying) {
      const before = new Set(document.getAnimations());
      if (f.phase === "enter") stage.setObjectTimed(f.id, true, f.effect);
      else {
        stage.setObjectTimed(f.id, true);
        stage.setObjectTimed(f.id, false, f.effect);
      }
      for (const a of document.getAnimations()) {
        if (before.has(a)) continue;
        a.pause();
        a.currentTime = f.progress * clampDuration(f.effect.duration);
      }
    }
  } finally {
    window.setTimeout = setTimeoutNow;
  }
  await settle();
}

declare global {
  interface Window {
    OpenStageVideo: { slideCount: number; stage: { width: number; height: number }; prepare: (index: number) => Promise<PreparedSlide>; show: (index: number, state: FrameState) => Promise<void> };
  }
}

window.OpenStageVideo = {
  slideCount: pkg.slides.length,
  stage: { width, height },
  prepare: async (index) => {
    const prepared = prepare(index);
    await settle();
    return prepared;
  },
  show,
};
