// Audio description: words, and a voice, that say what a video's picture shows, for a learner who cannot see it (WCAG 2.2, 1.2.5).
//
// The author adds description cues to a video: at this time, say this. A learner who wants them presses an "Audio description" button beside
// the video, which opens a dialog where they can read the descriptions, listen to them on their own, or play the video with each one spoken
// at its time. A description that needs more time than the video leaves can pause the video while it is spoken (an extended description).
// The button is only there when the author has added a description.
//
// This file is the timing and the playing. The logic takes the video and the sound as plain objects with the few methods it needs, so it
// is tested without a browser; the dialog is built at the bottom.

import type { DescriptionCue, OSObject } from "./types.ts";
import { t } from "./playertext.ts";

/** What the logic needs of a video. An HTMLVideoElement has all of it. */
export interface MediaLike {
  currentTime: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** What it needs of a sound that plays one description. */
export interface AudioLike {
  play(): Promise<void> | void;
  pause(): void;
  onended: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
}

export interface DescriptionHost {
  /** Where the voice for a description is, or null if it can only be read. */
  audioUrl(cueId: string): string | null;
  /** Something that plays one address. */
  makeAudio(url: string): AudioLike;
}

/** A time in a video as people write it: 1:05. */
export function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The descriptions on a video, in the order they happen. Nothing for any other kind of object. */
export function descriptionCues(obj: OSObject): DescriptionCue[] {
  if (obj.type !== "video") return [];
  const cues = (obj.content as { description?: { cues?: DescriptionCue[] } }).description?.cues;
  return Array.isArray(cues) ? [...cues].sort((a, b) => a.time - b.time) : [];
}

export class DescriptionPlayer {
  private readonly media: MediaLike;
  private readonly host: DescriptionHost;
  private readonly cues: DescriptionCue[];
  private next = 0;
  private speaking: DescriptionCue | null = null;
  private audio: AudioLike | null = null;
  /** The video was paused by this, for a description that needs its time, and is waiting to be started again. */
  private pausedByUs = false;
  private on = false;
  private queue: DescriptionCue[] = [];
  private queueAt = -1;
  /** Called whenever what the learner should be shown changes. */
  onChange: () => void = () => {};

  constructor(media: MediaLike, cues: DescriptionCue[], host: DescriptionHost) {
    this.media = media;
    this.host = host;
    this.cues = [...cues].sort((a, b) => a.time - b.time);
  }

  /** The descriptions have a voice at all. */
  get voiced(): boolean {
    return this.cues.some((c) => this.host.audioUrl(c.id) !== null);
  }

  /** The video is playing with the descriptions spoken in time. */
  get withVideo(): boolean {
    return this.on;
  }

  /** The descriptions are being listened to on their own, and which one: "2 of 5". */
  get listening(): { at: number; of: number } | null {
    return this.queueAt >= 0 ? { at: this.queueAt + 1, of: this.queue.length } : null;
  }

  // ---- with the video

  private readonly onTime = (): void => this.tick();
  private readonly onSeeking = (): void => {
    this.stopSpeech();
    this.arm();
  };
  private readonly onPlay = (): void => {
    // The learner pressed play while the video was held for a description: they are skipping the rest of it.
    if (this.speaking && this.pausedByUs) this.skip();
  };
  private readonly onEnded = (): void => this.end();

  /** Play the video from the start with each description spoken at its time. */
  begin(): void {
    this.stopListening();
    this.end();
    this.on = true;
    this.media.addEventListener("timeupdate", this.onTime);
    this.media.addEventListener("seeking", this.onSeeking);
    this.media.addEventListener("play", this.onPlay);
    this.media.addEventListener("ended", this.onEnded);
    this.media.currentTime = 0;
    this.next = 0;
    this.onChange();
    void this.media.play();
    this.tick();
  }

  /** Stop speaking descriptions. The video is left as it is. */
  end(): void {
    if (!this.on) return;
    this.on = false;
    this.stopSpeech();
    this.pausedByUs = false;
    this.media.removeEventListener("timeupdate", this.onTime);
    this.media.removeEventListener("seeking", this.onSeeking);
    this.media.removeEventListener("play", this.onPlay);
    this.media.removeEventListener("ended", this.onEnded);
    this.onChange();
  }

  /** After a jump to another place in the video: the descriptions still to come are the ones from here on. */
  private arm(): void {
    const t = this.media.currentTime * 1000;
    const at = this.cues.findIndex((c) => c.time >= t);
    this.next = at === -1 ? this.cues.length : at;
  }

  /** Speak any description whose time has come. One at a time: if several are due, the rest wait their turn. */
  tick(): void {
    if (!this.on || this.speaking) return;
    const t = this.media.currentTime * 1000;
    while (this.next < this.cues.length && this.cues[this.next]!.time <= t) {
      const cue = this.cues[this.next++]!;
      if (this.speak(cue)) return;
    }
  }

  /** Start speaking one description. False if it has no voice: it is then only for reading, and the video is never held for it. */
  private speak(cue: DescriptionCue): boolean {
    const url = this.host.audioUrl(cue.id);
    if (url === null) return false;
    this.speaking = cue;
    if (cue.pause && !this.media.paused) {
      this.media.pause();
      this.pausedByUs = true;
    } else if (!cue.pause && this.pausedByUs) {
      // The video was held for the one before, and this one does not need it held.
      this.pausedByUs = false;
      void this.media.play();
    }
    this.play(url, () => this.finishSpeech());
    return true;
  }

