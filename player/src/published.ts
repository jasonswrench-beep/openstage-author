// What a published page carries of the project: what the player reads, and nothing the author keeps only for the editor.
//
// The course data goes into index.html, where every learner can read it. The project and its slides also hold things that help the author
// and mean nothing to a learner: who wrote it and when it was last changed, the slide decks slides were imported from (by file name), what the
// project leaves out of its editable copy, the record of where a slide or shape was imported or recorded from (with what the import made of
// it), and, for a picture an AI service made, the words it was made from and the model. None of that is published. The credits page still
// says who or what made each file, as before.

import type { CoursePackage, CreditEntry, Layer, Project, Slide } from "./types.ts";

/** The project without what only the editor uses. Of its description the player reads the title, the language and when it was made (the xAPI course id). */
export function publishedProject(project: Project): Project {
  const { sources: _sources, sourceExclude: _exclude, meta, ...rest } = project;
  return { ...rest, meta: { title: meta.title, language: meta.language, created: meta.created } as Project["meta"] };
}

function publishedLayer(layer: Layer): Layer {
  return { ...layer, objects: layer.objects.map((o) => ({ ...o, provenance: null })) };
}

/** A slide without the record of where it and its objects were imported or recorded from. */
export function publishedSlide(slide: Slide): Slide {
  const { provenance: _provenance, ...rest } = slide;
  return { ...rest, baseLayer: publishedLayer(slide.baseLayer), layers: slide.layers.map(publishedLayer) };
}

/** A credit without the record of how an AI service made the file (the words, the model, the time): the page says only that it was made, and by which service. */
export function publishedCredit(entry: CreditEntry): CreditEntry {
  const { generated: _generated, ...source } = entry.source;
  return { ...entry, source };
}

/** The whole package as it goes into the page. */
export function publishedPackage(pkg: CoursePackage): CoursePackage {
  return {
    ...pkg,
    project: publishedProject(pkg.project),
    slides: pkg.slides.map(publishedSlide),
    ...(pkg.credits ? { credits: pkg.credits.map(publishedCredit) } : {}),
  };
}
