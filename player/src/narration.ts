// Narration controls: play and pause, captions, and a transcript. Captions and transcript
// are the script itself. Nothing here listens to the audio to work out what was said.

import type { Cue, NarrationAsset } from "./types.ts";

export function cueAt(cues: Cue[], t: number): Cue | null {
  return cues.find((c) => c.start <= t && t < c.end) ?? null;
}

export interface NarratedItem {
  id: string;
  asset: NarrationAsset;
}

/**
 * What an interaction item's narration is called in the package: its object's id, a slash, then its own id.
 * The same key narrate.py (item_key) gives it, so the audio the tool made is found here.
 */
export const itemNarrationKey = (objectId: string, itemId: string): string => `${objectId}/${itemId}`;

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** What the narration bar tells the player: the timing of a slide follows these. */
export interface NarrationEvents {
  /** The narration of this object (or item) has started playing. */
  onStart?(id: string): void;
  /** The browser refused to start the sound, so the learner has to press Play. */
  onBlocked?(): void;
}

export class NarrationBar {
  readonly el: HTMLElement;
  private readonly doc: Document;
  private readonly audio: HTMLAudioElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly capBtn: HTMLButtonElement;
  private readonly transBtn: HTMLButtonElement;
  private readonly caption: HTMLElement;
  private readonly transcript: HTMLElement;
  private queue: NarratedItem[] = [];
  private shown = new Set<string>();
  private index = 0;
  private captionsOn = true;
  private reported = new Set<string>();
  private blocked = false;
  private readonly events: NarrationEvents;

  constructor(doc: Document, events: NarrationEvents = {}) {
    this.doc = doc;
    this.events = events;
    this.el = make(doc, "section", "os-narration");
    this.el.setAttribute("aria-label", "Narration");
    this.el.hidden = true;
    this.audio = make(doc, "audio");
    this.audio.preload = "auto";

    const controls = make(doc, "div", "os-narration-controls");
    this.playBtn = this.button("Play narration", "os-nav-btn");
    this.replayBtn = this.button("Replay narration", "os-nav-btn");
    this.capBtn = this.button("Captions", "os-nav-btn");
    this.transBtn = this.button("Transcript", "os-nav-btn");
    this.capBtn.setAttribute("aria-pressed", "true");
    this.transBtn.setAttribute("aria-expanded", "false");
    controls.append(this.playBtn, this.replayBtn, this.capBtn, this.transBtn);

    // Captions are for people who can see them but not hear. Screen reader users get the
    // transcript, so the moving caption line is hidden from them to avoid reading twice.
    this.caption = make(doc, "div", "os-caption");
    this.caption.setAttribute("aria-hidden", "true");
    this.transcript = make(doc, "div", "os-transcript");
    this.transcript.id = "os-transcript";
    this.transcript.hidden = true;
    this.transBtn.setAttribute("aria-controls", this.transcript.id);

    this.el.append(controls, this.caption, this.transcript);

    this.playBtn.addEventListener("click", () => (this.audio.paused ? void this.play() : this.pause()));
    this.replayBtn.addEventListener("click", () => { this.index = 0; void this.play(true); });
    this.capBtn.addEventListener("click", () => {
      this.captionsOn = !this.captionsOn;
      this.capBtn.setAttribute("aria-pressed", String(this.captionsOn));
      this.updateCaption();
    });
    this.transBtn.addEventListener("click", () => {
      const open = this.transcript.hidden;
      this.transcript.hidden = !open;
      this.transBtn.setAttribute("aria-expanded", String(open));
    });
    this.audio.addEventListener("timeupdate", () => this.updateCaption());
    this.audio.addEventListener("pause", () => this.syncPlayButton());
    this.audio.addEventListener("play", () => this.syncPlayButton());
    this.audio.addEventListener("ended", () => {
      this.index += 1;
      if (this.index < this.queue.length) void this.play(true);
      else { this.index = 0; this.audio.removeAttribute("src"); this.updateCaption(); this.syncPlayButton(); }
    });
  }

