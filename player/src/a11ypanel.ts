// The learner's accessibility panel: a button in the course's navigation bar that opens a panel of choices, so a learner can make the text bigger or more widely spaced, change the colours,
// follow a reading line, have words that have no recorded voice read aloud, and read or keep the whole course as a transcript.
//
// It is a disclosure, not a pop-up: the panel sits beside the slide, so each change is seen as it is made; it is reached by the Tab key like anything else; Escape closes it and
// puts focus back on the button; and nothing in it traps focus. Every control is a native one with a label. What the choices are and how they are saved is in a11y.ts; the transcript
// is built in transcript.ts; both are tested without a page. Nothing here sends anything anywhere, and nothing speaks unless the learner asks.

import {
  bandTop, browserStorage, colourLabel, COLOURS, DEFAULTS, describe, isDefault, loadSettings, pickVoice, RATE, saveSettings, spacingLabel, SPACINGS, speedLabel, SPEEDS, speechChunks,
  textSizeLabel, TEXT_SIZES, type A11ySettings,
} from "./a11y.ts";
import { button } from "./stage.ts";
import { t } from "./playertext.ts";
import { buildTranscript, transcriptFileName, transcriptText } from "./transcript.ts";
import type { CoursePackage } from "./types.ts";

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** What the panel needs from the player. */
export interface PanelHost {
  pkg: CoursePackage;
  /** Tell a screen reader something. */
  say(message: string): void;
  /** The learner's settings changed (or were loaded): draw the course with them. */
  apply(settings: A11ySettings): void;
  /** The words on this slide that have no recorded voice, in reading order. */
  unvoicedText(): string[];
  /** Whether the course's narration is playing now. */
  narrationPlaying(): boolean;
}

export class AccessibilityPanel {
  /** The button that goes in the navigation bar. */
  readonly button: HTMLButtonElement;
  /** The panel, and the transcript window: both go in the player. */
  readonly panel: HTMLElement;
  readonly transcriptDialog: HTMLDialogElement;
  readonly readingLine: HTMLElement;

  private readonly doc: Document;
  private readonly win: Window;
  private readonly host: PanelHost;
  private readonly storage: Storage | null;
  private current: A11ySettings;
  private readonly remembered: boolean;
  private readonly note: HTMLElement;
  private readonly controls: { textSize: HTMLSelectElement; lineSpacing: HTMLSelectElement; letterSpacing: HTMLSelectElement; colours: HTMLSelectElement; readingLine: HTMLInputElement; speed: HTMLSelectElement };
  private readonly readBtn: HTMLButtonElement;
  private readonly readNote: HTMLElement;
  private speaking = false;
  /** Counts the readings, so the end of one that was stopped does not start the next. */
  private run = 0;
  private lastInput: "pointer" | "key" = "pointer";
  private lineListening = false;

