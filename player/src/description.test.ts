// Audio description: when each description is spoken, what the video does while it is, and what a learner can do about it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, DescriptionPlayer, descriptionCues, type AudioLike, type DescriptionHost, type MediaLike } from "./description.ts";
import type { DescriptionCue, OSObject } from "./types.ts";

class FakeMedia implements MediaLike {
  currentTime = 0;
  paused = true;
  plays = 0;
  pauses = 0;
  private listeners = new Map<string, Set<() => void>>();
  play(): void {
    this.paused = false;
    this.plays++;
    this.emit("play");
  }
  pause(): void {
    this.paused = true;
    this.pauses++;
    this.emit("pause");
  }
  addEventListener(type: string, l: () => void): void {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(l);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** The video plays on to this many seconds. */
  playTo(seconds: number): void {
    this.currentTime = seconds;
    this.emit("timeupdate");
  }
  seek(seconds: number): void {
    this.currentTime = seconds;
    this.emit("seeking");
    this.emit("timeupdate");
  }
}

class FakeAudio implements AudioLike {
  onended: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  played = false;
  paused = false;
  refuse = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  play(): Promise<void> | void {
    this.played = true;
    if (this.refuse) return Promise.reject(new Error("not allowed"));
  }
  pause(): void {
    this.paused = true;
  }
  finish(): void {
    this.onended?.(new Event("ended"));
  }
}

function cue(id: string, time: number, over: Partial<DescriptionCue> = {}): DescriptionCue {
  return { id, time, text: `Description ${id}`, pause: true, narration: { script: "x" }, ...over };
}

function setup(cues: DescriptionCue[], silent: string[] = []): { media: FakeMedia; player: DescriptionPlayer; sounds: FakeAudio[]; refuse: () => void } {
  const media = new FakeMedia();
  const sounds: FakeAudio[] = [];
  let refuse = false;
  const host: DescriptionHost = {
    audioUrl: (id) => (silent.includes(id) ? null : `narration/${id}.wav`),
    makeAudio: (url) => {
      const a = new FakeAudio(url);
      a.refuse = refuse;
      sounds.push(a);
      return a;
    },
  };
  return { media, player: new DescriptionPlayer(media, cues, host), sounds, refuse: () => (refuse = true) };
}

test("playing with the description starts the video from the beginning and speaks nothing until a description's time", () => {
  const { media, player, sounds } = setup([cue("a", 4000)]);
  media.currentTime = 60;
  player.begin();
  assert.equal(media.currentTime, 0);
  assert.equal(media.paused, false, "the video plays");
  assert.equal(player.withVideo, true);
  media.playTo(3.9);
  assert.equal(sounds.length, 0);
  media.playTo(4.1);
  assert.deepEqual(sounds.map((s) => s.url), ["narration/a.wav"]);
  assert.ok(sounds[0]!.played);
});

test("a description that needs its time holds the video while it is spoken, and lets it go when it ends", () => {
  const { media, player, sounds } = setup([cue("a", 4000)]);
  player.begin();
  media.playTo(4.2);
  assert.equal(media.paused, true, "held");
  media.playTo(4.2);
  assert.equal(sounds.length, 1, "spoken once, not again on the next tick");
  const playsBefore = media.plays;
  sounds[0]!.finish();
  assert.equal(media.paused, false, "let go");
  assert.equal(media.plays, playsBefore + 1);
});

test("a description that does not need the video held is spoken over it, and the video never stops", () => {
  const { media, player, sounds } = setup([cue("a", 2000, { pause: false })]);
  player.begin();
  const pausesBefore = media.pauses;
  media.playTo(2.1);
  assert.equal(media.pauses, pausesBefore);
  assert.equal(media.paused, false);
  assert.equal(sounds.length, 1);
  const playsBefore = media.plays;
  sounds[0]!.finish();
  assert.equal(media.plays, playsBefore, "nothing to start again");
});

test("two descriptions due together are spoken one after the other, and the video stays held between them", () => {
  const { media, player, sounds } = setup([cue("a", 5000), cue("b", 5000)]);
  player.begin();
  media.playTo(5.2);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0]!.url, "narration/a.wav");
  sounds[0]!.finish();
  assert.equal(sounds.length, 2, "the second begins at once");
  assert.equal(media.paused, true, "and the video was not let go in between");
  const playsBefore = media.plays;
  sounds[1]!.finish();
  assert.equal(media.paused, false);
  assert.equal(media.plays, playsBefore + 1);
});

test("a description with no voice is only for reading: it never holds the video or speaks", () => {
  const { media, player, sounds } = setup([cue("a", 1000), cue("b", 2000)], ["a"]);
  assert.equal(player.voiced, true);
  player.begin();
  const pausesBefore = media.pauses;
  media.playTo(1.5);
  assert.equal(sounds.length, 0);
  assert.equal(media.pauses, pausesBefore);
  media.playTo(2.5);
  assert.equal(sounds.length, 1);
});

test("descriptions with no voice at all say so, so the dialog can offer only reading", () => {
  const { player } = setup([cue("a", 1000)], ["a"]);
  assert.equal(player.voiced, false);
});

