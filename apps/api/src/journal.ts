import { resolve } from "node:path";
import { loadConfig } from "@jadero/platform-nest";
import { z } from "zod";
import { apiEnv } from "./config/api-config.js";
import { runJournal } from "./journal/journal.module.js";
import { describeFailure, parseJournalArgs } from "./journal/journal-commands.js";

// The journal commands (WP-39 D3, ADR-034), run by hand until the admin exists (WP-17):
// `journal:import [dir]` imports the drafts of `docs/journal/` as draft revisions and never
// publishes; `journal:publish <wp> [locales...]` publishes one work package's journal post through
// the domain's publish guards. One line per file or publish, never a body. Exit code 1 when a file
// was refused or failed, or the publish was refused; what imported before it stays.
const { DATABASE_URL, DATABASE_POOL_MAX, INIT_CWD } = loadConfig(
  apiEnv
    .pick({ DATABASE_URL: true, DATABASE_POOL_MAX: true })
    // pnpm sets INIT_CWD to where the owner ran it; the script itself runs in apps/api.
    .extend({ INIT_CWD: z.string().min(1).optional() }),
);

/**
 * The repo's drafts folder. pnpm runs a package script in the package folder (`apps/api`), so it is
 * two levels up from there; a run started elsewhere names its folder.
 */
const DEFAULT_DIR = resolve(process.cwd(), "../../docs/journal");

try {
  const args = parseJournalArgs(process.argv.slice(2), INIT_CWD ?? process.cwd(), DEFAULT_DIR);
  const ok = await runJournal(
    args,
    { url: DATABASE_URL, poolMax: DATABASE_POOL_MAX },
    { info: (line) => console.log(line), error: (line) => console.error(line) },
  );
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(`api: journal failed: ${describeFailure(error)}`);
  process.exitCode = 1;
}
