import { App } from "./app.ts";

const root = document.getElementById("app");
if (root) {
  const app = new App(root);
  app.wire();
}
