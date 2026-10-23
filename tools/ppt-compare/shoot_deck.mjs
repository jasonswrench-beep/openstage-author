// Plays a published course in headless Edge and saves a picture of the stage for each slide (1280 wide), pressing Next between them.
// Usage: node shoot_deck.mjs URL OUT_DIR SLIDE_COUNT
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [url, outDir, countArg, fromArg = "1"] = process.argv.slice(2);
const count = Number(countArg);
const from = Number(fromArg);
mkdirSync(outDir, { recursive: true });
const port = 9446;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--user-data-dir=" + process.env.TEMP + "/openstage-edge-profile3", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((ok) => { const n = ++id; pending.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => ok({ result: { timedOut: true } }), 20000); });
  const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.result?.value; };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(2500);
  for (let i = 1; i < from; i++) { await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Next'); if (b && !b.disabled) b.click(); })()`); await sleep(150); }
  for (let i = from; i <= count; i++) {
    const rect = await evalJs(`(() => { const r = document.querySelector('.os-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1280 / rect.w } });
    if (shot.result.data) writeFileSync(`${outDir}/slide-${String(i).padStart(3, "0")}.png`, Buffer.from(shot.result.data, "base64")); else console.log("no picture for", i);
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Next'); if (b && !b.disabled) b.click(); })()`);
    await sleep(Number(process.env.SHOOT_WAIT ?? 1500)); // long enough for a slide's own transition to finish
  }
  ws.close();
} finally { edge.kill(); }
console.log("shot", count);