test("jumping back in the video makes earlier descriptions come round again, and jumping forward skips the ones passed", () => {
  const { media, player, sounds } = setup([cue("a", 4000, { pause: false }), cue("b", 20000, { pause: false })]);
  player.begin();
  media.playTo(4.5);
  media.playTo(21);
  assert.deepEqual(sounds.map((s) => s.url), ["narration/a.wav", "narration/b.wav"].slice(0, sounds.length));
  const heard = sounds.length;
  media.seek(0);
  media.playTo(4.5);
  assert.equal(sounds.length, heard + 1, "a speaks again after going back");
  assert.equal(sounds[sounds.length - 1]!.url, "narration/a.wav");
  media.seek(30);
  media.playTo(31);
  assert.equal(sounds.length, heard + 1, "jumping past both says neither");
});

test("jumping while a description is being spoken stops it", () => {
  const { media, player, sounds } = setup([cue("a", 4000, { pause: false })]);
  player.begin();
  media.playTo(4.1);
  media.seek(50);
  assert.ok(sounds[0]!.paused, "its sound stopped");
  sounds[0]!.finish();
  assert.equal(sounds.length, 1, "and finishing it later does nothing");
});

test("pressing play while the video is held for a description skips the rest of it", () => {
  const { media, player, sounds } = setup([cue("a", 4000)]);
  player.begin();
  media.playTo(4.1);
  assert.equal(media.paused, true);
  media.play();
  assert.ok(sounds[0]!.paused, "the description stops");
  assert.equal(media.paused, false, "and the video carries on");
});

test("a sound the browser refuses to start does not leave the video held", async () => {
  const { media, player, refuse } = setup([cue("a", 4000)]);
  refuse();
  player.begin();
  media.playTo(4.1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(media.paused, false);
});

test("the end of the video, or turning the voice off, stops everything and lets go of the video's events", () => {
  const { media, player, sounds } = setup([cue("a", 4000)]);
  let changes = 0;
  player.onChange = () => changes++;
  player.begin();
  assert.deepEqual([media.count("timeupdate"), media.count("seeking"), media.count("play"), media.count("ended")], [1, 1, 1, 1]);
  media.playTo(4.1);
  media.emit("ended");
  assert.equal(player.withVideo, false);
  assert.ok(sounds[0]!.paused);
  assert.deepEqual([media.count("timeupdate"), media.count("seeking"), media.count("play"), media.count("ended")], [0, 0, 0, 0]);
  assert.ok(changes >= 2, "the page is told");
  // Turning it off by hand does not start the video either.
  player.begin();
  media.playTo(4.1);
  const playsBefore = media.plays;
  player.end();
  assert.equal(media.plays, playsBefore);
});

test("listening on its own plays the voiced descriptions in order of time and says where it is up to", () => {
  const { player, sounds } = setup([cue("c", 30000), cue("a", 4000), cue("b", 12000)], ["b"]);
  const progress: (string | null)[] = [];
  player.onChange = () => progress.push(player.listening ? `${player.listening.at} of ${player.listening.of}` : null);
  player.listen();
  assert.deepEqual(sounds.map((s) => s.url), ["narration/a.wav"], "the earliest first");
  assert.deepEqual(player.listening, { at: 1, of: 2 }, "b has no voice, so there are two");
  sounds[0]!.finish();
  assert.deepEqual(sounds.map((s) => s.url), ["narration/a.wav", "narration/c.wav"]);
  sounds[1]!.finish();
  assert.equal(player.listening, null, "done");
  assert.deepEqual(progress.filter(Boolean), ["1 of 2", "2 of 2"]);
});

test("stopping the listening, or starting the video with the description, stops the other", () => {
  const { media, player, sounds } = setup([cue("a", 4000), cue("b", 9000)]);
  player.listen();
  player.stopListening();
  assert.ok(sounds[0]!.paused);
  assert.equal(player.listening, null);
  sounds[0]!.finish();
  assert.equal(sounds.length, 1, "it does not go on to the next");
  player.listen();
  player.begin();
  assert.equal(player.listening, null);
  assert.equal(player.withVideo, true);
  assert.ok(sounds[1]!.paused, "the listening sound was stopped");
  void media;
});

test("closing the dialog stops listening but not a description that is being spoken with the video", () => {
  const { media, player, sounds } = setup([cue("a", 0)]);
  player.begin();
  assert.equal(sounds.length, 1);
  player.stopListening();
  assert.equal(sounds[0]!.paused, false, "the dialog's close event must not cut it off");
  assert.equal(player.withVideo, true);
  void media;
});

test("descriptions are put in the order they happen whatever order they were written in", () => {
  const obj = { type: "video", content: { description: { cues: [cue("late", 9000), cue("early", 1000), cue("mid", 5000)] } } } as unknown as OSObject;
  assert.deepEqual(descriptionCues(obj).map((c) => c.id), ["early", "mid", "late"]);
  assert.deepEqual(descriptionCues({ type: "audio", content: { description: { cues: [cue("a", 1)] } } } as unknown as OSObject), [], "only a video has them");
  assert.deepEqual(descriptionCues({ type: "video", content: {} } as unknown as OSObject), []);
});

test("a time is written as minutes and seconds", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(4500), "0:04");
  assert.equal(clock(65000), "1:05");
  assert.equal(clock(3_600_000), "60:00");
});
