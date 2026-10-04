// Regenerates asyncapi.json from the compiled contracts: `pnpm --filter @jadero/contracts asyncapi`.
import { writeFileSync } from "node:fs";
import { buildAsyncApiDocument } from "../dist/index.js";

const target = new URL("../asyncapi.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(buildAsyncApiDocument(), null, 2)}\n`);
console.log(`wrote ${target.pathname}`);
