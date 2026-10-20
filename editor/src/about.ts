// The About window's facts: the version, and where things are on this computer. They are what someone helping with a problem asks first, so they can be copied as plain text. The shell gathers them
// (`about_info` in lib.rs); everything that turns them into words is here, so it is tested alone (about.test.ts).

/** What the shell says about this copy of the editor. Every field is words or a path, never empty: "not found" says so. */
export interface AboutInfo {
  version: string;
  /** Whether this is an installed copy (it has the Python that travels with it beside it) rather than one run from the source folder. */
  installed: boolean;
  program: string;
  /** A file inside the folder of guides, to show that folder by, or "" when there is none. */
  guidesFile: string;
  python: string;
  node: string;
  recorder: string;
  recogniser: string;
  data: string;
  settings: string;
  engine: string;
  webview: string;
  windows: string;
  arch: string;
}

const FIELDS: readonly (keyof AboutInfo)[] = ["version", "installed", "program", "guidesFile", "python", "node", "recorder", "recogniser", "data", "settings", "engine", "webview", "windows", "arch"];

export const UNKNOWN_ABOUT: AboutInfo = {
  version: "unknown", installed: false, program: "unknown", guidesFile: "", python: "unknown", node: "unknown", recorder: "unknown", recogniser: "unknown", data: "unknown", settings: "unknown",
  engine: "unknown", webview: "unknown", windows: "unknown", arch: "unknown",
};

/** The shell's JSON as the facts; anything missing or of the wrong kind is "unknown", so the window always has something to say. */
export function parseAbout(raw: string): AboutInfo {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    // keep what is unknown
  }
  const out: Record<string, unknown> = { ...UNKNOWN_ABOUT };
  for (const key of FIELDS) {
    const value = data[key];
    if (key === "installed") out[key] = value === true;
    else if (typeof value === "string" && (value !== "" || key === "guidesFile")) out[key] = value;
  }
  return out as unknown as AboutInfo;
}

/** The labelled lines the window shows, in the order someone helping would want them. */
export function aboutLines(a: AboutInfo): { label: string; value: string }[] {
  return [
    { label: "Version", value: a.version },
    { label: "Kind of copy", value: a.installed ? "Installed (it has its own Python and Node)" : "Run from the source folder (it uses the Python and Node on this computer)" },
    { label: "Program", value: a.program },
    { label: "Python", value: a.python },
    { label: "Node", value: a.node },
    { label: "Screen recorder", value: a.recorder },
    { label: "Speech recogniser", value: a.recogniser },
    { label: "Narration voice", value: a.engine },
    { label: "Settings file", value: a.settings },
    { label: "Data folder", value: a.data },
    { label: "Web view", value: a.webview },
    { label: "Windows", value: `${a.windows} (${a.arch})` },
  ];
}

/** The same, as plain text to copy into a message. It holds no key and no course: only versions and folders. */
export function aboutText(a: AboutInfo): string {
  return ["OpenStage Author", ...aboutLines(a).map((l) => `${l.label}: ${l.value}`)].join("\n");
}
