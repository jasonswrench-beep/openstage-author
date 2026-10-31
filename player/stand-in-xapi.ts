// A stand-in learning record store (LRS) for trying an xAPI package by hand, the way _scorm-test.html is a stand-in LMS.
//
//   node stand-in-xapi.ts DIST_DIR [--course NAME] [--port 8765] [--lrs-port 8766]
//
// It starts two servers on this computer only. One serves the published courses in DIST_DIR and a test page, _xapi-test.html.
// The other is the LRS. They are on different ports on purpose: a real LRS is on a different site from the course, and the
// browser's rules for that (CORS) are part of what has to work. The LRS is the strict one from src/fake-lrs.ts, so it refuses
// a statement that a real LRS would refuse. It keeps everything in memory; stopping the program forgets it.
// This is a test aid. The course still has to be tried against a real LRS.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FakeLrs } from "./src/fake-lrs.ts";
import { uuid4 } from "./src/xapi.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "");
const course = option("course", "minimal");
const port = Number(option("port", "8765"));
const lrsPort = Number(option("lrs-port", "8766"));
if (!existsSync(path.join(root, course, "index.html"))) {
  console.error(`There is no published course at ${path.join(root, course)}. Publish it first.`);
  process.exit(1);
}

const lrs = new FakeLrs(`http://127.0.0.1:${lrsPort}/xapi/`);
const registration = uuid4();
const actor = { objectType: "Agent", name: "Test Learner", mbox: "mailto:test.learner@example.test" };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
};

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// ---- the LRS, on its own port

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Experience-API-Version, If-Match, If-None-Match",
  "Access-Control-Expose-Headers": "ETag, X-Experience-API-Version",
  "X-Experience-API-Version": "1.0.3",
};

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return; }
  const answer = await lrs.fetch(`http://127.0.0.1:${lrsPort}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers: Object.fromEntries(Object.entries(req.headers).filter((e): e is [string, string] => typeof e[1] === "string")),
    body: await body(req),
  });
  const text = await answer.text();
  res.writeHead(answer.status, { ...CORS, "Content-Type": "application/json" }).end(answer.status === 204 ? undefined : text);
}).listen(lrsPort, "127.0.0.1");

// ---- the course and the test page

const launchUrl = (): string => {
  const q = new URLSearchParams({ endpoint: lrs.endpoint, auth: lrs.auth, actor: JSON.stringify(actor), registration });
  return `${course}/index.html?${q.toString()}`;
};

const page = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenStage stand-in LRS</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 12px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 8px; } h2 { font-size: 16px; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
  button { font: inherit; padding: 6px 14px; }
  .layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr); gap: 16px; align-items: start; }
  iframe { width: 100%; height: 860px; border: 1px solid #888; background: #fff; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; border-bottom: 1px solid #ccc; padding: 3px 6px; vertical-align: top; word-break: break-word; }
  pre { background: #f3f3f3; padding: 8px; font-size: 12px; max-height: 220px; overflow: auto; white-space: pre-wrap; }
  :focus-visible { outline: 3px solid #0b3fb3; outline-offset: 2px; }
</style></head><body>
<h1>OpenStage stand-in LRS</h1>
<p>A test aid, not a real LRS. The course below was launched with the address of a strict xAPI store on another port,
and the store lists everything the course sends. The learner is <strong>${actor.name}</strong>, registration <code>${registration}</code>.</p>
<div class="bar">
  <button type="button" id="relaunch">Leave and relaunch</button>
  <button type="button" id="reset">Reset learner data</button>
</div>
<div class="layout">
  <iframe id="course" title="Course" src="about:blank"></iframe>
  <div>
    <h2>Statements the store accepted (<span id="count">0</span>)</h2>
    <table><thead><tr><th scope="col">Verb</th><th scope="col">Object</th><th scope="col">Result</th></tr></thead><tbody id="statements"></tbody></table>
    <h2>Saved place</h2><pre id="state">none</pre>
    <h2>Recent requests</h2><pre id="requests"></pre>
  </div>
</div>
<script>
  const frame = document.getElementById("course");
  const launch = () => { frame.src = ${JSON.stringify(launchUrl())}; };
  document.getElementById("relaunch").addEventListener("click", () => { frame.addEventListener("load", launch, { once: true }); frame.src = "about:blank"; });
  document.getElementById("reset").addEventListener("click", async () => {
    frame.addEventListener("load", async () => { await fetch("_xapi-reset", { method: "POST" }); launch(); }, { once: true });
    frame.src = "about:blank";
  });
  const text = (v) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
  async function refresh() {
    const data = await (await fetch("_xapi-log.json")).json();
    document.getElementById("count").textContent = data.statements.length;
    const rows = document.getElementById("statements"); rows.replaceChildren();
    for (const s of data.statements) {
      const tr = document.createElement("tr");
      const verb = s.verb.id.split("/").pop();
      const obj = s.object.id.replace(/^https:\\/\\/openstageauthor\\.com\\/xapi\\/course\\//, "");
      const r = s.result ? Object.entries(s.result).map(([k, v]) => k + "=" + text(v)).join(" ") : "";
      for (const t of [verb, obj, r]) { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); }
      rows.appendChild(tr);
    }
    document.getElementById("state").textContent = data.states.length ? data.states.join("\\n") : "none";
    document.getElementById("requests").textContent = data.requests.slice(-25).map((r) => r.method + " " + r.path).join("\\n");
  }
  setInterval(refresh, 500);
  launch(); refresh();
</script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/_xapi-test.html") { res.writeHead(200, { "Content-Type": TYPES[".html"]! }).end(page()); return; }
  if (url.pathname === "/_xapi-log.json") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ statements: lrs.statements, states: [...lrs.states.values()], requests: lrs.requests }));
    return;
  }
  if (url.pathname === "/_xapi-reset" && req.method === "POST") {
    lrs.statements.length = 0;
    lrs.requests.length = 0;
    lrs.states.clear();
    res.writeHead(204).end();
    return;
  }
  // A file of a published course. Nothing outside the published folder is ever served.
  const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end("Not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(port, "127.0.0.1", () => {
  console.log(`Stand-in LRS for ${course}: open http://127.0.0.1:${port}/_xapi-test.html`);
  console.log(`The store is at ${lrs.endpoint}. Close this window to stop it.`);
});
