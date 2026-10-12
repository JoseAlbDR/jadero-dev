// Runs with the Node test runner (`node --test`), like the other scripts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkComposeHardening, checkRepository, parseComposeYaml } from "./compose-hardening.mjs";

const HARDENED = `
x-hardened: &hardened
  read_only: true
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  tmpfs: ["/tmp:size=16m"]
x-migrate: &migrate
  restart: "no"
  healthcheck:
    disable: true
`;

/** A small runtime Compose file: one migrate and one server of the same image. */
const compose = (server, migrate = "") => `${HARDENED}
services:
  app-migrate:
    <<: [*hardened, *migrate]
    image: app:dev
    mem_limit: 300m${migrate}
  app:
    <<: *hardened
    image: app:dev
    restart: unless-stopped
    environment:
      NODE_OPTIONS: --max-old-space-size=225
    ports:
      - "127.0.0.1:3001:3001"
    mem_limit: 300m
    depends_on:
      app-migrate:
        condition: service_completed_successfully${server}
`;

const check = (source) => checkComposeHardening(parseComposeYaml(source), "compose.yml");

describe("the repository's compose.images.yml", () => {
  it("runs every service hardened, limited and after its migrate step", () => {
    const { services, problems } = checkRepository();
    assert.deepEqual(services, [
      "agent",
      "agent-consumer",
      "agent-migrate",
      "api",
      "api-migrate",
      "api-worker",
      "web",
    ]);
    assert.deepEqual(problems, []);
  });
});

describe("checkComposeHardening", () => {
  it("accepts services that carry the anchor, a limit and the migrate dependency", () => {
    assert.deepEqual(check(compose("")), []);
  });

  it("fails when an explicit key overrides the anchor", () => {
    assert.deepEqual(check(compose("\n    read_only: false")), [
      "compose.yml: app must set read_only: true",
    ]);
  });

  it("fails when a service's own tmpfs list drops /tmp (the merge is shallow)", () => {
    assert.deepEqual(check(compose('\n    tmpfs: ["/cache:size=64m"]')), [
      "compose.yml: app must mount a size-capped tmpfs on /tmp",
    ]);
  });

  it("fails when a service lacks the anchor entirely", () => {
    const source = `${HARDENED}
services:
  bare:
    image: bare:dev
    restart: unless-stopped
    mem_limit: 128m
    environment:
      NODE_OPTIONS: --max-old-space-size=96
`;
    assert.deepEqual(check(source), [
      "compose.yml: bare must set read_only: true",
      "compose.yml: bare must drop every capability (cap_drop: [ALL])",
      "compose.yml: bare must set security_opt no-new-privileges:true",
      "compose.yml: bare must mount a size-capped tmpfs on /tmp",
    ]);
  });

  it("fails on a missing memory limit, a heap far from 75% and a port open to every interface", () => {
    const source = compose("")
      .replace("    mem_limit: 300m\n    depends_on", "    depends_on")
      .replace('"127.0.0.1:3001:3001"', '"3001:3001"');
    assert.deepEqual(check(source), [
      "compose.yml: app must set mem_limit (ADR-027)",
      "compose.yml: app publishes 3001:3001: bind it to 127.0.0.1 (ADR-027)",
    ]);
    const greedy = compose("").replace("=225", "=290");
    assert.deepEqual(check(greedy), [
      "compose.yml: app must set NODE_OPTIONS --max-old-space-size to about 75% of mem_limit",
    ]);
  });

  it("fails when a server can start before its migrate step completed", () => {
    const source = compose("").replace("service_completed_successfully", "service_started");
    assert.deepEqual(check(source), [
      "compose.yml: app must depend on app-migrate with condition: service_completed_successfully",
    ]);
  });

  it("fails when a migrate service restarts or keeps the image healthcheck", () => {
    const source = compose("").replace("<<: [*hardened, *migrate]", "<<: *hardened");
    const problems = check(source);
    assert.ok(
      problems.includes(
        'compose.yml: app-migrate is a one-off: set restart: "no" and disable its healthcheck',
      ),
    );
  });
});
