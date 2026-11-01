// A plain record of what an assistant did, beside its projects, so a person who comes back can see it: when, which tool, whether it was done or
// refused, and the first line of the reply. What was written on a slide is not in it. A log that cannot be written never stops a tool.

import { appendFileSync } from "node:fs";
import path from "node:path";

export const LOG_NAME = "OpenStage MCP log.txt";

export function logger(folder: () => string | null, now: () => Date = () => new Date()): (entry: { tool: string; ok: boolean; first: string; changes: boolean }) => void {
  return (entry) => {
    const where = folder();
    if (!where) return;
    const stamp = now().toISOString().replace("T", " ").slice(0, 19);
    try {
      appendFileSync(path.join(where, LOG_NAME), `${stamp}  ${entry.tool}  ${entry.ok ? "OK" : "REFUSED"}${entry.changes ? "" : "  (read only)"}  ${entry.first.replace(/\s+/g, " ")}\n`, "utf-8");
    } catch {
      // The log is a courtesy.
    }
  };
}
