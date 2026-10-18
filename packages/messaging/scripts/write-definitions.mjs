// Regenerates the broker files from the topology module: `pnpm --filter @jadero/messaging topology`.
// - infra/rabbitmq/definitions.json: the dev vhost with the dev users and their fixed passwords.
// - infra/rabbitmq/server/definitions/<env>.json: one file per server vhost, without users or
//   permissions, loaded at boot so RabbitMQ never seeds `guest` (WP-8 D4).
// - infra/rabbitmq/server/permissions.tsv: the server users' tags and permissions, which
//   infra/rabbitmq/provision-users.sh converges with passwords from the environment.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildDefinitions,
  DEV_USERS,
  DEV_VHOST,
  JADERO_QUEUES,
  renderPermissionsTable,
  SERVER_ENVIRONMENTS,
} from "../dist/index.js";

const infra = (path) => fileURLToPath(new URL(`../../../infra/rabbitmq/${path}`, import.meta.url));

const jsonFiles = [
  [
    infra("definitions.json"),
    buildDefinitions({ vhost: DEV_VHOST, queues: JADERO_QUEUES, users: DEV_USERS }),
  ],
  ...SERVER_ENVIRONMENTS.map((env) => [
    infra(`server/definitions/${env.name}.json`),
    buildDefinitions({ vhost: env.vhost, queues: JADERO_QUEUES }),
  ]),
];
mkdirSync(infra("server/definitions"), { recursive: true });
for (const [target, definitions] of jsonFiles) {
  writeFileSync(target, `${JSON.stringify(definitions, null, 2)}\n`);
  console.log(`wrote ${target}`);
}
// Same layout as the rest of the repo, so `pnpm lint:check` passes on the generated files.
execFileSync(
  "pnpm",
  ["exec", "biome", "format", "--write", ...jsonFiles.map(([target]) => target)],
  {
    stdio: "ignore",
  },
);

const table = infra("server/permissions.tsv");
writeFileSync(
  table,
  renderPermissionsTable(
    SERVER_ENVIRONMENTS.map((env) => ({
      vhost: env.vhost,
      queues: JADERO_QUEUES,
      users: env.users,
    })),
  ),
);
console.log(`wrote ${table}`);
