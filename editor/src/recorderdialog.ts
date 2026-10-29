// The OpenScreen dialog: record the screen from the editor.
//
// OpenScreen (the Capture module) is a separate program that the editor starts and talks to. This dialog is where an author chooses what to
// record and how, starts it, and controls it while it goes on: pause, resume, stop, start again, add a marker. What the recorder does is held
// by the RecorderController (capturecontroller.ts), not by this dialog, so a recording goes on if the dialog is closed, and the dialog shows it
// again when it is opened. Every state is a sentence, and the sentences that matter are spoken through a status region; the recorder also
// has keys that work from any program, because the author is looking at another program while they record.
//
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it, and focus returns to the button that opened it.

import { errorText, type Backend } from "./backend.ts";
import { CHECK_LIMIT_MS, checkArguments, parseFinding, summarise, type Finding } from "./capturecheck.ts";
import { runOneShot, type RecorderController } from "./capturecontroller.ts";
import { recordingNameOf } from "./recordingfolder.ts";
import {
  describeSession, formatTime, MAX_COUNTDOWN, parseProbe, parseWindow, recordingFolder, settingsProblem,
  type Interactions, type RecordSettings, type Session, type Source, type Target, type WindowChoice,
} from "./capturesession.ts";

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

export interface RecorderDialogOptions {
  backend: Backend;
  controller: RecorderController;
  /** The open course's folder: recordings are kept inside it. Null when no course is open. */
  dir: string | null;
  /** The choices as the author left them last time, and a way to keep them. */
  settings: RecordSettings;
  keepSettings: (s: RecordSettings) => void;
  /** Leave the recordings folder out of the published package. Returns what to tell the author, or null if it was already left out. */
  excludeCaptures: () => string | null;
  /** Open the editing screens on a recording of this course, by its folder name. Resolves when the author closes them. */
  editRecording: (name: string, newestTake?: boolean) => Promise<void>;
  /** Open the steps made from a recording of this course, by its folder name. Resolves when the author closes them. */
  makeSteps: (name: string) => Promise<void>;
}

let dialogOpen = false;
/** Whether the dialog is on screen, so the editor knows whether to speak a recording's news itself. */
export const recorderDialogOpen = (): boolean => dialogOpen;

const INTERACTION_CHOICES: { value: Interactions; label: string }[] = [
  { value: "off", label: "Note nothing (recommended)" },
  { value: "no-keys", label: "Note where the mouse goes and what is clicked" },
  { value: "on", label: "Note the mouse, what is clicked, and the keys pressed" },
];

