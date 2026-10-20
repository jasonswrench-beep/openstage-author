// A plain-browser stand-in for the editor's Rust commands, used to try the web side without
// the app: node dev-server.mjs [port]. Serves web/ and does the same four jobs as
// src-tauri/src/lib.rs. For development only; it binds to this computer alone.
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The kinds of file a course can offer for download, shared with the validator, the player and the editor.
const DOWNLOAD_EXTENSIONS = JSON.parse(readFileSync(path.join(here, "..", "tools", "download-types.json"), "utf-8")).types.map((t) => t.ext);
const web = path.join(here, "web");
const repo = path.join(here, "..");
const port = Number(process.argv[2] ?? 5173);
const python = process.env.OPENSTAGE_PYTHON ?? "python";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

const safe = (p) => p === "project.json" || p === "theme.json" || p === "assets.json" || (/^slides\/[^/\\.:][^/\\:]*\.json$/.test(p) && !p.includes(".."));
const body = (req) =>
  new Promise((ok) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => ok(JSON.parse(s || "{}")));
  });
const send = (res, code, data, type = "application/json") => {
  res.writeHead(code, { "content-type": type });
  res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};

/** A plain blue-grey picture, as PNG bytes, for the stand-in service. */
function plainPng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; rows[o] = 70 + x; rows[o + 1] = 110 + y; rows[o + 2] = 160; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** A mono 16-bit WAV file of a plain tone, at 24 kHz, fading in and out so it does not click. */
function toneWav(hz, seconds) {
  const rate = 24000;
  const count = Math.round(rate * seconds);
  const out = Buffer.alloc(44 + count * 2);
  out.write("RIFF", 0, "latin1"); out.writeUInt32LE(36 + count * 2, 4); out.write("WAVE", 8, "latin1"); out.write("fmt ", 12, "latin1");
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36, "latin1"); out.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / 1200, (count - i) / 1200);
    out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 6000 * fade), 44 + i * 2);
  }
  return out;
}

const samplesMade = new Set();

