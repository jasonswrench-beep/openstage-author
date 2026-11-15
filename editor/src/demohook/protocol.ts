// The demo-mode hook's protocol: the messages between a program and OpenStage Studio's player.
// This file has no DOM and no Node code, so both sides and the tests share it.

/** The global a program's shell sets (only when launched with the demo flag) to switch the hook on. */
export const SETTINGS_GLOBAL = "__OPENSTAGE_DEMO_HOOK__";

export interface HookSettings {
  /** Where the player listens: always this computer, such as http://127.0.0.1:47321. */
  endpoint: string;
  /** A one-time secret the player made for this take. Requests without it are refused. */
  token: string;
  /** A folder the program may make demo projects in for this take (programs that open copies of demo projects need one). */
  workspace?: string;
}

export type Command =
  | { cmd: "hello" }
  | { cmd: "list" }
  | { cmd: "position"; id: string }
  | { cmd: "hover"; id: string | null }
  | { cmd: "click"; id: string }
  | { cmd: "focus"; id: string }
  | { cmd: "type"; id?: string; text: string }
  | { cmd: "key"; id?: string; key: string; modifiers: string[] }
  | { cmd: "scroll"; id?: string; axis: "x" | "y"; amount: number }
  | { cmd: "loadDemo"; name: string }
  | { cmd: "reset" }
  | { cmd: "settle" }
  | { cmd: "text" };

/** A command as sent, with the number its reply carries. */
export type Envelope = Command & { seq: number };

export interface Reply {
  seq: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** A control as the hook reports it. The rectangle is in CSS pixels of the page; `viewport` says how big the page is. */
export interface ControlInfo {
  id: string;
  label: string;
  role: string;
  rect: [number, number, number, number];
  visible: boolean;
  enabled: boolean;
}

export interface Hello {
  program: string;
  hookVersion: number;
  viewport: [number, number];
  devicePixelRatio: number;
  controls: number;
}

/** A piece of text on screen, as the `text` command reports it (for the frame scan). The rectangle is in CSS pixels. */
export interface TextOnScreen {
  text: string;
  rect: [number, number, number, number];
}

/** Version 2 added the `text` command. */
export const HOOK_VERSION = 2;

/** Whether an endpoint is on this computer only. The hook never talks to anything else. */
export function isLoopback(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return (u.protocol === "http:" || u.protocol === "ws:") && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** The hook's settings, if the program was launched in demo mode: from the global its shell set, or from the page's
 * address (`?demo-hook=<endpoint>&demo-token=<token>`). Null means demo mode is off, which is the default. */
export function readSettings(global: Record<string, unknown>, search: string): HookSettings | null {
  const fromGlobal = global[SETTINGS_GLOBAL] as Partial<HookSettings> | undefined;
  const params = new URLSearchParams(search);
  const endpoint = fromGlobal?.endpoint ?? params.get("demo-hook") ?? "";
  const token = fromGlobal?.token ?? params.get("demo-token") ?? "";
  const workspace = fromGlobal?.workspace;
  if (!endpoint || !token) return null;
  if (!isLoopback(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), token, ...(typeof workspace === "string" && workspace ? { workspace } : {}) };
}

/** Scale a control's CSS rectangle to pixels of a captured frame of `frame` size. */
export function toFrame(rect: [number, number, number, number], viewport: [number, number], frame: [number, number]): [number, number, number, number] {
  const sx = frame[0] / viewport[0];
  const sy = frame[1] / viewport[1];
  return [Math.round(rect[0] * sx), Math.round(rect[1] * sy), Math.round(rect[2] * sx), Math.round(rect[3] * sy)];
}

/** In demo mode the page's look must not depend on whether its window is in front or where the real mouse rests, so the
 * hook rewrites the page's own style rules: focus and hover follow markers the hook sets, not the browser's state. */
const STATE_PSEUDOS: [RegExp, string][] = [
  [/:focus-visible(?![\w-])/g, "[data-demo-focus-visible]"],
  [/:focus-within(?![\w-])/g, "[data-demo-focus-within]"],
  [/:focus(?![\w-])/g, "[data-demo-focus]"],
  [/:hover(?![\w-])/g, "[data-demo-hover]"],
];

export function steadySelector(selector: string): string {
  return STATE_PSEUDOS.reduce((sel, [re, attr]) => sel.replace(re, attr), selector);
}
