import { App } from "./app.ts";
import { dressDialogsWhenShown } from "./dialogchrome.ts";
import { describeDialogsBriefly } from "./dialogdesc.ts";
import { startDemoHook } from "./demohook/hook.ts";
import { readSettings } from "./demohook/protocol.ts";

describeDialogsBriefly();
dressDialogsWhenShown();

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  app.wire();
  // Demo mode for OpenStage Studio: off unless the editor was started with the demo flag (see src/demohook).
  const demo = readSettings(globalThis as unknown as Record<string, unknown>, location.search);
  if (demo) startDemoHook({ program: "OpenStage Author", settings: demo, loadDemo: (name) => app.demoOpen(name, demo.workspace), reset: () => app.demoReset() });
}
