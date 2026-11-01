// A very small client for the remote-control protocol of a browser built on Chromium (Microsoft Edge, Google Chrome). The video maker
// (video.ts) uses it to open the course in a browser that has no window, put each slide in the state it needs, and take a picture of it.
// The browser is a program of the author's own computer, started as a separate program; nothing of it is shipped or linked.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where a browser to take the pictures is: OPENSTAGE_BROWSER if it is set, otherwise Edge, then Chrome, in their usual places. Null if none. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | null {
  const named = env["OPENSTAGE_BROWSER"];
  if (named) return existsSync(named) ? named : null;
  const roots = [env["ProgramFiles(x86)"], env["ProgramFiles"], env["LOCALAPPDATA"]].filter((r): r is string => Boolean(r));
  for (const rel of [["Microsoft", "Edge", "Application", "msedge.exe"], ["Google", "Chrome", "Application", "chrome.exe"]]) {
    for (const root of roots) {
      const candidate = path.join(root, ...rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One page of the browser, spoken to over a web socket. */
export class Page {
  private readonly socket: WebSocket;
  private serial = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly waiting = new Map<string, ((params: unknown) => void)[]>();
  private closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => this.lost());
    socket.addEventListener("error", () => this.lost());
  }

  static async connect(url: string): Promise<Page> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("The browser did not answer.")), { once: true });
    });
    return new Page(socket);
  }

  private lost(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("The browser stopped while it was being used."));
    }
    this.pending.clear();
  }

  private receive(text: string): void {
    const message = JSON.parse(text) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
    if (message.id !== undefined) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) p.reject(new Error(`The browser refused ${p.method}: ${message.error.message}`));
      else p.resolve(message.result);
    } else if (message.method) {
      const waiters = this.waiting.get(message.method);
      if (waiters) {
        this.waiting.delete(message.method);
        for (const w of waiters) w(message.params);
      }
    }
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The browser stopped while it was being used."));
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The browser did not answer ${method} in ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves the next time the browser reports this event. */
  once(method: string): Promise<unknown> {
    return new Promise((resolve) => this.waiting.set(method, [...(this.waiting.get(method) ?? []), resolve]));
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.enable");
    const loaded = this.once("Page.loadEventFired");
    const result = await this.send<{ errorText?: string }>("Page.navigate", { url });
    if (result.errorText) throw new Error(`The browser could not open ${url}: ${result.errorText}`);
    await loaded;
  }

  /** Run a piece of script in the page and give back its value (waiting for it if it is a promise). */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(`The page failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value as T;
  }

  /** A picture (PNG) of the top left `width` by `height` of the page, made `scale` times as large. */
  async screenshot(width: number, height: number, scale = 1): Promise<Uint8Array> {
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width, height, scale } });
    return Uint8Array.from(Buffer.from(data, "base64"));
  }

  close(): void {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}

/** A browser that has no window, started for this one job. */
export class Browser {
  readonly page: Page;
  private readonly child: ChildProcess;
  private readonly profile: string;
  private done = false;

  private constructor(page: Page, child: ChildProcess, profile: string) {
    this.page = page;
    this.child = child;
    this.profile = profile;
  }

  /** Start the browser with a window of this size (in the page's own pixels) and connect to its one page. */
  static async launch(executable: string, size: { width: number; height: number }): Promise<Browser> {
    const profile = mkdtempSync(path.join(os.tmpdir(), "openstage-video-"));
    const child = spawn(
      executable,
      [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${size.width},${size.height}`,
        "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-gpu",
        "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "--allow-file-access-from-files", "--disable-features=Translate,MediaRouter",
        "about:blank",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    const exited = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`The browser stopped before it could be used (code ${code}).`))));
    // Ending on purpose, later, is not a failure that anyone is waiting for.
    exited.catch(() => undefined);
    child.once("error", () => undefined);
    const attempt = (async () => {
      const portFile = path.join(profile, "DevToolsActivePort");
      for (let waited = 0; waited < 30_000; waited += 100) {
        if (existsSync(portFile)) {
          const [port] = readFileSync(portFile, "utf-8").split(/\r?\n/);
          if (port) {
            const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl?: string }[];
            const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
            if (target?.webSocketDebuggerUrl) return Page.connect(target.webSocketDebuggerUrl);
          }
        }
        await sleep(100);
      }
      throw new Error("The browser did not start in 30 seconds.");
    })();
    let page: Page;
    try {
      page = await Promise.race([attempt, exited]);
    } catch (e) {
      Browser.stop(child);
      rmSync(profile, { recursive: true, force: true });
      throw e;
    }
    const browser = new Browser(page, child, profile);
    process.once("exit", () => browser.kill());
    await page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    return browser;
  }

  /** Stop this browser, and what it started, by its own process number: never another program of the same name. */
  private static stop(child: ChildProcess): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGKILL");
  }

  private kill(): void {
    Browser.stop(this.child);
  }

  async close(): Promise<void> {
    if (this.done) return;
    this.done = true;
    try {
      await this.page.send("Browser.close", {}, 5000);
    } catch {
      // It may already have gone; it is stopped below either way.
    }
    this.page.close();
    for (let waited = 0; waited < 3000 && this.child.exitCode === null; waited += 100) await sleep(100);
    this.kill();
    for (let tries = 0; tries < 20; tries++) {
      try {
        rmSync(this.profile, { recursive: true, force: true });
        return;
      } catch {
        await sleep(250);
      }
    }
  }
}
