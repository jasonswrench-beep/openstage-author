// A plain-browser stand-in for the editor's Rust commands, used to try the web side without
// the app: node dev-server.mjs [port]. Serves web/ and does the same four jobs as
// src-tauri/src/lib.rs. For development only; it binds to this computer alone.
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
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
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

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
      if (!/^assets\/[^\]+$/.test(rel) && !/^assets\/[a-z]+\/[^\/\]+$/.test(rel)) return send(res, 400, "Not an asset path", "text/plain");
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
