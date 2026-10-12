// Shared by the test files. Not part of the player.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime, type Host } from "./runtime.ts";
import type { CoursePackage, Project, Slide, Theme } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.join(here, "..", "..", "examples", "minimal.osproj");
const load = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(proj, rel), "utf-8")) as T;

export function examplePackage(): CoursePackage {
  return {
    project: load<Project>("project.json"),
    theme: load<Theme>("theme.json"),
    slides: [load<Slide>("slides/slide-001.json"), load<Slide>("slides/slide-002.json")],
    narration: {},
  };
}

export function newRuntime(pkg: CoursePackage = examplePackage()) {
  const log: string[] = [];
  const host: Host = {
    showSlide: (s) => log.push(`show ${s.id}`),
    setLayerVisible: (id, v) => log.push(`layer ${id} ${v}`),
    playMedia: (id) => log.push(`play ${id}`),
    pauseMedia: (id) => log.push(`pause ${id}`),
    setObjectState: (id, s) => log.push(`state ${id} ${s}`),
  };
  return { rt: new Runtime(pkg, host), log, pkg };
}
