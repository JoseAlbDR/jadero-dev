// Regenerates infra/rabbitmq/definitions.json from the topology module:
// `pnpm --filter @jadero/messaging topology`. Dev vhost and dev users only.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDefinitions, DEV_USERS, DEV_VHOST, JADERO_QUEUES } from "../dist/index.js";

const target = fileURLToPath(new URL("../../../infra/rabbitmq/definitions.json", import.meta.url));
const definitions = buildDefinitions({ vhost: DEV_VHOST, queues: JADERO_QUEUES, users: DEV_USERS });
writeFileSync(target, `${JSON.stringify(definitions, null, 2)}\n`);
// Same layout as the rest of the repo, so `pnpm lint` passes on the generated file.
execFileSync("pnpm", ["exec", "biome", "format", "--write", target], { stdio: "ignore" });
console.log(`wrote ${target}`);
