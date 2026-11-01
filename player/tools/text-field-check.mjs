// SPDX-License-Identifier: Apache-2.0
// Builds a text field with the player's own code (player/src/inputs.ts, bundled for a browser) in a real, headless Chromium and checks what it gives
// a person and a screen reader: the prompt is the box's label, the hint describes it, more lines make a text area, what is typed reaches the variable and
// the LMS layer when the learner leaves the box (never on every key), a returning learner finds their words, and the editor's copy of it does not respond.
//
// A developer check, not something an author runs. It needs Playwright, which is not part of this package: point PLAYWRIGHT_DIR at an installed copy
// (default: /opt/node-tools/node_modules/playwright), and esbuild from the editor's packages is used to bundle the player's code.
//
//   node player/tools/text-field-check.mjs

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules/playwright");
const esbuild = require(resolve(here, "..", "..", "editor", "node_modules", "esbuild"));

const bundle = await esbuild.build({
  entryPoints: [resolve(here, "..", "src", "inputs.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Inputs",
  platform: "browser",
  target: "es2022",
});
const code = bundle.outputFiles[0].text;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failures = 0;
let passes = 0;
const assertEqual = (actual, expected, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
};

async function check(name, body) {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  try {
    await page.setContent("<!doctype html><html lang='en'><body><div id='host'></div></body></html>");
    await page.addScriptTag({ content: code });
    await page.evaluate(() => {
      window.make = (content, hooks = {}, alt = "") => {
        const obj = {
          id: "obj-1", type: "input", name: "Input", geometry: { x: 0, y: 0, width: 600, height: 200, rotation: 0, z: 1 },
          content: { report: true, ...content }, style: {}, accessibility: { altText: alt || content.prompt, role: "group", tabOrder: 1, decorative: false },
          states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: {}, narration: null,
        };
        window.changes = [];
        const el = window.Inputs.buildInput(document, obj, { editing: false, onChange: (c) => window.changes.push(c), ...hooks });
        const host = document.getElementById("host");
        host.replaceChildren(el);
        return el;
      };
    });
    await body(page);
    if (problems.length > 0) throw new Error(problems.join("; "));
    passes += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : error}`);
  } finally {
    await page.close();
  }
}

await check("the prompt is the box's label, the hint describes it, and a one-line field is a native text box", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "What is your name?", variable: "var-words", hint: "Used on your certificate." }));
  const box = page.getByLabel("What is your name?");
  assertEqual(await box.count(), 1, "one box with that name");
  assertEqual(await box.evaluate((el) => el.tagName.toLowerCase() + ":" + el.type), "input:text", "a native one-line text box");
  assertEqual(await box.evaluate((el) => el.getAttribute("maxlength")), "200", "the usual 200 characters");
  const hintId = await box.getAttribute("aria-describedby");
  assertEqual(await page.locator(`#${hintId}`).textContent(), "Used on your certificate.", "the hint is what describes the box");
  assertEqual(await page.locator("fieldset").count(), 0, "no group of its own: the label names the box");
  assertEqual(await box.evaluate((el) => el.hasAttribute("aria-description")), false, "alt text the same as the prompt adds nothing");
});

await check("no hint means nothing describes the box, and different alt text is added as a description", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your name", variable: "var-words" }));
  assertEqual(await page.getByLabel("Your name").evaluate((el) => el.hasAttribute("aria-describedby")), false, "nothing to describe it");
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your name", variable: "var-words" }, {}, "Type the name you want printed on the certificate"));
  assertEqual(await page.getByLabel("Your name").getAttribute("aria-description"), "Type the name you want printed on the certificate", "the author's own words are kept");
});

await check("more than one line is a text area with that many rows, and the most characters is the limit of the box", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your reflection", variable: "var-words", lines: 4, maxLength: 60 }));
  const box = page.getByLabel("Your reflection");
  assertEqual(await box.evaluate((el) => [el.tagName.toLowerCase(), el.rows, el.maxLength]), ["textarea", 4, 60], "a text area of 4 rows holding 60 characters");
  await box.fill("x".repeat(100));
  assertEqual((await box.inputValue()).length, 60, "the box takes no more than that");
  await page.evaluate(() => window.make({ kind: "text", prompt: "A", variable: "v", lines: 99, maxLength: 99999 }));
  assertEqual(await page.getByLabel("A").evaluate((el) => [el.tagName.toLowerCase(), el.maxLength]), ["input", 200], "numbers outside the limits are the usual ones");
});

await check("what is typed reaches the variable and the LMS layer when the learner leaves the box, not on every key, and only once if nothing changed", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your name", variable: "var-words" }));
  const box = page.getByLabel("Your name");
  await box.pressSequentially("Ada");
  assertEqual(await page.evaluate(() => window.changes.length), 0, "nothing yet: still typing");
  await box.press("Enter");
  assertEqual(await page.evaluate(() => window.changes), [{ rowId: "obj-1", variable: "var-words", value: "Ada", response: "Ada", type: "fill-in" }], "told once, with what was typed");
  await box.focus();
  await box.blur();
  assertEqual(await page.evaluate(() => window.changes.length), 1, "leaving it unchanged says nothing more");
  await box.fill("Ada Lovelace");
  await box.blur();
  assertEqual(await page.evaluate(() => window.changes.map((c) => c.value)), ["Ada", "Ada Lovelace"], "a changed answer is told again");
  await box.fill("");
  await box.blur();
  assertEqual(await page.evaluate(() => window.changes.at(-1)), { rowId: "obj-1", variable: "var-words", value: "", response: "", type: "fill-in" }, "a cleared box is saved too");
});

await check("a long answer is told to the LMS cut to 250 characters, while the variable has all of it", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "Write", variable: "var-words", lines: 5, maxLength: 600 }));
  const box = page.getByLabel("Write");
  await box.fill("y".repeat(400));
  await box.blur();
  assertEqual(await page.evaluate(() => [window.changes[0].value.length, window.changes[0].response.length]), [400, 250], "all of it in the variable, 250 for the LMS");
});

await check("a learner who comes back finds their words, and the editor's copy neither responds nor is a tab stop", async (page) => {
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your name", variable: "var-words" }, { value: (v) => (v === "var-words" ? "Grace" : undefined) }));
  assertEqual(await page.getByLabel("Your name").inputValue(), "Grace", "the saved words are back");
  await page.evaluate(() => window.make({ kind: "text", prompt: "Your name", variable: "var-words" }, { editing: true, value: () => "Grace" }));
  const box = page.getByLabel("Your name");
  assertEqual(await box.inputValue(), "", "the editor shows an empty box, not a learner's words");
  assertEqual(await box.evaluate((el) => [el.readOnly, el.tabIndex]), [true, -1], "read only and not a tab stop");
  await box.evaluate((el) => { el.value = "typed"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  assertEqual(await page.evaluate(() => window.changes.length), 0, "the editor tells nothing to anyone");
});

await browser.close();
console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