  constructor(doc: Document, host: PanelHost) {
    this.doc = doc;
    this.win = doc.defaultView ?? window;
    this.host = host;
    this.storage = browserStorage(this.win);
    this.remembered = this.storage !== null;
    this.current = loadSettings(this.storage);

    this.button = button(doc, t("a11y.title"), "os-nav-btn os-a11y-open");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", "os-a11y-panel");

    const panel = make(doc, "section", "os-a11y-panel");
    panel.id = "os-a11y-panel";
    panel.setAttribute("aria-labelledby", "os-a11y-title");
    panel.tabIndex = -1;
    panel.hidden = true;
    this.panel = panel;
    const title = make(doc, "h2", "os-a11y-title");
    title.id = "os-a11y-title";
    title.textContent = t("a11y.title");
    this.note = make(doc, "p", "os-a11y-note");

    const field = (id: string, label: string, options: [string, string][], value: string, onChange: (v: string) => void): { box: HTMLElement; select: HTMLSelectElement } => {
      const box = make(doc, "div", "os-a11y-field");
      const l = make(doc, "label", "");
      l.htmlFor = id;
      l.textContent = label;
      const select = make(doc, "select", "os-a11y-select");
      select.id = id;
      for (const [v, text] of options) {
        const o = make(doc, "option", "");
        o.value = v;
        o.textContent = text;
        select.appendChild(o);
      }
      select.value = value;
      select.addEventListener("change", () => onChange(select.value));
      box.append(l, select);
      return { box, select };
    };
    const group = (legend: string, ...kids: HTMLElement[]): HTMLElement => {
      const fs = make(doc, "fieldset", "os-a11y-group");
      const lg = make(doc, "legend", "");
      lg.textContent = legend;
      fs.append(lg, ...kids);
      return fs;
    };
    const text = (cls: string, words: string): HTMLElement => {
      const p = make(doc, "p", cls);
      p.textContent = words;
      return p;
    };

    const size = field("os-a11y-size", t("a11y.textSize"), TEXT_SIZES.map((n) => [String(n), textSizeLabel(n)]), String(this.current.textSize), (v) => this.change({ textSize: Number(v) as A11ySettings["textSize"] }));
    const lines = field("os-a11y-lines", t("a11y.lineSpacing"), SPACINGS.map((s) => [s, spacingLabel(s)]), this.current.lineSpacing, (v) => this.change({ lineSpacing: v as A11ySettings["lineSpacing"] }));
    const letters = field("os-a11y-letters", t("a11y.letterSpacing"), SPACINGS.map((s) => [s, spacingLabel(s)]), this.current.letterSpacing, (v) => this.change({ letterSpacing: v as A11ySettings["letterSpacing"] }));
    const colours = field("os-a11y-colours", t("a11y.colours"), COLOURS.map((c) => [c, colourLabel(c)]), this.current.colours, (v) => this.change({ colours: v as A11ySettings["colours"] }));
    const speed = field("os-a11y-speed", t("a11y.speed"), SPEEDS.map((s) => [s, speedLabel(s)]), this.current.speed, (v) => this.change({ speed: v as A11ySettings["speed"] }));

    const lineBox = make(doc, "div", "os-a11y-check");
    const lineInput = make(doc, "input", "");
    lineInput.type = "checkbox";
    lineInput.id = "os-a11y-line";
    lineInput.checked = this.current.readingLine;
    lineInput.setAttribute("aria-describedby", "os-a11y-line-note");
    const lineLabel = make(doc, "label", "");
    lineLabel.htmlFor = "os-a11y-line";
    lineLabel.textContent = t("a11y.readingLine");
    lineBox.append(lineInput, lineLabel);
    lineInput.addEventListener("change", () => this.change({ readingLine: lineInput.checked }));
    const lineNote = text("os-a11y-note", t("a11y.readingLineNote"));
    lineNote.id = "os-a11y-line-note";

    this.readBtn = button(doc, t("a11y.readAloud"), "os-nav-btn");
    this.readBtn.setAttribute("aria-describedby", "os-a11y-read-note");
    this.readNote = text("os-a11y-note", "");
    this.readNote.id = "os-a11y-read-note";
    this.readBtn.addEventListener("click", () => (this.speaking ? this.stopSpeaking(true) : this.readAloud()));

    const showBtn = button(doc, t("a11y.showTranscript"), "os-nav-btn");
    const downloadBtn = button(doc, t("a11y.downloadTranscript"), "os-nav-btn");
    showBtn.addEventListener("click", () => this.showTranscript());
    downloadBtn.addEventListener("click", () => this.downloadTranscript());
    const resetBtn = button(doc, t("a11y.reset"), "os-nav-btn");
    resetBtn.addEventListener("click", () => this.reset());
    const closeBtn = button(doc, t("common.close"), "os-nav-btn");
    // Several things in the course have a Close button; this one says which.
    closeBtn.setAttribute("aria-label", t("a11y.closePanel"));
    closeBtn.addEventListener("click", () => this.close());
    const actions = make(doc, "div", "os-a11y-actions");
    actions.append(resetBtn, closeBtn);

    panel.append(
      title, this.note,
      group(t("a11y.groupText"), size.box, lines.box, letters.box),
      group(t("a11y.colours"), colours.box),
      group(t("a11y.groupReading"), lineBox, lineNote),
      group(t("a11y.readAloud"), this.readNote, speed.box, this.readBtn),
      group(t("narration.transcript"), text("os-a11y-note", t("a11y.transcriptNote")), showBtn, downloadBtn),
      actions,
    );
    this.controls = { textSize: size.select, lineSpacing: lines.select, letterSpacing: letters.select, colours: colours.select, readingLine: lineInput, speed: speed.select };

    this.transcriptDialog = make(doc, "dialog", "os-a11y-transcript");
    this.readingLine = make(doc, "div", "os-readline");
    this.readingLine.setAttribute("aria-hidden", "true");
    this.readingLine.hidden = true;

    this.button.addEventListener("click", () => (this.panel.hidden ? this.open() : this.close()));
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    // Reading aloud can be stopped with Escape from anywhere, so a learner who closed the panel is never stuck with a voice.
    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.speaking && this.panel.hidden) this.stopSpeaking(true);
    });
    this.win.speechSynthesis?.addEventListener?.("voiceschanged", () => this.syncRead());

    this.syncNote();
    this.syncRead();
    this.syncReadingLine();
  }

  /** The settings as they are now. */
  settings(): A11ySettings {
    return { ...this.current };
  }

  // ---- opening and closing

  open(): void {
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.syncRead();
    this.panel.focus();
  }

  close(): void {
    const hadFocus = this.panel.contains(this.doc.activeElement);
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (hadFocus || this.doc.activeElement === this.doc.body) this.button.focus();
  }

  // ---- the settings

  private change(part: Partial<A11ySettings>): void {
    this.current = { ...this.current, ...part };
    saveSettings(this.storage, this.current);
    this.syncReadingLine();
    this.host.apply(this.settings());
    this.host.say(describe(this.current));
  }

  private reset(): void {
    this.current = { ...DEFAULTS };
    saveSettings(this.storage, this.current);
    const c = this.controls;
    c.textSize.value = String(DEFAULTS.textSize);
    c.lineSpacing.value = DEFAULTS.lineSpacing;
    c.letterSpacing.value = DEFAULTS.letterSpacing;
    c.colours.value = DEFAULTS.colours;
    c.readingLine.checked = DEFAULTS.readingLine;
    c.speed.value = DEFAULTS.speed;
    this.stopSpeaking(false);
    this.syncReadingLine();
    this.host.apply(this.settings());
    this.host.say(t("a11y.saidReset", { described: describe(this.current) }));
  }

  private syncNote(): void {
    this.note.textContent = t("a11y.note", { remembered: this.remembered ? t("a11y.noteRemembered") : t("a11y.noteNotRemembered") });
  }

  // ---- the reading line

  private onPointer = (e: PointerEvent): void => {
    this.lastInput = "pointer";
    this.place(e.clientY);
  };

  private onFocus = (e: FocusEvent): void => {
    const target = e.target as Element | null;
    if (!target || target === this.doc.body || this.readingLine.contains(target)) return;
    this.lastInput = "key";
    const r = target.getBoundingClientRect();
    this.place(r.top + r.height / 2);
  };

  private onKey = (): void => {
    if (this.lastInput === "key" && this.doc.activeElement && this.doc.activeElement !== this.doc.body) {
      const r = this.doc.activeElement.getBoundingClientRect();
      this.place(r.top + r.height / 2);
    }
  };

  private place(y: number): void {
    const h = this.readingLine.offsetHeight || 44;
    this.readingLine.hidden = false;
    this.readingLine.style.top = `${bandTop(y, h, this.win.innerHeight)}px`;
  }

  private syncReadingLine(): void {
    const on = this.current.readingLine;
    if (on && !this.lineListening) {
      this.doc.addEventListener("pointermove", this.onPointer, { passive: true });
      this.doc.addEventListener("focusin", this.onFocus);
      this.doc.addEventListener("keyup", this.onKey);
      this.lineListening = true;
      // It starts where the keyboard is, or in the middle of the window until the pointer moves.
      const active = this.doc.activeElement;
      if (active && active !== this.doc.body) {
        const r = active.getBoundingClientRect();
        this.place(r.top + r.height / 2);
      } else this.place(this.win.innerHeight / 2);
    } else if (!on && this.lineListening) {
      this.doc.removeEventListener("pointermove", this.onPointer);
      this.doc.removeEventListener("focusin", this.onFocus);
      this.doc.removeEventListener("keyup", this.onKey);
      this.lineListening = false;
      this.readingLine.hidden = true;
    }
  }

  // ---- reading aloud

  private voice(): SpeechSynthesisVoice | null {
    const synth = this.win.speechSynthesis;
    if (!synth) return null;
    return pickVoice(synth.getVoices(), this.host.pkg.project.meta.language);
  }

  /** Says whether reading aloud can work on this computer, and turns the button on or off. */
  private syncRead(): void {
    const synth = this.win.speechSynthesis;
    const lang = this.host.pkg.project.meta.language;
    let words: string;
    let ok = true;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      words = t("a11y.readNoSynth");
      ok = false;
    } else if (this.voice() === null) {
      words = t("a11y.readNoVoice", { lang });
      ok = synth.getVoices().length === 0; // the list may not have loaded yet; try, and say so if it is still empty
      if (ok) words = t("a11y.readNoteLoading");
    } else {
      words = t("a11y.readNote");
    }
    this.readNote.textContent = words;
    this.readBtn.disabled = !ok && !this.speaking;
    this.readBtn.textContent = this.speaking ? t("a11y.stopReading") : t("a11y.readAloud");
  }

  private readAloud(): void {
    const synth = this.win.speechSynthesis;
    if (!synth) return;
    if (this.host.narrationPlaying()) {
      this.host.say(t("a11y.saidNarrationPlaying"));
      return;
    }
    const voice = this.voice();
    if (voice === null) {
      this.host.say(t("a11y.saidNoVoice"));
      this.syncRead();
      return;
    }
    const chunks = this.host.unvoicedText().flatMap((words) => speechChunks(words));
    if (chunks.length === 0) {
      this.host.say(t("a11y.saidNothingToRead"));
      return;
    }
    synth.cancel();
    const mine = ++this.run;
    this.speaking = true;
    this.syncRead();
    this.host.say(t("a11y.saidReading"));
    let i = 0;
    const next = (): void => {
      if (mine !== this.run) return;
      const chunk = chunks[i++];
      if (chunk === undefined) {
        this.speaking = false;
        this.syncRead();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunk);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = RATE[this.current.speed];
      u.onend = next;
      u.onerror = () => {
        if (mine !== this.run) return;
        this.speaking = false;
        this.syncRead();
      };
      synth.speak(u);
    };
    next();
  }

  /** Stop reading (the slide changed, narration began, or the learner asked). `tell` says so to a screen reader. */
  stopSpeaking(tell = false): void {
    if (!this.speaking) return;
    this.run++;
    this.win.speechSynthesis?.cancel();
    this.speaking = false;
    this.syncRead();
    if (tell) this.host.say(t("a11y.saidStopped"));
  }

  // ---- the transcript

  private showTranscript(): void {
    const transcript = buildTranscript(this.host.pkg);
    const d = this.transcriptDialog;
    d.replaceChildren();
    d.setAttribute("aria-labelledby", "os-a11y-transcript-title");
    d.lang = transcript.language;
    const h = make(this.doc, "h2", "");
    h.id = "os-a11y-transcript-title";
    h.textContent = t("a11y.transcriptTitle", { title: transcript.title });
    // The words scroll, so they can be reached by keyboard; a region with a name, so a screen reader says what it is when focus lands there.
    h.tabIndex = -1;
    const body = make(this.doc, "div", "os-a11y-transcript-body");
    body.setAttribute("role", "region");
    body.setAttribute("aria-label", t("a11y.transcriptWords"));
    body.tabIndex = 0;
    for (const s of transcript.sections) {
      const sh = make(this.doc, "h3", "");
      sh.textContent = s.title;
      body.appendChild(sh);
      if (s.paragraphs.length === 0) {
        const p = make(this.doc, "p", "os-a11y-empty");
        p.textContent = t("a11y.nothingToRead");
        body.appendChild(p);
      }
      for (const text of s.paragraphs) {
        const p = make(this.doc, "p", "");
        p.textContent = text;
        body.appendChild(p);
      }
    }
    const save = button(this.doc, t("a11y.downloadTranscript"), "os-nav-btn");
    save.addEventListener("click", () => this.downloadTranscript());
    const close = button(this.doc, t("common.close"), "os-nav-btn");
    close.setAttribute("aria-label", t("a11y.closeTranscript"));
    close.addEventListener("click", () => d.close());
    const actions = make(this.doc, "div", "os-a11y-actions");
    actions.append(save, close);
    d.append(h, body, actions);
    d.addEventListener("close", () => this.button.focus(), { once: true });
    d.showModal();
    // Focus starts on the title, so a screen reader says the transcript's name and what it is. Left to itself the browser put it on the scrolling box,
    // which had no name, and NVDA said nothing when the transcript opened (found 2026-10-21).
    h.focus();
  }

  private downloadTranscript(): void {
    const transcript = buildTranscript(this.host.pkg);
    const blob = new Blob(["﻿", transcriptText(transcript)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = this.doc.createElement("a");
    a.href = url;
    a.download = transcriptFileName(transcript.title);
    a.hidden = true;
    this.doc.body.appendChild(a);
    a.click();
    a.remove();
    this.win.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.host.say(t("a11y.saidDownload", { file: a.download }));
  }

  /** Is anything other than the course's own turned on? */
  get active(): boolean {
    return !isDefault(this.current);
  }
}
