// The MCP access dialog: lets an AI assistant (Claude Desktop, Claude Code or another) use OpenStage Author to build, check and publish courses with
// nobody at the keyboard, and gives the lines that connect one. It is off until it is turned on here, and an assistant can use one folder only. The
// choices are written to the settings file, which the assistant's program reads each time it connects. A native <dialog>, so focus moves in, Tab
// stays inside, Escape closes it and focus returns to where it came from.

import { errorText, type Backend } from "./backend.ts";
import { claudeCodeCommand, claudeDesktopConfig, mcpProblem, type McpInfo, type McpSettings } from "./mcpsettings.ts";
import { parseSettings, serializeSettings } from "./stock.ts";

type Attrs = Record<string, string | boolean>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

export interface McpOptions {
  backend: Backend;
  announce: (message: string) => void;
}

/** A block of text to copy: a label, the text in a box that can be read and selected, and a button that copies it. */
function copyBlock(id: string, label: string, text: string, rows: number, say: (m: string) => void): HTMLElement {
  const box = h("textarea", { id, readonly: true, rows: String(rows), spellcheck: "false", class: "mcp-lines" });
  box.value = text;
  const copy = h("button", { type: "button", text: "Copy" });
  copy.setAttribute("aria-label", `Copy the lines for ${label}`);
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(text).then(
      () => say(`Copied the lines for ${label}.`),
      () => say(`The lines could not be copied. Select them in the box and copy them yourself.`),
    );
  });
  return h("div", { class: "field mcp-block" }, h("label", { for: id, text: label }), box, copy);
}

export function openMcp(opts: McpOptions): Promise<void> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let choice: McpSettings = { enabled: false, folder: "" };

    const dialog = h("dialog", { class: "dialog wide mcp-dialog", "aria-labelledby": "mcp-title" });
    const on = h("input", { id: "mcp-on", type: "checkbox", "aria-describedby": "mcp-safety" });
    const folderBox = h("input", { id: "mcp-folder", type: "text", readonly: true, value: "", placeholder: "No folder chosen" });
    const choose = h("button", { type: "button", text: "Choose folder..." });
    const save = h("button", { type: "button", text: "Save" });
    const closeBtn = h("button", { type: "button", text: "Close" });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const lines = h("div", { class: "mcp-connect" });

    const say = (text: string) => { status.textContent = text; };
    const fail = (text: string) => { failure.textContent = text; };

    const leave = () => {
      dialog.close();
      dialog.remove();
      opts.announce("MCP access closed.");
      resolve();
    };

    save.addEventListener("click", async () => {
      fail("");
      say("");
      const next: McpSettings = { enabled: on.checked, folder: choice.folder };
      const problem = mcpProblem(next);
      if (problem) {
        fail(problem);
        return;
      }
      try {
        const settings = parseSettings(await b.readSettings());
        await b.writeSettings(serializeSettings({ ...settings, mcp: next }));
        choice = next;
        say(next.enabled ? `Saved. An assistant may now use the folder ${next.folder}. Connect it with the lines below, or close and open it again if it is already connected.` : "Saved. MCP access is off: an assistant that was connected is stopped at its next request.");
      } catch (err) {
        fail(errorText(err));
      }
    });
    choose.addEventListener("click", async () => {
      const picked = await b.pickFolder("Choose the folder an assistant may use", "publish");
      if (!picked) return;
      choice = { ...choice, folder: picked };
      folderBox.value = picked;
      say(`The folder is ${picked}. Press Save to keep it.`);
    });
    closeBtn.addEventListener("click", leave);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); leave(); });

    dialog.append(
      h("h2", { id: "mcp-title", text: "MCP access" }),
      h("p", { class: "note", text: "MCP (the Model Context Protocol) is how an AI assistant such as Claude uses a program's tools. With it on, an assistant can build a course in this program while nobody is at the keyboard: make a project, add slides, text, pictures and questions, write narration, check the course for accessibility problems, and publish it. It does this with this program's own editing code, so every change means what it means here." }),
      h("div", { class: "field check" }, on, h("label", { for: "mcp-on", text: "Let an AI assistant use OpenStage Author" })),
      h("div", { class: "field" }, h("label", { for: "mcp-folder", text: "The folder it may use" }), folderBox),
      h("div", { class: "btn-row" }, choose),
      h("p", { id: "mcp-safety", class: "note", text: "It is off until you turn it on. An assistant can open, make, change and publish courses only inside this folder, and cannot reach anything else on this computer, your stock-library keys and AI service keys included. Every change is saved as it is made, and every action is written to OpenStage MCP log.txt in the folder (not what was written on a slide). Do not edit the same project in the editor while an assistant is working on it." }),
      status, failure,
      lines,
      h("div", { class: "dialog-actions" }, save, closeBtn),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    on.focus();

    // What is saved, and how to connect an assistant.
    void (async () => {
      try {
        const settings = parseSettings(await b.readSettings());
        choice = settings.mcp ?? { enabled: false, folder: "" };
        on.checked = choice.enabled;
        folderBox.value = choice.folder;
      } catch {
        // nothing saved yet: off
      }
      let info: McpInfo | null = null;
      try {
        info = await b.mcpInfo();
      } catch (err) {
        lines.append(h("p", { class: "note", text: errorText(err) }));
        return;
      }
      if (!info.found) {
        lines.append(h("p", { class: "note", text: info.note }));
        return;
      }
      lines.append(
        h("h3", { text: "Connect an assistant" }),
        h("p", { class: "note", text: "After you press Save, give your assistant these lines. It reads the settings each time it connects, so you can turn access off here later without changing them. They need Node.js, which comes with the installed program." }),
        copyBlock("mcp-desktop", "Claude Desktop (add to claude_desktop_config.json)", claudeDesktopConfig(info), 9, say),
        copyBlock("mcp-code", "Claude Code (run in a terminal)", claudeCodeCommand(info), 4, say),
      );
    })();
  });
}
