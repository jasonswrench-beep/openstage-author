// The two dialogs for AI services.
//
// "AI services" is where the author adds a key for OpenAI or ElevenLabs, says yes to a service sending it their words, chooses the
// model, fetches the voices on their ElevenLabs account, and switches voice plugins on. The permission question is asked the first
// time something would be sent to a service, in the place where the author asked for it (making narration audio, a picture or a sound).
//
// Both are native <dialog>s, so focus moves in, Tab stays inside, Escape closes them and focus returns to what opened them. Nothing is
// sent anywhere from here except by a button that says so: "Check the key" and "Get my voices" talk to the service with the key, and
// only after the author has said yes to that service.

import {
  allow, hasKey, isAllowed, noPlugins, nowStamp, permissionText, SERVICES, withKey, withdraw,
  type AiSettings, type PluginList, type ServiceInfo, type Work,
} from "./aiservices.ts";
import { errorText, type Backend } from "./backend.ts";
import { parseSettings, serializeSettings, type Settings } from "./stock.ts";

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

/** Read the settings file, change them, and write them back, so a change made here never undoes one made somewhere else in the editor. */
export async function updateSettings(b: Backend, change: (s: Settings) => Settings): Promise<Settings> {
  const next = change(parseSettings(await b.readSettings().catch(() => "")));
  await b.writeSettings(serializeSettings(next));
  return next;
}

// ---- the question before anything is sent

export interface PermissionQuestion {
  service: ServiceInfo;
  work: Work;
  detail?: { narrations?: number; characters?: number };
}

/**
 * Ask whether a service may be sent what the author is about to make with it. Resolves to true only if they say yes, which is also kept in the
 * settings so they are not asked again. The "Not now" button has the focus, so pressing Enter without reading gives the safe answer.
 */
export function askPermission(b: Backend, q: PermissionQuestion): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "ap-title", "aria-describedby": "ap-text" });
    const error = h("p", { class: "dialog-error", role: "alert" });
    const yes = h("button", { type: "button", text: `Allow ${q.service.name}` });
    const no = h("button", { type: "button", text: "Not now", autofocus: true });
    let answer = false;
    const finish = () => { dialog.close(); dialog.remove(); resolve(answer); };
    no.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    yes.addEventListener("click", async () => {
      try {
        await updateSettings(b, (s) => ({ ...s, ai: allow(s.ai, q.service.id, nowStamp()) }));
        answer = true;
        finish();
      } catch (err) {
        error.textContent = `Could not save your answer. ${errorText(err)}`;
      }
    });
    dialog.append(
      h("h2", { id: "ap-title", text: `Send to ${q.service.name}?` }),
      h("div", { id: "ap-text" }, ...permissionText(q.service, q.work, q.detail).map((t) => h("p", { text: t }))),
      error, h("div", { class: "dialog-actions" }, yes, no),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    no.focus();
  });
}

// ---- the settings dialog

export interface AiDialogOptions {
  backend: Backend;
  /** Plugins as last listed, shown while the dialog looks again. */
  plugins: PluginList;
  announce: (message: string) => void;
}

/** What the dialog tells the editor when it closes: the settings as saved, or null if the author cancelled. */
export interface AiDialogResult {
  settings: Settings | null;
  plugins: PluginList;
}

