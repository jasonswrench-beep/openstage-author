// Which learning-record-store hosts a published course may report to. A learning system launches a course with the address of a store (xAPI) or of a
// place to ask for a token (cmi5) in the page's own address, so whoever can hand a learner a link can name the place the learner's answers are sent to.
// The player already refuses an address that is not https (apart from the learner's own computer). An author, or the institution the author works for, who
// knows which learning systems it uses may go further and list their hosts when publishing: the course then reports only to those, and a launch that
// names any other runs the course untracked, exactly as a preview does. With no list, the course behaves as it always has.
//
// A host is written as a plain name: `lrs.example.org`, or `*.example.org` for any host one or more levels under it (the name itself is not included).
// There is no scheme, port, path or address in a list, because the check is on the host alone. Nothing here knows about a page, so all of it is tested directly.

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^(?:\\*\\.)?${LABEL}(?:\\.${LABEL})*$`);
/** The most hosts a list may hold, so a list cannot swell the page. */
export const MAX_HOSTS = 50;

export interface ParsedHosts {
  /** The hosts that are good, lower case, each once, in the order given. */
  hosts: string[];
  /** For each entry that is not a host, what is wrong with it, in words for the author. */
  problems: string[];
}

/** One entry's problem in words, or null when it is a host. `entry` is already trimmed and lower case. */
function problemWith(entry: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(entry)) return `"${entry}" has a web address's start (https://). Write only the host, such as lrs.example.org.`;
  if (entry.includes("/")) return `"${entry}" has a path. Write only the host, such as lrs.example.org.`;
  if (entry.includes(":") || entry.includes("[")) return `"${entry}" has a port or an address in brackets. Write only the host's name, such as lrs.example.org.`;
  if (entry.includes("*") && !entry.startsWith("*.")) return `"${entry}": a * may only start a host, as in *.example.org.`;
  if (entry === "*.") return `"${entry}" needs a name after it, as in *.example.org.`;
  if (entry.length > 253 || !HOST.test(entry)) return `"${entry}" is not a host name. Use letters, digits and hyphens, with dots between the parts, such as lrs.example.org.`;
  return null;
}

/** Reads a list the way an author writes it: hosts separated by commas, spaces or new lines. Anything that is not a host is reported, and left out. */
export function parseHosts(text: string): ParsedHosts {
  const hosts: string[] = [];
  const problems: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const entry = raw.trim().toLowerCase().replace(/\.$/, "");
    if (entry === "") continue;
    const problem = problemWith(entry);
    if (problem) problems.push(problem);
    else if (!hosts.includes(entry)) hosts.push(entry);
  }
  if (hosts.length > MAX_HOSTS) problems.push(`There are ${hosts.length} hosts; a course may list at most ${MAX_HOSTS}.`);
  return { hosts: hosts.slice(0, MAX_HOSTS), problems };
}

/**
 * Whether a course with this list may report to this host. `host` is what a web address calls its host (URL.hostname). With no list, or an empty one, any host
 * is allowed, as before. With a list, the host has to be on it: the same name, or under a `*.` entry.
 */
export function hostAllowed(host: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => (a.startsWith("*.") ? h.length > a.length - 1 && h.endsWith(a.slice(1)) : h === a));
}

/** `hostAllowed` for a launch address. When the host is refused it says so on the console, so whoever runs the course can see why nothing is reported. */
export function hostAllowedOrSay(url: URL, allowed: readonly string[] | undefined): boolean {
  if (hostAllowed(url.hostname, allowed)) return true;
  console.warn(`This course reports only to the hosts its author listed (${(allowed ?? []).join(", ")}). ${url.hostname} is not one of them, so the course runs without reporting.`);
  return false;
}
