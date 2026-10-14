// Which files stay out of a package's source/ copy. The same cases are run against the validator's version of the rule.
import assert from "node:assert/strict";
import { test } from "node:test";
import cases from "../../tools/source-exclude-cases.json" with { type: "json" };
import { isExcluded } from "./exclude.ts";

test("the exclusion rule gives the answers in the shared cases", () => {
  assert.ok(cases.cases.length > 10);
  for (const c of cases.cases) assert.equal(isExcluded(c.path, c.patterns), c.excluded, `${JSON.stringify(c.patterns)} on ${c.path}${c.note ? ` (${c.note})` : ""}`);
});
