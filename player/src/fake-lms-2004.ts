// A small SCORM 2004 (4th edition) run-time emulator, for tests and for the manual test page. Like fake-lms.ts it is
// deliberately stricter than most LMSs, so a mistake in the course shows up here first: the standard's error codes, its word
// lists, its limits, and the rule that an interaction's id and type come before its answers. It also does what a real LMS does
// with a pass mark: when the manifest gives one and a scaled score arrives, success_status is worked out from them.
// It is not a substitute for testing in a real LMS.

import type { Persistence, Store } from "./fake-lms.ts";
import type { Scorm2004Api } from "./scorm2004.ts";

const ERRORS: Record<string, string> = {
  "0": "No Error",
  "101": "General Exception",
  "103": "Already Initialized",
  "104": "Content Instance Terminated",
  "112": "Termination Before Initialization",
  "113": "Termination After Termination",
  "122": "Retrieve Data Before Initialization",
  "123": "Retrieve Data After Termination",
  "132": "Store Data Before Initialization",
  "133": "Store Data After Termination",
  "142": "Commit Before Initialization",
  "143": "Commit After Termination",
  "201": "General Argument Error",
  "351": "General Set Failure",
  "401": "Undefined Data Model Element",
  "403": "Data Model Element Value Not Initialized",
  "404": "Data Model Element Is Read Only",
  "405": "Data Model Element Is Write Only",
  "406": "Data Model Element Type Mismatch",
  "407": "Data Model Element Value Out Of Range",
  "408": "Data Model Dependency Not Established",
};

const READ_ONLY = new Set(["cmi._version", "cmi.completion_threshold", "cmi.credit", "cmi.entry", "cmi.launch_data", "cmi.learner_id", "cmi.learner_name",
  "cmi.max_time_allowed", "cmi.mode", "cmi.scaled_passing_score", "cmi.time_limit_action", "cmi.total_time", "cmi.interactions._count", "cmi.objectives._count"]);
const WRITE_ONLY = new Set(["cmi.exit", "cmi.session_time"]);
const KNOWN = new Set([...READ_ONLY, ...WRITE_ONLY, "cmi.completion_status", "cmi.success_status", "cmi.location", "cmi.suspend_data", "cmi.progress_measure",
  "cmi.score.scaled", "cmi.score.raw", "cmi.score.min", "cmi.score.max"]);

const COMPLETION = ["completed", "incomplete", "not attempted", "unknown"];
const SUCCESS = ["passed", "failed", "unknown"];
const EXIT = ["", "timeout", "suspend", "logout", "normal"];
const TYPES = ["true_false", "choice", "fill_in", "long_fill_in", "matching", "performance", "sequencing", "likert", "numeric", "other"];
const RESULTS = ["correct", "incorrect", "unanticipated", "neutral"];

const REAL = /^-?\d+(\.\d+)?$/;
const SHORT_ID = /^[A-Za-z0-9._:-]+$/;
const DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+(\.\d{1,2})?S)?)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,2})?(Z|[+-]\d{2}:\d{2})?)?$/;

const real = (v: string): boolean => REAL.test(v);
const items = (v: string): string[] => (v === "" ? [] : v.split("[,]"));

function memory(): Persistence {
  let data: Store = {};
  return { load: () => ({ ...data }), save: (d) => { data = { ...d }; } };
}

export class FakeLms2004 implements Scorm2004Api {
  /** Calls made, in order, so a test can assert on the conversation. */
  readonly log: string[] = [];
  mode: "normal" | "browse" | "review" = "normal";
  /** The pass mark a manifest would give, as a fraction. Null means the manifest gave none, so success_status is whatever the course wrote. */
  scaledPassingScore: number | null = 0.8;
  private store: Store;
  private readonly persistence: Persistence;
  private session: Store = {};
  private state: "new" | "running" | "terminated" = "new";
  private error = "0";

  constructor(persistence: Persistence = memory()) {
    this.persistence = persistence;
    this.store = persistence.load();
  }

  /** The learner's record, as the LMS would hold it. */
  get data(): Store {
    const all = { ...this.store, ...this.session };
    const derived = this.derivedSuccess();
    if (derived) all["cmi.success_status"] = derived;
    return all;
  }

