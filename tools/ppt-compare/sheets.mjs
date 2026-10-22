// Lays PowerPoint's own picture of each slide beside the editor's version of it, two slides to a sheet, using headless Edge to draw the page.
// Usage: node sheets.mjs PPT_DIR OS_DIR OUT_DIR FIRST LAST [OS_OFFSET]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [pptDir, osDir, outDir, firstArg, lastArg, offsetArg = "1"] = process.argv.slice(2);
const first = Number(firstArg), last = Number(lastArg), offset = Number(offsetArg);
mkdirSync(outDir, { recursive: true });
const port = 9447;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--user-data-dir=" + process.env.TEMP + "/openstage-edge-profile4", "--no-first-run", "--disable-gpu", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(3, "0");
try {
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((ok) => { const n = ++id; pending.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 760, deviceScaleFactor: 1, mobile: false });
  const url = (p) => "file:///" + p.replace(/\\/g, "/");
  for (let a = first; a <= last; a += 2) {
    const rows = [a, a + 1].filter((n) => n <= last);
    const html = `<body style="margin:0;background:#888;font:14px sans-serif">${rows.map((n) => `<div style="display:flex;gap:6px;margin-bottom:6px"><div style="position:relative"><img width=640 src="${url(`${pptDir}/slide-${pad(n)}.png`)}"><span style="position:absolute;left:4px;top:2px;background:#ff0;padding:0 4px">PowerPoint ${n}</span></div><div style="position:relative"><img width=640 src="${url(`${osDir}/slide-${pad(n + offset)}.png`)}"><span style="position:absolute;left:4px;top:2px;background:#0ff;padding:0 4px">OpenStage ${n}</span></div></div>`).join("")}</body>`;
    writeFileSync(`${outDir}/_page.html`, html);
    await send("Page.navigate", { url: url(`${outDir}/_page.html`) });
    await sleep(900);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1300, height: rows.length * 366, scale: 1 } });
    writeFileSync(`${outDir}/sheet-${pad(a)}.png`, Buffer.from(shot.result.data, "base64"));
  }
  ws.close();
} finally { edge.kill(); }
console.log("sheets done");
