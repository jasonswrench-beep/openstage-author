// The captions dialog: write, time, check and save the captions of a video or an audio clip, and make its transcript.
//
// What counts as a good caption, how WebVTT and SRT are read and written, and how a script becomes captions are in captions.ts, which has no screen
// and is tested alone. This dialog is where an author uses them: every caption is a labelled group of fields (when it starts, when it ends, its
// words), the video plays in the dialog so the times can be set while listening ("Start now", "End now"), and the captions shown over it are the
// ones in the list. Nothing is saved until the author presses Save, and what is hard to read is said in words and never stops the saving.
//
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it (after asking, if there are changes), and focus returns to the button
// that opened it.

import { errorText, type Backend } from "./backend.ts";
import {
  breakLongLines, buildTranscript, cuesFromScript, cueWarnings, DEFAULT_LIMITS, formatSrt, formatVtt, inOrder, newCueAfter, ordered, parseCaptions, parseClock, savingProblem,
  secondsField, trackWarnings, type Cue, type Extra,
} from "./captions.ts";

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

export interface CaptionsOptions {
  backend: Backend;
  /** The open course's folder. */
  dir: string;
  kind: "video" | "audio";
  /** The clip's file in the course, such as `assets/video/Lesson.mp4`. */
  mediaPath: string;
  /** Its captions file now, or null. */
  captions: string | null;
  /** Its transcript as plain text, or null if it has formatting the editor cannot edit (then it is left alone). */
  transcript: string | null;
  /** What is on the screen that the voice does not say (from a recording's edit), to put in the transcript. */
  extras: Extra[];
  /** How long the clip is, if something already knows. The clip itself is asked as well, and wins. */
  lengthMs: number | null;
  /** Called when the captions are saved: the captions file's path in the course, and the new transcript if the author changed it (else null). */
  apply: (captionsPath: string, transcript: string | null) => void;
}

const COURSE_CAPTIONS = /^assets\/captions\/[^/\\]+\.vtt$/;

const fileOf = (path: string): string => path.split("/").pop() ?? path;
const stemOf = (path: string): string => fileOf(path).replace(/\.[^.]*$/, "");

