import { App } from "./app.ts";
import { backend } from "./backend.ts";
import { dressDialogsWhenShown } from "./dialogchrome.ts";
import { describeDialogsBriefly } from "./dialogdesc.ts";

describeDialogsBriefly();
dressDialogsWhenShown();

const root = document.getElementById("app");
if (root) {
  // The Presenter add-on is a separate download. Asked once, before the menus are made, so Insert > Presenter is there only when it is.
  // A slow or failing answer never keeps the editor from opening: no add-on is the same as none.
  void (async () => {
    const presenter = await Promise.race([backend.presenterAddon().catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), 1500))]);
    const app = new App(root, { presenter });
    app.wire();
  })();
}
