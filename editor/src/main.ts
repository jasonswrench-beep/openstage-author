import { App } from "./app.ts";
import { dressDialogsWhenShown } from "./dialogchrome.ts";
import { describeDialogsBriefly } from "./dialogdesc.ts";

describeDialogsBriefly();
dressDialogsWhenShown();

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  app.wire();
}
