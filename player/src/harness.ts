// A stand-in LMS for trying the published course by hand. It is a page with a fake SCORM
// API (1.2, or 2004 when the address ends ?lms=2004), the course in a frame, and a live view
// of what the course has told it. Learner data is kept in the browser's local storage, so
// closing and reopening really resumes.
// This is a test aid. The course still has to be tried in a real LMS.

import { FakeLms2004 } from "./fake-lms-2004.ts";
import { FakeLms, type Persistence, type Store } from "./fake-lms.ts";

const is2004 = new URLSearchParams(location.search).get("lms") === "2004";
// The two standards keep separate records, so switching between them never reads one as the other.
const KEY = `openstage-fake-lms${is2004 ? "-2004" : ""}:${location.pathname}`;

const persistence: Persistence = {
  load: () => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; }
  },
  save: (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ } },
};
/** What the page needs of either stand-in LMS. */
interface StandIn { readonly data: Store; readonly log: string[]; mode: "normal" | "browse" | "review"; relaunch(): void; reset(): void }
const lms: StandIn = is2004 ? new FakeLms2004(persistence) : new FakeLms(persistence);
// The course looks for the API under the name its standard gives it.
(window as unknown as Record<string, unknown>)[is2004 ? "API_1484_11" : "API"] = lms;

document.getElementById("standard")!.textContent = is2004 ? "SCORM 2004 (4th edition)" : "SCORM 1.2";
document.getElementById("switch")!.setAttribute("href", is2004 ? "_scorm-test.html" : "_scorm-test.html?lms=2004");
document.getElementById("switch")!.textContent = is2004 ? "Pretend to be SCORM 1.2 instead" : "Pretend to be SCORM 2004 instead";

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
