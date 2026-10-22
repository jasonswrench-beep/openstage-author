import { App } from "./app.ts";
import { describeDialogsBriefly } from "./dialogdesc.ts";

describeDialogsBriefly();

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  app.wire();
}
