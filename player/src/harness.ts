// A stand-in LMS for trying the published course by hand. It is a page with a fake SCORM
// 1.2 API, the course in a frame, and a live view of what the course has told it. Learner
// data is kept in the browser's local storage, so closing and reopening really resumes.
// This is a test aid. The course still has to be tried in a real LMS.

import { FakeLms, type Store } from "./fake-lms.ts";

const KEY = `openstage-fake-lms:${location.pathname}`;

const lms = new FakeLms({
  load: () => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; }
  },
  save: (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ } },
});
(window as unknown as { API: FakeLms }).API = lms;

const frame = document.getElementById("course") as HTMLIFrameElement;
const table = document.getElementById("data") as HTMLTableSectionElement;
const calls = document.getElementById("calls") as HTMLElement;

function render(): void {
  const rows = Object.entries(lms.data)
    .filter(([k]) => !k.startsWith("cmi.interactions") && k !== "cmi.suspend_data")
    .sort(([a], [b]) => a.localeCompare(b));
  const suspend = lms.data["cmi.suspend_data"];
  const interactions = Object.entries(lms.data).filter(([k]) => k.startsWith("cmi.interactions")).sort(([a], [b]) => a.localeCompare(b));
  table.innerHTML = "";
  const all: [string, string][] = [...rows, ["cmi.suspend_data", suspend ?? ""], ...interactions];
  for (const [k, v] of all) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = k;
    const td = document.createElement("td");
    td.textContent = String(v);
    tr.append(th, td);
    table.appendChild(tr);
  }
  calls.textContent = lms.log.slice(-25).join("\n");
}
setInterval(render, 400);

function loadCourse(): void {
  lms.relaunch();
  frame.src = "index.html";
}

/** Leave the course (the frame unloads, so the course says goodbye) and open it again. */
document.getElementById("relaunch")!.addEventListener("click", () => {
  frame.addEventListener("load", () => loadCourse(), { once: true });
  frame.src = "about:blank";
});

document.getElementById("reset")!.addEventListener("click", () => {
  frame.addEventListener("load", () => { lms.reset(); frame.src = "index.html"; }, { once: true });
  frame.src = "about:blank";
});

document.getElementById("review")!.addEventListener("change", (e) => {
  lms.mode = (e.target as HTMLInputElement).checked ? "review" : "normal";
});

loadCourse();
render();
