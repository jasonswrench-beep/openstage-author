// The part of the captions dialog that listens to the voice (story D3): choose a speech model, download it when the author says so, give the recogniser the course's own words as a
// hint, listen to the clip, and hand back what was heard.
//
// Everything that decides what a caption is lives in recognition.ts and captions.ts, which have no screen and are tested alone. This is the screen: labelled fields and buttons that work
// by keyboard, a progress bar that is a real <progress>, one line that says whether the recogniser and the model are ready, and messages for the dialog's status line when something
// happens. The sound is read in this window (speechaudio.ts) and handed to the recogniser program through the shell; nothing is sent anywhere.

import { errorText, type Backend } from "./backend.ts";
import { dropNotes, dropSilent, encodeWav, joinPieces, megabytes, planPieces, soundMapOf, type SoundMap, type SpeechModel, type SpeechStatus, type Word } from "./recognition.ts";
import { decodeSpeech } from "./speechaudio.ts";

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

/** What the recogniser heard in a clip, after its notes and anything "heard" in silence were taken out. */
export interface Listened {
  words: Word[];
  /** How loud each moment of the clip is, to end captions where the voice stops. */
  sound: SoundMap;
  /** The length of the clip's sound, in milliseconds. */
  lengthMs: number;
  /** Notes about sounds, such as [BLANK_AUDIO], that were taken out. */
  notes: number;
  /** Words heard where the clip is silent, which were taken out. */
  silent: number;
  /** Things the author should know about, in words. */
  problems: string[];
}

export interface SpeechPanelOptions {
  backend: Backend;
  /** The open course's folder, and the clip's file in it. */
  dir: string;
  mediaPath: string;
  kind: "video" | "audio";
  /** The names and terms in the course, offered as the first guess of the words to listen for. */
  hint: string;
  /** Whether the dialog has captions whose times could be set by the voice. */
  haveCaptions: () => boolean;
  /** Something to tell the author (the dialog's status line). */
  say: (...messages: string[]) => void;
  /** What was heard: `write` makes captions from it, `place` sets the times of the captions already there. Resolves with whether the captions changed (then the dialog has already moved focus). */
  onHeard: (heard: Listened, mode: "write" | "place") => Promise<boolean>;
  /** The sound of the clip, for setting the times of the captions by where the voice pauses (no speech model). Resolves with whether the captions changed. */
  onGaps: (found: { sound: SoundMap; lengthMs: number }) => Promise<boolean>;
}

export interface SpeechPanel {
  element: HTMLElement;
  /** Whether a download or a listening is going on. */
  working: () => boolean;
  /** Stop what is going on, if anything. */
  stop: () => Promise<void>;
  /** Re-read whether the buttons can be used (the captions changed). */
  update: () => void;
}

