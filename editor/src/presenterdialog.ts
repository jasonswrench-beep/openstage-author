// Insert > Presenter...: a presenter that speaks a slide's narration, made into a video on the slide (docs/presenter.md). Choose who speaks, how the picture
// is cut, whether it carries the "AI presenter" label, and whose words it says; the editor makes the speech if it is not made, asks the add-on for the mouth
// shapes, draws and records the clip, saves it with its captions, and puts it on the slide. With a presenter clip chosen, the same dialog says whether the clip
// still says what its narration says and makes it again.
//
// A native <dialog>, like the others: focus moves in, Tab stays inside, Escape closes it (and while a clip is being made, Escape stops it first). Every field is a
// labelled control, every choice a real radio button, and what is happening is said in a status line that a screen reader reads. The Model does the work
// (addPresenterClip, remakePresenterClip), each one undo step; this file asks, says, and runs the steps in order.

import type { Backend } from "./backend.ts";
import { formatVtt } from "./captions.ts";
import type { Model } from "./model.ts";
import { excerpt, keyOf, type Narration } from "./narration.ts";
import { nowStamp } from "./aiservices.ts";
import { clipMode, renderClip } from "./presenter/clip.ts";
import { captionsFromNarration, parseNarrationCues } from "./presenter/cues.ts";
import { parsePresenters, parseTrack, type PresenterInfo } from "./presenter/look.ts";
import { blockFor, clipStatus, creditForClip, FRAMINGS, fileHint, startingAltText, type Framing, type PresenterClipSpec } from "./presenter/status.ts";

type Attrs = Record<string, string | boolean>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

export interface PresenterHooks {
  backend: Pick<Backend, "narrationCache" | "makeNarration" | "readNarrationAudio" | "narrationCues" | "presenterAsk" | "presenterMouthTrack" | "savePresenterClip" | "captionsWrite">;
  announce: (message: string) => void;
}

