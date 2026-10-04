// Freezes the schema of every published event version in compat/<routingKey>.json:
// `pnpm --filter @jadero/contracts compat:accept`. A new version gets its first snapshot; an
// existing one is only rewritten when the change is compatible (a new optional property).
// An incompatible change is refused: publish a new version (<context>.<event>.v<N+1>) instead.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compatibilityProblems, eventContracts, publishedSchema } from "../dist/index.js";

let refused = false;
for (const contract of eventContracts) {
  const file = new URL(`../compat/${contract.routingKey}.json`, import.meta.url);
  const current = publishedSchema(contract);
  if (existsSync(file)) {
    const problems = compatibilityProblems(JSON.parse(readFileSync(file, "utf8")), current);
    if (problems.length > 0) {
      refused = true;
      console.error(`${contract.routingKey}: incompatible, publish a new version instead`);
      for (const problem of problems) console.error(`  ${problem}`);
      continue;
    }
  }
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`froze ${contract.routingKey}`);
}
process.exitCode = refused ? 1 : 0;
