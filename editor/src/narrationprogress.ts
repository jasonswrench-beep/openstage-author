// How long making audio takes, said while it is being made. The speech engine is a program that runs to the end and says nothing on the way,
// so the Narration window looks at the audio that has appeared on the disk and works out the rest from how quickly it came. Nothing here
// needs a window: the words and the sums are tested alone (narrationprogress.test.ts).
//
// Two kinds of voice are told apart, because they are very different in speed: Kokoro on this computer, which has to start up (the first
// narration takes the longest) and then takes about 20 milliseconds a character on a computer without a graphics card (measured
// 2026-10-22: 17 to 24 ms a character, and 10 to 25 seconds to start); and everything else (an internet service or a plugin), which
// is guessed to be quicker. The guess is only for the first moments: it is replaced by what this computer really did, and what it did is
// remembered for next time.

export type Kind = "kokoro" | "other";

/** Seconds of waiting for each character of script, for each kind of voice. */
export type Rates = Partial<Record<Kind, number>>;

export const DEFAULT_RATES: Record<Kind, number> = { kokoro: 0.02, other: 0.008 };
/** Seconds before the first narration of a kind can finish, for the voice to start (Kokoro loads its model). */
export const START_UP: Record<Kind, number> = { kokoro: 20, other: 2 };

export interface Job {
  key: string;
  characters: number;
  kind: Kind;
}

export const kindOfEngine = (engine: string): Kind => (engine === "kokoro" ? "kokoro" : "other");

const rateFor = (kind: Kind, rates: Rates): number => {
  const r = rates[kind];
  return typeof r === "number" && r > 0 && Number.isFinite(r) ? r : DEFAULT_RATES[kind];
};

/** Seconds, in words an author can plan around. */
export function waitWords(seconds: number): string {
  if (seconds < 45) return "less than a minute";
  if (seconds < 90) return "about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 5) * 5;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 || rest === 60 ? `about ${h}` : `about ${h} ${rest} minutes`;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What to expect before anything has been made: the seconds in all, and whether the rates are this computer's own from last time. */
export function firstGuess(jobs: readonly Job[], rates: Rates): { seconds: number; remembered: boolean } {
  let seconds = 0;
  const kinds = new Set<Kind>();
  for (const j of jobs) {
    seconds += j.characters * rateFor(j.kind, rates);
    kinds.add(j.kind);
  }
  for (const k of kinds) seconds += START_UP[k];
  const remembered = [...kinds].every((k) => typeof rates[k] === "number");
  return { seconds, remembered };
}

/** The sentence said when the making starts. */
export function startingText(jobs: readonly Job[], rates: Rates): string {
  const count = jobs.length;
  const characters = jobs.reduce((n, j) => n + j.characters, 0);
  const guess = firstGuess(jobs, rates);
  const slowStart = jobs.some((j) => j.kind === "kokoro") ? " The first one takes longest, because the voice has to start up." : "";
  return `Making audio for ${count} ${count === 1 ? "narration" : "narrations"} (${characters.toLocaleString("en-US")} characters). ${guess.remembered ? "Last time on this computer that would have taken" : "A first guess:"} ${waitWords(guess.seconds)}.${slowStart} It gets more exact as they finish. You can cancel, and what is finished is kept.`;
}

export interface ProgressView {
  done: number;
  total: number;
  /** Seconds still to wait, as far as can be told. */
  secondsLeft: number;
  /** For the line under the heading: "3 of 45 done, about 6 minutes left." */
  text: string;
  /** For a button, in few words: "3 of 45". */
  short: string;
}

/** Follows one run of "make the audio": told, from time to time, which narrations have audio now. */
export class RunProgress {
  private readonly jobs: readonly Job[];
  private readonly rates: Rates;
  private readonly startedAt: number;
  /** The moment each narration was first seen finished, in the order they were seen. */
  private readonly seen: { key: string; at: number }[] = [];

  constructor(jobs: readonly Job[], rates: Rates, startedAt: number) {
    this.jobs = jobs;
    this.rates = rates;
    this.startedAt = startedAt;
  }

  /** What this run showed about speed, for each kind with something to go on: seconds per character, leaving out the first narration (it carries the start-up). */
  measured(): Rates {
    const out: Rates = {};
    for (const kind of ["kokoro", "other"] as const) {
      let ms = 0;
      let characters = 0;
      for (let i = 1; i < this.seen.length; i++) {
        const job = this.jobs.find((j) => j.key === this.seen[i]!.key);
        if (!job || job.kind !== kind) continue;
        ms += this.seen[i]!.at - this.seen[i - 1]!.at;
        characters += job.characters;
      }
      // A few characters in one poll say little: wait for a sentence's worth, or the guess stays.
      if (characters >= 200 && ms > 0) out[kind] = ms / 1000 / characters;
    }
    return out;
  }

  update(done: ReadonlySet<string>, now: number): ProgressView {
    for (const j of this.jobs) {
      if (done.has(j.key) && !this.seen.some((s) => s.key === j.key)) this.seen.push({ key: j.key, at: now });
    }
    const total = this.jobs.length;
    const finished = this.jobs.filter((j) => done.has(j.key));
    const live = this.measured();
    const rates: Rates = { ...this.rates, ...live };
    let secondsLeft = 0;
    for (const j of this.jobs) if (!done.has(j.key)) secondsLeft += j.characters * rateFor(j.kind, rates);
    if (finished.length === 0) {
      const elapsed = (now - this.startedAt) / 1000;
      const kinds = new Set(this.jobs.map((j) => j.kind));
      const startUp = Math.max(...[...kinds].map((k) => START_UP[k]));
      secondsLeft += Math.max(3, startUp - elapsed);
    }
    const left = finished.length === total ? "" : `, ${waitWords(secondsLeft)} left`;
    return {
      done: finished.length,
      total,
      secondsLeft,
      text: finished.length === 0 ? `Starting the voice and making the first one. ${capital(waitWords(secondsLeft))} in all, as a first guess.` : `${finished.length} of ${total} done${left}.`,
      short: `${finished.length} of ${total}`,
    };
  }
}

const STORE = "openstage.narrationRates";

/** The speeds this computer showed last time, if it was ever measured. Nothing is lost if the browser will not say. */
export function loadRates(): Rates {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, unknown>;
    const out: Rates = {};
    for (const k of ["kokoro", "other"] as const) {
      const v = raw[k];
      if (typeof v === "number" && v > 0 && v < 5 && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRates(r: Rates): void {
  if (r.kokoro === undefined && r.other === undefined) return;
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...loadRates(), ...r }));
  } catch {
    // remembering is a convenience
  }
}
