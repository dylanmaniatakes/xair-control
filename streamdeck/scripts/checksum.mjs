import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = "com.dylanmaniatakes.xair-control.streamDeckPlugin";
const hash = createHash("sha256")
  .update(await readFile(`releases/${file}`))
  .digest("hex");
await writeFile("releases/SHA256SUMS", `${hash}  ${file}\n`);
