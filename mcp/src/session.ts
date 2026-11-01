// What the server holds while an assistant is connected: the fence (files.ts), and the one project that is open, as the editor's own Model, so
// every change is made by the same code the editor uses and means exactly what it means there. Every change is saved as it is made.

import path from "node:path";
import { Model } from "../../editor/src/model.ts";
import { newProjectFiles } from "../../editor/src/template.ts";
import type { Layer, OSObject, Slide } from "../../player/src/types.ts";
import { Jail, createProjectFolder, readProject, writeProjectFiles } from "./files.ts";
import { ToolError } from "./protocol.ts";

export interface OpenProject {
  /** The name an assistant uses for it: the folder's name without .osproj. */
  name: string;
  dir: string;
  model: Model;
}

export class Session {
  private fence: Jail | null;
  current: OpenProject | null = null;

  constructor(jail: Jail | null = null) {
    this.fence = jail;
  }

  /** The fence round the folder an assistant may use. It is there once the settings have allowed a folder. */
  get jail(): Jail {
    if (!this.fence) throw new ToolError("MCP access is not set up: no folder has been chosen for an assistant to use.");
    return this.fence;
  }

  /**
   * Use this folder. If it is a different one from before, the project that was open is let go: what was changed in it is already saved, and
   * nothing that was opened under one folder is ever changed under another.
   */
  useFolder(folder: string): void {
    const next = new Jail(folder);
    if (this.fence?.root === next.root) return;
    this.fence = next;
    this.current = null;
  }

  open(name: string): OpenProject {
    const dir = this.jail.project(name);
    let opened;
    try {
      opened = readProject(dir);
    } catch (e) {
      if (e instanceof ToolError && /project\.json/.test(e.message)) throw new ToolError(`There is no project called ${name.replace(/\.osproj$/i, "")} in the folder. Ask list_projects for the names.`);
      throw e;
    }
    this.current = { name: path.basename(dir).replace(/\.osproj$/i, ""), dir, model: new Model(opened) };
    return this.current;
  }

  create(name: string, input: { title: string; author: string; language: string }): OpenProject {
    const dir = this.jail.project(name);
    createProjectFolder(dir, newProjectFiles({ ...input, today: new Date().toISOString().slice(0, 10) }));
    return this.open(name);
  }

  /** The open project, or a sentence that says to open one. */
  require(): OpenProject {
    if (!this.current) throw new ToolError("No project is open. Use open_project to open one, or create_project to make one.");
    return this.current;
  }

  /** Write what has changed. Returns how many files were written and removed. */
  save(): { written: number; removed: number } {
    const { dir, model } = this.require();
    const files = model.dirtyFiles();
    const removed = model.removedFiles();
    if (files.length === 0 && removed.length === 0) return { written: 0, removed: 0 };
    writeProjectFiles(dir, files, removed);
    model.markSaved(files);
    return { written: files.length, removed: removed.length };
  }

  /** A slide by its number (counting from 1), its id or its name. */
  slide(which: string | number): { slide: Slide; index: number } {
    const { model } = this.require();
    const slides = model.slides;
    const asNumber = typeof which === "number" ? which : /^\d+$/.test(which) ? Number(which) : NaN;
    const byId = typeof which === "string" ? slides.findIndex((s) => s.id === which) : -1;
    const byName = typeof which === "string" && byId === -1 ? slides.filter((s) => s.name.trim().toLowerCase() === which.trim().toLowerCase()) : [];
    const index = byId !== -1 ? byId : Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= slides.length ? asNumber - 1 : byName.length === 1 ? slides.indexOf(byName[0]!) : -1;
    if (index === -1) {
      if (byName.length > 1) throw new ToolError(`More than one slide is called "${which}". Use its number (1 to ${slides.length}) or its id.`);
      throw new ToolError(`There is no slide "${which}". The project has ${slides.length} ${slides.length === 1 ? "slide" : "slides"}, numbered 1 to ${slides.length}; get_course lists them.`);
    }
    return { slide: slides[index]!, index };
  }

  /** Find an object by its id on any slide and make it the one the model is working on, so the editor's operations act on it. */
  focus(objectId: string): { slide: Slide; layer: Layer; object: OSObject } {
    const { model } = this.require();
    for (const slide of model.slides) {
      for (const layer of [slide.baseLayer, ...slide.layers]) {
        const object = layer.objects.find((o) => o.id === objectId);
        if (!object) continue;
        model.selectSlide(slide.id);
        model.selectLayer(layer.id);
        model.selectObject(object.id);
        return { slide, layer, object };
      }
    }
    throw new ToolError(`There is no object ${objectId} in this project. get_slide lists the objects of a slide with their ids.`);
  }

  /** Make a slide (and its base layer) the one the model is working on. */
  focusSlide(which: string | number): { slide: Slide; index: number } {
    const found = this.slide(which);
    this.require().model.selectSlide(found.slide.id);
    return found;
  }
}
