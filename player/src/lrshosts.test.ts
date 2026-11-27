// The hosts a published course may report to (lrshosts.ts): how an author's list is read, and which hosts a list lets through.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { hostAllowed, hostAllowedOrSay, MAX_HOSTS, parseHosts } from "./lrshosts.ts";

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

test("a list is read from commas, spaces and new lines, in lower case, each host once", () => {
  const r = parseHosts("LRS.Example.org, lrs.example.org\n *.Learn.example.net;  localhost 127.0.0.1 ");
  assert.deepEqual(r.hosts, ["lrs.example.org", "*.learn.example.net", "localhost", "127.0.0.1"]);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(parseHosts(""), { hosts: [], problems: [] }, "no list is not a problem");
  assert.deepEqual(parseHosts("  \n , ").hosts, []);
  assert.deepEqual(parseHosts("lrs.example.org.").hosts, ["lrs.example.org"], "the dot that ends a full name is dropped");
});

test("an entry that is not a host is named and left out, in words for the author", () => {
  const r = parseHosts("https://lrs.example.org, lrs.example.org/xapi, lrs.example.org:8443, [::1], *, a*.example.org, *., bad_name.example.org, -x.example.org, good.example.org");
  assert.deepEqual(r.hosts, ["good.example.org"]);
  assert.equal(r.problems.length, 9);
  assert.match(r.problems[0]!, /https:\/\//);
  assert.match(r.problems[1]!, /path/);
  assert.match(r.problems[2]!, /port/);
  assert.match(r.problems[3]!, /brackets/);
  assert.match(r.problems[4]!, /\*/);
  for (const p of r.problems) assert.match(p, /^"/, "each problem names the entry");
});

test("a list that is far too long is refused", () => {
  const many = Array.from({ length: MAX_HOSTS + 1 }, (_, i) => `h${i}.example.org`).join(",");
  const r = parseHosts(many);
  assert.equal(r.hosts.length, MAX_HOSTS);
  assert.equal(r.problems.length, 1);
  assert.equal(parseHosts(Array.from({ length: MAX_HOSTS }, (_, i) => `h${i}.example.org`).join(",")).problems.length, 0);
});

test("with no list every host is allowed, as before", () => {
  assert.equal(hostAllowed("anywhere.example.org", undefined), true);
  assert.equal(hostAllowed("anywhere.example.org", []), true);
});

test("with a list only a listed host is allowed, whatever its case", () => {
  const list = ["lrs.example.org", "localhost"];
  assert.equal(hostAllowed("lrs.example.org", list), true);
  assert.equal(hostAllowed("LRS.Example.ORG", list), true);
  assert.equal(hostAllowed("lrs.example.org.", list), true, "a full name that ends in a dot is the same host");
  assert.equal(hostAllowed("localhost", list), true);
  assert.equal(hostAllowed("other.example.org", list), false);
  assert.equal(hostAllowed("example.org", list), false);
  assert.equal(hostAllowed("xlrs.example.org", list), false, "a longer name is not the listed one");
  assert.equal(hostAllowed("lrs.example.org.evil.test", list), false, "the listed name at the start of another is not it");
  assert.equal(hostAllowed("127.0.0.1", list), false, "the learner's own computer is allowed only when it is listed");
});

test("a * entry allows any host under it, and not the name itself", () => {
  const list = ["*.example.org"];
  assert.equal(hostAllowed("lrs.example.org", list), true);
  assert.equal(hostAllowed("a.b.example.org", list), true);
  assert.equal(hostAllowed("example.org", list), false);
  assert.equal(hostAllowed("notexample.org", list), false, "a name that only ends the same way is not under it");
  assert.equal(hostAllowed("example.org.evil.test", list), false);
});

test("a launch at a host that is not listed is refused with a word on the console", () => {
  assert.equal(hostAllowedOrSay(new URL("https://lrs.example.org/xapi/"), ["lrs.example.org"]), true);
  assert.deepEqual(warnings, []);
  assert.equal(hostAllowedOrSay(new URL("https://other.example.org/xapi/"), ["lrs.example.org"]), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /other\.example\.org/);
  assert.match(warnings[0]!, /lrs\.example\.org/);
  assert.equal(hostAllowedOrSay(new URL("https://other.example.org/"), undefined), true);
  assert.equal(warnings.length, 1, "no list, no word");
});
