import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
const dir = "com.dylanmaniatakes.xair-control.sdPlugin";
await build({
  entryPoints: ["src/plugin.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${dir}/bin/plugin.cjs`,
  external: ["bufferutil", "utf-8-validate"],
});
await copyFile("../LICENSE", `${dir}/LICENSE`);
await copyFile("node_modules/ws/LICENSE", `${dir}/WS-LICENSE`);