  private play(url: string, done: () => void): void {
    const audio = this.host.makeAudio(url);
    this.audio = audio;
    audio.onended = done;
    audio.onerror = done;
    try {
      const started = audio.play();
      // A browser may refuse to start a sound. The video must not be left waiting for a description that will never end.
      if (started && typeof started.catch === "function") started.catch(done);
    } catch {
      done();
    }
  }

  private finishSpeech(): void {
    if (!this.speaking) return;
    this.speaking = null;
    this.audio = null;
    // Another description may be due already, and then the video stays held for it.
    this.tick();
    if (!this.speaking && this.pausedByUs) {
      this.pausedByUs = false;
      if (this.on) void this.media.play();
    }
  }

  private stopSpeech(): void {
    const audio = this.audio;
    this.speaking = null;
    this.audio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
  }

  /** Stop the description that is being spoken now, and let the video go on. */
  skip(): void {
    this.stopSpeech();
    this.pausedByUs = false;
    this.tick();
  }

  // ---- on its own

  /** Listen to the descriptions one after another, without the video. */
  listen(): void {
    this.end();
    this.stopListening();
    this.queue = this.cues.filter((c) => this.host.audioUrl(c.id) !== null);
    if (this.queue.length === 0) return;
    this.queueAt = 0;
    this.onChange();
    this.playQueued();
  }

  private playQueued(): void {
    const cue = this.queue[this.queueAt];
    const url = cue ? this.host.audioUrl(cue.id) : null;
    if (!cue || url === null) {
      this.stopListening();
      return;
    }
    this.play(url, () => {
      if (this.queueAt < 0) return;
      this.queueAt++;
      if (this.queueAt >= this.queue.length) this.stopListening();
      else {
        this.onChange();
        this.playQueued();
      }
    });
  }

  stopListening(): void {
    // Only listening on its own is stopped here. A description spoken with the video belongs to end().
    if (this.queueAt < 0) return;
    this.queueAt = -1;
    this.queue = [];
    this.stopSpeech();
    this.onChange();
  }
}

// ---- what the learner sees

type El = HTMLElement;

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * The button beside a video, and the dialog it opens. The dialog is a native one, so focus moves into it, Tab stays inside it, Escape
 * closes it and focus goes back to the button. `video` is the player the descriptions are timed against.
 */
export function buildDescriptionControls(doc: Document, obj: OSObject, video: HTMLMediaElement, host: DescriptionHost): El {
  const cues = descriptionCues(obj);
  const player = new DescriptionPlayer(video, cues, host);
  const wrap = make(doc, "div", "os-ad");

  const open = make(doc, "button", "os-nav-btn os-ad-open", t("ad.title"));
  open.type = "button";
  open.setAttribute("aria-haspopup", "dialog");
  // Said where it can be heard when it is on, and not drawn when it is off.
  const state = make(doc, "span", "os-ad-state");
  state.setAttribute("role", "status");

  const dialog = make(doc, "dialog", "os-ad-dialog") as HTMLDialogElement;
  const titleId = `os-ad-title-${obj.id}`;
  dialog.setAttribute("aria-labelledby", titleId);
  const title = make(doc, "h2", "", t("ad.title"));
  title.id = titleId;
  const intro = make(doc, "p", "", t("ad.intro", { name: obj.accessibility.altText || t("ad.theVideo") }));

  const list = make(doc, "ol", "os-ad-list");
  for (const cue of cues) {
    const li = make(doc, "li", "");
    li.append(make(doc, "span", "os-ad-time", clock(cue.time)), doc.createTextNode(" "), make(doc, "span", "", cue.text));
    list.appendChild(li);
  }

  const listenBtn = make(doc, "button", "os-nav-btn", t("ad.listen"));
  listenBtn.type = "button";
  const withBtn = make(doc, "button", "os-nav-btn", t("ad.playWith"));
  withBtn.type = "button";
  const note = make(doc, "p", "os-ad-note");
  const progress = make(doc, "p", "os-ad-progress");
  progress.setAttribute("role", "status");
  const close = make(doc, "button", "os-nav-btn", t("common.close"));
  close.type = "button";
  const actions = make(doc, "div", "os-ad-actions");
  if (player.voiced) actions.append(listenBtn, withBtn);
  actions.append(close);
  note.textContent = player.voiced
    ? t("ad.noteVoiced")
    : t("ad.noteWritten");

  dialog.append(title, intro, list, note, progress, actions);
  wrap.append(open, state, dialog);

  const show = (): void => {
    state.textContent = player.withVideo ? t("ad.isOn") : "";
    const l = player.listening;
    progress.textContent = l ? t("ad.progress", { at: l.at, of: l.of }) : "";
    listenBtn.textContent = l ? t("ad.stopListening") : t("ad.listen");
    withBtn.textContent = player.withVideo ? t("ad.turnOffVoice") : t("ad.playWith");
  };
  player.onChange = show;
  show();

  open.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());
  // Closing the dialog by any route ends listening on its own, which would otherwise carry on out of sight.
  dialog.addEventListener("close", () => player.stopListening());
  listenBtn.addEventListener("click", () => (player.listening ? player.stopListening() : player.listen()));
  withBtn.addEventListener("click", () => {
    if (player.withVideo) {
      player.end();
      return;
    }
    dialog.close();
    player.begin();
  });
  return wrap;
}