  /** Start a fresh launch of the SCO, as the LMS does when a learner opens it again. */
  relaunch(): void {
    this.state = "new";
    this.session = {};
    this.store = this.persistence.load();
  }

  reset(): void {
    this.store = {};
    this.persistence.save({});
    this.relaunch();
  }

  Initialize(arg: string): string {
    this.log.push("Initialize");
    if (this.state === "running") return this.fail("103");
    if (this.state === "terminated") return this.fail("104");
    if (arg !== "") return this.fail("201");
    this.state = "running";
    const resuming = this.store["cmi.exit"] === "suspend";
    this.session = {
      "cmi._version": "1.0",
      "cmi.entry": resuming ? "resume" : this.store["cmi.completion_status"] ? "" : "ab-initio",
      "cmi.mode": this.mode,
      "cmi.credit": "credit",
      "cmi.learner_id": "learner-1",
      "cmi.learner_name": "Learner, Test",
    };
    if (this.scaledPassingScore !== null) this.session["cmi.scaled_passing_score"] = String(this.scaledPassingScore);
    // A first launch starts as "unknown", the standard's word for nothing reported yet.
    if (!this.store["cmi.completion_status"]) this.store["cmi.completion_status"] = "unknown";
    if (!this.store["cmi.success_status"]) this.store["cmi.success_status"] = "unknown";
    return this.ok();
  }

  GetValue(element: string): string {
    this.log.push(`get ${element}`);
    const bad = this.guard("122", "123");
    if (bad) { this.error = bad; return ""; }
    if (WRITE_ONLY.has(element)) { this.error = "405"; return ""; }
    if (element === "cmi.interactions._count") { this.error = "0"; return String(this.interactionCount()); }
    if (element === "cmi.objectives._count") { this.error = "0"; return "0"; }
    if (element === "cmi.success_status") { this.error = "0"; return this.data["cmi.success_status"] ?? "unknown"; }
    const value = this.session[element] ?? this.store[element];
    if (value === undefined) {
      this.error = KNOWN.has(element) || /^cmi\.interactions\.\d+\./.test(element) ? "403" : "401";
      return "";
    }
    this.error = "0";
    return value;
  }

  SetValue(element: string, value: string): string {
    this.log.push(`set ${element}=${value.length > 60 ? value.slice(0, 57) + "..." : value}`);
    const bad = this.guard("132", "133");
    if (bad) return this.fail(bad);
    if (typeof value !== "string") return this.fail("406");
    if (READ_ONLY.has(element)) return this.fail("404");
    if (this.mode !== "normal") return this.fail("351");
    const code = this.validate(element, value);
    if (code) return this.fail(code);
    this.store[element] = value;
    if (WRITE_ONLY.has(element)) this.session[element] = value;
    return this.ok();
  }

  Commit(arg: string): string {
    this.log.push("Commit");
    const bad = this.guard("142", "143");
    if (bad) return this.fail(bad);
    if (arg !== "") return this.fail("201");
    this.persistence.save(this.store);
    return this.ok();
  }

  Terminate(arg: string): string {
    this.log.push("Terminate");
    if (this.state === "new") return this.fail("112");
    if (this.state === "terminated") return this.fail("113");
    if (arg !== "") return this.fail("201");
    // As real LMSs do: unless the learner suspended, there is nothing to resume.
    if (this.store["cmi.exit"] !== "suspend") {
      delete this.store["cmi.suspend_data"];
      delete this.store["cmi.location"];
    }
    this.persistence.save(this.store);
    this.state = "terminated";
    return this.ok();
  }

  GetLastError(): string { return this.error; }
  GetErrorString(code: string): string { return ERRORS[code] ?? ""; }
  GetDiagnostic(code: string): string { return ERRORS[code] ?? ""; }

  // ---- internals

  private guard(before: string, after: string): string | null {
    if (this.state === "new") return before;
    if (this.state === "terminated") return after;
    return null;
  }

  private ok(): string { this.error = "0"; return "true"; }
  private fail(code: string): string { this.error = code; return "false"; }

  private interactionCount(): number {
    return Object.keys(this.store).filter((k) => /^cmi\.interactions\.\d+\.id$/.test(k)).length;
  }

