// Runs with the Node test runner (`node --test`), like the other scripts.
//
// Static checks of the backup and restore scripts (WP-8 step 6, D7): the facts they repeat from
// other files must stay equal to those files, because a drift here fails only on the night it
// matters (a restore on another Postgres image, a container name the backup no longer finds, a
// checkpoint table backed up after all). The behavior itself is checked in Docker by
// infra/scripts/backup-check.sh (`pnpm backup:check`, the `backup` job of ci.yml).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const compose = parse(read("infra/compose/compose.ops.yml"));
const backup = read("infra/scripts/backup.sh");
const restore = read("infra/scripts/restore.sh");
const check = read("infra/scripts/backup-check.sh");
const template = read("infra/env/backup.env.tpl");
const runbook = read("docs/runbooks/restore.md");

/**
 * Returns the value of a `readonly NAME=value` line, or of the default in
 * `readonly NAME="${VAR:-value}"`, and fails when the line is missing.
 * @param {string} source the script text
 * @param {string} name the constant's name
 * @returns {string} the value
 */
function constant(source, name) {
  const match = source.match(new RegExp(`^readonly ${name}=(.+)$`, "m"));
  assert.ok(match, `readonly ${name}= is missing`);
  const value = match[1].replace(/^"|"$/g, "");
  const fallback = value.match(/^\$\{[A-Z_]+:-(.+)\}$/);
  return fallback ? fallback[1] : value;
}

/**
 * Returns the words of a `readonly NAME=(a b c)` array line.
 * @param {string} source the script text
 * @param {string} name the array's name
 * @returns {string[]} the words
 */
function array(source, name) {
  const match = source.match(new RegExp(`^readonly ${name}=\\(([^)]*)\\)$`, "m"));
  assert.ok(match, `readonly ${name}=( ) is missing`);
  return match[1].trim().split(/\s+/);
}

describe("the backup scripts against compose.ops.yml", () => {
  it("restore into the ops Postgres image, digest included", () => {
    assert.equal(constant(restore, "POSTGRES_IMAGE"), compose.services.postgres.image);
  });

  it("default to the containers Compose names in the jadero-ops project", () => {
    assert.equal(compose.name, "jadero-ops");
    for (const [name, service] of [
      ["POSTGRES_CONTAINER", "postgres"],
      ["RABBITMQ_CONTAINER", "rabbitmq"],
      ["KUMA_CONTAINER", "uptime-kuma"],
    ]) {
      assert.ok(compose.services[service], `compose.ops.yml has no ${service} service`);
      assert.equal(constant(backup, name), `jadero-ops-${service}-1`);
    }
  });

  it("copy Uptime Kuma's data from its volume's mount point", () => {
    const mounts = compose.services["uptime-kuma"].volumes.map((volume) => volume.split(":")[1]);
    assert.ok(mounts.includes(constant(backup, "KUMA_DATA")));
  });
});

describe("the backup and restore scripts", () => {
  it("leave the same checkpoint tables' data out (ADR-017)", () => {
    const tables = array(backup, "EXCLUDED_TABLE_DATA");
    assert.ok(tables.length > 0);
    assert.ok(tables.every((table) => table.startsWith("checkpoints.")));
    assert.deepEqual(array(restore, "EXCLUDED_TABLE_DATA"), tables);
  });

  it("dump with restic running the command itself, never through a pipe", () => {
    const code = backup
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.match(code, /--stdin-from-command/);
    assert.doesNotMatch(code, /\|\s*restic backup/);
    assert.doesNotMatch(code, /--stdin(?![-\w])/);
  });

  it("restore only into a container with no network", () => {
    assert.match(restore, /docker run -d --name "\$container" --network none /);
  });

  it("check against images pinned by digest, on the restic release the runbook installs", () => {
    const images = [...check.matchAll(/^readonly [A-Z_]+_IMAGE=(.+)$/gm)].map((match) => match[1]);
    assert.ok(images.length >= 2);
    for (const image of images) {
      assert.match(image, /^[a-z0-9./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/, image);
    }
    const restic = images.find((image) => image.startsWith("docker.io/restic/restic:"));
    assert.ok(restic, "the check pins restic's image");
    const version = restic.split(":")[1].split("@")[0];
    assert.match(runbook, new RegExp(`^v=${version.replaceAll(".", "\\.")}$`, "m"));
  });
});

describe("infra/env/backup.env.tpl", () => {
  const assignments = template
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => line.split(/=(.*)/s));

  it("holds only 1Password references in vault jadero-ops", () => {
    assert.ok(assignments.length >= 5);
    const reference = /\{\{ op:\/\/jadero-ops\/[a-z0-9-]+\/[a-z]+ \}\}/g;
    for (const [name, value] of assignments) {
      assert.match(value, reference, name);
      // Outside the references only the repository's fixed scheme and separator are literal.
      const literal = value.replace(/^'|'$/g, "").replace(reference, "");
      assert.equal(literal, name === "RESTIC_REPOSITORY" ? "s3:https:///" : "", name);
    }
  });

  it("sets every variable backup.sh requires", () => {
    const names = assignments.map(([name]) => name);
    for (const name of [
      "RESTIC_REPOSITORY",
      "RESTIC_PASSWORD",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "BACKUP_HEARTBEAT_URL",
    ]) {
      assert.ok(names.includes(name), `${name} is not set`);
      assert.match(backup, new RegExp(`\\b${name}\\b`));
    }
  });

  it("keeps no secret reference in a comment, since op inject resolves those too", () => {
    for (const line of template.split("\n").filter((l) => l.startsWith("#"))) {
      assert.doesNotMatch(line, /\{\{|op:\/\//, line);
    }
  });

  it("names only items the runbook lists", () => {
    const items = [...template.matchAll(/op:\/\/jadero-ops\/([a-z0-9-]+)\//g)].map((m) => m[1]);
    for (const item of items) {
      assert.ok(runbook.includes(`\`${item}\``), `docs/runbooks/restore.md does not list ${item}`);
    }
  });
});