  /** Whether the narration is playing now. */
  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended && this.audio.hasAttribute("src");
  }

  /** Set up for a new slide. Starts playing if the browser allows it. */
  load(items: NarratedItem[]): void {
    this.stop();
    this.queue = items.filter((i) => i.asset.audio);
    this.index = 0;
    this.reported.clear();
    this.blocked = false;
    this.transcript.innerHTML = "";
    this.shown.clear();
    this.transcript.hidden = true;
    this.transBtn.setAttribute("aria-expanded", "false");
    this.el.hidden = items.length === 0;
    if (items.length === 0) return;

    const heading = make(this.doc, "h2", "os-sr-only");
    heading.textContent = "Transcript";
    this.transcript.appendChild(heading);
    for (const item of items) this.addToTranscript(item);

    const hasAudio = this.queue.length > 0;
    this.playBtn.hidden = !hasAudio;
    this.replayBtn.hidden = !hasAudio;
    this.capBtn.hidden = !hasAudio;
    this.syncPlayButton();
    this.updateCaption();
    if (hasAudio) void this.play(true); // browsers refuse until the learner has interacted; that is fine
  }

  /**
   * Narration for something that has just appeared, such as feedback after an answer. It
   * replaces whatever is playing, because it responds to what the learner just did.
   */
  playNow(items: NarratedItem[]): void {
    if (items.length === 0) return;
    this.audio.pause();
    this.audio.removeAttribute("src");
    if (this.shown.size === 0) {
      const heading = make(this.doc, "h2", "os-sr-only");
      heading.textContent = "Transcript";
      this.transcript.appendChild(heading);
    }
    for (const item of items) this.addToTranscript(item);
    this.queue = items.filter((i) => i.asset.audio);
    this.index = 0;
    this.reported.clear();
    this.blocked = false;
    this.el.hidden = false;
    const hasAudio = this.queue.length > 0;
    this.playBtn.hidden = this.replayBtn.hidden = this.capBtn.hidden = !hasAudio;
    this.syncPlayButton();
    this.updateCaption();
    if (hasAudio) void this.play(true);
  }

  private addToTranscript(item: NarratedItem): void {
    if (this.shown.has(item.id)) return;
    this.shown.add(item.id);
    const p = make(this.doc, "p");
    p.textContent = item.asset.script;
    if (item.asset.lang) p.lang = item.asset.lang;
    this.transcript.appendChild(p);
  }

  stop(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.caption.textContent = "";
    this.caption.hidden = true;
  }

  private async play(fromStart = false): Promise<void> {
    const item = this.queue[this.index];
    if (!item?.asset.audio) return;
    if (fromStart || !this.audio.src) {
      this.audio.src = item.asset.audio;
      this.audio.currentTime = 0;
    }
    try {
      await this.audio.play();
      // Said once for each object, however many times it is paused and resumed.
      if (!this.reported.has(item.id) && this.queue[this.index] === item) {
        this.reported.add(item.id);
        this.events.onStart?.(item.id);
      }
    } catch {
      // Autoplay blocked: the Play button is the way in. Anything waiting for the narration must not wait for ever.
      if (!this.blocked) {
        this.blocked = true;
        this.events.onBlocked?.();
      }
    }
    this.syncPlayButton();
  }

  private pause(): void {
    this.audio.pause();
  }

  private syncPlayButton(): void {
    const playing = !this.audio.paused && !this.audio.ended;
    this.playBtn.textContent = playing ? "Pause narration" : "Play narration";
  }

  private updateCaption(): void {
    const item = this.queue[this.index];
    const cue = item?.asset.cues && this.audio.hasAttribute("src") ? cueAt(item.asset.cues, this.audio.currentTime) : null;
    this.caption.textContent = this.captionsOn ? (cue?.text ?? "") : "";
    this.caption.hidden = !this.captionsOn;
  }

  private button(text: string, cls: string): HTMLButtonElement {
    const b = make(this.doc, "button", cls);
    b.type = "button";
    b.textContent = text;
    return b;
  }
}