export function openAiServices(opts: AiDialogOptions): Promise<AiDialogResult> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let settings: Settings = parseSettings("");
    let ai: AiSettings = settings.ai;
    let plugins = opts.plugins;
    let loaded = false;

    const dialog = h("dialog", { class: "dialog wide ai-dialog", "aria-labelledby": "ai-title" });
    const status = h("p", { class: "as-status", role: "status" });
    const say = (text: string) => { status.textContent = text; };

    const intro = h("div", {},
      h("p", { text: "Make voices, pictures and sounds with a service you have your own key for, and use other voice models through plugins. Nothing is sent anywhere until you add a key and say yes to that service." }),
      h("p", { class: "note", text: "Your keys are kept on this computer only, in OpenStage's own settings. They are never saved in a project, so sharing a project never shares a key. Voices are always the ready-made ones a service offers: OpenStage does not copy anyone's voice." }));

    // ---- one block for each service
    const blocks = SERVICES.map((svc) => {
      const prefix = `ai-${svc.id}`;
      const key = h("input", { id: `${prefix}-key`, type: "password", autocomplete: "off", spellcheck: "false" });
      const show = h("button", { type: "button", class: "small", text: "Show", "aria-label": `Show the ${svc.name} key`, "aria-pressed": "false" });
      show.addEventListener("click", () => { const shown = key.type === "text"; key.type = shown ? "password" : "text"; show.textContent = shown ? "Show" : "Hide"; show.setAttribute("aria-pressed", String(!shown)); });
      const get = h("button", { type: "button", class: "small", text: `Get a ${svc.name} key` });
      get.addEventListener("click", () => void b.openUrl(svc.keyUrl));
      const works = svc.works.map((w) => (w === "voice" ? "voices" : w === "picture" ? "pictures" : "sound effects")).join(", ");
      const permit = h("input", { id: `${prefix}-allow`, type: "checkbox" });
      const sendsList = svc.works.map((w) => svc.sends[w]).filter(Boolean).join(" and ");
      const models = svc.models;
      const modelInputs = (["speech", "picture"] as const).flatMap((kind) => {
        const m = models[kind];
        if (!m) return [];
        const input = h("input", { id: `${prefix}-model-${kind}`, type: "text", autocomplete: "off", spellcheck: "false", placeholder: m.fallback });
        input.addEventListener("change", () => { ai = { ...ai, models: { ...ai.models, [svc.id]: { ...ai.models[svc.id], [kind]: input.value.trim() } } }; });
        return [{ kind, input, row: h("div", { class: "field" }, h("label", { for: input.id, text: `${m.label} (empty uses ${m.fallback})` }), input) }];
      });
      const check = h("button", { type: "button", class: "small", text: "Check the key" });
      const fetchVoices = svc.id === "elevenlabs" ? h("button", { type: "button", class: "small", text: "Get my voices" }) : null;
      const voiceCount = svc.id === "elevenlabs" ? h("p", { class: "note", id: `${prefix}-voices` }) : null;

      const readKey = () => { ai = withKey(ai, svc.id, key.value); };
      const refresh = () => {
        permit.checked = isAllowed(ai, svc.id);
        if (voiceCount) voiceCount.textContent = ai.voices.elevenlabs.length === 0 ? "No voices fetched yet. After your key is checked and you have said yes, choose Get my voices to see the ready-made voices on your account." : `${ai.voices.elevenlabs.length} ready-made voices from your account are in the voice list.`;
      };
      key.addEventListener("change", () => {
        const was = isAllowed(ai, svc.id);
        readKey();
        refresh();
        if (was && !isAllowed(ai, svc.id)) say(`The key changed, and it may be another account, so tick the box again to say yes to ${svc.name} for the new key.`);
      });
      permit.addEventListener("change", () => { ai = permit.checked ? allow(ai, svc.id, nowStamp()) : withdraw(ai, svc.id); refresh(); });

      /** Talk to the service about the key. The tool checks the author's yes in the saved settings, so the settings are saved first. */
      const ask = async (op: "check" | "voices") => {
        readKey();
        if (!hasKey(ai, svc.id)) { say(`Type your ${svc.name} key first.`); key.focus(); return; }
        if (!isAllowed(ai, svc.id)) { say(`Tick "Allow OpenStage to send ..." for ${svc.name} first. This button contacts ${svc.name} with your key.`); permit.focus(); return; }
        try {
          settings = await updateSettings(b, (s) => ({ ...s, ai }));
          say(op === "check" ? `Checking your ${svc.name} key...` : `Asking ${svc.name} for the voices on your account...`);
          const answer = await b.aiService(op, svc.id);
          if (!answer.ok) { say(answer.message); return; }
          if (op === "voices") {
            ai = { ...ai, voices: { ...ai.voices, elevenlabs: answer.voices } };
            refresh();
            say(answer.voices.length === 0 ? "Your account has no ready-made voices to list." : `Found ${answer.voices.length} ready-made voices. They are in the voice list once you save.`);
          } else {
            say(`${svc.name} accepted the key.`);
          }
        } catch (err) {
          say(errorText(err));
        }
      };
      check.addEventListener("click", () => void ask("check"));
      fetchVoices?.addEventListener("click", () => void ask("voices"));

      const section = h("section", { class: "ai-service", "aria-labelledby": `${prefix}-h` },
        h("h3", { id: `${prefix}-h`, text: `${svc.name} (${works})` }),
        h("p", { class: "note", text: svc.blurb }),
        h("div", { class: "field" }, h("label", { for: key.id, text: `${svc.name} ${svc.keyName}` }), h("span", { class: "as-keyrow" }, key, show, get)),
        h("div", { class: "field check" }, permit, h("label", { for: permit.id, text: `Allow OpenStage to send ${svc.name} ${sendsList}` })),
        h("div", { class: "btn-row" }, check, ...(fetchVoices ? [fetchVoices] : [])),
        ...(voiceCount ? [voiceCount] : []),
        ...(modelInputs.length ? [h("details", {}, h("summary", { text: `${svc.name} models (advanced)` }), h("p", { class: "note", text: "Services change their model names from time to time. If one stops working, type the new name here." }), ...modelInputs.map((m) => m.row))] : []),
      );
      const fill = () => {
        key.value = ai.keys[svc.id];
        for (const m of modelInputs) m.input.value = ai.models[svc.id][m.kind];
        refresh();
      };
      return { section, fill, readKey };
    });

    // ---- plugins
    const folderText = h("p", { class: "note", id: "ai-plugin-folder" });
    const pluginList = h("div", { class: "ai-plugins" });
    const openFolder = h("button", { type: "button", class: "small", text: "Open the plugins folder" });
    const lookAgain = h("button", { type: "button", class: "small", text: "Look again" });
    let folder = "";
    openFolder.addEventListener("click", async () => {
      try {
        folder = await b.aiPluginsFolder();
        folderText.textContent = `Voice plugins go in this folder, each in a folder of its own: ${folder}`;
        await b.revealInFolder(folder);
      } catch (err) {
        say(errorText(err));
      }
    });
    const renderPlugins = () => {
      pluginList.replaceChildren();
      if (plugins.plugins.length === 0 && plugins.problems.length === 0) {
        pluginList.append(h("p", { class: "note", text: "No voice plugins are installed. A plugin is a folder you copy into the plugins folder. docs/plugins.md explains how one is made." }));
      }
      for (const p of plugins.plugins) {
        const box = h("input", { id: `ai-plugin-${p.id}`, type: "checkbox", ...(ai.plugins[p.id] ? { checked: true } : {}) });
        box.addEventListener("change", () => {
          const next = { ...ai.plugins };
          if (box.checked) next[p.id] = true; else delete next[p.id];
          ai = { ...ai, plugins: next };
          plugins = { ...plugins, plugins: plugins.plugins.map((x) => (x.id === p.id ? { ...x, enabled: box.checked } : x)) };
        });
        const facts = [p.version ? `Version ${p.version}.` : "", `Licence: ${p.licence}.`, `${p.voices.length} ${p.voices.length === 1 ? "voice" : "voices"}.`,
          p.network ? "Its author says it uses the internet, so the words of a narration may be sent to a service." : "Its author says it works on this computer only.", p.description].filter(Boolean).join(" ");
        pluginList.append(h("div", { class: "ai-plugin" },
          h("div", { class: "field check" }, box, h("label", { for: box.id, text: `Use ${p.name}` })),
          h("p", { class: "note", text: facts })));
      }
      for (const problem of plugins.problems) {
        pluginList.append(h("p", { class: "note ai-plugin-problem", text: `The folder "${problem.folder}" cannot be used as a plugin. ${problem.problem}` }));
      }
    };
    lookAgain.addEventListener("click", async () => {
      try {
        // The plugins are listed with the switches as saved, so save the switches first.
        settings = await updateSettings(b, (s) => ({ ...s, ai }));
        plugins = await b.aiPlugins();
        renderPlugins();
        say(`${plugins.plugins.length} ${plugins.plugins.length === 1 ? "plugin" : "plugins"} found.`);
      } catch (err) {
        say(errorText(err));
      }
    });

    const save = h("button", { type: "button", text: "Save" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    let result: AiDialogResult = { settings: null, plugins };
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    save.addEventListener("click", async () => {
      if (!loaded) return;
      try {
        for (const blk of blocks) blk.readKey();
        const saved = await updateSettings(b, (s) => ({ ...s, ai }));
        const listed = await b.aiPlugins().catch(() => plugins);
        result = { settings: saved, plugins: listed };
        opts.announce("AI services saved.");
        finish();
      } catch (err) {
        say(`Could not save. ${errorText(err)}`);
      }
    });

    dialog.append(
      h("h2", { id: "ai-title", text: "AI services and voice plugins" }),
      intro,
      ...blocks.map((blk) => blk.section),
      h("section", { class: "ai-service", "aria-labelledby": "ai-plugins-h" },
        h("h3", { id: "ai-plugins-h", text: "Voice plugins" }),
        h("p", { text: "A plugin gives OpenStage another speech model. It does nothing until you switch it on here." }),
        h("p", { class: "note", text: "A plugin is a program, and it runs as you: it can do anything you can do on this computer. Switch on only plugins you trust. A plugin is never part of a project, so a project you are sent cannot bring one. A plugin offers a fixed set of voices; OpenStage has no way to hand a plugin a recording to copy." }),
        h("div", { class: "btn-row" }, openFolder, lookAgain), folderText, pluginList),
      status,
      h("div", { class: "dialog-actions" }, save, cancel),
    );
    document.body.appendChild(dialog);
    renderPlugins();
    dialog.showModal();
    (dialog.querySelector("#ai-openai-key") as HTMLElement | null)?.focus();

    void (async () => {
      try {
        settings = parseSettings(await b.readSettings());
        ai = settings.ai;
      } catch {
        // no settings yet
      }
      for (const blk of blocks) blk.fill();
      renderPlugins();
      loaded = true;
      try {
        folder = await b.aiPluginsFolder();
        folderText.textContent = `Voice plugins go in this folder, each in a folder of its own: ${folder}`;
        plugins = await b.aiPlugins();
        renderPlugins();
      } catch {
        folderText.textContent = "";
        plugins = plugins ?? noPlugins();
      }
    })();
  });
}
