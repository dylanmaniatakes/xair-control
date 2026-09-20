// Local, read-only property-inspector preview. Does not register a hardware action.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer } from "ws";
import { Controller } from "../src/controller.js";
const port = Number(process.env.PREVIEW_PORT || 18092);
const server = createServer(async (req, res) => {
  try {
    const file = {
      "/": "index.html",
      "/inspector.js": "inspector.js",
      "/style.css": "style.css",
    }[req.url];
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    let content = await readFile(
      new URL(
        `../com.dylanmaniatakes.xair-control.sdPlugin/ui/${file}`,
        import.meta.url,
      ),
    );
    if (file === "index.html")
      content = content
        .toString()
        .replace(
          "</body>",
          `<script>window.addEventListener('DOMContentLoaded',()=>window.connectElgatoStreamDeckSocket('${port}','preview','registerPropertyInspector','{}',JSON.stringify({context:'preview-action',action:'com.dylanmaniatakes.xair-control.fader',payload:{settings:{}}})))</script></body>`,
        );
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : "text/css",
    );
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("Preview failed");
  }
});
const ws = new WebSocketServer({ server });
ws.on("connection", (socket) => {
  const controller = new Controller((m) => socket.send(JSON.stringify(m)));
  socket.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.event === "sendToPlugin") controller.handle(m);
    if (m.event === "setSettings")
      console.log("Settings save received (preview only)");
  });
  socket.on("close", () => controller.close());
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Inspector preview: http://127.0.0.1:${port}`),
);
