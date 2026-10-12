// A small SCORM 1.2 run-time emulator, for tests and for the manual test page. It is
// deliberately stricter than most LMSs about data types and limits, so a mistake in the
// course shows up here first. It is not a substitute for testing in Moodle, Canvas and
// Brightspace, which each have their own quirks.

import type { ScormApi } from "./scorm.ts";

export type Store = Record<string, string>;

export interface Persistence {
  load(): Store;
  save(data: Store): void;
}

const ERRORS: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "201": "Invalid argument error",
  "202": "Element cannot have children",
  "301": "Not initialized",
  "401": "Not implemented error",
  "402": "Invalid set value, element is a keyword",
  "403": "Element is read only",
  "404": "Element is write only",
  "405": "Incorrect data type",
};

const STATUSES = ["passed", "completed", "failed", "incomplete", "browsed"];
const READ_ONLY = ["cmi.core.student_id", "cmi.core.student_name", "cmi.core._children", "cmi.core.entry",
  "cmi.core.lesson_mode", "cmi.core.credit", "cmi.core.total_time", "cmi.interactions._count"];
const WRITE_ONLY = ["cmi.core.exit", "cmi.core.session_time"];

function memory(): Persistence {
  let data: Store = {};
  return { load: () => ({ ...data }), save: (d) => { data = { ...d }; } };
}

export class FakeLms implements ScormApi {
  /** Calls made, in order, so a test can assert on the conversation. */
  readonly log: string[] = [];
  mode: "normal" | "browse" | "review" = "normal";
  private store: Store;
  private readonly persistence: Persistence;
  private session: Store = {};
  private initialised = false;
  private ended = false;
  private error = "0";

  constructor(persistence: Persistence = memory()) {
    this.persistence = persistence;
    this.store = persistence.load();
  }

  /** The learner's saved record, as the LMS would hold it. */
  get data(): Store {
    return { ...this.store, ...this.session };
  }

  /** Start a fresh launch of the SCO, as the LMS does when a learner opens it again. */
  relaunch(): void {
    this.initialised = false;
    this.ended = false;
    this.session = {};
    this.store = this.persistence.load();
  }

  reset(): void {
    this.store = {};
    this.session = {};
    this.persistence.save({});
    this.relaunch();
  }

  LMSInitialize(arg: string): string {
    this.log.push("LMSInitialize");
    if (arg !== "") return this.fail("201");
    if (this.initialised) return this.fail("101");
    this.initialised = true;
    const resuming = this.store["cmi.core.exit"] === "suspend";
    this.session = {
      "cmi.core.entry": resuming ? "resume" : this.store["cmi.core.lesson_status"] ? "" : "ab-initio",
      "cmi.core.lesson_mode": this.mode,
      "cmi.core.credit": "credit",
      "cmi.core.student_id": "learner-1",
      "cmi.core.student_name": "Learner, Test",
    };
    if (!this.store["cmi.core.lesson_status"]) this.store["cmi.core.lesson_status"] = "not attempted";
    return this.ok();
  }

  LMSGetValue(element: string): string {
    this.log.push(`get ${element}`);
    if (!this.live()) return "";
    if (WRITE_ONLY.includes(element)) { this.fail("404"); return ""; }
    const value = this.session[element] ?? this.store[element];
    if (element === "cmi.interactions._count") { this.error = "0"; return String(this.interactionCount()); }
    if (value === undefined) {
      this.fail(/^cmi\.(core|suspend_data|launch_data|comments|objectives|student_data|student_preference|interactions)/.test(element) ? "0" : "201");
      return "";
    }
    this.error = "0";
    return value;
  }

  LMSSetValue(element: string, value: string): string {
    this.log.push(`set ${element}=${value.length > 60 ? value.slice(0, 57) + "..." : value}`);
    if (!this.live()) return "false";
    if (typeof value !== "string") return this.fail("405");
    if (READ_ONLY.includes(element) || element.endsWith("._children")) return this.fail("403");
    if (this.mode !== "normal") return this.fail("403");

    const bad = this.validate(element, value);
    if (bad) return this.fail(bad);
    if (WRITE_ONLY.includes(element)) this.session[element] = value;
    this.store[element] = value;
    return this.ok();
  }

  LMSCommit(arg: string): string {
    this.log.push("LMSCommit");
    if (!this.live()) return "false";
    if (arg !== "") return this.fail("201");
    this.persistence.save(this.store);
    return this.ok();
  }

  LMSFinish(arg: string): string {
    this.log.push("LMSFinish");
    if (!this.live()) return "false";
    if (arg !== "") return this.fail("201");
    // As real LMSs do: a normal exit after finishing leaves nothing to resume.
    if (this.store["cmi.core.exit"] !== "suspend") {
      delete this.store["cmi.suspend_data"];
      delete this.store["cmi.core.lesson_location"];
    }
    this.persistence.save(this.store);
    this.ended = true;
    this.initialised = false;
    return this.ok();
  }

  LMSGetLastError(): string { return this.error; }
  LMSGetErrorString(code: string): string { return ERRORS[code] ?? ""; }
  LMSGetDiagnostic(code: string): string { return ERRORS[code] ?? ""; }

  // ---- internals

  private live(): boolean {
    if (!this.initialised || this.ended) { this.error = "301"; return false; }
    return true;
  }

  private ok(): string { this.error = "0"; return "true"; }
  private fail(code: string): string { this.error = code; return "false"; }

  private interactionCount(): number {
    const ids = Object.keys(this.store).filter((k) => /^cmi\.interactions\.\d+\.id$/.test(k));
    return ids.length;
  }

  /** Returns an error code if the value is not allowed for this element. */
  private validate(element: string, value: string): string | null {
    switch (element) {
      case "cmi.core.lesson_status":
        return STATUSES.includes(value) ? null : "405";
      case "cmi.core.lesson_location":
        return value.length <= 255 ? null : "405";
      case "cmi.suspend_data":
        return value.length <= 4096 ? null : "405";
      case "cmi.core.exit":
        return ["", "time-out", "suspend", "logout"].includes(value) ? null : "405";
      case "cmi.core.score.raw":
      case "cmi.core.score.min":
      case "cmi.core.score.max":
        return value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? null : "405";
      case "cmi.core.session_time": {
        const m = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(value);
        return m && Number(m[2]) < 60 && Number(m[3]) < 60 ? null : "405";
      }
    }
    const inter = /^cmi\.interactions\.(\d+)\.(id|type|student_response|result|weighting|time|latency|correct_responses\.\d+\.pattern)$/.exec(element);
    if (inter) {
      if (Number(inter[1]) > this.interactionCount()) return "201";
      const field = inter[2];
      if (field === "type") return ["true-false", "choice", "fill-in", "matching", "performance", "sequencing", "likert", "numeric"].includes(value) ? null : "405";
      if (field === "result") return ["correct", "wrong", "unanticipated", "neutral"].includes(value) || !Number.isNaN(Number(value)) ? null : "405";
      if (field === "id") return value.length > 0 && value.length <= 255 ? null : "405";
      return null;
    }
    return /^cmi\./.test(element) ? "401" : "201";
  }
}
