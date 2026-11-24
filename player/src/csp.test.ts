// The published page's content security policy (csp.ts): what it says, that the real publishing tool writes it into the page ahead of everything it governs, and that
// the page and the player's own code do none of the things it forbids. A policy that the page itself breaks would make a course lose its colours, its pictures or its
// tracking in the learner's browser, so these tests read the page the way the browser would.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { EMBED_ORIGINS, embedUrl } from "./blocks.ts";
import { DIRECTIVES, contentSecurityPolicy, policyMetaTag } from "./csp.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const player = path.resolve(here, "..");
const examples = path.resolve(player, "..", "examples");

/** The policy as a map from each directive to its sources. */
const parse = (policy: string): Record<string, string[]> =>
  Object.fromEntries(policy.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));

test("the policy lists exactly these directives with exactly these sources, so a change to it is a decision someone made", () => {
  assert.deepEqual(parse(contentSecurityPolicy()), {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:"],
    "connect-src": ["https:", "http://localhost:*", "http://127.0.0.1:*"],
    "frame-src": ["https://www.youtube-nocookie.com", "https://player.vimeo.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  });
});

test("every directive says in plain words why it is there, and none is listed twice", () => {
  for (const d of DIRECTIVES) assert.ok(d.why.length > 40, `${d.name} has a reason`);
  const names = DIRECTIVES.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
});

test("nothing lets code be written into the page or built from text, and nothing is open to every site", () => {
  const policy = parse(contentSecurityPolicy());
  const everything = Object.values(policy).flat();
  for (const banned of ["'unsafe-eval'", "'unsafe-inline'", "'unsafe-hashes'", "'wasm-unsafe-eval'", "*", "http:", "ws:", "wss:"]) {
    assert.ok(!everything.includes(banned), `${banned} is not allowed anywhere`);
  }
  assert.deepEqual(policy["script-src"], ["'self'"], "script comes only from the course's own file");
  assert.deepEqual(policy["style-src"], ["'self'"], "style sheets come only from the course's own file");
  for (const [name, sources] of Object.entries(policy)) {
    if (name !== "connect-src") assert.ok(!sources.includes("https:"), `${name}: only the tracking reports may go to any https site`);
  }
  assert.deepEqual(policy["object-src"], ["'none'"]);
});

test("the frames allowed are exactly the sites the player builds embed addresses from, and every embed address is inside them", () => {
  const frames = parse(contentSecurityPolicy())["frame-src"]!;
  assert.deepEqual([...frames].sort(), Object.values(EMBED_ORIGINS).sort());
  const addresses = [
    embedUrl({ provider: "youtube", id: "dQw4w9WgXcQ", hash: "", transcript: "", captionsConfirmed: true }),
    embedUrl({ provider: "vimeo", id: "76979871", hash: "", transcript: "", captionsConfirmed: true }),
    embedUrl({ provider: "vimeo", id: "76979871", hash: "abc123def4", transcript: "", captionsConfirmed: true }),
  ];
  for (const address of addresses) {
    assert.ok(address, "a well-formed id gives an address");
    assert.ok(frames.includes(new URL(address).origin), `${address} is allowed to be framed`);
  }
  assert.ok(Object.values(EMBED_ORIGINS).every((o) => /^https:\/\/[a-z.-]+$/.test(o)), "each is one https host, with no wildcard");
});

test("the tag is one well-formed meta element that cannot be broken out of", () => {
  const tag = policyMetaTag();
  assert.match(tag, /^<meta http-equiv="Content-Security-Policy" content="[^"<>]+">$/);
  assert.ok(tag.includes(contentSecurityPolicy()));
});

// ---- the real publishing tool

/** Publish an example as a quick look (no problem check, so it needs no Python) and give back the folder. */
function publishPreview(example: string): { dir: string; page: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-csp-test-"));
  const out = path.join(dir, "site");
  const r = spawnSync(process.execPath, ["publish.ts", path.join(examples, example), out, "--json", "--preview"], { cwd: player, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { dir, page: readFileSync(path.join(out, "index.html"), "utf-8") };
}

test("a published page carries the policy in a meta tag, before the style sheet and the script it governs", () => {
  const { dir, page } = publishPreview("minimal.osproj");
  try {
    const tags = page.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g) ?? [];
    assert.deepEqual(tags, [policyMetaTag()], "exactly one, and it is the policy");
    const at = page.indexOf(tags[0]!);
    assert.ok(at > 0 && at < page.indexOf("<link"), "ahead of the style sheet");
    assert.ok(at < page.indexOf("<script"), "ahead of the scripts");
    assert.ok(at > page.indexOf('<meta charset="utf-8">'), "after the character set, which has to be among the first bytes");
    for (const directive of ["default-src 'self'", "script-src 'self'", "connect-src https: http://localhost:* http://127.0.0.1:*", "frame-src https://www.youtube-nocookie.com https://player.vimeo.com", "img-src 'self' data:", "media-src 'self' blob:", "object-src 'none'"]) {
      assert.ok(page.includes(directive), `the page says ${directive}`);
    }
    assert.ok(!page.includes("unsafe-eval") && !page.includes("unsafe-inline"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the published page itself breaks none of its own rules: no inline script or style, no handler attribute, nothing from another site", () => {
  const { dir, page } = publishPreview("minimal.osproj");
  try {
    // The course's data sits in a script tag of type application/json, which is data and not code. Take it out before reading the rest of the markup.
    const data = /<script type="application\/json" id="openstage-project">[\s\S]*?<\/script>/.exec(page);
    assert.ok(data, "the project data is in a JSON script block");
    const markup = page.replace(data[0], "");
    const scripts = markup.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    assert.deepEqual(scripts, ['<script src="player.js"></script>'], "the only script is the course's own file, with nothing written in it");
    assert.ok(!/<style\b/i.test(markup), "no style element");
    assert.ok(!/\sstyle\s*=/i.test(markup), "no style attribute");
    assert.ok(!/\son[a-z]+\s*=/i.test(markup), "no event handler attribute");
    assert.ok(!/javascript:/i.test(markup));
    assert.deepEqual(markup.match(/<link\b[^>]*>/g), ['<link rel="stylesheet" href="player.css">'], "the one style sheet is the course's own file");
    for (const [, address] of markup.matchAll(/\s(?:src|href|action)="([^"]*)"/g)) {
      assert.ok(!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(address!), `${address} is a file of the course, not another site`);
    }
    // The video maker rewrites this one tag to load its own script in place of the player (video.ts), so the page must keep writing it exactly so.
    assert.ok(page.includes('<script src="player.js"></script>'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same holds for an example that has pictures, whose files are all the course's own", () => {
  const { dir, page } = publishPreview("scenario.osproj");
  try {
    assert.equal((page.match(/Content-Security-Policy/g) ?? []).length, 1);
    assert.ok(page.includes(policyMetaTag()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the player's own code

test("the code that goes into the player does nothing the policy forbids: no inline style attribute, no script or style element, no evaluated text", async () => {
  const bundle = await build({ entryPoints: [path.join(here, "player.ts")], bundle: true, format: "iife", target: "es2022", write: false, metafile: true, logLevel: "silent" });
  const sources = Object.keys(bundle.metafile.inputs).map((f) => path.resolve(player, f));
  assert.ok(sources.length > 20 && sources.some((f) => f.endsWith("sanitize.ts")), "the files that make the player were found");
  const forbidden: [RegExp, string][] = [
    [/setAttribute\(\s*["']style["']/, "writes a style attribute, which the policy refuses (set a property on the element's style object instead)"],
    [/setAttributeNS\([^)]*["']style["']/, "writes a style attribute"],
    [/createElement\(\s*["'](style|script)["']/, "makes a style or script element"],
    [/insertAdjacentHTML|document\.write|\.srcdoc\b|outerHTML\s*=/, "writes markup into the page"],
    [/\beval\s*\(|new Function\s*\(/, "evaluates text as code"],
    [/set(Timeout|Interval)\(\s*["'`]/, "hands text to a timer to run"],
    [/setAttribute\(\s*["']on[a-z]+["']/i, "writes an event handler attribute"],
  ];
  const found: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf-8");
    for (const [pattern, what] of forbidden) if (pattern.test(text)) found.push(`${path.relative(player, file)} ${what}`);
  }
  assert.deepEqual(found, []);
  const output = bundle.outputFiles[0]!.text;
  assert.ok(!/\beval\s*\(/.test(output) && !/new Function\s*\(/.test(output), "nor does anything the bundler added");
});
