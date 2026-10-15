# AI help with writing: design note (draft, nothing built)

Written 2026-10-15 for the author to approve. Nothing here is built. It adds a fourth kind of AI service, **text from a prompt**, beside the
voices and pictures in `docs/ai-generation.md`, so the editor can draft learning outcomes and test questions for the author to review.

## What it is for

- **Draft learning outcomes** from the text of the slides the author picks, written as measurable outcomes with action verbs.
- **Draft test questions** from a slide or a selection: multiple choice and true/false first, each with the answer, the wrong answers and
  the feedback for each wrong answer. The same drafts can be turned into the quiz kinds the editor already has.
- Later, if wanted: tighter wording, a reading-level check, a first draft of narration scripts.

The author is always the editor. A draft is shown in a dialog and **nothing is inserted until the author accepts it**. Nothing is
filled in silently (the rule in `CLAUDE.md` for `altText`, `role`, `tabOrder` and `decorative` holds here too).

## Providers

All use the author's own key, are off until the author adds a key **and** says yes, and send nothing from Publish or Preview.

| Service | Where it runs | How it is asked for JSON | Notes (from each service's own documentation, read 2026-10-15) |
| --- | --- | --- | --- |
| OpenAI | over the internet | Responses API, `text.format` with a JSON Schema | Same key and consent as voices and pictures. |
| Claude (Anthropic) | over the internet | Messages API, `output_config.format` with a JSON Schema | Haiku 5.5 is the cheapest tier (from $0.10 per million input tokens and $0.50 per million output); Sonnet 5.5 costs $2 and $10. |
| Gemini (Google) | over the internet | Interactions API, `response_format` with a JSON Schema | The documentation now leads with the Interactions endpoint, not `generateContent`. Check it again when this is built. |
| A model on the author's computer | the author's computer | a local server (below) | A later phase. No key, no internet, nothing leaves the computer. |

All three hosted services can be made to return JSON that follows a schema, so a draft question arrives as data the editor can check, not as
prose to be picked apart. Model names change often; the editor keeps a default model per service in its settings that the author can change,
and says which one it used. The author must always check their own charges on each service's account page (the same rule as for voices
and pictures; the editor does not show a charge).

## How it fits the project

- **A fourth plugin contract: text from a prompt.** `CLAUDE.md` says local models sit behind three plugin contracts (audio from text,
  captions from media, image from prompt). This adds a fourth. That sentence in `CLAUDE.md` and `docs/plugins.md` change with it, with the
  author's yes. Nothing model-specific enters the format or the renderer.
- **All traffic stays in Python**, in `tools/engines/`, one small file per service next to `openai_engine.py`. A key arrives in an
  environment variable (`OPENSTAGE_KEY_ANTHROPIC`, `OPENSTAGE_KEY_GEMINI`, as `OPENSTAGE_KEY_OPENAI` does now), the model in
  `OPENSTAGE_MODEL_<SERVICE>_TEXT`, and permission as `--allow-network <service>`. The Rust shell reads the key and the author's yes from the
  settings file and validates what comes back, as it does for voices and pictures.
- **A live test**, like `TEST AI SERVICES.bat`, for each service the author has a key for. These services change their programming
  interfaces, so each one is built from its current documentation and then tried with a real key before it is called done.
- **No change to the project format** for the first phase. An accepted draft is an ordinary question or an ordinary objectives list. The
  checker and the validator treat it like anything the author typed. (See the open question about credits.)
- **What is sent** is only the text of the slides the author picked and the instruction, shown in a plain "this will be sent" step before
  the first send, with the number of characters. No images, no audio, no other part of the course, and never a key.

## Safeguards for what comes back

- The answer key is shown beside every question, and the author must be able to see and change it before accepting. A model sometimes marks
  the wrong choice as right; the editor says so in the dialog.
- A draft is checked by the existing validator rules before it can be inserted (every question has a correct answer, feedback is present, text
  has a reading route).
- The dialog is fully keyboard operable, has no keyboard trap, and announces when a draft is ready, as the other dialogs do. This is the
  ATAG rule for the editor itself.
- Text the learner will read that is drafted this way still needs audio: the editor offers narration for it as it does for anything else.

## Local models (a later phase)

A small model on the author's computer would work with no key and no internet, and some are licensed Apache 2.0 like this project. From their
own model cards (read 2026-10-15): **Qwen3.5-4B** (Apache 2.0, about 4 billion parameters, reads pictures as well as text, 201 languages, long
context, and its "thinking" mode can be switched off), **Qwen3.5-9B** (Apache 2.0, about 9 billion parameters, long context) and **SmolLM3-3B**
(Apache 2.0, 3 billion parameters, English, French, Spanish, German, Italian and Portuguese). Qwen3.5-4B is the first to try: the author's
research (Perplexity, 2026-10-15) pointed to it, and its card confirms the licence, the picture input, and how to turn thinking off. The
benchmarks on a model card are the maker's own and do not show that a model writes good test questions; the trial below does. IBM Granite 4.1 8B
is reported as Apache 2.0 but was not confirmed. The longer list at github.com/eugeneyan/open-llms stops at January 2025, so it is a good
history but not a guide to today's models.

Open points before building it:

- **Does it write good enough questions?** The hosted services write better wrong answers than small models usually do. The plan is a short
  trial on three or four real slides of the author's, with the author judging the drafts side by side, before any work on bundling. The
  trial would try: quiz questions with a reason for each answer, written only from the supplied slide text; the same explanation at
  different reading levels; answers drawn only from supplied excerpts; and a first-draft description of a diagram or screenshot (a
  suggestion for the author's alt text, never filled in silently). With Qwen3.5-4B it would also compare thinking switched on and off, not
  assume that the slower mode writes better teaching material.
- **How it runs.** The editor would not bundle a model. It would talk to a local server that the author installs (for example llama.cpp or
  Ollama, both widely used and open source; their licences are to be confirmed), through the same text contract as the hosted services.
  Qwen's card describes servers that answer the same way OpenAI's service does, on the author's own computer, so a local model may need little
  more than a different address in the OpenAI engine. That is to be confirmed when it is built.
- **Licences.** Each model's licence is checked from its own card. A model is only ever downloaded by the author, with their yes, never
  shipped inside OpenStage. That also avoids the speech-model problem (the GPL parts), which is still open.
- **The computer.** The memory and graphics card of the author's main computer decide which sizes are practical.

## Open questions for the author

1. Should the credits page say when questions or outcomes were drafted by an AI service, as it does for AI pictures? It could go either way: it
   is honest, but the author has reviewed and owns the text. Saying so needs a format change (a version bump and a migration).
2. Which service is the default if more than one has a key: the one the author last used, or a choice every time?
3. Which memory and graphics card does the main computer have?

## Build order, if approved

1. The text contract, the OpenAI engine, and **Draft learning outcomes** in the editor, with a live test.
2. **Draft test questions**, inserted as a new quiz slide for review.
3. The Claude and Gemini engines, each with a live test.
4. The short local-model trial, then a decision on the local phase.