  /** What an LMS with a pass mark makes of success_status: the course's own word is replaced once a scaled score is there. */
  private derivedSuccess(): string | null {
    if (this.scaledPassingScore === null) return null;
    const scaled = this.store["cmi.score.scaled"];
    if (scaled === undefined) return "unknown";
    return Number(scaled) >= this.scaledPassingScore ? "passed" : "failed";
  }

  /** An error code if the value is not allowed for this element, otherwise null. */
  private validate(element: string, value: string): string | null {
    switch (element) {
      case "cmi.completion_status": return COMPLETION.includes(value) ? null : "406";
      case "cmi.success_status": return SUCCESS.includes(value) ? null : "406";
      case "cmi.exit": return EXIT.includes(value) ? null : "406";
      case "cmi.location": return value.length <= 1000 ? null : "406";
      case "cmi.suspend_data": return value.length <= 64000 ? null : "406";
      case "cmi.session_time": return DURATION.test(value) ? null : "406";
      case "cmi.progress_measure": return !real(value) ? "406" : Number(value) >= 0 && Number(value) <= 1 ? null : "407";
      case "cmi.score.scaled": return !real(value) ? "406" : Number(value) >= -1 && Number(value) <= 1 ? null : "407";
      case "cmi.score.min":
      case "cmi.score.max":
      case "cmi.score.raw": {
        if (!real(value)) return "406";
        const min = element === "cmi.score.min" ? value : this.store["cmi.score.min"];
        const max = element === "cmi.score.max" ? value : this.store["cmi.score.max"];
        const raw = element === "cmi.score.raw" ? value : this.store["cmi.score.raw"];
        if (min !== undefined && max !== undefined && Number(min) > Number(max)) return "407";
        if (raw !== undefined && min !== undefined && Number(raw) < Number(min)) return "407";
        if (raw !== undefined && max !== undefined && Number(raw) > Number(max)) return "407";
        return null;
      }
    }
    const m = /^cmi\.interactions\.(\d+)\.(id|type|timestamp|weighting|learner_response|result|latency|description|correct_responses\.(\d+)\.pattern)$/.exec(element);
    if (!m) return "401";
    const n = Number(m[1]);
    const field = m[2]!;
    const count = this.interactionCount();
    if (n > count) return "351";
    if (field === "id") return value.length > 0 && value.length <= 4000 && !/\s/.test(value) ? null : "406";
    if (n === count) return "408"; // the id of this interaction has not been set yet
    const type = this.store[`cmi.interactions.${n}.type`];
    switch (field) {
      case "type": return TYPES.includes(value) ? null : "406";
      case "timestamp": return TIMESTAMP.test(value) ? null : "406";
      case "weighting": return real(value) ? null : "406";
      case "result": return RESULTS.includes(value) || real(value) ? null : "406";
      case "latency": return DURATION.test(value) ? null : "406";
      case "description": return value.length <= 250 ? null : "406";
    }
    if (!type) return "408"; // the answer's syntax depends on the type
    return field === "learner_response" ? this.response(type, value) : this.pattern(type, value);
  }

  private response(type: string, value: string): string | null {
    switch (type) {
      case "true_false": return value === "true" || value === "false" ? null : "406";
      case "choice":
      case "sequencing": return items(value).every((s) => SHORT_ID.test(s)) ? null : "406";
      case "likert": return SHORT_ID.test(value) ? null : "406";
      case "numeric": return real(value) ? null : "406";
      case "matching": return items(value).every((p) => /^[^[\]]+\[\.\][^[\]]+$/.test(p) && p.split("[.]").every((s) => SHORT_ID.test(s))) ? null : "406";
      case "fill_in": return items(value).length <= 10 && items(value).every((s) => s.length <= 250) ? null : "406";
      default: return value.length <= 4000 ? null : "406";
    }
  }

  private pattern(type: string, value: string): string | null {
    switch (type) {
      case "fill_in": {
        const body = value.replace(/^(\{(case_matters|order_matters)=(true|false)\})*/, "");
        return items(body).length <= 10 && items(body).every((s) => s.length <= 250) ? null : "406";
      }
      case "numeric": return /^(-?\d+(\.\d+)?)?(\[:\](-?\d+(\.\d+)?)?)?$/.test(value) && value !== "" ? null : "406";
      case "choice":
      case "sequencing": return items(value).length > 0 && items(value).every((s) => SHORT_ID.test(s)) ? null : "406";
      default: return this.response(type, value);
    }
  }
}
