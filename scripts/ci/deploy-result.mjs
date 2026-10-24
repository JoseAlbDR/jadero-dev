#!/usr/bin/env node
/**
 * Turns the server's answer to one deploy or rollback into the deploy job's result (WP-9 D8,
 * `.github/workflows/deploy.yml`, step "Run the deploy on the server"). The step runs
 * `deploy-entry` over SSH, keeps the journal lines the server printed in a file, and calls this
 * script with the SSH exit code. The script prints one line, a workflow command (`::notice::`,
 * `::error::`) or plain text, and exits with the job's status.
 *
 * The exit codes: 0 recorded; 75 busy (another deploy holds the lock); 1 the run ended in a
 * state other than recorded, or was refused; 255 SSH failed. One exit 1 is green: the server's
 * exact refusal of this request as not newer (`refused reason=not-newer`), on a call from
 * release.yml, where a later release reaching the server first is expected (the anti-rollback
 * guard). On a manual dispatch the same line stays an error: deploying an older version by hand
 * is a mistake to show (a downgrade is a rollback).
 *
 * Nothing the server printed is echoed: the messages are fixed text plus the job's own inputs,
 * so no host, address or secret reaches the log from here, and no server line can act as a
 * workflow command.
 *
 * Usage: `CODE=<ssh exit> JOURNAL=<file> EVENT=... ACTION=... SERVER_ENV=... SERVICE=... VERSION=...
 * node scripts/ci/deploy-result.mjs`
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} DeployRequest
 * @property {string} event the workflow's event name (`workflow_dispatch` for a manual run).
 * @property {string} action `deploy` or `rollback`.
 * @property {string} serverEnv the server's environment word (`staging`, `prod`).
 * @property {string} service the service deployed.
 * @property {string} version the version deployed, empty for a rollback.
 */

/**
 * @typedef {object} DeployResult
 * @property {string} message the line to print.
 * @property {number} exitCode the job step's exit status.
 */

/**
 * The last line of the journal the server printed, as `tail -n 1` reads it.
 * @param {string} journal the journal text.
 * @returns {string} the last line, or "" when there is none.
 */
export function lastLine(journal) {
  const lines = journal.replace(/\n$/, "").split("\n");
  return lines.at(-1) ?? "";
}

/**
 * Whether a journal line is exactly the server's refusal of this request as not newer: the six
 * fields of a journal line split on single spaces (time, environment, service, version, state,
 * reason), with this request's environment, service and version, state `refused` and reason
 * `reason=not-newer`. Never a substring match: a near miss is not this refusal.
 * @param {string} line one journal line.
 * @param {DeployRequest} request the request the job sent.
 * @returns {boolean} true only for the exact line.
 */
export function isNotNewerRefusal(line, request) {
  const fields = line.split(" ");
  if (fields.length !== 6) return false;
  const [time, env, service, version, state, reason] = fields;
  return (
    time !== "" &&
    request.version !== "" &&
    env === request.serverEnv &&
    service === request.service &&
    version === request.version &&
    state === "refused" &&
    reason === "reason=not-newer"
  );
}

/**
 * Maps the SSH exit code and the journal to the job's message and exit status.
 * @param {DeployRequest & { code: string, journal: string }} input the request, the SSH exit code
 *   as the shell gave it, and the journal text (empty when the server printed nothing).
 * @returns {DeployResult} what to print and how the step ends.
 */
export function classify(input) {
  const { code, journal, action, serverEnv, service, version, event } = input;
  const line = lastLine(journal);
  const state = line.split(/\s+/)[4] ?? "";
  const error = (/** @type {string} */ text) => ({ message: `::error::${text}`, exitCode: 1 });
  switch (code) {
    case "0":
      return { message: `${service}: ${action} on ${serverEnv} recorded`, exitCode: 0 };
    case "75":
      return error(
        `busy: another deploy holds the ${serverEnv} lock; nothing was touched, rerun once it ends`,
      );
    case "1":
      if (event !== "workflow_dispatch" && action === "deploy" && isNotNewerRefusal(line, input)) {
        return {
          message: `::notice::${service} ${version} not deployed to ${serverEnv}: the server already runs this or a newer version (a later release got there first); nothing to do`,
          exitCode: 0,
        };
      }
      switch (state) {
        case "aborted":
          return error(
            "aborted before the point of no return: nothing shared changed, the running release keeps serving; the reason is in the last journal line",
          );
        case "rolled_back":
          return error(
            "rolled back: the new release failed after the point of no return and the previous one is healthy again; the reason is in the journal lines above",
          );
        case "failed":
          return error(
            `FAILED: the rollback did not get healthy either; the environment needs the owner on the server (the journal /srv/jadero/${serverEnv}/deploy.log)`,
          );
        case "refused":
          return error(
            "refused by the server: nothing was touched; the reason is in the last journal line (not-newer: a downgrade is a rollback)",
          );
        default:
          return error(
            "refused before the journal (deploy-entry, or bad input); see the server's message above",
          );
      }
    case "255":
      return journal.length > 0
        ? error(
            `the SSH session dropped mid-deploy; the server ignores the hangup and runs to its end state, so read the journal (/srv/jadero/${serverEnv}/deploy.log) before a rerun`,
          )
        : error(
            "SSH failed before the server answered (tailnet, host key or key line); most likely nothing ran, the journal says for sure",
          );
    default:
      return error(`unexpected exit ${code} from the server`);
  }
}

/**
 * Reads the step's environment and the journal file, prints the result line and sets the exit
 * status.
 * @param {NodeJS.ProcessEnv} env the step's environment (`CODE`, `JOURNAL`, `EVENT`, `ACTION`,
 *   `SERVER_ENV`, `SERVICE`, `VERSION`).
 * @returns {number} the exit status, also set on `process.exitCode`.
 */
export function main(env = process.env) {
  const file = env.JOURNAL ?? "";
  const result = classify({
    code: env.CODE ?? "",
    journal: file !== "" && existsSync(file) ? readFileSync(file, "utf8") : "",
    event: env.EVENT ?? "",
    action: env.ACTION ?? "",
    serverEnv: env.SERVER_ENV ?? "",
    service: env.SERVICE ?? "",
    version: env.VERSION ?? "",
  });
  process.stdout.write(`${result.message}\n`);
  process.exitCode = result.exitCode;
  return result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