export function mountSpeechPanel(opts: SpeechPanelOptions): SpeechPanel {
  const b = opts.backend;
  let status: SpeechStatus | null = null;
  let busy = false;
  let lastPercent = -1;

  const state = h("p", { id: "sp-state", class: "note" });
  const select = h("select", { id: "sp-model", "aria-describedby": "sp-model-note" });
  const modelNote = h("p", { id: "sp-model-note", class: "note" });
  const hint = h("textarea", { id: "sp-hint", rows: "2", "aria-describedby": "sp-hint-note" });
  hint.value = opts.hint;
  const download = h("button", { type: "button", id: "sp-download", text: "Download the speech model..." });
  const listen = h("button", { type: "button", id: "sp-listen", text: "Listen and write the captions" });
  const place = h("button", { type: "button", id: "sp-place", text: "Set the times of my captions by the voice" });
  const gaps = h("button", { type: "button", id: "sp-gaps", "aria-describedby": "sp-gaps-note", text: "Set the times of my captions by the quiet gaps in the voice" });
  const stop = h("button", { type: "button", id: "sp-stop", text: "Stop", hidden: true });
  const bar = h("progress", { id: "sp-progress", max: "100", "aria-label": "How far this has got", hidden: true });
  const barText = h("p", { id: "sp-progress-text", class: "note", hidden: true });

  const chosen = (): SpeechModel | undefined => status?.models.find((m) => m.id === select.value);

  function update(): void {
    const m = chosen();
    const ready = status?.ready === true;
    modelNote.textContent = m?.note ?? "";
    if (status === null) state.textContent = "Checking the speech recogniser.";
    else if (!ready) state.textContent = status.problem;
    else if (m === undefined) state.textContent = "No speech model is offered.";
    else if (!m.installed) state.textContent = `The model ${m.id} is not on this computer yet. It is ${megabytes(m.bytes)}. Download it once and it stays here.`;
    else state.textContent = `Ready. The model ${m.id} is on this computer, so nothing is downloaded or sent when it listens.`;
    select.disabled = busy || !ready || (status?.models.length ?? 0) === 0;
    download.hidden = !ready || m === undefined || m.installed;
    download.disabled = busy;
    if (m !== undefined) download.textContent = `Download the speech model (${megabytes(m.bytes)})...`;
    const canListen = ready && m?.installed === true && !busy;
    listen.disabled = !canListen;
    place.disabled = !canListen || !opts.haveCaptions();
    // The gaps need no model, so they work whether or not the recogniser is there.
    gaps.disabled = busy || !opts.haveCaptions();
    stop.hidden = !busy;
    bar.hidden = !busy;
    barText.hidden = !busy;
  }

  async function refresh(keep?: string): Promise<void> {
    try {
      status = await b.speechStatus();
    } catch (err) {
      status = { ready: false, problem: `The speech recogniser could not be checked. ${errorText(err)}`, folder: "", models: [] };
    }
    const current = keep ?? select.value;
    select.replaceChildren(...status.models.map((m) => h("option", { value: m.id, text: `${m.label}, ${megabytes(m.bytes)}, ${m.installed ? "downloaded" : "not downloaded yet"}` })));
    select.value = status.models.some((m) => m.id === current) ? current : (status.models.find((m) => m.installed) ?? status.models[0])?.id ?? "";
    update();
  }

  /** Show how far something has got: a percent, or a bar that just moves while nothing is known. */
  function progress(percent: number | null, words: string): void {
    barText.textContent = words;
    if (percent === null) bar.removeAttribute("value");
    else bar.value = Math.max(0, Math.min(100, percent));
    lastPercent = percent ?? -1;
  }

  let stopAsked = false;

  function begin(words: string): void {
    busy = true;
    lastPercent = -1;
    progress(null, words);
    update();
  }

  /** Done: the buttons come back, and focus goes to the button that was pressed (or the nearest one that can be used), unless something else has already taken it. */
  function end(focusTo: HTMLElement | null): void {
    busy = false;
    update();
    if (focusTo === null) return;
    const usable = (e: HTMLElement): boolean => !e.hidden && !(e as HTMLButtonElement).disabled;
    (usable(focusTo) ? focusTo : usable(listen) ? listen : select).focus();
  }

  async function downloadModel(): Promise<void> {
    const m = chosen();
    if (m === undefined || busy) return;
    const ok = await b.confirm(
      `Download the speech model ${m.id}? It is ${megabytes(m.bytes)}, from huggingface.co (a model made by OpenAI and shared under the MIT licence). It is kept on this computer in ${status?.folder ?? "the editor's folder"} and checked when it arrives. ` +
      `Nothing from your course is sent. You can stop it while it downloads. Go on?`,
    );
    if (!ok) return;
    begin(`Downloading ${m.id}...`);
    opts.say(`Downloading the speech model ${m.id}, ${megabytes(m.bytes)}. This takes a few minutes. You can stop it with the Stop button.`);
    let off: () => void = () => {};
    try {
      off = await b.onSpeechDownload((p) => {
        if (p.id !== m.id || p.total <= 0) return;
        const percent = Math.floor((p.done / p.total) * 100);
        if (percent !== lastPercent) progress(percent, `Downloading ${m.id}: ${megabytes(p.done)} of ${megabytes(p.total)} (${percent}%)`);
      });
      await b.speechDownload(m.id);
      opts.say(`The speech model ${m.id} is downloaded and its checksum is right. You can listen to the voice now.`);
    } catch (err) {
      opts.say(`The model was not downloaded. ${errorText(err)}`);
    } finally {
      off();
    }
    await refresh(m.id);
    end(listen);
  }

  async function listenTo(mode: "write" | "place", pressed: HTMLElement): Promise<void> {
    const m = chosen();
    if (m === undefined || busy) return;
    begin("Reading the sound...");
    stopAsked = false;
    opts.say(mode === "write" ? "Listening to the voice. This takes a fraction of the length of the recording." : "Listening to the voice to set the times of your captions.");
    let token: string | null = null;
    let off: () => void = () => {};
    let heard = false;
    try {
      const bytes = await b.mediaBytes(opts.dir, opts.mediaPath);
      progress(null, "Reading the sound...");
      const samples = await decodeSpeech(bytes);
      const lengthMs = Math.round(samples.length / 16);
      const sound = soundMapOf(samples);
      // A long clip is listened to in pieces, one after another, cut where the sound is quietest, and the words are joined with their times moved on.
      const pieces = planPieces(sound, samples.length);
      if (pieces.length > 1) opts.say(`This is ${Math.round(lengthMs / 60000)} minutes long, so it is listened to in ${pieces.length} parts, one after another. You can stop it at any time with the Stop button.`);
      let part = 0;
      const where = (): string => (pieces.length === 1 ? "" : `Part ${part + 1} of ${pieces.length}: `);
      off = await b.onSpeechProgress((p) => {
        const whole = Math.floor((part * 100 + p) / pieces.length);
        if (whole !== lastPercent) progress(whole, `${where()}Listening with ${m.id}: ${p}%`);
      });
      const answers: string[] = [];
      for (part = 0; part < pieces.length; part++) {
        if (stopAsked) throw new Error("Listening was stopped.");
        const piece = pieces[part]!;
        progress(pieces.length === 1 ? null : Math.floor((part * 100) / pieces.length), `${where()}Listening with ${m.id}...`);
        token = await b.speechAudioPut(encodeWav(samples.subarray(piece.fromSample, piece.toSample)));
        answers.push(await b.speechListen(token, m.id, hint.value));
        const done = token;
        token = null;
        void b.speechDrop(done).catch(() => undefined);
      }
      const parsed = joinPieces(answers, pieces.map((p) => p.fromMs));
      const clean = dropNotes(parsed.words);
      const awake = dropSilent(clean.words, sound);
      busy = false;
      update();
      heard = await opts.onHeard({ words: awake.words, sound, lengthMs, notes: clean.dropped, silent: awake.dropped, problems: parsed.problems }, mode);
    } catch (err) {
      const said = errorText(err);
      opts.say(/stopped/i.test(said) ? "Listening was stopped. Nothing was changed." : `${said} Nothing was changed.`);
    } finally {
      off();
      if (token !== null) void b.speechDrop(token).catch(() => undefined);
    }
    end(heard ? null : pressed);
  }

  /** Set the times of the captions by where the voice pauses. Needs only the sound: no model, nothing downloaded. */
  async function placeByTheGaps(): Promise<void> {
    if (busy) return;
    begin("Reading the sound...");
    opts.say("Reading the sound to find where the voice pauses.");
    let changed = false;
    try {
      const bytes = await b.mediaBytes(opts.dir, opts.mediaPath);
      const samples = await decodeSpeech(bytes);
      const lengthMs = Math.round(samples.length / 16);
      const sound = soundMapOf(samples);
      busy = false;
      update();
      changed = await opts.onGaps({ sound, lengthMs });
    } catch (err) {
      opts.say(`${errorText(err)} Nothing was changed.`);
    }
    end(changed ? null : gaps);
  }

  download.addEventListener("click", () => void downloadModel());
  listen.addEventListener("click", () => void listenTo("write", listen));
  place.addEventListener("click", () => void listenTo("place", place));
  gaps.addEventListener("click", () => void placeByTheGaps());
  stop.addEventListener("click", () => {
    opts.say("Stopping...");
    stopAsked = true; // between two parts of a long clip there is nothing running to cancel, so the loop looks at this
    void b.speechCancel();
  });
  select.addEventListener("change", update);

  const element = h("fieldset", { class: "speech-panel" },
    h("legend", { text: "Write the captions by listening to the voice" }),
    h("p", { class: "note", text: `The computer listens to the sound of the ${opts.kind} and writes what it hears, with the time of every word. It runs on this computer, and nothing is sent anywhere. It makes mistakes, especially with names and when there is noise or music, so what it writes is marked as unchecked until you have checked it. To set the times of captions you already have (typed, from a script, or brought in), write or bring them in first, then press the second button.` }),
    state,
    h("div", { class: "field" }, h("label", { for: "sp-model", text: "Speech model" }), select),
    modelNote,
    h("div", { class: "field" }, h("label", { for: "sp-hint", text: "Words to listen for" }), hint),
    h("p", { id: "sp-hint-note", class: "note", text: "Names and terms from your course, so they are heard right (for example Brightspace, or a person's name). They stay on this computer. Change them if you like." }),
    h("div", { class: "btn-row" }, download, listen, place, stop),
    bar, barText,
    h("div", { class: "btn-row" }, gaps),
    h("p", { id: "sp-gaps-note", class: "note", text: "This one needs no model and downloads nothing. It finds where the voice pauses, and starts each of your captions at the pause nearest to where its share of the speech should begin. It never changes your words. The times are only estimates, so they are marked as unchecked until you have played the recording and put right any that are off." }),
  );
  update();
  void refresh();

  return {
    element,
    working: () => busy,
    stop: async () => { if (busy) { await b.speechCancel(); } },
    update,
  };
}
