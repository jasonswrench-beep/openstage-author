// The Narration dialog: every narrated object in the course, slide by slide in the order they play, with whether its
// audio has been made, and the buttons that make what is missing. The audio is made by the voice's engine: Kokoro on this
// computer, a plugin, or an internet service the author has a key for. It can take a while and can be cancelled. Before
// the words of a script are sent to a service for the first time, the author is asked. A native <dialog>, so focus moves
// in, Tab stays inside, Escape closes it (or, while audio is being made, cancels that) and focus returns to where it came from.

import { audioPlan, availability, servicesToAsk, type AiSettings, type PluginInfo, type ServiceId } from "./aiservices.ts";
import { errorText, type Backend } from "./backend.ts";
import { narratedName, type Model, type NarratedObject } from "./model.ts";
import { NO_ENGINE_STATUS, RUNTIME_URL, engineLine, installQuestion, progressDetail, removeQuestion, stepText, type EngineStatus } from "./engine.ts";
import { audioStatus, engineOf, excerpt, formatBytes, formatDuration, totals, totalsLine, unusedAudio, type CachedAudio } from "./narration.ts";
import { makeAudio } from "./makeaudio.ts";

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

export interface NarrationDialogOptions {
  model: Model;
  backend: Backend;
  /** Whether Kokoro, the speech engine that runs on this computer, is set up. Without it audio cannot be made with its voices, but everything can still be read. */
  engine: boolean;
  /** The author's AI settings and the voice plugins found, as they are now. */
  ai: () => AiSettings;
  plugins: () => readonly PluginInfo[];
  /** Ask whether a service may be sent the narration. Resolves to true if the author says yes (and the editor keeps the answer). */
  ask: (service: ServiceId, detail: { narrations: number; characters: number }) => Promise<boolean>;
  /** The audio that has been made, as the editor last knew it. */
  cache: () => ReadonlyMap<string, CachedAudio>;
  /** Look at the disk again, and update what `cache` returns. */
  refresh: () => Promise<void>;
  announce: (message: string) => void;
}

/** What the dialog tells the editor when it closes: an object (or one of its items) to go to, if the author chose one. */
export interface NarrationDialogResult {
  goTo: NarratedObject | null;
}