export function openRecorder(opts: RecorderDialogOptions): Promise<void> {
  const b = opts.backend;
  const c = opts.controller;
  return new Promise((resolve) => {
    dialogOpen = true;
    const s: RecordSettings = { ...opts.settings, region: { ...opts.settings.region } };
    let sources: Source[] = [];
    let usable = false;
    let checking = false;
    let busyQuery = false;

    const dialog = h("dialog", { class: "dialog wide recorder-dialog", "aria-labelledby": "rc-title" });
    const status = h("p", { id: "rc-status", role: "status", "aria-atomic": "false" });
    // Each thing said is a line of its own, added after the ones before. A status region that is replaced, or read whole, between two things said together (a take is
    // set aside, then the next one starts) may be heard saying only the second. Only the last few lines are kept.
    const say = (messages: string[]) => {
      for (const m of messages) status.append(h("span", { class: "rc-say", text: m }));
      while (status.childElementCount > 4) status.firstElementChild?.remove();
    };

    // ---- choices
    const name = h("input", { type: "text", id: "rc-name", value: s.name, maxlength: "60" });
    const practice = h("input", { type: "checkbox", id: "rc-practice" });
    practice.checked = s.practice;
    const target = h("select", { id: "rc-target" },
      h("option", { value: "screen", text: "A whole screen" }), h("option", { value: "window", text: "One window" }), h("option", { value: "region", text: "Part of a screen" }));
    target.value = s.target;
    const display = h("select", { id: "rc-display" });
    const windowSel = h("select", { id: "rc-window" }, h("option", { value: "", text: "No window chosen yet" }));
    const findWindows = h("button", { type: "button", text: "Look for windows" });
    const region = (id: string, label: string, value: string) => {
      const input = h("input", { type: "text", id: `rc-region-${id}`, inputmode: "numeric", size: "6", value });
      return { input, field: h("div", { class: "field" }, h("label", { for: `rc-region-${id}`, text: label }), input) };
    };
    const left = region("left", "Pixels from the left of the screen", s.region.left);
    const top = region("top", "Pixels from the top of the screen", s.region.top);
    const width = region("width", "Width in pixels", s.region.width);
    const height = region("height", "Height in pixels", s.region.height);
    const microphone = h("select", { id: "rc-microphone" });
    const output = h("select", { id: "rc-output" });
    const camera = h("select", { id: "rc-camera" });
    const interactions = h("select", { id: "rc-interactions" }, ...INTERACTION_CHOICES.map((o) => h("option", { value: o.value, text: o.label })));
    interactions.value = s.interactions;
    const countdown = h("input", { type: "number", id: "rc-countdown", min: "0", max: String(MAX_COUNTDOWN), step: "1", value: String(s.countdownSeconds) });
    const sounds = h("input", { type: "checkbox", id: "rc-sounds" });
    sounds.checked = s.sounds;

    const field = (id: string, label: string, control: HTMLElement, extra: Node[] = []) =>
      h("div", { class: "field" }, h("label", { for: id, text: label }), h("div", {}, control, ...extra));

    function fillChoices(): void {
      const options = (kind: Source["kind"], first: [string, string][], current: string, select: HTMLSelectElement) => {
        const items = sources.filter((x) => x.kind === kind);
        select.replaceChildren(
          ...first.map(([value, text]) => h("option", { value, text })),
          ...items.map((x) => h("option", { value: String(x.number), text: `${x.label}${x.isDefault ? " (the default)" : ""}` })),
        );
        if (select.options.length === 0 && kind === "display") select.append(h("option", { value: "1", text: "Screen 1" }));
        const values = [...select.options].map((o) => o.value);
        select.value = values.includes(current) ? current : (values[0] ?? "");
      };
      options("display", [], String(s.display), display);
      options("microphone", [["default", "The default microphone"], ["none", "No microphone"]], s.microphone, microphone);
      options("output", [["default", "The default sound the computer plays"], ["none", "None of the computer's sound"]], s.output, output);
      options("camera", [["none", "No webcam"], ["default", "The first webcam"]], s.camera, camera);
    }

    function readSettings(): RecordSettings {
      return {
        name: name.value, practice: practice.checked, target: target.value as Target, display: Number(display.value) || 1,
        window: windowSel.value, region: { left: left.input.value, top: top.input.value, width: width.input.value, height: height.input.value },
        microphone: microphone.value, output: output.value, camera: camera.value, interactions: interactions.value as Interactions,
        countdownSeconds: countdown.value.trim() === "" ? Number.NaN : Number(countdown.value), sounds: sounds.checked,
      };
    }

    const screenGroup = h("div", {}, field("rc-display", "Which screen", display));
    const windowGroup = h("div", {}, field("rc-window", "Which window", windowSel, [findWindows]));
    const regionGroup = h("div", {}, h("p", { class: "note", text: "Choose which screen above, then the part of it, in pixels, counted from the top left corner. It must be at least 64 by 64." }), left.field, top.field, width.field, height.field);
    const realGroup = h("div", {},
      h("fieldset", {}, h("legend", { text: "What to record" }), field("rc-target", "Record", target), screenGroup, windowGroup, regionGroup),
      h("fieldset", {}, h("legend", { text: "Sound and picture of you" }),
        field("rc-microphone", "Your voice", microphone), field("rc-output", "The computer's own sound", output), field("rc-camera", "A webcam", camera),
        h("p", { class: "note", text: "A webcam, and your voice, are recorded only if you choose them. The computer's own sound includes a screen reader's speech." })),
      h("fieldset", {}, h("legend", { text: "What you do while recording" }),
        field("rc-interactions", "OpenScreen may", interactions),
        h("p", { class: "note", text: "Noting what you do is how a step-by-step lesson can be made from a recording later. It is kept in a private file inside the recording, never published, nothing is noted while paused, and the keys of a password box are never noted." })));

    const problem = h("p", { id: "rc-problem", class: "note" });
    const start = h("button", { type: "button", id: "rc-start", text: "Start recording", "aria-describedby": "rc-problem" });
    const setup = h("section", { "aria-labelledby": "rc-setup-title" },
      h("h3", { id: "rc-setup-title", text: "Record" }),
      field("rc-name", "Name of the recording", name),
      h("div", { class: "field" }, h("span", { text: "Practice" }), h("div", {}, practice, " ", h("label", { for: "rc-practice", text: "Try the controls with a made-up picture and sound. Nothing on your screen is recorded." }))),
      realGroup,
      h("fieldset", {}, h("legend", { text: "Starting" }),
        field("rc-countdown", `Countdown, in seconds (0 to ${MAX_COUNTDOWN})`, countdown),
        h("div", { class: "field" }, h("span", { text: "Sounds" }), h("div", {}, sounds, " ", h("label", { for: "rc-sounds", text: "Play a short sound for each step (the countdown, start, pause, resume and stop). Recommended for anyone who cannot see the screen. The sounds are never recorded." })))),
      problem, h("div", { class: "dialog-actions" }, start));

    // ---- the recording as it goes
    const liveTitle = h("h3", { id: "rc-live-title", tabindex: "-1", text: "Recording" });
    const now = h("p", { id: "rc-now" });
    const pause = h("button", { type: "button", text: "Pause" });
    const stop = h("button", { type: "button", text: "Stop" });
    const again = h("button", { type: "button", text: "Start again" });
    const markerLabel = h("input", { type: "text", id: "rc-marker", maxlength: "120" });
    const addMarker = h("button", { type: "button", text: "Add a marker" });
    const markers = h("ul", { class: "rc-list", "aria-label": "Markers" });
    const notes = h("ul", { class: "rc-list", "aria-label": "What the recorder said" });
    const where = h("p", { id: "rc-where" });
    const show = h("button", { type: "button", text: "Show the recording in its folder" });
    const done = h("button", { type: "button", text: "Done" });
    const editNow = h("button", { type: "button", text: "Edit the recording I just made" });
    const stepsNow = h("button", { type: "button", text: "Make steps from the recording I just made" });
    const doneRow = h("div", { class: "dialog-actions" }, editNow, stepsNow, show, done);
    const controls = h("div", { class: "dialog-actions" }, pause, stop, again);
    const markerRow = h("div", { class: "field" }, h("label", { for: "rc-marker", text: "Words for a marker (optional)" }), h("div", {}, markerLabel, " ", addMarker));
    const live = h("section", { "aria-labelledby": "rc-live-title", hidden: true }, liveTitle, now, controls, markerRow,
      h("h4", { text: "Markers" }), markers, h("h4", { text: "What the recorder said" }), notes, where, doneRow);

    // ---- the check
    const found = h("p", { id: "rc-found" });
    const check = h("button", { type: "button", text: "Check this computer", "aria-describedby": "rc-found" });
    const findings: Finding[] = [];
    const list = h("ul", { class: "rc-list", "aria-label": "What the check found" });
    const checkBox = h("section", { "aria-labelledby": "rc-check-title" },
      h("h3", { id: "rc-check-title", text: "Is this computer ready to record?" }), found, h("div", { class: "dialog-actions" }, check), list);
    const close = h("button", { type: "button", text: "Close" });

    // ---- the recordings already made, to edit
    const recordingsSel = h("select", { id: "rc-recordings" });
    const editBtn = h("button", { type: "button", id: "rc-edit", text: "Edit this recording" });
    const stepsBtn = h("button", { type: "button", id: "rc-steps", text: "Make steps from this recording" });
    const editBox = h("section", { "aria-labelledby": "rc-edit-title", hidden: true },
      h("h3", { id: "rc-edit-title", text: "Edit a recording, or make steps from it" }),
      h("p", { class: "note", text: "Open a recording made in this course to cut it, and to add text, shapes and zoom. The recording itself, its picture and sound, is never changed. Steps are what the recording shows one thing at a time (a click, some typing), proposed from what you did while recording, for a lesson the learner follows." }),
      field("rc-recordings", "Recording", recordingsSel), h("div", { class: "dialog-actions" }, editBtn, stepsBtn));
    async function refreshRecordings(): Promise<void> {
      if (opts.dir === null) return;
      const names = await b.listRecordings(opts.dir).catch(() => [] as string[]);
      const keep = recordingsSel.value;
      recordingsSel.replaceChildren(...names.map((n) => h("option", { value: n, text: n.replace(/\.capture$/, "") })));
      if (names.includes(keep)) recordingsSel.value = keep;
      editBox.hidden = names.length === 0;
    }
    async function edit(name: string, back: HTMLElement, newestTake = false): Promise<void> {
      if (c.busy) { say(["A recording is going. Wait until it is finished, then edit."]); return; }
      await opts.editRecording(name, newestTake);
      back.focus();
    }
    async function steps(name: string, back: HTMLElement): Promise<void> {
      if (c.busy) { say(["A recording is going. Wait until it is finished, then make steps."]); return; }
      await opts.makeSteps(name);
      back.focus();
    }

    // ---- showing the state
    function ready(): string | null {
      if (opts.dir === null) return "Open or make a course first. Recordings are kept inside the course's own folder.";
      if (!usable && !practice.checked) return "The recorder program was not found, so no recording can be made, not even a practice one. See the message under the check.";
      return settingsProblem(readSettings());
    }

    function showSetup(): void {
      const isPractice = practice.checked;
      realGroup.hidden = isPractice;
      screenGroup.hidden = target.value !== "screen" && target.value !== "region";
      windowGroup.hidden = target.value !== "window";
      regionGroup.hidden = target.value !== "region";
      const why = busyQuery ? "Looking at what this computer has." : (ready() ?? "");
      problem.textContent = why;
      start.setAttribute("aria-disabled", why === "" ? "false" : "true");
      if (why === "") start.removeAttribute("aria-disabled");
    }

    function showSession(session: Session): void {
      const idle = session.phase === "idle";
      const over = session.phase === "finished" || session.phase === "failed";
      live.hidden = idle;
      setup.hidden = !idle;
      now.textContent = describeSession(session);
      pause.textContent = session.phase === "paused" ? "Resume" : "Pause";
      controls.hidden = over;
      markerRow.hidden = over;
      doneRow.hidden = !over;
      show.hidden = session.phase !== "finished" || session.folder === "";
      editNow.hidden = show.hidden;
      liveTitle.textContent = session.phase === "finished" ? "Finished" : session.phase === "failed" ? "The recording did not finish" : "Recording";
      markers.replaceChildren(...session.markers.map((m) => h("li", { text: `${formatTime(m.elapsedMs)}${m.label ? `: ${m.label}` : ""}` })));
      notes.replaceChildren(...session.notes.map((n) => h("li", {}, h("strong", { class: n.ok ? "rc-pass" : "rc-problem", text: n.ok ? "Note. " : "Problem. " }), h("span", { text: n.text }))));
      where.textContent = session.folder === "" ? "" : `Kept in: ${session.folder}${session.setAside > 0 ? `. ${session.setAside} earlier ${session.setAside === 1 ? "take was" : "takes were"} set aside, not erased.` : ""}`;
    }

    const unsubscribe = c.subscribe((session, messages) => {
      showSession(session);
      if (messages.length > 0) say(messages);
      if (session.phase === "finished") void refreshRecordings();
    });
    showSession(c.session);
    void refreshRecordings();

    // ---- what the author does
    start.addEventListener("click", async () => {
      if (start.getAttribute("aria-disabled") === "true") { say([problem.textContent || "Something needs a choice first."]); return; }
      if (opts.dir === null) return;
      const chosen = readSettings();
      opts.keepSettings(chosen);
      const told = opts.excludeCaptures();
      const message = await c.start(chosen, recordingFolder(opts.dir, chosen.name));
      if (message !== null) { say([message]); return; }
      if (told) say([told]);
      liveTitle.focus();
    });
    pause.addEventListener("click", () => void c.togglePause());
    stop.addEventListener("click", () => void c.act("stop"));
    again.addEventListener("click", () => void c.act("restart"));
    addMarker.addEventListener("click", async () => { await c.marker(markerLabel.value); markerLabel.value = ""; markerLabel.focus(); });
    markerLabel.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addMarker.click(); } });
    done.addEventListener("click", () => { c.dismiss(); say([]); start.focus(); });
    editBtn.addEventListener("click", () => { if (recordingsSel.value !== "") void edit(recordingsSel.value, editBtn); });
    editNow.addEventListener("click", () => void edit(recordingNameOf(c.session.folder), editNow, true));
    stepsBtn.addEventListener("click", () => { if (recordingsSel.value !== "") void steps(recordingsSel.value, stepsBtn); });
    stepsNow.addEventListener("click", () => void steps(recordingNameOf(c.session.folder), stepsNow));
    show.addEventListener("click", () => { void b.revealInFolder(c.session.folder).catch((err: unknown) => say([`Could not show the folder. ${errorText(err)}`])); });
    for (const el of [name, practice, target, display, windowSel, microphone, output, camera, interactions, countdown, sounds, left.input, top.input, width.input, height.input]) {
      el.addEventListener("input", showSetup);
      el.addEventListener("change", showSetup);
    }

    async function lookForWindows(): Promise<void> {
      if (busyQuery || !usable) { say([usable ? "Already looking." : "The recorder program was not found."]); return; }
      busyQuery = true;
      findWindows.setAttribute("aria-disabled", "true");
      say(["Looking for windows."]);
      showSetup();
      const found: WindowChoice[] = [];
      const job = await runOneShot(b, ["windows"], (line) => { const w = parseWindow(line); if (w) found.push(w); });
      busyQuery = false;
      findWindows.removeAttribute("aria-disabled");
      windowSel.replaceChildren(h("option", { value: "", text: found.length > 0 ? "Choose a window" : "No window chosen yet" }), ...found.map((w) => h("option", { value: w.title, text: w.label })));
      say([found.length > 0 ? `Found ${found.length} ${found.length === 1 ? "window" : "windows"}. Choose one.` : job.problem !== "" ? `Could not list the windows. ${job.problem}` : "No window can be recorded right now."]);
      showSetup();
      if (found.length > 0) windowSel.focus();
    }
    findWindows.addEventListener("click", () => { if (findWindows.getAttribute("aria-disabled") !== "true") void lookForWindows(); });

    async function runCheck(): Promise<void> {
      if (!usable || checking || c.busy) { say([c.busy ? "A recording is going, so the check waits until it is over." : "The recorder program was not found."]); return; }
      checking = true;
      findings.length = 0;
      list.replaceChildren();
      check.textContent = "Checking...";
      check.setAttribute("aria-disabled", "true");
      say(["Checking this computer. This takes a few seconds."]);
      const job = await runOneShot(b, checkArguments(opts.dir), (line) => {
        const f = parseFinding(line);
        if (f && findings.length < 100) {
          findings.push(f);
          list.replaceChildren(...findings.map((x) => h("li", {}, h("strong", { class: x.ok ? "rc-pass" : "rc-problem", text: x.ok ? "Passed. " : "Problem. " }), h("span", { text: `${x.label}: ${x.message}` }))));
        }
      }, CHECK_LIMIT_MS);
      checking = false;
      check.textContent = "Check this computer";
      check.removeAttribute("aria-disabled");
      const summary = summarise(findings, job.exit);
      say([job.problem === "" ? summary.sentence : `${summary.sentence} ${job.problem}`]);
    }
    check.addEventListener("click", () => { if (check.getAttribute("aria-disabled") !== "true") void runCheck(); });

    const finish = () => {
      unsubscribe();
      opts.keepSettings(readSettings());
      dialogOpen = false;
      dialog.close();
      dialog.remove();
      resolve();
    };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });

    dialog.append(
      h("h2", { id: "rc-title", text: "OpenScreen: the screen recorder" }),
      h("p", { text: "OpenScreen records your screen, your voice and the computer's own sound, so you can put the recording in a course. It works on Windows. It is a separate program that OpenStage starts." }),
      h("p", { class: "note", text: "Recording from here is new. Putting a recording in a course, and editing it, are still being built. A recording is kept in the course's captures folder, which is left out of the published course." }),
      status, live, setup, editBox, checkBox, h("div", { class: "dialog-actions" }, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    try {
      fillChoices();
    } catch (err) {
      say([`The lists of screens and devices could not be filled in. ${errorText(err)}`]);
    }
    showSetup();
    found.textContent = "Looking for the recorder program...";
    check.setAttribute("aria-disabled", "true");
    (c.busy || c.session.phase !== "idle" ? liveTitle : start).focus();

    void (async () => {
      const located = await b.captureCheck().catch((err: unknown) => ({ ok: false as const, message: `Could not look for the recorder. ${errorText(err)}` }));
      usable = located.ok;
      found.textContent = located.ok ? `The recorder program was found: ${located.path}` : located.message;
      if (located.ok && !checking) check.removeAttribute("aria-disabled");
      if (located.ok && !c.busy) {
        const job = await runOneShot(b, ["probe"], (line) => { sources = sources.concat(parseProbe(line)); });
        if (job.problem === "" || sources.length > 0) {
          try { fillChoices(); } catch (err) { say([`The lists of screens and devices could not be filled in. ${errorText(err)}`]); }
        }
      }
      showSetup();
    })();
  });
}