function open(dir) {
  const project = readFileSync(path.join(dir, "project.json"), "utf-8");
  const ids = [...new Set(JSON.parse(project).scenes.flatMap((s) => s.slides))];
  const slides = ids
    .filter((id) => safe(`slides/${id}.json`) && existsSync(path.join(dir, "slides", `${id}.json`)))
    .map((id) => ({ id, text: readFileSync(path.join(dir, "slides", `${id}.json`), "utf-8") }));
  const assets = existsSync(path.join(dir, "assets.json")) ? readFileSync(path.join(dir, "assets.json"), "utf-8") : null;
  const ref = JSON.parse(project).theme?.ref;
  const theme = ref === "theme.json" && existsSync(path.join(dir, "theme.json")) ? readFileSync(path.join(dir, "theme.json"), "utf-8") : null;
  return { dir, project, theme, assets, slides };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    // The accessibility audit (editor/audit): a developer tool, served here and never packaged with the app.
    if (url.pathname === "/__audit.js") return send(res, 200, readFileSync(path.join(here, "audit", "a11y-audit.js")), "text/javascript");
    if (url.pathname === "/api/open") return send(res, 200, open(url.searchParams.get("dir")));
    if (url.pathname === "/api/save") {
      const { dir, files, remove } = await body(req);
      if (!existsSync(path.join(dir, "project.json"))) return send(res, 400, "Not a project folder", "text/plain");
      for (const f of files) {
        if (!safe(f.path)) return send(res, 400, `Not a project file: ${f.path}`, "text/plain");
        const target = path.join(dir, f.path);
        writeFileSync(`${target}.tmp`, f.text);
        renameSync(`${target}.tmp`, target);
      }
      for (const r of remove ?? []) {
        if (!r.startsWith("slides/") || !safe(r)) return send(res, 400, `Cannot remove ${r}`, "text/plain");
        rmSync(path.join(dir, r), { force: true });
      }
      return send(res, 200, {});
    }
    if (url.pathname === "/api/import") {
      const { dir, source, kind = "image" } = await body(req);
      const kinds = { image: ["images", ["png", "jpg", "jpeg", "gif", "webp", "svg"]], video: ["video", ["mp4", "webm", "m4v", "ogv"]], audio: ["audio", ["mp3", "wav", "ogg", "m4a", "aac"]], captions: ["captions", ["vtt"]], document: ["documents", DOWNLOAD_EXTENSIONS] };
      const k = kinds[kind];
      const ext = path.extname(source).toLowerCase().slice(1);
      if (!k || !k[1].includes(ext)) return send(res, 400, `That is not a ${kind} file this editor can use.`, "text/plain");
      const stem = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9_-]/g, "-") || kind;
      mkdirSync(path.join(dir, "assets", k[0]), { recursive: true });
      let name = `${stem}.${ext}`;
      for (let n = 2; existsSync(path.join(dir, "assets", k[0], name)); n++) name = `${stem}-${n}.${ext}`;
      writeFileSync(path.join(dir, "assets", k[0], name), readFileSync(source));
      return send(res, 200, JSON.stringify(`assets/${k[0]}/${name}`));
    }
    if (url.pathname === "/api/save-deck-picture") {
      // The same checks as save_deck_picture_at in src-tauri/src/lib.rs: a name made from the picture, bytes that are what the name says.
      const { dir, name, data } = await body(req);
      const bytes = Buffer.from(String(data), "base64");
      const m = /^pptx-([0-9a-f]{14})\.(png|jpg|gif|webp|bmp)$/.exec(String(name));
      const starts = (b) => bytes.subarray(0, b.length).equals(Buffer.from(b));
      const ok = m && existsSync(path.join(dir, "project.json")) && bytes.length <= 50 * 1024 * 1024 && ({
        png: () => starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpg: () => starts([0xff, 0xd8, 0xff]), gif: () => bytes.subarray(0, 6).toString("latin1").startsWith("GIF8"),
        webp: () => bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP", bmp: () => starts([0x42, 0x4d]),
      })[m[2]]();
      if (!ok) return send(res, 400, "That is not a picture of the kind its name says.", "text/plain");
      mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
      const target = path.join(dir, "assets", "images", String(name));
      if (!existsSync(target)) writeFileSync(target, bytes);
      return send(res, 200, JSON.stringify(`assets/images/${name}`));
    }
    if (url.pathname === "/api/assets") {
      const { dir } = await body(req);
      const out = [];
      for (const [kind, folder] of [["image", "images"], ["video", "video"], ["audio", "audio"], ["captions", "captions"], ["document", "documents"]]) {
        const d = path.join(dir, "assets", folder);
        if (!existsSync(d)) continue;
        for (const name of readdirSync(d).sort()) if (!name.startsWith(".")) out.push({ path: `assets/${folder}/${name}`, kind, size: statSync(path.join(d, name)).size });
      }
      return send(res, 200, out);
    }
    if (url.pathname === "/api/delete-asset") {
      const { dir, path: rel } = await body(req);
      if (!/^assets\/[^\\]+$/.test(rel) && !/^assets\/[a-z]+\/[^\/\\]+$/.test(rel)) return send(res, 400, "Not an asset path", "text/plain");
      rmSync(path.join(dir, rel), { force: true });
      return send(res, 200, {});
    }
    if (url.pathname === "/api/create") {
      const { dir, files } = await body(req);
      if (existsSync(dir) && readdirSync(dir).length > 0) return send(res, 400, "That folder is not empty. Choose an empty folder, or make a new one.", "text/plain");
      if (!files.every((f) => safe(f.path)) || !files.some((f) => f.path === "project.json")) return send(res, 400, "Bad project files", "text/plain");
      for (const sub of ["slides", "assets/images", "assets/video", "assets/audio"]) mkdirSync(path.join(dir, sub), { recursive: true });
      for (const sub of ["images", "video", "audio"]) writeFileSync(path.join(dir, "assets", sub, ".gitkeep"), "");
      for (const f of files) writeFileSync(path.join(dir, f.path), f.text);
      return send(res, 200, {});
    }
    if (url.pathname === "/api/migrate") {
      const { dir } = await body(req);
      const r = spawnSync(python, [path.join(repo, "tools", "migrate.py"), dir, "--json"], { encoding: "utf-8" });
      if (r.status !== 0) return send(res, 500, r.stderr || "migration failed", "text/plain");
      return send(res, 200, r.stdout);
    }
    if (url.pathname === "/api/validate") {
      const { dir, files } = await body(req);
      const temp = mkdtempSync(path.join(os.tmpdir(), "openstage-validate-"));
      try {
        mkdirSync(path.join(temp, "slides"));
        for (const f of files) if (safe(f.path)) writeFileSync(path.join(temp, f.path), f.text);
        const r = spawnSync(python, [path.join(repo, "tools", "validate.py"), temp, "--json", "--asset-root", dir], { encoding: "utf-8" });
        if (!r.stdout.trim()) return send(res, 500, r.stderr || "validator produced no output", "text/plain");
        return send(res, 200, r.stdout);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
    // Stand-ins for the AI services, for trying the dialogs in a browser. Nothing is sent anywhere: a plain picture is saved in
    // the project the way the app saves a real one. The plugin list is the real tool's, over the example plugins.
    if (url.pathname === "/api/ai-plugins") {
      const { enabled = [] } = await body(req);
      const args = [path.join(repo, "tools", "generate.py"), "plugins", "--plugins-dir", process.env.OPENSTAGE_PLUGINS_DIR ?? path.join(repo, "examples", "plugins")];
      if (enabled.length) args.push("--plugins-enabled", enabled.filter((id) => /^[a-z][a-z0-9-]{1,30}$/.test(id)).join(","));
      const r = spawnSync(python, args, { encoding: "utf-8", input: "{}" });
      return send(res, 200, r.stdout || JSON.stringify({ ok: false }));
    }
    if (url.pathname === "/api/ai-service") {
      const { op, service } = await body(req);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/ai-make") {
      const { dir, kind, request } = await body(req);
      if (!existsSync(path.join(dir, "project.json")) || kind !== "picture") return send(res, 400, "Not something that can be made.", "text/plain");
      if (String(request.prompt ?? "").includes("FAIL")) return send(res, 200, { ok: false, message: "The stand-in service was asked to fail." });
      const folder = "images";
      const ext = "png";
      const stem = "ai-" + (String(request.prompt ?? "").split(/\s+/).slice(0, 5).join("-").replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "made");
      mkdirSync(path.join(dir, "assets", folder), { recursive: true });
      let name = `${stem}.${ext}`;
      for (let n = 2; existsSync(path.join(dir, "assets", folder, name)); n++) name = `${stem}-${n}.${ext}`;
      writeFileSync(path.join(dir, "assets", folder, name), plainPng(96, 64));
      return send(res, 200, { ok: true, path: `assets/${folder}/${name}`, service: request.service, model: "stand-in" });
    }
    // A stand-in for hearing a voice: a short tone whose pitch depends on the voice, so different voices can be told apart. The first time a voice
    // is asked for, it takes a moment and says it was made; after that it says it was kept, as the real thing does. A voice called "...fail" fails.
    if (url.pathname === "/api/voice-sample") {
      const { voice = "", lang = "en-US" } = await body(req);
      if (typeof voice !== "string" || !voice || voice.length > 100) return send(res, 400, "That is not a voice.", "text/plain");
      if (voice.endsWith("fail")) return send(res, 200, { ok: false, message: "The stand-in voice was asked to fail." });
      const kept = samplesMade.has(`${voice}|${lang}`);
      if (!kept) await new Promise((done) => setTimeout(done, Number(process.env.OPENSTAGE_SAMPLE_DELAY_MS ?? 600)));
      samplesMade.add(`${voice}|${lang}`);
      let pitch = 200;
      for (const c of voice) pitch = 180 + ((pitch * 31 + c.charCodeAt(0)) % 400);
      const engine = voice.includes(":") ? voice.split(":")[0] : "kokoro";
      return send(res, 200, { ok: true, audio: toneWav(pitch, 1.2).toString("base64"), cached: kept, engine, name: engine === "openai" ? "OpenAI" : engine === "kokoro" ? "Kokoro" : engine, where: engine === "openai" ? "internet" : "computer", duration: 1.2 });
    }
    if (url.pathname === "/api/asset") {
      const dir = url.searchParams.get("dir");
      const rel = url.searchParams.get("path") ?? "";
      if (!/^assets\/[^.]/.test(rel) || rel.split("/").includes("..")) return send(res, 400, "Not an asset", "text/plain");
      return send(res, 200, readFileSync(path.join(dir, rel)), "application/octet-stream");
    }
    const file = path.join(web, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(web) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, "Not found", "text/plain");
    send(res, 200, readFileSync(file), types[path.extname(file)] ?? "application/octet-stream");
  } catch (e) {
    send(res, 500, String(e), "text/plain");
  }
}).listen(port, "127.0.0.1", () => console.log(`Editor preview at http://127.0.0.1:${port}/`));
