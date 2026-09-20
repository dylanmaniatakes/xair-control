import WebSocket from "ws";
import { Controller } from "./controller.js";
const args = process.argv.slice(2),
  get = (name) => args[args.indexOf(name) + 1];
const port = Number(get("-port")),
  uuid = get("-pluginUUID"),
  event = get("-registerEvent");
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !uuid ||
  event !== "registerPlugin"
)
  throw Error("Launch this plugin through Stream Deck");
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const send = (message) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};
const controller = new Controller(send);
ws.on("open", () => send({ event, uuid }));
ws.on("message", (data) => {
  try {
    controller.handle(JSON.parse(data.toString()));
  } catch {
    /* Malformed events must not crash the plugin. */
  }
});
ws.on("close", () => {
  controller.close();
  process.exit(0);
});
ws.on("error", () => {
  controller.close();
  process.exit(1);
});