const fileOf = (path: string): string => path.split("/").pop() ?? path;
const stemOf = (path: string): string => fileOf(path).replace(/\.[^.]*$/, "");
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Open the dialog on the slide being edited. Resolves when it is closed. */
export function openPresenter(m: Model, hooks: PresenterHooks): Promise<void> {
  return new Promise((resolve) => {
    const b = hooks.backend;
    const selected = m.object && m.presenterClip(m.object.id) ? m.object : null;
    const clipId = selected?.id ?? null;
    const speakable = m.speakableObjects();

    const dialog = h("dialog", { class: "dialog wide presenter-dialog", "aria-labelledby": "pr-title", "aria-describedby": "pr-intro" });
    const form = h("form", { method: "dialog" });
    const status = h("p", { class: "note", role: "status", "aria-live": "polite", id: "pr-status" });
    const say = (text: string): void => { status.textContent = text; hooks.announce(text); };
    const show = (text: string): void => { status.textContent = text; };

    let presenters: PresenterInfo[] = [];
    let controller: AbortController | null = null;
    let busy = false;
    const finish = (): void => { dialog.close(); dialog.remove(); resolve(); };

    const make = h("button", { type: "button", id: "pr-make", text: clipId ? "Make the clip again" : "Make the clip", disabled: true });
    const close = h("button", { type: "button", id: "pr-close", text: "Close" });
    const intro = h("p", { id: "pr-intro", class: "note", text: clipId
      ? "This is a clip a presenter made from the narration on this video. If the words or a choice below have changed since, make it again. It takes as long as the speech does."
      : "A presenter speaks the narration of a text on this slide. The clip goes on the slide as a video with captions, and the text stops speaking so the words are not said twice. Making it takes as long as the speech does." });

    // ---- who speaks
    const who = h("fieldset", {}, h("legend", { text: "Who speaks" }));
    const choiceOf = (name: string): HTMLInputElement | undefined => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((r) => r.checked);
    const alt = h("input", { type: "text", id: "pr-alt" });
    let altTouched = false;
    alt.addEventListener("input", () => { altTouched = true; });
    const chosenPresenter = (): PresenterInfo | undefined => presenters.find((p) => p.id === choiceOf("pr-who")?.value);

    // ---- the framing and the label
    const framing = h("fieldset", {}, h("legend", { text: "The shape of the picture" }));
    const now = selected?.presenter;
    for (const f of FRAMINGS) {
      const input = h("input", { type: "radio", name: "pr-framing", id: `pr-framing-${f.id}`, value: f.id, ...((now ? now.framing === f.id : f.id === "rounded") ? { checked: true } : {}) });
      framing.append(h("div", { class: "field check" }, input, h("label", { for: `pr-framing-${f.id}`, text: f.label })));
    }
    const label = h("input", { type: "checkbox", id: "pr-label", ...((now ? now.label : true) ? { checked: true } : {}) });
    const labelRow = h("div", { class: "field check" }, label, h("label", { for: "pr-label", text: "Show a small \"AI presenter\" label in the corner of the clip" }));

    // ---- whose words
    const words = h("div", { class: "field" });
    let from: HTMLSelectElement | null = null;
    let takeOff: HTMLInputElement | null = null;
    let newCaptions: HTMLInputElement | null = null;
    if (clipId && selected) {
      const n = selected.narration as Narration | null;
      const state = clipStatus(selected);
      words.append(
        h("p", { id: "pr-words", text: n ? `The words: ${excerpt(n.script, 160)}` : "This video has no narration, so there is nothing for the presenter to say." }),
        h("p", { id: "pr-state", class: "note", text: state === "out-of-date" ? "This clip is out of date: the narration or a choice has changed since it was made." : state === "up-to-date" ? "This clip says what its narration says." : "" }),
      );
      newCaptions = h("input", { type: "checkbox", id: "pr-captions", ...(state === "out-of-date" ? { checked: true } : {}) });
      words.append(h("div", { class: "field check" }, newCaptions, h("label", { for: "pr-captions", text: "Write new captions from the words (the clip then uses them instead of the ones it has; the old captions file is kept)" })));
    } else if (speakable.length > 0) {
      from = h("select", { id: "pr-from", "aria-describedby": "pr-from-note" });
      for (const o of speakable) from.append(h("option", { value: o.id, text: `${o.name}: ${excerpt(o.narration.script, 70)}` }));
      takeOff = h("input", { type: "checkbox", id: "pr-take", checked: true });
      words.append(
        h("label", { for: "pr-from", text: "The words to speak (the narration of)" }), from,
        h("p", { id: "pr-from-note", class: "note", text: "The voice, speed and language are the ones that narration has. Change them in Narration, then make the clip." }),
        h("div", { class: "field check" }, takeOff, h("label", { for: "pr-take", text: "Take the narration off that text, so the words are not said twice (you can undo it)" })),
      );
    } else {
      words.append(h("p", { id: "pr-words", text: "There is no narration on this slide for a presenter to speak. Write it first: Narration menu, Narration..., then come back." }));
    }

    const altRow = h("div", { class: "field" }, h("label", { for: "pr-alt", text: "Alt text: the presenter in words, for someone who cannot see the screen" }), alt);

    // ---- making it
    const stop = (): void => { controller?.abort(); };
    async function run(): Promise<void> {
      const presenter = chosenPresenter();
      const frame = (choiceOf("pr-framing")?.value ?? "rounded") as Framing;
      if (!presenter) { say("Choose who speaks first."); return; }
      const source = clipId ? selected : speakable.find((o) => o.id === from?.value);
      const sourceId = clipId ?? (source as { id: string } | undefined)?.id ?? "";
      const narration = (clipId ? (selected?.narration as Narration | null) : (source as { narration?: Narration } | undefined)?.narration) ?? null;
      if (!narration || narration.script.trim() === "") { say("There are no words for the presenter to say."); return; }
      const key = keyOf(narration);
      const labelOn = label.checked;
      controller = new AbortController();
      busy = true;
      make.disabled = true;
      close.textContent = "Stop";
      try {
        say("Looking for the speech that is already made.");
        let cache = await b.narrationCache(m.dir);
        if (!cache.some((c) => c.hash === key)) {
          say("The speech is not made yet. Making it now; this can take a minute.");
          const made = await b.makeNarration(m.dir, m.allFiles(), [sourceId]);
          if (!made.ok) throw new Error(made.cancelled ? "Stopped." : (made.message ?? "The speech could not be made."));
          cache = await b.narrationCache(m.dir);
          if (!cache.some((c) => c.hash === key)) throw new Error("The speech could not be made. The Narration dialog says what the speech engine needs.");
        }
        const wav = await b.readNarrationAudio(m.dir, key);
        say("Listening to the speech to find the mouth shapes.");
        const track = parseTrack(await b.presenterMouthTrack(m.dir, key));
        const seconds = Math.ceil(track.durationMs / 1000);
        const follows = track.source !== "phonemes"
          ? "The mouth follows the sound."
          : track.timing === "measured"
            ? "The mouth follows the words, each sound when the voice said it."
            : "The mouth follows the words, but when each sound falls inside its word is a guess. To time each one exactly, make the narration audio again with Kokoro.";
        const how = await clipMode();
        say(how === "fast"
          ? `${follows} Drawing and encoding the clip. It is ${seconds} seconds long and should take only a few.`
          : `${follows} Drawing and recording the clip. This window has no faster way, so it takes about ${seconds} seconds, as long as the speech. Keep this window in front until it is done.`);
        let said = 0;
        const clip = await renderClip({
          wav, track, look: presenter.look, label: labelOn, signal: controller.signal,
          onProgress: (fraction) => {
            const step = Math.floor(fraction * 4);
            if (step > said && step < 4) { said = step; say(`${step * 25} percent of the clip is made.`); }
            else show(`Making the clip: ${Math.round(fraction * 100)} percent.`);
          },
        });
        say("Saving the clip.");
        const src = await b.savePresenterClip(m.dir, fileHint(presenter, narration.script), clip.video);
        let captions = String(selected?.content["captions"] ?? "");
        let timed = "";
        if (!clipId || newCaptions?.checked || captions === "") {
          // Timed from the narration's own timing when it has some: when each sentence is spoken, as the speech engine reported it.
          const timing = parseNarrationCues(await b.narrationCues(m.dir, key).catch(() => null));
          const made = captionsFromNarration(timing, narration.script, clip.speechMs, clip.speechStartMs);
          captions = await b.captionsWrite(m.dir, stemOf(src), null, formatVtt(made.cues, { estimated: made.estimated }));
          timed = made.fromVoice ? "timed from the voice" : "with estimated times";
        }
        const block = blockFor(narration, { id: presenter.id, tier: "lite", framing: frame, label: labelOn });
        const spec: PresenterClipSpec = {
          src, captions, altText: alt.value.trim() === "" ? startingAltText(presenter) : alt.value.trim(), narration, block,
          credit: creditForClip({ path: src, presenter, script: narration.script, madeAt: nowStamp() }),
          takeNarrationFrom: !clipId && takeOff?.checked ? sourceId : null,
        };
        const placed = clipId ? m.remakePresenterClip(clipId, spec) : m.addPresenterClip(spec);
        if (!placed) throw new Error("There is no slide to put the clip on.");
        busy = false;
        controller = null;
        const msg = clipId
          ? `The clip is made again and ${fileOf(src)} is in place of the old one. The captions were ${timed ? `written from the words, ${timed}${timed.startsWith("with") ? ": play the clip and check them in Write captions" : ""}` : "left as they were"}.`
          : `The presenter is on the slide, a ${frame === "circle" ? "circle" : frame === "rounded" ? "rounded square" : "square"} you can move and resize. Its captions are written from the words, ${timed}${timed.startsWith("with") ? ": play it and check them in Write captions" : ""}. The narration of the text it spoke was taken off; undo puts everything back.`;
        hooks.announce(msg);
        resolve();
        dialog.close();
        dialog.remove();
        return;
      } catch (e) {
        const stopped = e instanceof Error && e.name === "AbortError";
        say(stopped || errorText(e) === "Stopped." ? "Stopped. Nothing was changed." : `The clip could not be made. ${errorText(e)}`);
        make.disabled = presenters.length === 0;
      } finally {
        busy = false;
        controller = null;
        close.textContent = "Close";
      }
    }

    make.addEventListener("click", () => { void run(); });
    close.addEventListener("click", () => { if (busy) stop(); else finish(); });
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); if (busy) stop(); else finish(); });
    form.addEventListener("submit", (e) => e.preventDefault());

    form.append(
      h("h2", { id: "pr-title", text: clipId ? "Presenter clip" : "Presenter" }), intro,
      words, who, framing, labelRow, ...(clipId ? [] : [altRow]), status,
      h("div", { class: "dialog-actions" }, make, close),
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
    (from ?? close).focus();

    // ---- ask the add-on who there is
    show("Asking the Presenter add-on who there is.");
    void (async () => {
      try {
        presenters = parsePresenters(await b.presenterAsk("presenter.presenters"));
      } catch (e) {
        say(`The Presenter add-on did not answer. ${errorText(e)}`);
        return;
      }
      if (presenters.length === 0) { say("The Presenter add-on has no presenters to offer."); return; }
      const have = selected?.presenter?.id;
      presenters.forEach((p, i) => {
        const input = h("input", { type: "radio", name: "pr-who", id: `pr-who-${p.id}`, value: p.id, ...((have ? have === p.id : i === 0) ? { checked: true } : {}) });
        input.addEventListener("change", () => { if (!altTouched) alt.value = startingAltText(p); });
        who.append(h("div", { class: "field check" }, input, h("label", { for: `pr-who-${p.id}`, text: `${p.name}: ${p.description}` })));
      });
      const first = chosenPresenter();
      if (first) alt.value = startingAltText(first);
      const canMake = (await clipMode()) !== null;
      const ready = canMake && (clipId !== null ? Boolean(selected?.narration) : speakable.length > 0);
      make.disabled = !ready;
      show(!canMake ? "This window cannot make video, so a clip cannot be made here." : ready ? "Choose who speaks, then press Make the clip." : status.textContent ?? "");
      if (ready) hooks.announce(`${presenters.length} presenters to choose from.`);
    })();
  });
}