export function openNarration(opts: NarrationDialogOptions): Promise<NarrationDialogResult> {
  const { model, backend: b } = opts;
  return new Promise((resolve) => {
    let running = false;
    let chosen: NarratedObject | null = null;

    const dialog = h("dialog", { class: "dialog wide narration-dialog", "aria-labelledby": "nr-title" });
    const summary = h("p", { class: "nr-summary" });
    // While audio is being made: a bar and a sentence, so the wait is not a mystery. Filled in from the audio that appears on the disk.
    const progressBar = h("progress", { id: "nr-progress", "aria-label": "Making audio", max: "1", value: "0" });
    const progressText = h("p", { class: "nr-progress-text", id: "nr-progress-text" });
    const progressBox = h("div", { class: "nr-progress", hidden: true }, progressBar, progressText);
    const plan = h("div", { class: "nr-plan" });
    let engineReady = opts.engine;
    let engineStatus: EngineStatus = NO_ENGINE_STATUS;
    const context = () => ({ ai: opts.ai(), kokoro: engineReady, plugins: opts.plugins() });
    const list = h("div", { class: "nr-list" });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const makeAll = h("button", { type: "button", text: "Make all missing audio" });
    const clearBtn = h("button", { type: "button", text: "Clear unused audio" });
    const closeBtn = h("button", { type: "button", text: "Close" });
    // The narration voice on this computer: whether it is there, and a button to install it (or take it away). What it is doing is said in the live line a step at a time; the detail of each step is not a live region, so a screen reader is not read every line pip prints.
    const engineText = h("p", { class: "note", id: "nr-engine-text" });
    const installBtn = h("button", { type: "button", id: "nr-engine-install", text: "Install the narration voice..." });
    const removeBtn = h("button", { type: "button", id: "nr-engine-remove", text: "Remove the narration voice..." });
    const runtimeBtn = h("button", { type: "button", id: "nr-engine-runtime", text: "Get Microsoft's Visual C++ runtime...", hidden: true });
    const engineDetail = h("p", { class: "note", id: "nr-engine-detail" });
    const engineBox = h("div", { class: "nr-engine", role: "group", "aria-labelledby": "nr-engine-title" }, h("h3", { id: "nr-engine-title", text: "Narration voice on this computer" }), engineText, h("div", { class: "btn-row" }, installBtn, removeBtn, runtimeBtn), engineDetail);

    const say = (text: string) => { status.textContent = text; };

    const renderEngine = () => {
      const line = engineLine(engineStatus);
      engineText.textContent = line.text;
      installBtn.hidden = !line.canInstall;
      removeBtn.hidden = !line.canRemove;
      runtimeBtn.hidden = !engineStatus.runtimeMissing;
      for (const b2 of [installBtn, removeBtn]) {
        if (running) b2.setAttribute("aria-disabled", "true");
        else b2.removeAttribute("aria-disabled");
      }
    };
    const refreshEngine = async () => {
      engineStatus = await b.engineStatus().catch(() => NO_ENGINE_STATUS);
      engineReady = await b.narrationEngine().catch(() => false);
      renderEngine();
    };

    const render = () => {
      const items = model.narratedObjects();
      const t = totals(items, opts.cache());
      summary.textContent = totalsLine(t);
      makeAll.textContent = t.missing > 0 ? `Make all missing audio (${t.missing})` : "Make all missing audio";
      plan.replaceChildren(...audioPlan(items.map((i) => i.narration), context()).map((line) => h("p", { class: "note", text: line })));
      const canMakeSome = items.some((i) => audioStatus(i.narration, opts.cache()).state === "missing" && availability(i.narration, context()).state !== "blocked");
      const can = canMakeSome && !running;
      if (can) makeAll.removeAttribute("aria-disabled"); else makeAll.setAttribute("aria-disabled", "true");
      const unused = unusedAudio(items.map((i) => i.narration), opts.cache());
      clearBtn.textContent = unused.length > 0 ? `Clear unused audio (${unused.length})` : "Clear unused audio";
      if (unused.length > 0 && !running) clearBtn.removeAttribute("aria-disabled"); else clearBtn.setAttribute("aria-disabled", "true");
      closeBtn.textContent = running ? "Cancel" : "Close";
      renderEngine();

      list.replaceChildren();
      let slideId = "";
      let group: HTMLElement | null = null;
      for (const item of items) {
        if (item.slideId !== slideId) {
          slideId = item.slideId;
          list.append(h("h3", { text: item.slideName }));
          group = h("ul", { class: "nr-items", role: "list" });
          list.append(group);
        }
        const s = audioStatus(item.narration, opts.cache());
        const av = availability(item.narration, context());
        const name = narratedName(item, model.slides.find((x) => x.id === item.slideId)?.baseLayer.id ?? "");
        const go = h("button", { type: "button", class: "small", text: "Go to", "aria-label": `Go to ${name}` });
        go.addEventListener("click", () => { chosen = item; finish(); });
        const make = h("button", { type: "button", class: "small", text: "Make audio", "aria-label": `Make audio for ${name}` });
        if (s.state === "ready" || av.state === "blocked" || running) make.setAttribute("aria-disabled", "true");
        make.addEventListener("click", () => { if (make.getAttribute("aria-disabled") !== "true") void run([item.key]); });
        group!.append(h("li", { class: "nr-row" },
          h("div", { class: "nr-text" },
            h("strong", { text: name }),
            h("span", { class: "nr-excerpt", text: excerpt(item.narration.script) })),
          h("span", { class: "nr-state", "data-key": item.key, text: s.state === "ready" ? `Audio ready, ${formatDuration(s.duration ?? 0)}` : av.state === "blocked" ? `Needs audio. ${av.short}` : av.state === "needs-permission" ? "Needs audio. You will be asked before anything is sent." : "Needs audio" }),
          h("div", { class: "nr-buttons" }, go, make)));
      }
      if (items.length === 0) list.append(h("p", { class: "note", text: "Select an object, then write what it should say in the Narration section of the Properties panel." }));
    };

    let starting = false;
    const run = async (asked: string[]) => {
      if (running || starting) return;
      starting = true;
      failure.textContent = "";
      const outcome = await makeAudio(
        {
          model, backend: b, ai: opts.ai, plugins: opts.plugins, kokoro: () => engineReady, ask: opts.ask, cache: opts.cache, refresh: opts.refresh,
        },
        asked,
        {
          started: ({ todo, text }) => {
            running = true;
            starting = false;
            render();
            say(text);
            progressBar.max = todo.length;
            progressBar.value = 0;
            progressBox.hidden = false;
          },
          progress: (view, todo, done, fresh) => {
            progressBar.value = view.done;
            progressBar.setAttribute("aria-valuetext", view.text);
            progressText.textContent = view.text;
            makeAll.textContent = `Making audio... ${view.short}`;
            for (const n of todo) {
              if (!done.has(n.key)) continue;
              const row = list.querySelector(`[data-key="${CSS.escape(n.key)}"]`);
              if (row) row.textContent = `Audio ready, ${formatDuration(audioStatus(n.narration, fresh).duration ?? 0)}`;
            }
          },
          milestone: say,
        },
      );
      starting = false;
      progressBox.hidden = true;
      running = false;
      say(outcome.state === "done" ? outcome.message : "");
      if (outcome.state !== "done") failure.textContent = outcome.message;
      render();
    };

    const finish = () => {
      dialog.close();
      dialog.remove();
      opts.announce("Narration closed.");
      resolve({ goTo: chosen });
    };
    const leave = async () => {
      if (running) {
        say("Cancelling.");
        await b.cancelJob().catch(() => false);
        return;
      }
      finish();
    };

    const installEngine = async () => {
      if (running || installBtn.getAttribute("aria-disabled") === "true") return;
      failure.textContent = "";
      if (!(await b.confirm(installQuestion()))) return;
      running = true;
      render();
      engineDetail.textContent = "";
      say("Installing the narration voice. This takes a few minutes, and you can cancel.");
      let step = 0;
      let off: () => void = () => undefined;
      try {
        off = await b.onEngineProgress((p) => {
          if (p.step !== step) {
            step = p.step;
            say(stepText(p.step, p.steps, p.label));
          }
          if (p.line !== "") engineDetail.textContent = progressDetail(p.line);
        });
        await b.engineInstall();
        await refreshEngine();
        await opts.refresh();
        say("The narration voice is installed. Choose Make all missing audio to use it.");
        engineDetail.textContent = "";
      } catch (err) {
        say("");
        engineDetail.textContent = "";
        failure.textContent = errorText(err);
        await refreshEngine();
      } finally {
        off();
        running = false;
        render();
        (engineStatus.state === "installed" ? makeAll : installBtn.hidden ? makeAll : installBtn).focus();
      }
    };
    installBtn.addEventListener("click", () => void installEngine());
    runtimeBtn.addEventListener("click", () => {
      failure.textContent = "";
      b.openUrl(RUNTIME_URL).then(
        () => say("Microsoft's page for the Visual C++ runtime is open in your browser. Install it, then press Install the narration voice."),
        (err) => { failure.textContent = errorText(err); },
      );
    });
    removeBtn.addEventListener("click", async () => {
      if (running || removeBtn.getAttribute("aria-disabled") === "true") return;
      failure.textContent = "";
      if (!(await b.confirm(removeQuestion(engineStatus.size)))) return;
      try {
        const freed = await b.engineRemove();
        await refreshEngine();
        await opts.refresh();
        say(`The narration voice is removed${freed > 0 ? `, freeing ${formatBytes(freed)}` : ""}.`);
      } catch (err) {
        failure.textContent = errorText(err);
        await refreshEngine();
      } finally {
        render();
        (installBtn.hidden ? makeAll : installBtn).focus();
      }
    });

    makeAll.addEventListener("click", () => { if (makeAll.getAttribute("aria-disabled") !== "true") void run([]); });
    clearBtn.addEventListener("click", async () => {
      if (clearBtn.getAttribute("aria-disabled") === "true" || running) return;
      failure.textContent = "";
      const unused = unusedAudio(model.narratedObjects().map((n) => n.narration), opts.cache());
      if (unused.length === 0) { say("Every audio file is used by a narration."); return; }
      if (model.dirty) {
        // The audio the saved version uses would look unused from here, so it would be cleared with the rest.
        failure.textContent = "Save the project first, so that audio the saved version uses is not cleared too.";
        return;
      }
      const bytes = unused.reduce((n, a) => n + (a.size ?? 0), 0);
      const files = `${unused.length} ${unused.length === 1 ? "audio file" : "audio files"}`;
      const sure = await b.confirm(`Delete ${files} that no narration uses any more${bytes > 0 ? ` (${formatBytes(bytes)})` : ""}? If you undo a change to a script, voice, speed or language, the audio for the old version will have to be made again, and an online voice charges you again.`);
      if (!sure) return;
      try {
        const n = await b.deleteNarrationAudio(model.dir, unused.map((a) => a.hash));
        await opts.refresh();
        say(`Cleared ${n} unused ${n === 1 ? "audio file" : "audio files"}${bytes > 0 ? `, freeing ${formatBytes(bytes)}` : ""}.`);
      } catch (err) {
        await opts.refresh().catch(() => undefined);
        failure.textContent = errorText(err);
      } finally {
        render();
      }
    });
    closeBtn.addEventListener("click", () => void leave());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void leave(); });

    dialog.append(
      h("h2", { id: "nr-title", text: "Narration" }),
      h("p", { class: "note", text: "Narration belongs to an object and plays when its slide opens, in reading order. An item of an interaction, such as a glossary term or a flip card, has its own narration, which plays when the learner opens that item. The captions and the transcript come from the script, so they always match what is said. To change a word, change the script and make its audio again." }),
      summary, progressBox, plan, engineBox, status, failure, list,
      h("div", { class: "dialog-actions" }, makeAll, clearBtn, closeBtn),
    );
    document.body.appendChild(dialog);
    render();
    dialog.showModal();
    makeAll.focus();
    // When nothing can be made only because the voice is not installed, the way forward is the install button, so it gets the keyboard.
    void refreshEngine().then(() => {
      const items = model.narratedObjects();
      const waiting = items.some((i) => audioStatus(i.narration, opts.cache()).state === "missing");
      const anyCanBeMade = items.some((i) => audioStatus(i.narration, opts.cache()).state === "missing" && availability(i.narration, context()).state !== "blocked");
      if (waiting && !anyCanBeMade && !installBtn.hidden && !running) {
        installBtn.focus();
        say("Nothing can be spoken yet because the narration voice is not installed. Press Install the narration voice to get it.");
      }
    });
  });
}