/** `12` seconds, or `1:05`: how a time is told to the author in a sentence. */
function say(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}` : `${s}`;
}

/** Resolves when the dialog is closed, with what the editor should say (empty if nothing was saved). */
export function openCaptions(opts: CaptionsOptions): Promise<string> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let cues: Cue[] = [];
    let lengthMs: number | null = opts.lengthMs;
    let dirty = false;
    /** The times came from a script, not from the voice, and nobody has said they are right. */
    let estimated = false;
    const undo: Cue[][] = [];
    const startTranscript = opts.transcript;

    const dialog = h("dialog", { class: "dialog wide captions-dialog", "aria-labelledby": "cap-title" });
    const status = h("p", { id: "cap-status", role: "status" });
    const speak = (...messages: string[]) => { status.textContent = messages.filter((m) => m !== "").join(" "); };

    // ---- the clip, to listen to while the times are set
    const player = h(opts.kind === "video" ? "video" : "audio", { id: "cap-player", controls: true, preload: "metadata", "aria-label": `The ${opts.kind}, to listen to while you set the times` });
    let track: TextTrack | null = null;
    let playerOk = false;
    const lengthNote = h("p", { id: "cap-length", class: "note" });
    const showLength = () => {
      lengthNote.textContent = lengthMs === null
        ? `The length of the ${opts.kind} is not known, so the captions cannot be checked against it.`
        : `The ${opts.kind} is ${say(lengthMs)} seconds long. The times below are seconds from its start; 1:05 means one minute and five seconds.`;
    };
    showLength();
    player.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(player.duration) && player.duration > 0) {
        lengthMs = Math.round(player.duration * 1000);
        showLength();
        refreshWarnings();
      }
    });

    // ---- the captions, one group of fields each
    const list = h("div", { id: "cap-list" });
    const summary = h("p", { id: "cap-summary", class: "note" });
    const checked = h("button", { type: "button", id: "cap-checked", text: "I have checked the times" });
    const estimateNote = h("div", { id: "cap-estimated", class: "note cap-estimated", hidden: true },
      h("p", { text: "These times are estimates, worked out from the script. Nothing has listened to the voice. Play the video, set each time so the caption matches what is said, then press the button." }), checked);
    const together = h("ul", { id: "cap-together", class: "rc-list", "aria-label": "About the captions together" });
    const addBtn = h("button", { type: "button", id: "cap-add", text: "Add a caption" });
    const orderBtn = h("button", { type: "button", id: "cap-order", text: "Put the captions in order of time" });
    const breakBtn = h("button", { type: "button", id: "cap-break", text: "Break long lines" });
    const undoBtn = h("button", { type: "button", id: "cap-undo", text: "Undo the last change to the list" });

    const rowEls: { start: HTMLInputElement; end: HTMLInputElement; text: HTMLTextAreaElement; warn: HTMLElement }[] = [];

    function remember(): void {
      undo.push(cues.map((c) => ({ ...c })));
      if (undo.length > 30) undo.shift();
      dirty = true;
    }

    function syncPreview(): void {
      if (!playerOk) return;
      try {
        if (track === null) {
          track = player.addTextTrack("captions", "Captions", "en");
          track.mode = "showing";
        }
        while (track.cues !== null && track.cues.length > 0) track.removeCue(track.cues[0]!);
        for (const c of cues) if (c.endMs > c.startMs && c.text.trim() !== "") track.addCue(new VTTCue(c.startMs / 1000, c.endMs / 1000, c.text));
      } catch {
        // The picture goes on without captions over it.
      }
    }

    /** Update what is said about each caption, and about all of them, without redrawing (so typing is never interrupted). */
    function refreshWarnings(): void {
      let hard = 0;
      cues.forEach((c, i) => {
        const w = cueWarnings(c);
        if (w.length > 0) hard++;
        const el = rowEls[i];
        if (el !== undefined) el.warn.textContent = w.join(" ");
      });
      const all = trackWarnings(cues, lengthMs);
      together.replaceChildren(...all.slice(0, 12).map((t) => h("li", { text: t })), ...(all.length > 12 ? [h("li", { text: `And ${all.length - 12} more.` })] : []));
      summary.textContent = cues.length === 0
        ? "There are no captions yet."
        : `${cues.length} ${cues.length === 1 ? "caption" : "captions"}. ${hard === 0 ? "None is hard to read." : `${hard} ${hard === 1 ? "has" : "have"} something that makes it hard to read; each says what, and you can still save.`}`;
      estimateNote.hidden = !estimated;
      orderBtn.toggleAttribute("disabled", inOrder(cues));
      undoBtn.toggleAttribute("disabled", undo.length === 0);
      syncPreview();
    }

    function timeField(index: number, which: "start" | "end"): HTMLInputElement {
      const c = cues[index]!;
      const id = `cap-${index}-${which}`;
      const input = h("input", { type: "text", id, size: "8", inputmode: "decimal", value: secondsField(which === "start" ? c.startMs : c.endMs) });
      input.addEventListener("change", () => {
        const ms = parseClock(input.value);
        const now = cues[index];
        if (now === undefined) return;
        if (ms === null) {
          speak("Write the time in seconds from the start, for example 12 or 12.5, or as minutes and seconds, like 1:05.");
          input.value = secondsField(which === "start" ? now.startMs : now.endMs);
          return;
        }
        remember();
        cues[index] = which === "start" ? { ...now, startMs: ms } : { ...now, endMs: ms };
        input.value = secondsField(ms);
        refreshWarnings();
      });
      return input;
    }

    function draw(focus?: { index: number; part: "start" | "end" | "text" } | "add"): void {
      rowEls.length = 0;
      list.replaceChildren(...cues.map((c, i) => {
        const start = timeField(i, "start");
        const end = timeField(i, "end");
        const text = h("textarea", { id: `cap-${i}-text`, rows: "2", "aria-describedby": `cap-${i}-warn` });
        text.value = c.text;
        text.addEventListener("input", () => {
          const now = cues[i];
          if (now === undefined) return;
          cues[i] = { ...now, text: text.value };
          dirty = true;
          refreshWarnings();
        });
        const warn = h("p", { id: `cap-${i}-warn`, class: "note cap-warn" });
        rowEls.push({ start, end, text, warn });
        const startNow = h("button", { type: "button", text: "Start now", "aria-label": `Start caption ${i + 1} at the time the ${opts.kind} is at now` });
        const endNow = h("button", { type: "button", text: "End now", "aria-label": `End caption ${i + 1} at the time the ${opts.kind} is at now` });
        for (const [btn, which, input] of [[startNow, "start", start], [endNow, "end", end]] as const) {
          btn.toggleAttribute("disabled", !playerOk);
          btn.addEventListener("click", () => {
            const now = cues[i];
            if (now === undefined) return;
            const ms = Math.round(player.currentTime * 1000);
            remember();
            cues[i] = which === "start" ? { ...now, startMs: ms } : { ...now, endMs: ms };
            input.value = secondsField(ms);
            refreshWarnings();
            speak(`Caption ${i + 1} ${which === "start" ? "starts" : "ends"} at ${say(ms)} seconds.`);
          });
        }
        const del = h("button", { type: "button", text: "Delete", "aria-label": `Delete caption ${i + 1}` });
        del.addEventListener("click", () => {
          remember();
          cues.splice(i, 1);
          draw(cues.length === 0 ? "add" : { index: Math.min(i, cues.length - 1), part: "text" });
          speak(`Deleted caption ${i + 1}. ${cues.length} left. You can undo it.`);
        });
        return h("fieldset", { class: "cap-row" },
          h("legend", { text: `Caption ${i + 1} of ${cues.length}` }),
          h("div", { class: "field" }, h("label", { for: start.id, text: "Starts at (seconds)" }), start),
          h("div", { class: "field" }, h("label", { for: end.id, text: "Ends at (seconds)" }), end),
          h("div", { class: "field" }, h("label", { for: text.id, text: "Words" }), text),
          warn,
          h("div", { class: "btn-row" }, startNow, endNow, del));
      }));
      refreshWarnings();
      if (focus === "add") addBtn.focus();
      else if (focus !== undefined) rowEls[focus.index]?.[focus.part]?.focus();
    }

    addBtn.addEventListener("click", () => {
      remember();
      cues.push(newCueAfter(cues, lengthMs));
      draw({ index: cues.length - 1, part: "text" });
      speak(`Added caption ${cues.length}. It starts where the one before it ends. Write its words.`);
    });
    orderBtn.addEventListener("click", () => {
      remember();
      cues = ordered(cues);
      draw();
      speak("The captions are now in order of time.");
      orderBtn.focus();
    });
    breakBtn.addEventListener("click", () => {
      const r = breakLongLines(cues);
      if (r.changed === 0) { speak("No caption has a line that is too long, or one that can be broken."); return; }
      remember();
      cues = r.cues;
      draw();
      speak(`Broke the long lines of ${r.changed} ${r.changed === 1 ? "caption" : "captions"} into lines of ${DEFAULT_LIMITS.maxChars} characters or fewer. You can undo it.`);
      breakBtn.focus();
    });
    undoBtn.addEventListener("click", () => {
      const before = undo.pop();
      if (before === undefined) return;
      cues = before;
      draw();
      speak(`Undone. ${cues.length} ${cues.length === 1 ? "caption" : "captions"}.`);
      undoBtn.focus();
    });

    checked.addEventListener("click", () => {
      estimated = false;
      dirty = true;
      refreshWarnings();
      speak("The times are no longer marked as estimates.");
      (rowEls[0]?.start ?? addBtn).focus();
    });

    /** Replace the list, asking first when it would lose captions that are there. */
    async function replaceCues(next: Cue[], told: string, fromScriptTimes = false): Promise<boolean> {
      if (cues.some((c) => c.text.trim() !== "") && !(await b.confirm(`This replaces the ${cues.length} ${cues.length === 1 ? "caption" : "captions"} you have now. You can undo it. Go on?`))) return false;
      remember();
      cues = next;
      estimated = fromScriptTimes;
      draw();
      speak(told);
      return true;
    }

    // ---- a script
    const script = h("textarea", { id: "cap-script", rows: "5" });
    const fromScript = h("button", { type: "button", id: "cap-from-script", text: "Make captions from this script" });
    fromScript.addEventListener("click", () => {
      void (async () => {
        const made = cuesFromScript(script.value, lengthMs);
        if (made.length === 0) { speak("Write or paste the words that are spoken first."); script.focus(); return; }
        const done = await replaceCues(made, `Made ${made.length} captions from the script. Their times are only estimates, spread over the ${opts.kind} by the length of each caption. Play the ${opts.kind} and change the times so each caption matches the voice.`, true);
        if (done) (rowEls[0]?.start ?? fromScript).focus();
      })();
    });

    // ---- a file
    const importBtn = h("button", { type: "button", id: "cap-import", text: "Bring in a .vtt or .srt file..." });
    importBtn.addEventListener("click", () => {
      void (async () => {
        try {
          const picked = await b.pickCaptionSource();
          if (!picked) return;
          const parsed = parseCaptions(await b.captionSourceRead(picked));
          if (parsed.cues.length === 0) { speak(`No captions could be read from ${fileOf(picked.replace(/\\/g, "/"))}. ${parsed.problems.join(" ")}`); return; }
          await replaceCues(parsed.cues, `Brought in ${parsed.cues.length} captions from ${fileOf(picked.replace(/\\/g, "/"))}. ${parsed.problems.join(" ")}`);
        } catch (err) {
          speak(`Could not bring in that file. ${errorText(err)}`);
        }
      })();
    });

    const copy = async (what: "WebVTT" | "SRT") => {
      const problem = savingProblem(cues);
      if (problem !== null) { speak(problem); return; }
      try {
        await navigator.clipboard.writeText(what === "WebVTT" ? formatVtt(ordered(cues)) : formatSrt(ordered(cues)));
        speak(`Copied the captions as ${what}. Paste them into any program that takes ${what} captions.`);
      } catch {
        speak("The captions could not be copied.");
      }
    };
    const copyVtt = h("button", { type: "button", text: "Copy as WebVTT" });
    const copySrt = h("button", { type: "button", text: "Copy as SRT" });
    copyVtt.addEventListener("click", () => void copy("WebVTT"));
    copySrt.addEventListener("click", () => void copy("SRT"));

    // ---- the transcript
    const transcript = h("textarea", { id: "cap-transcript", rows: "8" });
    transcript.value = startTranscript ?? "";
    const makeTranscript = h("button", { type: "button", id: "cap-make-transcript", text: "Make a transcript from the captions" });
    makeTranscript.addEventListener("click", () => {
      void (async () => {
        const text = buildTranscript(cues, opts.extras);
        if (text === "") { speak("There are no captions to make a transcript from yet."); return; }
        if (transcript.value.trim() !== "" && transcript.value.trim() !== text && !(await b.confirm("This replaces the transcript you have now. Go on?"))) return;
        transcript.value = text;
        dirty = true;
        speak(`Made a transcript of ${text.split(/\n\n/).length} paragraphs. ${opts.extras.length > 0 ? "What is on the screen is in square brackets where it happens." : ""} Read it and change it if you like.`);
        transcript.focus();
      })();
    });
    transcript.addEventListener("input", () => { dirty = true; });
    const transcriptBox = h("fieldset", {}, h("legend", { text: "Transcript" }),
      h("p", { class: "note", text: "A transcript is the words of the captions run together, so a learner can read the whole thing at once. It is shown under the player. For a recording, what is on the screen is put in square brackets where it happens." }),
      ...(startTranscript === null
        ? [h("p", { class: "note", text: "This transcript has formatting the editor cannot edit yet, so it is left as it is." })]
        : [h("div", { class: "btn-row" }, makeTranscript), h("div", { class: "field" }, h("label", { for: "cap-transcript", text: "Transcript" }), transcript)]));

    // ---- saving and leaving
    const save = h("button", { type: "button", id: "cap-save", text: "Save and use these captions" });
    const close = h("button", { type: "button", id: "cap-close", text: "Close without saving" });

    async function finish(): Promise<void> {
      if (dirty && !(await b.confirm("You have changes that are not saved. Close and lose them?"))) return;
      dialog.close();
      dialog.remove();
      resolve("");
    }

    async function saveAndUse(): Promise<void> {
      const problem = savingProblem(cues);
      if (problem !== null) { speak(problem); return; }
      const wasInOrder = inOrder(cues);
      const final = ordered(cues);
      const words = final.filter((c) => c.text.trim() !== "").length;
      const hard = final.filter((c) => cueWarnings(c).length > 0).length;
      try {
        const existing = opts.captions !== null && COURSE_CAPTIONS.test(opts.captions) ? opts.captions : null;
        const path = await b.captionsWrite(opts.dir, stemOf(opts.mediaPath), existing, formatVtt(final, { estimated }));
        const newTranscript = startTranscript !== null && transcript.value.trim() !== startTranscript.trim() ? transcript.value : null;
        opts.apply(path, newTranscript);
        dirty = false;
        dialog.close();
        dialog.remove();
        resolve(`Saved ${words} ${words === 1 ? "caption" : "captions"} in ${fileOf(path)}, and the ${opts.kind} now uses them.${wasInOrder ? "" : " They were put in order of time."}${estimated ? " The times are still marked as estimates, so check them." : ""}${hard > 0 ? ` ${hard} ${hard === 1 ? "is" : "are"} hard to read; open the captions again to see which.` : ""}${newTranscript !== null ? " The transcript was changed too." : ""}`);
      } catch (err) {
        speak(`The captions could not be saved. ${errorText(err)}`);
      }
    }

    save.addEventListener("click", () => void saveAndUse());
    close.addEventListener("click", () => void finish());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void finish(); });
    dialog.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveAndUse();
      }
    });

    dialog.append(
      h("h2", { id: "cap-title", text: `Write captions for ${fileOf(opts.mediaPath)}` }),
      h("p", { class: "note", text: `Captions are the words that are spoken, shown in time with the ${opts.kind}, for anyone who cannot hear it or has the sound off. Type them, start from a script, or bring in a .vtt or .srt file. Nothing is saved until you press Save. When you save, the captions are written again as plain WebVTT, so styling or positions in an older file are not kept.` }),
      h("div", { class: "cap-player" }, player),
      lengthNote,
      h("fieldset", {}, h("legend", { text: "Start from a script" }),
        h("div", { class: "field" }, h("label", { for: "cap-script", text: "The words that are spoken" }), script),
        h("p", { class: "note", text: "Nothing here listens to the voice. The captions are cut at the ends of sentences and clauses so each is short enough to read, and their times are estimates for you to check." }),
        h("div", { class: "btn-row" }, fromScript)),
      h("div", { class: "btn-row" }, importBtn, copyVtt, copySrt),
      h("h3", { text: "The captions" }),
      estimateNote, summary, together,
      list,
      h("div", { class: "btn-row" }, addBtn, orderBtn, breakBtn, undoBtn),
      transcriptBox,
      status,
      h("div", { class: "dialog-actions" }, save, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    summary.textContent = "Opening the captions.";

    // The clip is played straight from the course's folder. If it cannot be, the times are still typed by hand. Then the captions it has now are read.
    void (async () => {
      try {
        player.src = await b.mediaUrl(opts.dir, opts.mediaPath);
        playerOk = true;
      } catch {
        player.hidden = true;
        speak(`The ${opts.kind} could not be played here, so the times have to be typed.`);
      }
      if (opts.captions !== null) {
        try {
          const text = await b.captionsRead(opts.dir, opts.captions);
          if (text === undefined) speak(`The captions file ${fileOf(opts.captions)} is not in the course any more, so you are starting again.`);
          else {
            const parsed = parseCaptions(text);
            cues = parsed.cues;
            estimated = parsed.estimated;
            speak(`Opened ${cues.length} ${cues.length === 1 ? "caption" : "captions"} from ${fileOf(opts.captions)}. ${parsed.problems.join(" ")}`);
          }
        } catch (err) {
          speak(`The captions file could not be read, so you are starting again. ${errorText(err)}`);
        }
      }
      draw();
      (rowEls[0]?.text ?? script).focus();
    })();
  });
}
