import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RATES, RunProgress, firstGuess, startingText, waitWords, type Job } from "./narrationprogress.ts";

const jobs = (n: number, characters = 400, kind: Job["kind"] = "kokoro"): Job[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, characters, kind }));

test("a wait is said in minutes an author can plan around", () => {
  assert.equal(waitWords(10), "less than a minute");
  assert.equal(waitWords(60), "about a minute");
  assert.equal(waitWords(95), "about 2 minutes");
  assert.equal(waitWords(380), "about 6 minutes");
  assert.equal(waitWords(3600), "about 1 hour");
  assert.equal(waitWords(3600 + 20 * 60), "about 1 hour 20 minutes");
  assert.equal(waitWords(2 * 3600 + 29 * 60), "about 2 hours 30 minutes");
});

test("the first guess adds the start-up and the characters, and uses this computer's own speed when it is known", () => {
  const forty = jobs(45);
  const g = firstGuess(forty, {});
  assert.equal(Math.round(g.seconds), Math.round(45 * 400 * DEFAULT_RATES.kokoro + 20));
  assert.equal(g.remembered, false);
  const quick = firstGuess(forty, { kokoro: 0.005 });
  assert.equal(quick.remembered, true);
  assert.ok(quick.seconds < g.seconds);
  assert.match(startingText(forty, {}), /^Making audio for 45 narrations \(18,000 characters\)\. A first guess: about 6 minutes\. The first one takes longest/);
  assert.match(startingText(jobs(1, 100, "other"), { other: 0.01 }), /^Making audio for 1 narration \(100 characters\)\. Last time on this computer that would have taken less than a minute\. It gets/);
});

test("before the first one is done it says the voice is starting; then it counts what is left from how fast it really went", () => {
  const p = new RunProgress(jobs(4), {}, 0);
  assert.equal(p.update(new Set(), 2000).text, "Starting the voice and making the first one. About a minute in all, as a first guess.");
  // The first finishes after the start-up; each of the next takes 8 s for 400 characters = 0.02 s a character.
  assert.equal(p.update(new Set(["k0"]), 25_000).text, "1 of 4 done, less than a minute left.");
  p.update(new Set(["k0", "k1"]), 33_000);
  const v = p.update(new Set(["k0", "k1", "k2"]), 41_000);
  assert.equal(v.done, 3);
  assert.equal(v.short, "3 of 4");
  assert.equal(Math.round(v.secondsLeft), 8);
  assert.equal(v.text, "3 of 4 done, less than a minute left.");
  assert.equal(Math.round(p.measured().kokoro! * 1000), 20);
  assert.equal(p.update(new Set(["k0", "k1", "k2", "k3"]), 49_000).text, "4 of 4 done.");
});

test("a slow computer shows itself: the estimate follows what was seen, not the guess", () => {
  const p = new RunProgress(jobs(10), {}, 0);
  p.update(new Set(["k0"]), 30_000);
  p.update(new Set(["k0", "k1"]), 50_000); // 400 characters in 20 s: 0.05 a character
  const v = p.update(new Set(["k0", "k1", "k2"]), 70_000);
  assert.equal(Math.round(p.measured().kokoro! * 1000), 50);
  assert.equal(Math.round(v.secondsLeft), 7 * 400 * 0.05);
  assert.equal(v.text, "3 of 10 done, about 2 minutes left.");
});

test("kinds of voice are measured apart, and a little data does not change the guess", () => {
  const mixed: Job[] = [...jobs(2, 400, "kokoro"), { key: "o0", characters: 100, kind: "other" }];
  const p = new RunProgress(mixed, { other: 0.01 }, 0);
  p.update(new Set(["k0"]), 25_000);
  p.update(new Set(["k0", "k1"]), 33_000);
  assert.equal(p.measured().other, undefined);
  assert.equal(Math.round(p.measured().kokoro! * 1000), 20);
  assert.equal(Math.round(p.update(new Set(["k0", "k1"]), 33_000).secondsLeft), 1);
});
