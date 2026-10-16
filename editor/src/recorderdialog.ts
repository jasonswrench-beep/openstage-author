// The OpenScreen dialog: the screen recorder, as far as the editor goes so far.
//
// OpenScreen (the Capture module) is a separate program that the editor starts and talks to. This dialog finds it and asks it whether this
// computer is ready to record: it runs the recorder's `setup-check`, which looks at Windows, the screen, the video and sound encoders, the
// microphone, the camera and the disk, and says in plain words what it found. That records nothing, asks Windows for no permission and sends
// nothing anywhere. Recording and editing from here are the next pieces; they will live in this dialog's place.
//
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it, and focus returns to the button that opened it.

import { errorText, type Backend } from "./backend.ts";
import { CHECK_LIMIT_MS, checkArguments, parseFinding, summarise, type Finding } from "./capturecheck.ts";
import type { StreamExit } from "./recorder.ts";

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
  /** Where recordings will be kept: the open project's folder, if there is one. The check says how much room is on that drive. */
  dir: string | null;
}

export function openRecorder(opts: RecorderDialogOptions): Promise<void> {
  const b = opts.backend;
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide recorder-dialog", "aria-labelledby": "rc-title" });
    const found = h("p", { id: "rc-found" });
    const status = h("p", { id: "rc-status", role: "status" });
    const list = h("ul", { class: "rc-list", "aria-label": "What the check found" });
    const check = h("button", { type: "button", text: "Check this computer", "aria-describedby": "rc-found" });
    const close = h("button", { type: "button", text: "Close" });

    let usable = false;
    let running = false;
    let stopper: number | undefined;
    const findings: Finding[] = [];

    const draw = () => {
      list.replaceChildren(...findings.map((f) =>
        h("li", {}, h("strong", { class: f.ok ? "rc-pass" : "rc-problem", text: f.ok ? "Passed. " : "Problem. " }), h("span", { text: `${f.label}: ${f.message}` }))));
    };
    const setBusy = (busy: boolean) => {
      running = busy;
      check.textContent = busy ? "Checking..." : "Check this computer";
      if (busy || !usable) check.setAttribute("aria-disabled", "true");
      else check.removeAttribute("aria-disabled");
    };

    async function run(): Promise<void> {
      if (!usable || running) return;
      findings.length = 0;
      draw();
      setBusy(true);
      status.textContent = "Checking this computer. This takes a few seconds.";
      let offLine: (() => void) | undefined;
      let offExit: (() => void) | undefined;
      let ended = false;
      const end = (exit: StreamExit | null, why = "") => {
        if (ended) return;
        ended = true;
        window.clearTimeout(stopper);
        offLine?.();
        offExit?.();
        setBusy(false);
        const summary = summarise(findings, exit);
        status.textContent = why === "" ? summary.sentence : `${summary.sentence} ${why}`;
      };
      try {
        offLine = await b.onStreamLine((line) => {
          const f = parseFinding(line);
          if (f && findings.length < 100) {
            findings.push(f);
            draw();
          }
        });
        offExit = await b.onStreamExit((exit) => end(exit));
        stopper = window.setTimeout(() => void b.streamStop().catch(() => false), CHECK_LIMIT_MS);
        await b.streamStart(checkArguments(opts.dir));
      } catch (err) {
        end(null, errorText(err));
      }
    }

    const finish = () => {
      if (running) void b.streamStop().catch(() => false);
      window.clearTimeout(stopper);
      dialog.close();
      dialog.remove();
      resolve();
    };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    check.addEventListener("click", () => { if (check.getAttribute("aria-disabled") !== "true") void run(); });

    dialog.append(
      h("h2", { id: "rc-title", text: "OpenScreen: the screen recorder" }),
      h("p", { text: "OpenScreen records your screen, your voice and the computer's own sound, so you can put the recording in a course. It works on Windows. It is a separate program that OpenStage starts." }),
      h("p", { class: "note", text: "Recording and editing from this window are still being built. For now it can tell you whether this computer is ready to record. The check records nothing, asks Windows for no permission and sends nothing anywhere." }),
      found, h("div", { class: "dialog-actions" }, check), status, list,
      h("div", { class: "dialog-actions" }, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    found.textContent = "Looking for the recorder program...";
    check.setAttribute("aria-disabled", "true");
    check.focus();
    void b.captureCheck().then((r) => {
      usable = r.ok;
      found.textContent = r.ok ? `The recorder program was found: ${r.path}` : r.message;
      if (r.ok) check.removeAttribute("aria-disabled");
    }).catch((err: unknown) => {
      found.textContent = `Could not look for the recorder. ${errorText(err)}`;
    });
  });
}
