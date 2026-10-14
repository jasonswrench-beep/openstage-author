// Following a video or an audio clip: when objects on a slide are timed to a clip's own time, this watches the clip and tells the timeline where
// it is. What shows then depends only on the clip's time, so a learner who plays, pauses, skips ahead or goes back sees what belongs to that
// moment. It is also where "Pause timing" reaches the clip: pausing the timing pauses a clip that is playing, and resuming plays it again,
// so everything holds still while the learner reads.
//
// It works on anything shaped like a media element, so it is tested with a clip moved by hand.

export interface ClipLike {
  /** Seconds into the clip. */
  currentTime: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FollowHooks {
  /** The clip is at this many milliseconds. */
  time(id: string, ms: number): void;
  /** The clip cannot play, or is not there: whatever follows it must not be left hidden. */
  failed(id: string): void;
}

/** Something to call every so often. The player uses the real one; the tests use one moved by hand. */
export interface Ticker {
  start(fn: () => void, ms: number): unknown;
  stop(handle: unknown): void;
}

export const realTicker: Ticker = {
  start: (fn, ms) => setInterval(fn, ms),
  stop: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** How often the clip's time is read while it plays. The clip itself reports about four times a second, which is too coarse for a note meant to arrive at a word. */
export const POLL_MS = 100;

const WATCHED = ["timeupdate", "seeking", "seeked", "playing", "pause", "ended", "loadedmetadata", "durationchange"];

interface Watch {
  clip: ClipLike;
  off: () => void;
}

export class MediaFollower {
  private readonly watching = new Map<string, Watch>();
  /** The clips this paused, so resuming plays them again and no others. */
  private held = new Set<string>();
  private handle: unknown = null;
  private readonly hooks: FollowHooks;
  private readonly ticker: Ticker;

  constructor(hooks: FollowHooks, ticker: Ticker = realTicker) {
    this.hooks = hooks;
    this.ticker = ticker;
  }

  /**
   * Start following a clip. A clip that is not there (null) has failed: what follows it is told so at once. The clip's time so far is
   * reported straight away, so an object timed for the very start shows.
   */
  attach(id: string, clip: ClipLike | null): void {
    this.release1(id);
    if (!clip) {
      this.hooks.failed(id);
      return;
    }
    const report = () => {
      this.hooks.time(id, Math.round(clip.currentTime * 1000));
      this.poll();
    };
    const fail = () => this.hooks.failed(id);
    for (const type of WATCHED) clip.addEventListener(type, report);
    clip.addEventListener("error", fail);
    this.watching.set(id, { clip, off: () => { for (const type of WATCHED) clip.removeEventListener(type, report); clip.removeEventListener("error", fail); } });
    report();
  }

  /** Stop following everything, for a new slide. Clips are left as they are. */
  detach(): void {
    for (const id of [...this.watching.keys()]) this.release1(id);
    this.held.clear();
    this.poll();
  }

  /** Is any clip being followed? */
  get following(): boolean {
    return this.watching.size > 0;
  }

  /** Pause timing: a clip that is playing is paused, and remembered. Returns how many were paused. */
  hold(): number {
    for (const [id, w] of this.watching) {
      if (!w.clip.paused) {
        w.clip.pause();
        this.held.add(id);
      }
    }
    this.poll();
    return this.held.size;
  }

  /** Resume timing: the clips that were paused play again. Returns how many. */
  release(): number {
    const ids = [...this.held];
    this.held.clear();
    for (const id of ids) {
      const w = this.watching.get(id);
      if (!w) continue;
      // The browser can refuse to play; then the learner presses play on the clip itself.
      void Promise.resolve(w.clip.play()).catch(() => undefined);
    }
    this.poll();
    return ids.length;
  }

  private release1(id: string): void {
    this.watching.get(id)?.off();
    this.watching.delete(id);
  }

  /** Read the time of every clip that is playing, a few times a second, for as long as one is. */
  private poll(): void {
    const playing = [...this.watching.values()].some((w) => !w.clip.paused);
    if (playing && this.handle === null) {
      this.handle = this.ticker.start(() => {
        let any = false;
        for (const [id, w] of this.watching) {
          this.hooks.time(id, Math.round(w.clip.currentTime * 1000));
          if (!w.clip.paused) any = true;
        }
        if (!any) this.poll();
      }, POLL_MS);
    } else if (!playing && this.handle !== null) {
      this.ticker.stop(this.handle);
      this.handle = null;
    }
  }
}
