---
wp: 9
decision: recorded
adr: [ADR-053, ADR-049, ADR-043, ADR-051, ADR-029, ADR-005, ADR-047]
---

# WP-9: Deploy pipeline to new.jadero.dev

Issue #17, branch `wp/9-deploy-pipeline`, release R0, size M, tag learning. Depends on WP-7 (images and release) and WP-8 (the server), both done. Closes R0: its exit criterion is "an event crosses the broker on new.jadero.dev; CI, images and deploy work end to end".

Deliverable (report section 14, decisions.json, issue #17): `deploy(env, service, version)` over Tailscale, per-service migrations, a health-gated rollout and rollback, the RabbitMQ topology deploy and smoke tests. Milestone: the walking skeleton live, with an event crossing the broker in production. Second pass (D-7 d): the deploy script renders each service's `.env` with `op inject` from `infra/env/<service>.env.tpl` (only `op://` references) right before `docker compose up`; a deploy fails cleanly while 1Password is unreachable, and running services are unaffected. Carried over from WP-8: the anti-rollback guard, the credential rotation ordering, one env file per environment, the `tag:ci` grant in the Tailscale policy, replacing the test deploy key, the restore drill again with real tables, the `nginx` and `backup` checks as required checks, and the D-31 external uptime check. The HSTS raise (#141, not before 2026-10-25) is listed with the steps but stays its own `chore/` PR.

What the owner learns (decisions.json): deployment as a state machine, expand/contract for schemas and messages.

**ADRs in the front matter.** The brief named ADR-048; it is superseded. ADR-049 is the live text: it restates ADR-048's per-service pipeline, `deploy.yml`, the deploy mechanics (SSH over Tailscale with a forced command), the deploy script steps and the downtime rule, changes the registry login to the deploy job's own token, and moves the staging deploy after release into WP-9. ADR-043 carries the secrets rule (1Password, `op inject`, restating D-7 d). ADR-051 restates the hosting layout (Compose projects `jadero-prod` and `jadero-staging`, health and restarts, monitoring with the external check of D-31, staging after cutover of D-30). ADR-029 gives expand/contract for messages and the topology rules, ADR-005 the one-off migrate step before the service, ADR-047 the edge that closes health routes.

**What you already know, and what is new.** The one-off migrate step and expand-only migrations come from WP-10 (D2, D3); readiness, the image `HEALTHCHECK` and Compose `--wait` from WP-3 and WP-7 (D5); build once and promote, and the job token for GHCR, from WP-7 (D7); versioned events, contract tests and expand/contract for messages from WP-5 and WP-6 (D6); SSH over Tailscale, the forced command and the secrets token from WP-8 (D2, D3, D5); convergent provisioning, the additive RabbitMQ import, rotation against a pool and the anti-rollback finding from WP-8's step log. This file spends its words on what is new: a deploy as a sequence of states that each can fail, what may change before the point of no return and what must be undone after it, which side of a contract moves first, and how the same bytes travel from staging to production.

**What checking the repo and the tools found (2026-10-18).** Each fact is used below; sources in Facts checked.
1. GHCR holds `jadero-dev-api` and `jadero-dev-agent` at 0.2.0 (`sha-0b68419`, pushed 2026-10-18) and `jadero-dev-web` at 0.1.0 (`sha-f9bdedb`), all private. The tag `api-v0.2.0` points at `0b68419`, the commit `release.yml` builds and writes into the image's `org.opencontainers.image.revision` label.
2. release-please gives a commit to a component by the paths it touches. `infra/` belongs to no component, so a change only to a Compose file or an env template releases nothing and therefore deploys nothing (Q1).
3. The topology's source is `packages/messaging/src/topology`, which is a release component; the `node-workspace` plugin releases `api` and `agent` whenever `messaging` releases. Every topology change therefore arrives together with an `api` and an `agent` release (Q2).
4. `api-worker` sends one `system.ping.v1` when it boots, then one every `HEARTBEAT_INTERVAL_MS` (default 5 minutes). `agent`'s consumer stores the event's own `time` as `last_seen_at` in `heartbeat.broker_heartbeat`. `POST /dev/ping` exists only with `NODE_ENV=development`. So the smoke test can rely on the boot ping after an `api` deploy, and on the next heartbeat after an `agent` deploy (D7).
5. The edge answers 404 on `/api/health/*` (WP-8 D6, ADR-047), so ADR-026's smoke line "`/api/health`" is checked on `127.0.0.1`, never through nginx. There is no maintenance page on 502 yet, though ADR-049 (restating ADR-026 "Downtime") names one.
6. Tailscale's GitHub Action v4.2.0 supports workload identity federation: the runner proves who it is with GitHub's OIDC token, so no Tailscale secret is stored in GitHub. Its nodes are ephemeral and must carry a tag.
7. On GitHub Free, a public repository has environments with required reviewers and environment secrets. A job cannot read an environment's secrets until a reviewer approves it. Self-review is allowed unless "prevent self-reviews" is turned on, so the owner can approve their own production deploy.
8. A `GITHUB_TOKEN` expires when its job ends, at most 6 hours on GitHub-hosted runners: safe to hand to the server for one pull.
9. `op inject` accepts variables inside references (`op://$env/db/password` in 1Password's example) and writes its output with mode 0600 by default. What it leaves on disk after a failure is not documented.
10. `rabbitmqctl import_definitions` reads a file or standard input, and its own output says the import "is asynchronous and can take some time": a deploy must wait until the queues are listed before starting a consumer.
11. Docker Compose 5.6.0: `up --wait` waits for healthy, `--wait-timeout` bounds it, `--no-deps` leaves other services alone.
12. `protect-main` is the only ruleset: a release tag can be moved or deleted by anyone with push rights (Q1 B relies on tags that do not move).

## Decisions explained

### D1. Why is a deploy a state machine with recorded state, and not a list of commands?

**Problem.** A deploy is about ten steps across five systems (GitHub, 1Password, GHCR, Postgres, Docker). Any step can fail, and the runner can disappear half way: a cancelled job or a dropped SSH session. A plain list of commands under `set -e` stops at the failure and leaves behind whatever it had done: a new env file next to an old container, a migrated schema, and no record of which version runs. The next deploy starts from a state nobody wrote down.

**Example.** `deploy staging api 0.3.0`. Migrate succeeds, `up` recreates `api`, and while the script waits for health the owner cancels the GitHub job. sshd closes the session and sends SIGHUP to the script, which dies. Is `api` 0.3.0 healthy? Unknown. `versions.env` still says 0.2.0. The next run cannot tell whether to roll back, retry or do nothing.

**Decision (ADR-049, restating ADR-048's deploy script steps; the anti-rollback guard from WP-8).** `deploy.sh` runs the deploy as a finite state machine: named states, allowed transitions, and a journal line written before each transition, in files only root writes. One deploy per environment at a time (a lock), and SIGHUP is ignored, so a lost session never stops it half way. The states split into two zones:
- **Before `provisioned`** nothing shared has changed (files are fetched and rendered under new names, the image is only pulled). Any failure is `aborted`: remove the temporary files and exit; the running services never noticed.
- **From `provisioned` on** the shared world has moved (a role password re-set, a migration applied, a container recreated). Any failure takes the `rolling_back` transition: the previous image, the newest env file, the previous release's files, and the health gate again. If that fails too, the state is `failed`: stop, exit non-zero, alert. Never a retry loop.

```mermaid
stateDiagram-v2
  [*] --> checked: lock taken, words valid, version newer than current
  checked --> fetched: release files for this version on disk
  fetched --> rendered: op inject into service.env.new
  rendered --> pulled: image by tag, digest and revision checked
  pulled --> provisioned: topology applied, this service's roles and user converged
  provisioned --> migrated: one-off migrate exits 0
  migrated --> started: env file swapped, up --wait healthy
  started --> verified: smoke passes
  verified --> recorded: versions.env and previous.env written
  recorded --> [*]
  checked --> aborted: any failure before provisioned
  rendered --> aborted
  pulled --> aborted
  provisioned --> rolling_back: any failure from here on
  migrated --> rolling_back
  started --> rolling_back
  rolling_back --> rolled_back: previous image healthy
  rolling_back --> failed: previous image unhealthy too
  aborted --> [*]
  rolled_back --> [*]
  failed --> [*]
```

`provisioned` is the **point of no return**: the first transition that changes something other services share. Everything before it is preparation that can be thrown away. This is the same shape as the publish state machine of WP-12 (a state, transitions with guards, nothing else allowed), applied to an operation instead of a record.

**Alternatives.**
- *A plain script with `set -e`.* Discarded: it stops at the error but neither undoes nor records. Wins for a one-off task that touches one thing.
- *A deploy tool (Kamal, Capistrano) or configuration management (Ansible).* Discarded: a new tool, with its own model and proxy, for three services on one host whose steps we already know. Wins when several apps and hosts must share one way to deploy.
- *An orchestrator (Kubernetes, Docker Swarm)*, where the controller is the state machine: desired state, rollout history, `rollout undo`. Discarded: a control plane on an 8 GB box, and ADR-049 accepts seconds of downtime. Wins with several nodes, rolling updates and self-healing needs.
- *A pull agent on the server (Watchtower for Compose, Argo CD or Flux for Kubernetes).* Discarded in ADR-026, restated by ADR-049: weaker control over migrations and rollback. Wins with many servers.

**Patterns:** finite state machine with explicit transitions, write-ahead journal (record, then act), point of no return, compensating action (rollback), mutual exclusion (one deploy per environment), fail safe, idempotent re-run.

### D2. How does CI get in, and why does each environment get its own key?

**Recap (WP-8 D2 and D3, ADR-049 deploy mechanics B).** SSH reaches the server only over Tailscale; the Cloud Firewall drops everything but 80 and 443. The `deploy` user's key runs one forced command, `deploy-entry`, which accepts exactly `deploy <env> <service> <version>` (allowlists, strict semver, ASCII only) and calls `sudo` on one root script that checks the words again.

**What is new here: the runner.**
- **A tagged, ephemeral node.** The Tailscale GitHub Action joins the tailnet as a node tagged `tag:ci`, removed when the job ends. It authenticates with workload identity federation: GitHub issues the job an OIDC token whose subject names the repository and the environment (`repo:JoseAlbDR/jadero-dev:environment:staging`), and Tailscale exchanges it for a node key. No Tailscale secret is stored in GitHub.
- **A grant to one port.** The Tailscale policy (WP-8 step 2b) gains `tag:ci` to `tag:server` on `tcp:<ssh-port>` only, with a test that denies every other port. The runner reaches sshd and nothing else.
- **One key per environment.** Each GitHub environment holds its own `DEPLOY_SSH_KEY`. On the server each key line forces `deploy-entry staging` or `deploy-entry prod`, and `deploy-entry` refuses a command whose environment word differs from its argument. Production's key is readable only after the owner approves the job (fact 7).
- **The server's host key is pinned** in the workflow (`known_hosts` from an environment variable, `StrictHostKeyChecking=yes`): the runner sends its key and the registry token only to our server.
- **The registry token travels on standard input**, never in the command line, which `deploy-entry` logs and limits to letters, digits, dots and hyphens.

**Example.** The staging key leaks and the attacker is also on the tailnet. They send `deploy prod api 0.3.0`. sshd runs `deploy-entry staging`; the words name `prod`; the journal shows `refused reason=env-mismatch`, exit 1. Production was never reachable with that key.

**Alternatives.**
- *One key for both environments* (the WP-8 test setup). Discarded: a leak from the automatic staging job reaches production. Wins with one environment.
- *A Tailscale OAuth client secret or auth key in GitHub secrets.* Discarded as the default: a long-lived secret to store and rotate, where federation needs none. Wins if federation is not offered on the owner's plan (**verify**); then it is the fallback.
- *Tailscale SSH for the runner.* Discarded in WP-8 D2: it does not read `authorized_keys`, so there is no forced command.
- *A self-hosted runner on the server.* Discarded: every workflow's code would run on the production host. Wins for an isolated network with no inbound path at all.

**Patterns:** workload identity federation (short-lived credentials from an identity provider instead of stored secrets), least privilege per environment (blast radius), capability-scoped credential, host key pinning, secrets out of argv.

### D3. Why can `deploy` only move forward, and is rollback its own command?

**Problem (WP-8 step 3 check question).** The allowlists check the form of the words, not their meaning. A stolen key with tailnet access can deploy a valid old release with a known flaw: a downgrade attack.

**Example.** Production runs `api` 0.3.0. `deploy prod api 0.1.0` passes every allowlist, and 0.1.0 also meets a schema two releases newer than the code (D5).

**Decision (recorded as a WP-9 requirement in WP-8's implementation choices).** `deploy.sh` reads the current version from `versions.env`, on the side the client does not control, and refuses a version that is not strictly newer by semver precedence (`0.10.0` is newer than `0.9.0`; `1.0.0-rc.1` is older than `1.0.0`): `refused reason=not-newer`. Going back is a separate verb, `rollback <env> <service>`, which takes no version: it returns to the one recorded in `previous.env`, once (a second rollback finds nothing older and refuses). A failed deploy never becomes current, so retrying the same new version works. Re-running the current version with fresh secrets is a third verb, `redeploy`, available from the owner's root shell only (D4, rotation).

**Alternatives.**
- *Accept any version that exists in the registry.* Discarded: that is exactly what a downgrade uses. Wins nowhere where the key leaves your hands.
- *A floor of known-bad versions (a deny list).* Discarded: someone must maintain it, and it fails open for the version nobody listed. Wins for fleets of devices (verified boot's rollback index, TUF's version counters), where the vendor owns the list.
- *Rollback to any named version, behind approval.* Discarded for now: the rollback target is the one release before, which D5's compatibility rule covers. Wins when operations need to go back several releases, as its own approved workflow.

**Patterns:** anti-rollback (downgrade protection, a monotonic version), state checks on the trusted side, a separate verb for a dangerous operation.

### D4. Why are secrets rendered right before `up`, into a new file, and why can a 1Password outage not touch running services?

**Recap (WP-8 D5, ADR-043, D-7 d).** Templates in `infra/env/` hold only `op://` references. The service-account token lives in `/etc/jadero/op-token`, root, mode 600, read only by root's `op inject`. Rotation is change the item in 1Password, then deploy.

**Problem.** The secret store is a remote service that will sometimes be down, rate-limited (ADR-007: 1,000 reads per hour per token) or misconfigured. If rendering can break a running service, an outage at 1Password becomes an outage of the site.

**Decision.** Rendering sits in the state machine where it can only abort:
- **Before anything changes.** `rendered` comes after `fetched` and before `pulled`. `op inject` writes `<service>.env.new` (0600); the step passes only when `op` exits 0 and no `{{` is left in the file. The running containers read their env file once, at start, so they never see the new one until `started` swaps it in with a rename (atomic on one filesystem). Whatever `op` leaves on disk after a failure (fact 9) is a `.new` file that gets deleted.
- **A rollback needs nothing remote.** The previous image is still on disk and so is the env file, so `rolling_back` works with 1Password, GitHub and GHCR all down (static stability).
- **Scoped per service and environment** (the WP-8 carry-over "one env file per environment"). One template per service (`infra/env/api.env.tpl`), rendered with `JADERO_ENV=staging` inside the references (`op://jadero-ops/postgres-content-$JADERO_ENV/password`) into `/srv/jadero/staging/api.env`. `api`'s file holds only `api`'s staging secrets; `ops.env`, which holds both environments, is never read by a service. The items are the ones `ops.env.tpl` already reads, so a rotation still changes one item.
- **Rotation ordering** (WP-8 step 4a). Postgres checks a password only when a connection opens, and a service reads its env file only at boot. So a deploy re-sets only the deployed service's roles (`provision.sql` gains a `service` variable; today it sets every role of the environment) and recreates that service in the same run. A deploy of `api` can never re-password `agent`'s role behind `agent`'s back.
- **Configuration is a contract too.** A release never removes or renames a variable the previous release reads: add the new one first, remove the old one a release later. That is what lets `rolling_back` start the previous image with the newest env file (expand/contract for configuration).

**Example.** 1Password has an incident during `deploy staging agent 0.3.0`. `op inject` exits non-zero; the journal says `staging agent 0.3.0 aborted at rendered: op exit 1`; the `.new` file is removed; `agent` 0.2.0 keeps consuming pings; the GitHub job is red. Rerun when 1Password is back.

**Alternatives.**
- *Render at container start (`op run -- node dist/main.js`).* Discarded: every restart, including Docker's own after a crash, would depend on 1Password, and the token would live inside the container. Wins when a platform syncs secrets on its own loop (Kubernetes with an external secrets operator), so a restart reads a local copy.
- *A timer that re-renders on a schedule.* Discarded: the password would change while the consumers keep the old one (the rotation trap). Wins with an operator that also restarts the consumers on change.
- *Render once by hand and keep the files* (WP-8's `ops.env`). Discarded for services: rotation would be a manual step again. Wins for infrastructure that changes a few times a year.
- *A local secrets cache (1Password Connect, Vault Agent).* Discarded: another service to run for one box. Wins with many consumers.

**Patterns:** validate before you act, atomic file swap (write new, rename), static stability (the recovery path depends on nothing remote), least privilege scoping, rotation ordering, expand/contract for configuration.

### D5. Why do migrations run before the new code, expand-only, and why does a rollback never run a down migration?

**Recap (WP-10 D2 and D3, ADR-005).** Each service applies only its own migrations, to its own database, in a one-off container from its own image (`node dist/migrate.js`); exit 0 gates the start. Migrations are expand-only in the release that needs them; the contract step ships later; there are no down migrations.

**What is new here: the timeline, and which release must tolerate which schema.** In the state machine, `migrated` comes after `provisioned` and before `started`. From that moment the schema is ahead of the code still running, for a few seconds during the recreate and for as long as a rollback lasts. So every schema must work with two releases at once: the one being deployed and the one before it (N-1 compatibility). D3 makes "the one before it" exact: a rollback goes back one release, never more. Drizzle applies the pending migrations in one transaction (WP-10 D2), so a failed migrate leaves the schema as it was; the deploy still takes `rolling_back`, which here just restarts the version already running.

**Example.** `api` adds a required `summary` to projects, in three releases:

| Release | Migration | Code | Rollback goes to, and why it works |
|---|---|---|---|
| 0.3.0 (expand) | `ALTER TABLE content.projects ADD COLUMN summary text;` (nullable) | writes `summary`, reads it with a fallback | 0.2.0, which ignores the extra column |
| 0.4.0 (migrate the data) | `UPDATE content.projects SET summary = left(body, 200) WHERE summary IS NULL;` | reads `summary` only | 0.3.0, which already writes `summary` |
| 0.5.0 (contract) | `ALTER TABLE content.projects ALTER COLUMN summary SET NOT NULL;` | unchanged | 0.4.0, which writes `summary` on every insert |

Squeeze it into one release (`ADD COLUMN summary text NOT NULL`, code reads only `summary`) and the deploy itself works, but the rollback target 0.2.0 never writes `summary`, so every project it inserts fails; with `DEFAULT ''` its inserts pass and the new code later shows empty summaries it trusts. The contract step is safe exactly when the release before it, the rollback target, no longer needs the old shape.

**Alternatives.**
- *Down migrations on rollback.* Discarded in WP-10: they drop the data written since, and nobody tests them. Wins when schema changes are rare and big, in a maintenance window.
- *Code first, schema after (code that tolerates a missing column, a DBA migrates later).* Discarded: conditionals in code for every change. Wins when migrations are run by another team on its own schedule.
- *Restore the database as the rollback.* Discarded: loses every write since the backup. Wins only when the data itself is destroyed (WP-8 D7).

**Patterns:** expand/contract (parallel change), N-1 compatibility, backward-compatible migration, roll forward, deploy gate.

### D6. Why do consumers deploy before producers, and the topology before both?

**Recap (WP-5, WP-6 D6, ADR-029 rule 4).** Events are typed `<context>.<event>.v<N>`. Within a version only an optional field may be added; a breaking change is a new version published next to the old one until every consumer moved. Every consumer parses the producer's fixtures with its own schema in `pnpm verify`.

**What is new here: the order of deploys, and the broker as a third party.** Messages wait in queues, for seconds or for days when a consumer is down, so an old consumer meets new messages and a new consumer meets old ones. The side that must tolerate the new shape deploys first:
- **Messages: consumer first.** It must accept the new version before anyone sends it.
- **HTTP: provider first.** `api` adds a response field before `web` reads it. Same rule, other direction: the tolerant side moves first.
- **Topology before both.** Services have no `configure` permission on the broker (WP-5 T4), so a queue or binding must exist before its consumer starts, and the broker must route a new routing key before the producer sends it. The import is additive (WP-8 step 4b): it creates and updates, never deletes. A queue's arguments cannot change in place (RabbitMQ refuses a redeclare with different arguments), so a changed queue is a new queue name: expand/contract for topology. Removing a queue, binding or user is the deliberate contract step of "Retiring a consumer" (`infra/compose/README.md`).

**Example: `system.ping.v2` adds a required `region`.**

```mermaid
flowchart LR
  T["messaging 0.3.0: bind system.ping.v2 to agent.system.ping (additive)"] --> C["agent 0.3.0: accepts v1 and v2"]
  C --> P["api 0.4.0: emits v2 only"]
  P --> R["later: agent 0.4.0 drops v1, then the v1 binding is retired by hand"]
```

The other order fails in two ways. `api` 0.4.0 first, before the binding exists: its v2 messages match no binding and land in `jadero.unrouted` (WP-5 C3), and the agent never sees them. Binding in place but `agent` 0.2.0 still running: each v2 message fails the v1 contract, a permanent failure, so it is dead-lettered at once without retries, and the producer never notices (the study backlog's tolerant-reader line). In one release run that ships `messaging`, `api` and `agent` together (fact 3), the workflow deploys `agent`, then `api`, then `web`, which is consumer first for the ping and provider first for `web`'s HTTP reads.

**Alternatives.**
- *Deploy every service together, in lockstep.* Discarded: services that cannot ship alone are a distributed monolith (ADR-029's smell list). Wins in a monolith, where one deploy owns both sides.
- *A schema registry with enforced compatibility modes (Confluent Schema Registry).* Discarded: one producer team; the contract tests already check compatibility in CI. Wins with many teams publishing to shared topics.
- *Upcasting: the consumer converts old events to the new shape on read.* Not needed while events live minutes in a queue. Wins for an event store kept for years.

**Patterns:** expand/contract for messages, consumer-first rollout, provider-first for HTTP, tolerant reader, additive infrastructure change, distributed monolith (anti-pattern).

### D7. Why do the health gate and the smoke checks decide, and what is checked where?

**Recap (WP-7 D5, WP-12 step 7b).** Each image's `HEALTHCHECK` asks its own `/health/ready`; Docker only marks a container unhealthy, it never restarts it for that; `up --wait` waits for healthy. Readiness must check every dependency a request needs, or a broken one passes the deploy.

**Problem.** "Healthy" says the process is up and can reach its own dependencies. It does not say the edge routes to it, that the page renders in three locales, or that an event still crosses the broker.

**Decision (ADR-049, restating ADR-026: "smoke test, on failure re-pin the previous version and alert").**
- **Health gate:** `docker compose up -d --wait --wait-timeout 120 --no-deps <process types>`; non-zero when any of them is not healthy in time.
- **Smoke, after healthy, from outside the containers:** `/health/ready` on `127.0.0.1` (the edge 404s it on purpose, fact 5); through the edge for staging, `https://new.jadero.dev/<locale>/` for `es`, `en`, `de` and `/api/v1/content/en/projects` (proves nginx, TLS and routing); production has no public host until the cutover (WP-29), so its page checks use `127.0.0.1`; and the **broker path**: a ping emitted after the deploy started has reached `agent`'s `heartbeat.broker_heartbeat` (fact 4).
- **A check gates only the services on its path.** The ping gates `api` and `agent` deploys, not `web`; the pages gate `web` and `api`. Rolling back a good `web` because RabbitMQ is in a memory alarm fixes nothing and hides the real failure.
- **Downtime:** the recreate costs seconds of 502, accepted by ADR-049; nginx serves a static maintenance page meanwhile (added in step 4, fact 5).

**Example.** `api` 0.3.0 has a relay bug: it marks outbox rows sent without publishing. `api-worker` is healthy (Postgres and RabbitMQ both answer), the pages render, but `last_seen_at` never moves past the deploy start. The ping check fails after its wait, the state goes `rolling_back`, `api` 0.2.0 comes back, and its boot ping arrives within seconds.

**Alternatives.**
- *Health gate only.* Discarded: the relay bug above passes it. Wins for a service with no downstream path.
- *Every check gates every deploy.* Discarded: a failure elsewhere rolls back an innocent release. Wins when one deploy unit owns the whole path.
- *Watch metrics for minutes after the deploy (canary analysis).* Discarded: a few requests a day give no signal. Wins with real traffic and error-rate metrics.

**Patterns:** deploy gate, synthetic transaction (smoke test), end-to-end probe, blast radius of a check, liveness versus readiness (recalled).

### D8. Why does staging deploy by itself and production wait for an approval, with the same image?

**Recap (WP-7 D7).** One image per service, built once, promoted through every environment; the version tag for people and `versions.env`, `sha-<short>` for tracing; tags are movable pointers, the digest is not. WP-7 left a note for WP-9: record the digest next to the version.

**Decision (ADR-049, D-30).**
- **`release.yml` calls `deploy.yml`** (a reusable workflow) after the images job, because events made with the job's `GITHUB_TOKEN` start no other workflow (WP-7 fact 6): a separate workflow waiting for the release would never run.
- **Staging is automatic, production waits.** `deploy-staging` (environment `staging`) runs for each released service, in the order `agent`, `api`, `web` (D6). `deploy-production` (environment `production`, the owner as required reviewer, `main` only) needs staging's success and pauses until approved; its key exists for the job only after the approval.
- **Promotion by digest.** Staging records `API_IMAGE=ghcr.io/josealbdr/jadero-dev-api@sha256:<d>`; the production job hands that digest to the server, which refuses an image whose digest differs. The bytes production runs are the bytes staging tested.
- **One deploy per environment at a time** (`concurrency: deploy-<env>`), never cancelled in progress: a cancelled deploy is the worst state D1 handles.

```mermaid
flowchart LR
  M[Release PR merged] --> RP[release-please tags api-v0.3.0]
  RP --> I[images: build, smoke, scan, push, attest]
  I --> S[deploy-staging: agent, api, web]
  S --> A{owner approves production}
  A -->|approved| P[deploy-production: same digests]
  A -->|not approved| W[staging ahead, production unchanged]
```

**Alternatives.**
- *Continuous deployment to production, no gate.* Discarded for now: one owner, a public site, and the gate costs one click. Wins with many deploys a day and checks you trust more than a person.
- *Manual deploys only (`workflow_dispatch`).* Discarded: staging would lag behind releases. Wins when releases are rare and each one is an event.
- *Promote by tag.* Discarded: a tag can move between the staging and the production pull. Wins nowhere when the digest is free to record.

**Patterns:** deployment pipeline with promotion, build once deploy many, manual approval gate, immutable reference (digest), serialized deploys per environment.

### D9. Who tells you the whole box is down?

**Recap (WP-8 D8, D-31, ADR-051 restating ADR-027 "Monitoring").** Uptime Kuma watches every health endpoint and the backup heartbeat, but it runs on the same box, so it cannot report the box, or itself, being down.

**What is new here.** WP-9 adds the external check D-31 decided: one free hosted HTTP monitor, outside Hetzner, on `https://new.jadero.dev/` (later `https://jadero.dev/`) and on `https://status.jadero.dev/status/jadero`, Uptime Kuma's own public page, so Kuma's death is seen too. It alerts by email and is written into `docs/runbooks/deploy.md` with what it can and cannot see: it never reaches the `127.0.0.1` health endpoints or the broker; that stays Kuma's job.

**Patterns:** independent failure domains for monitoring, watching the watcher, probe from outside.

## Open questions

Two choices no ADR decides. Q2 depends on Q1.

### Q1. Where do the deploy-time files come from on the server?

**What you need to know first.** Besides the image, a deploy reads files: the services' Compose files, the env templates, the RabbitMQ definitions with `provision-users.sh` and `permissions.tsv`, `provision.sql`, and the smoke script. Root runs them, and a Compose file decides mounts and privileges: a line `volumes: ["/:/host"]` gives its container the whole host. So whoever writes the Compose file that root runs controls the server. Today (WP-8) these files come from the owner's git checkout on the server, synced by hand; `deploy.sh` and `deploy-entry` are copied into `/srv/jadero/bin` by hand.

Facts: `infra/` belongs to no release component, so a change there alone releases and deploys nothing (fact 2). A release tag such as `api-v0.3.0` points at the commit the image was built from, and the image's revision label says which (fact 1). The repository is public, so the server can fetch it over HTTPS without a credential. No ruleset protects tags today (fact 12).

**Options.**
- *A. The owner's checkout, synced by hand before a deploy.* Pros: nothing new; the owner sees every change land on the box. Cons: drift between an image and its files: `api` 0.3.0 needs a new variable, the checkout is older, the boot fails, the deploy rolls back (fail safe, but every automatic staging deploy fails until the owner syncs); a rollback runs today's files with yesterday's image. Wins when the files change rarely and an operator is always at hand.
- *B. Fetched at the release tag.* `deploy.sh` fetches `infra/` from the public repository at the tag of the version being deployed, checks that the tag's commit equals the image's revision label, and keeps the files per release on disk (current and previous). Pros: the image and its deploy files come from one reviewed commit; a rollback uses the previous release's own files, already on disk; nothing to sync by hand. Cons: root runs files fetched from GitHub, so the trust anchor becomes the protected `main` branch plus release tags that cannot move (a tag ruleset, a manual action); a deploy needs GitHub reachable (it already needs GHCR); an `infra/`-only change does nothing until the service releases, closed by listing a hash of each service's deploy files in its `release-inputs.txt`, the mechanism ADR-049 already uses for dependencies. `deploy.sh` and `deploy-entry` stay owner-installed: the code that does the checks must not update itself from what it checks.
- *C. Sent by CI with the deploy* (a tarball on the SSH session's input). Pros: no fetch on the server. Cons: whoever holds the deploy key supplies the files root runs, so a stolen key sends a Compose file that mounts `/`, which undoes WP-8 D3. Wins only with a trusted deployer inside the boundary (the GitOps pull model).
- *D. Baked into each image* (the image carries its Compose fragment and template, read with `docker create` and `docker cp` before it runs). Pros: one signed artifact covers code and deploy files. Cons: the topology and the Compose project span several images; an image describing its own privileges is circular; a memory limit change needs a rebuild. Wins with packaged deploy manifests published next to the images (Helm charts as OCI artifacts).

**Patterns:** configuration versioned with the artifact, single source of truth, trust anchor, root of trust (what may update itself), environment drift.

Question: **which option, and what is the trust anchor in it?**

### Q2. Who applies the RabbitMQ topology before a service needs it?

**What you need to know first.** Services cannot declare queues (WP-5 T4), so a queue must exist before its consumer starts, or the consumer's readiness fails and the deploy rolls back. RabbitMQ imports `infra/rabbitmq/server/definitions/<env>.json` only when the broker boots; a live import is `rabbitmqctl import_definitions`, additive, and asynchronous (fact 10), so the deploy waits until the queues are listed. Every topology change comes with an `api` and an `agent` release (fact 3). ADR-049, restating ADR-048, says: "The RabbitMQ topology is deployed from `definitions.json` by an `infra` deploy job before any service that needs a new queue."

**Options.**
- *A. Its own target, first in the run.* `deploy <env> topology <messaging-version>` imports the definitions from the `messaging` tag and converges the users; the workflow runs it before the service jobs whenever `messaging` released. Pros: matches ADR-049's wording; the topology has its own version line in `versions.env`; one place to look. Cons: the order lives in the workflow, so a manual `agent` deploy can skip it (it fails safe at readiness and rolls back); one more target in `deploy-entry`'s allowlist, with its own anti-rollback line.
- *B. Each `api` and `agent` deploy imports the definitions of its own release*, in `provisioned`, before migrate. Pros: the service that needs a queue brings the file that declares it, so the order holds however the deploy is started (by construction); one verb. Cons: departs from ADR-049's "infra deploy job" (a superseding ADR line); an older release re-imports older definitions, harmless only because the import never deletes and queue arguments never change in place, which becomes a written rule with a test.
- *C. Services declare their own queues at boot* (give them `configure`). Pros: no separate step. Cons: undoes WP-5 T4 (a compromised service could reshape the broker) and lets two services race to declare one queue with different arguments. Wins for one team whose service owns its whole vhost.

**Patterns:** additive (expand-only) infrastructure change, ordering by construction versus ordering by orchestration, least privilege.

Question: **A, B or C, and why?**

### Recommendations

Read after answering.

- **Q1: B.** One reviewed commit for the image and its files removes the drift class entirely, and the rollback gets the files that belong to it. The trust anchor is `main`'s protection plus a tag ruleset (`*-v*`: no update, no deletion), checked on every deploy by comparing the tag's commit with the image's revision label; `deploy.sh` and `deploy-entry` stay installed by hand as the root of trust. Written as a short ADR in step 1. If you pick A, record the checkout's commit in each journal line and in `versions.env`, so a rollback at least says which files it ran.
- **Q2, if Q1 is B (or D): B**, with the superseding line in the same short ADR, the rule "queue arguments never change in place; a changed queue is a new name" checked by a test on the generator, and the journal naming the release whose definitions were imported. Ordering by construction beats ordering by a workflow that a manual run can bypass.
- **Q2, if Q1 is A: A.** With a hand-synced checkout the definitions are whatever the owner pulled, so a separate, visible topology step with its own version line is clearer than an import hidden inside every service deploy.

## Implementation choices

What WP-9 builds, assuming the recommendations. Object to any line.

**Environments and templates (step 2)**
- Compose: one `infra/compose/compose.services.yml` with WP-7's hardening anchors and every process type, plus `compose.staging.yml` and `compose.prod.yml` holding only the project name, the published ports and the network: projects `jadero-staging` and `jadero-prod` (ADR-051), and the two environments cannot drift apart.
- Images run by digest from `versions.env` (`API_IMAGE=ghcr.io/josealbdr/jadero-dev-api@sha256:...`), never by tag.
- Ports on `127.0.0.1`: staging `web` 3120 and `api` 3121 (what nginx already proxies), production `web` 3110 and `api` 3111, no public host for production until WP-29; workers and `agent` publish nothing (Uptime Kuma reads them on the environment networks).
- Each project joins only its own network, as `external` (`jadero_staging`, `jadero_prod`), and reaches `postgres` and `rabbitmq` by name.
- Templates `infra/env/api.env.tpl`, `agent.env.tpl`, `web.env.tpl`: `op://jadero-ops/<item>-$JADERO_ENV/password` references, plain values for the rest (`NODE_ENV=production`, `LOG_LEVEL=info`, fake AI providers), rendered to `/srv/jadero/<env>/<service>.env`, root, 600.
- `OTEL_TRACES_EXPORTER=none` on the servers until a collector runs there (ADR-010 names `otlp`; nothing listens yet).
- `HEARTBEAT_INTERVAL_MS=60000` on the servers: an `agent` deploy's smoke waits at most a minute; 1,440 pings a day, the inbox keeps 30 days (about 43,000 rows).
- `scripts/compose-hardening.test.mjs` covers the services files (digest pins, limits, `127.0.0.1` binds, external networks, no published worker port); ADR-027's memory rows are unchanged (same processes).
- Each service's `release-inputs.txt` also lists a content hash of its deploy files, so a change to them releases the service (Q1 B).
- Step 2 is a candidate for `known` (Compose files in the WP-7 shape): your call.

**`deploy.sh` (step 3)**
- Verbs: `deploy <env> <service> <version>` and `rollback <env> <service>` through `deploy-entry`; `redeploy <env> <service>` (same version, fresh secrets) only from the owner's root shell.
- `deploy-entry` takes the environment from its key line (`command="/srv/jadero/bin/deploy-entry staging"`) and refuses another.
- State in `/srv/jadero/<env>/`: `versions.env` (current, the environment's release manifest of ADR-025), `previous.env` (the last good one before it), `deploy.log` (one line per transition: time, environment, service, version, state, a fixed reason; never a secret).
- `flock -n` on `/run/lock/jadero-deploy-<env>.lock`: a second deploy exits 75 ("busy") without touching anything.
- `trap '' HUP`: a lost SSH session does not stop a deploy; the runner prints the journal's tail.
- Anti-rollback by semver precedence, in the script, with tests for `0.10.0` against `0.9.0` and pre-releases.
- Standard input carries the registry user and token (lines 1 and 2) and, for production, the expected digest (line 3); a temporary `DOCKER_CONFIG` from `mktemp -d`, removed by a trap after the pull (ADR-049).
- The pulled image's revision label must equal the tag's commit (Q1 B), and the release files land in `/srv/jadero/<env>/releases/<service>-<version>/`.
- Render with `op inject` into `<service>.env.new`; pass only on exit 0 with no `{{` left; rename at `started`.
- `provision.sql` gains a `service` variable and `provision-users.sh` a user filter, so a deploy converges only its own service's roles and broker user.
- Migrate with `docker compose run --rm <service>-migrate`; `web` has none.
- Start with `up -d --wait --wait-timeout 120 --no-deps` on the service's process types (`api api-worker`, `agent agent-consumer`, `web`).
- Rollback: the previous digest, the newest env file, the previous release's files, the health gate again; on failure `failed`, exit 1, no retry.
- Keep the current and previous image per service; prune the rest after `recorded`.
- Tests with `node --test` like `deploy-entry`'s: stub `docker`, `op`, `git`, `curl` and `psql` on `PATH` record their calls; covered: `op` failing changes nothing, health failing rolls back, rollback failing stops, lock busy, downgrade refused, SIGHUP ignored, an environment mismatch refused.

**Topology and smoke (step 4)**
- Topology per Q2: `rabbitmqctl import_definitions` from standard input into the running broker, then poll `list_queues -p /<env>` until every queue of the file is listed; then `provision-users.sh`.
- An integration test on Testcontainers, next to `server-provisioning.int.test.ts`: a live import adds a queue and keeps the users; re-importing an older file changes nothing; a queue redeclared with other arguments is refused (**verify** the exact behavior there).
- `infra/scripts/smoke-deploy.sh <env> <service>`: the checks of D7, each gating only the services on its path.
- The ping check: `SELECT last_seen_at FROM heartbeat.broker_heartbeat WHERE source = 'jadero/api'` in `agent_<env>`, read-only, through the ops Postgres socket, newer than the deploy's start.
- A static maintenance page on 502, 503 and 504 for `new.jadero.dev` (ADR-049 "Downtime"), checked by `smoke-edge.sh` and the nginx hardening test.
- Mid-WP `reviewer` on the branch after step 4.

**CI (step 5)**
- `.github/workflows/deploy.yml`: `workflow_call` (environment, service, version, expected digest) and `workflow_dispatch` for a manual deploy or rollback; `release.yml` gains `deploy-staging` and `deploy-production` jobs, each a matrix in the order `agent`, `api`, `web` with `max-parallel: 1`.
- Environments: `staging` (no reviewer, `main` only), `production` (the owner as required reviewer, `main` only); secret `DEPLOY_SSH_KEY` per environment; variables `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`.
- `tailscale/github-action` v4.2.0 pinned by SHA, workload identity federation (`oauth-client-id`, `audience`, `tags: tag:ci`), Tailscale pinned to 1.104.1; the federated identity bound to `repo:JoseAlbDR/jadero-dev:environment:*`; an OAuth client as the fallback. Changed after the step 5 review (owner, 2026-10-24): two federated identities with the exact subjects `...:environment:staging` and `...:environment:production`, never a wildcard, since GitHub creates an unprotected environment for any name a branch names.
- Permissions: workflow `{}`; the deploy job `contents: read`, `packages: read`, `id-token: write`; `concurrency: deploy-<env>` without cancel; `timeout-minutes: 20`.
- **Owner:** the `tag:ci` owner and grant with a test in the Tailscale policy; two new keys (private halves only in the environment secrets), two key lines bound to `staging` and `prod`, the WP-8 test key removed; the tag ruleset; `nginx` and `backup` added to `protect-main`'s required checks (both already skip inside the job, so they report on every pull request), and the workflows README table updated.

**First deploy and operations (step 6)**
- The Release PR cut after steps 2 to 5 merge gives the first versions that carry the deploy files; staging deploys by itself, production after your approval; the R0 milestone is the ping row in `agent_prod`.
- Staging seeded once by the owner (`docker compose run --rm api node dist/seed.js`, never by a deploy); production stays empty (**verify** the home page answers on an empty content database).
- Memory checked before production's first `up` (**verify**: both environments' limits are about 3.4 GB, plus the ops stack's 1.8 GB).
- 1Password failure shown live: the token file moved aside for one run, the deploy aborts at `rendered`, the site keeps answering, the file goes back.
- Rotation drill: rotate `postgres-content-staging` in 1Password, `redeploy staging api`, show no failed connection.
- Restore drill again with real tables (staging's seeded content, `agent`'s heartbeat and inbox rows), RTO measured.
- D-31 external monitor (account by the owner) and Uptime Kuma monitors for each service's `/health/ready`.
- `docs/runbooks/deploy.md`: deploy, rollback, redeploy, reading the journal, leaving `failed`, the external monitor.

## One concrete trace

Placeholders stand for values that stay out of a public repo: `<tailnet-host>`, `<ssh-port>`, `<sha>`, `<d>`. Outputs are **expected**, not yet run; each step's log records the real ones.

### Trace 1: `api` 0.3.0 from the merged Release PR to production

1. The Release PR merges. release-please tags `api-v0.3.0` at `<sha>`; the images job pushes `ghcr.io/josealbdr/jadero-dev-api:0.3.0` and `:sha-<sha7>` with digest `sha256:<d>` and its provenance.
2. `deploy-staging` (environment `staging`) starts with `env=staging service=api version=0.3.0`. The Tailscale step exchanges the job's OIDC token (subject `repo:JoseAlbDR/jadero-dev:environment:staging`) and joins as an ephemeral `tag:ci` node; `tailscale ping <tailnet-host>` answers.
3. The job runs `printf '%s\n%s\n' "$GITHUB_ACTOR" "$GITHUB_TOKEN" | ssh -i key -o StrictHostKeyChecking=yes -o UserKnownHostsFile=known_hosts -p <ssh-port> deploy@<tailnet-host> deploy staging api 0.3.0`.
4. sshd runs `deploy-entry staging`. `SSH_ORIGINAL_COMMAND` is `deploy staging api 0.3.0`; the words pass; syslog `jadero-deploy: accepted env=staging service=api version=0.3.0`; it execs `sudo -n /srv/jadero/bin/deploy.sh deploy staging api 0.3.0`, standard input passed through.
5. `deploy.sh` takes the lock and reads `/srv/jadero/staging/versions.env`: `API_VERSION=0.2.0`, `API_IMAGE=ghcr.io/josealbdr/jadero-dev-api@sha256:<old>`. 0.3.0 is newer. Journal: `2026-10-21T09:00:01Z staging api 0.3.0 checked`.
6. `git fetch --depth 1 https://github.com/JoseAlbDR/jadero-dev.git refs/tags/api-v0.3.0` resolves `<sha>`; `git archive <sha> infra/` unpacks into `releases/api-0.3.0/`. Journal `fetched`.
7. `JADERO_ENV=staging op inject -i releases/api-0.3.0/infra/env/api.env.tpl -o api.env.new` exits 0; no `{{` left. The file holds `DATABASE_URL=postgres://content_staging:...@postgres:5432/content_staging`, `DATABASE_READ_URL=...content_reader_staging...`, `RABBITMQ_URL=amqp://api_staging:...@rabbitmq:5672/staging` and the plain values. Journal `rendered`.
8. `docker login ghcr.io --username <actor> --password-stdin` into a temporary `DOCKER_CONFIG`; `docker pull ghcr.io/josealbdr/jadero-dev-api:0.3.0`; the repo digest is `sha256:<d>`; `docker image inspect` shows `org.opencontainers.image.revision=<sha>`, equal to the tag's commit; the config folder is removed. Journal `pulled`.
9. `rabbitmqctl import_definitions` reads `definitions/staging.json` from standard input; `rabbitmqctl list_queues -p /staging name` lists `agent.system.ping` and its retry and dead-letter queues; `provision-users.sh staging` converges `api_staging`; `provision.sql -v env=staging -v service=api` re-sets `content_staging` and `content_reader_staging` (the same values, nothing rotated). Journal `provisioned`: the point of no return.
10. `docker compose -p jadero-staging run --rm api-migrate` applies `0005_project_summary` (say) and exits 0. Journal `migrated`.
11. `mv api.env.new api.env`; `docker compose -p jadero-staging up -d --wait --wait-timeout 120 --no-deps api api-worker` returns when both are healthy (about 4 s of 502 on `new.jadero.dev`, the maintenance page shown). Journal `started`.
12. Smoke: `curl -fsS http://127.0.0.1:3121/health/ready` 200; `https://new.jadero.dev/es/`, `/en/`, `/de/` 200; `https://new.jadero.dev/api/v1/content/en/projects` 200; in `agent_staging`, `SELECT last_seen_at FROM heartbeat.broker_heartbeat WHERE source = 'jadero/api'` returns `2026-10-21 09:00:19+00`, after the deploy's start: `api-worker`'s boot ping crossed the broker. Journal `verified`.
13. `previous.env` gets `API_VERSION=0.2.0` with its digest; `versions.env` gets `API_VERSION=0.3.0`, `API_IMAGE=...@sha256:<d>`; images older than 0.2.0 are pruned. Journal `recorded`, exit 0; the job prints the journal's tail and outputs the digest.
14. `deploy-production` waits. The owner approves in GitHub; the job reads the production key, joins the tailnet, and sends the same command for `prod` with `sha256:<d>` as the third input line. Steps 4 to 13 repeat against `jadero-prod`, the digest check passes, the page checks use `127.0.0.1:3110`, and the ping row appears in `agent_prod`: the R0 milestone.

### Trace 2: four failures

**2a. 1Password is unreachable.** Step 7 fails: `op` exits non-zero. Journal `staging api 0.3.0 aborted at rendered: op exit 1`; `api.env.new` is deleted; nothing was pulled, provisioned or recreated. `api` 0.2.0 keeps serving and pinging; the job is red with that line. Rerun later.

**2b. The new version never becomes healthy.** Step 11: `api` 0.3.0 exits on a config error (a variable missing from the template). `up --wait` returns non-zero after 120 s at most. Journal `rolling_back`; `API_IMAGE` set back to `sha256:<old>`; the previous release's Compose files and the newest env file; `up --wait` again; healthy. Journal `rolled_back`, exit 1. The migration of step 10 stays applied, and 0.2.0 works with it because it was expand-only (D5).

**2c. The job is cancelled in the middle of step 11.** sshd closes the session and sends SIGHUP; `deploy.sh` ignores it and runs to `recorded` (or to `rolled_back`), writing every transition to the journal. The next deploy takes the lock, reads a consistent `versions.env` and proceeds. Without the trap, the script would have died between `started` and `recorded`, with 0.3.0 running and 0.2.0 on record.

**2d. A stolen staging key.** `deploy prod api 0.3.0` with the staging key: `deploy-entry staging` refuses, `reason=env-mismatch`. `deploy staging api 0.1.0`: `deploy.sh` refuses, `reason=not-newer`. `rollback staging api` works, but only to the 0.2.0 recorded in `previous.env`, which is what the owner would have chosen anyway.

## Patterns

| Pattern | Where it appears |
|---|---|
| Finite state machine, explicit transitions | D1; the publish state machine of WP-12 is the same shape on a record |
| Write-ahead journal, idempotent re-run | D1, Trace 2c |
| Point of no return, compensating action (rollback) | D1, D5, Trace 2b |
| Mutual exclusion, serialized deploys per environment | D1 (lock), D8 (concurrency group) |
| Workload identity federation, short-lived credentials | D2 (Tailscale), D8 and ADR-049 (the job's `GITHUB_TOKEN`); from WP-7 D7 |
| Least privilege per environment, capability-scoped credential | D2 (keys bound by the forced command); from WP-8 D3 |
| Host key pinning, secrets out of argv | D2 |
| Anti-rollback (downgrade protection) | D3, Trace 2d; from WP-8's step 3 check question |
| Validate before you act, atomic file swap | D4 |
| Static stability | D4 (the rollback needs nothing remote) |
| Rotation ordering | D4; from WP-8 step 4a |
| Expand/contract (parallel change), N-1 compatibility | D5 (schema), D6 (messages, topology), D4 (configuration); from WP-5, WP-6 D6 and WP-10 D3 |
| Consumer first for messages, provider first for HTTP, tolerant reader | D6 |
| Additive infrastructure change | D6, Q2; from WP-8 step 4b |
| Distributed monolith (anti-pattern) | D6 |
| Deploy gate, synthetic transaction, end-to-end probe | D7 |
| Blast radius of a check | D7 (a check gates only its path) |
| Build once deploy many, promotion by digest, immutable reference | D8; from WP-7 D7 |
| Manual approval gate | D8 |
| Independent failure domains for monitoring | D9; from WP-8 D8 |
| Trust anchor, root of trust, configuration versioned with the artifact | Q1 |
| Ordering by construction versus by orchestration | Q2 |

## Proposed steps

The explainer is the gate, not a step. **Owner** marks what only the owner can do (GitHub settings, the Tailscale policy, 1Password, `sudo` on the server). Each step ends with a green `pnpm verify`, one scoped commit and two lines in the step log.

1. *Explainer* (this file); after your answers, the short ADR for Q1 and Q2 (with the superseding line if Q2 is B).
2. *Per-environment Compose and env templates* (`known`: marked by the owner 2026-10-18, D-38 fast path; explained in the chat without a check question). Agent: `compose.services.yml` with the two overlays, the three templates, the hardening test, the release-inputs extension.
3. *`deploy.sh` as a state machine* (learning). Agent: the verbs, the environment-bound `deploy-entry`, the journal and state files, the lock, the anti-rollback guard, the render, the registry login, the revision check, the scoped provisioning (`provision.sql` `service` variable, the user filter), migrate, start, rollback, the shell tests.
4. *Topology and smoke* (learning). Agent: the live import with its wait, its integration test, `smoke-deploy.sh` with the ping check, the maintenance page. Then the mid-WP `reviewer`.
5. *CI deploy workflow* (learning). Agent: `deploy.yml`, the jobs in `release.yml`, the workflows README. **Owner:** environments, keys, the Tailscale grant and federated identity, the tag ruleset, the required checks.
6. *First real deploy and operations* (learning, owner on the server and in GitHub; SSH only through the owner's profile for this host, `sudo` is the owner's). Staging by itself, production after approval, the ping in production; the 1Password and rotation demos; the restore drill with real tables; the D-31 monitor; `docs/runbooks/deploy.md`.
7. *Docs and map*: `/map` (the deploy view: `deploy.yml`, the state machine, both service lanes solid), the `AGENTS.md` status line, `/wrap-wp 9`.

**Refinement of the approved list (say if you disagree).** Step 6 needs `deploy.yml` and the deploy files on `main`: `release.yml` can only call a workflow that exists there, production's environment allows `main` only, and the first deployable versions are the ones the Release PR cuts after that merge. So steps 2 to 5 merge as the WP-9 PR after the mid-WP review; steps 6 and 7 continue on a second branch `wp/9-deploy-live` (the learning gate reads the number). The HSTS raise (#141) stays its own `chore/` PR from 2026-10-25.

## Decision

Recorded 2026-10-18 in [ADR-053](../adr/0053-deploy-files-from-the-release-tag.md) (D-83, D-84). The owner said go on D1 to D9 and the implementation choices.

- **Q1: B, fetched at the release tag.** Owner's reason: no drift between the Compose files and the image, plus a tag ruleset so release tags cannot move or be deleted. The trust anchor is `main`'s protection plus that ruleset; `deploy.sh` and `deploy-entry` stay hand-installed as the root of trust.
- **Q2: B, each `api` and `agent` deploy imports its own release's definitions before migrate.** Owner's reason: it removes the manual topology step (the owner's work runs a manual infrastructure-as-code apply for each new event) and applies the queue in order before the service starts. Added by the main session after reading the generator: the import overwrites policies, so the deploy records the imported `messaging` version and imports only an equal or newer one (the D3 anti-rollback rule applied to the topology). The rule on the generator is narrower than the explainer said: only a queue's type is a declared argument and cannot change in place; TTLs, dead-lettering and the delivery limit are policies and change at once.
- **Correction taught in the dialogue.** The owner summed it up as "everything atomic, a release or a rollback carries everything of its own version". Half right: what travels with the release (image, Compose, env templates, smoke) is swapped whole and a rollback returns to the previous release's copy. Shared state (database schema, topology, rendered env) only moves forward and stays at the newest version in a rollback; it is safe because every change to it is additive and the previous release works on it (N-1 compatibility, expand/contract). Per-service deploys are not atomic across services either; compatibility, not atomicity, is what makes them safe.
- **Taught in the dialogue (owner asked):** RabbitMQ exchange types (direct, topic with `*` and `#`, fanout, headers), quorum versus classic queues, and the mapping to AWS (exchange like an EventBridge bus, binding like a rule, quorum queue like SQS with `maxReceiveCount` and a DLQ, fanout like SNS).
- **Amendment 2026-10-18 (step 3, owner said yes to three gaps the implementer found before writing code):**
  1. *Rename after `provisioned`, not at `started`* (amends the implementation choice "rename at `started`"). Compose loads every service's env file on any command, so a migrate run after `provisioned` would read the old file: on a rotation the role password just set would not match and every rotating deploy would roll back; on a first deploy the file would not exist. The rename is the first action after `provisioned`. D4's guarantee holds: running containers keep the env from their creation (a restart reuses it), and before `provisioned` nothing is renamed, so a failure there is still `aborted`. From `provisioned` on the rendered env is shared state that only moves forward (ADR-053 Consequences).
  2. *Bootstrap with Compose profiles.* One project per environment (ADR-051) makes Compose resolve every service's image variable and env file, so the first `agent` deploy would fail before `api` and `web` exist. Each process type joins its service's profile, and `deploy.sh` fills an image variable not yet in `versions.env` with the inert `jadero.invalid/not-deployed`; a test requires that the deployed service never gets the inert reference. Changes `compose.services.yml` and its hardening test.
  3. *Provisioning passwords parsed from this run's `<service>.env.new`.* `ops.env` goes stale after a rotation and holds both environments. Reading the passwords from the file this run rendered (one `op` read) makes the password set in Postgres and RabbitMQ the one the service will use, by construction; a value that is not letters and digits only aborts the deploy before `provisioned` (fail closed). Rejected: a second provisioning template per service (two reads that can disagree if a rotation lands between them).
- **Taught in the dialogue (owner asked, step 3):** a finite state machine with an online shop order and the SRM approval flow as examples, and why this one is an operation that must survive its process (write-ahead journal). Files versus a SQLite table for the deploy state: `versions.env` is the release manifest Compose reads directly, the journal already keeps the full history, `flock` leaves one writer, and the history for people comes from GitHub deployments in step 5; a table wins when history drives decisions or several hosts write. Rollback is one step back because expand/contract guarantees compatibility with the previous release only: the contract phase removes what N-2 may still read.
- **Amendment 2026-10-23 (mid-WP review, owner said yes to the fixes):**
  1. *The point of no return is the first provisioning write, not the `provisioned` journal line* (amends D1's "`provisioned` is the point of no return" and the step 3 amendment's rename). `provision.sql` can fail after an `ALTER ROLE`, or the broker step after Postgres converged; the rollback then ran before the rename, so the previous release started on the old env file, Compose kept its containers, their pooled connections passed the health gate and the run said `rolled_back` while Postgres held the new password (an outage at the next restart). Now a flag is set right before `provision_postgres`, and a rollback (or the exit trap past the point of no return) moves `<service>.env.new` into place first, so Compose recreates the previous release's containers with the matching passwords. A failure before that write (the topology import) keeps the old env file and removes the `.new` file, which holds secrets.
  2. *The lock moved from `/run/lock/jadero-deploy-<env>.lock` to `/srv/jadero/<env>/deploy.lock`* (amends the implementation choice "`flock -n` on `/run/lock/...`" and the delegated detail that names it). `/run/lock` is world-writable, so any local user could pre-create the file and hold every deploy at exit 75, or plant a symlink that root opens for writing; the state folder sits under the root-owned `/srv/jadero` and is created 700.
  3. *`MESSAGING_VERSION` is written just before the import (write-ahead)*, not at `recorded`. It still records the newest version imported in the environment, so ADR-053's wording holds and needs no new ADR.

## Step log

- Step 2 (per-environment Compose and env templates, `known`, D-38 fast path): `infra/compose/compose.services.yml` runs the seven process types with WP-7's hardening plus rotated logs, each image a required `${API_IMAGE:?}`-style variable from `versions.env`, each reading `/srv/jadero/${JADERO_ENV:?}/<service>.env` and blanking the credentials it does not read (`api` no `RABBITMQ_URL`, `api-worker` no `DATABASE_READ_URL`, both migrate steps only `DATABASE_URL`); `compose.staging.yml` and `compose.prod.yml` hold only the project name, the `127.0.0.1` ports of `api` and `web` (3121/3120, 3111/3110), `SITE_URL` and the external `jadero_staging`/`jadero_prod` network; `infra/env/{api,agent,web}.env.tpl` reference `<item>-$JADERO_ENV` items of `ops.env.tpl` and leave `${JADERO_ENV}` in role, user and vhost names to Compose (checked: `op inject` substitutes variables only inside a reference); `scripts/compose-hardening.mjs` gains `checkServicesHardening`, `checkEnvironmentOverlay`, `envTemplateProblems` and `missingVariableProblems`; `scripts/release-inputs.mjs` appends a SHA-256 per deploy file (each service's parsed Compose entries, its template, and for `api` and `agent` `provision.sql`, `provision-users.sh`, `permissions.tsv` and the definitions folder), and `turbo.json` adds `infra/postgres/**` and `infra/rabbitmq/**` to `test:scripts` inputs. `docker compose config` validates both projects under Compose 5.6.0.
- Step 2 why: one shared file with thin overlays means staging and production cannot drift apart; digests from `versions.env` make the deploy run the bytes staging tested; blanking per process type keeps WP-12's rule that a process holds only the credentials it uses, even though one env file per service feeds them all; and hashing the deploy files into `release-inputs.txt` makes an `infra/`-only change release the services that read it (ADR-053), where until now it would have waited for an unrelated release.
- Step 3 (`deploy.sh` as a state machine, D1, D3, D4 and the step 3 amendment): `infra/scripts/deploy.sh` replaces the WP-8 stub with three verbs (`deploy <env> <service> <version>`, `rollback <env> <service>`, `redeploy <env> <service>`, the last refused when `SUDO_USER` is `deploy`) that run checked, fetched (`git fetch --depth 1` of `refs/tags/<service>-v<version>`, `git archive ... infra` into `releases/<service>-<version>/`, the overlay's `name:` checked against `jadero-<env>`), rendered (`op inject` into `<service>.env.new`, passing on exit 0, no `{{` and every password in `DATABASE_URL`, `DATABASE_READ_URL`, `RABBITMQ_URL` letters and digits only), pulled (login with a `mktemp -d` `DOCKER_CONFIG` removed after the pull, the repo digest checked against stdin's line 3, required on prod, and the revision label against the tag's commit), provisioned (an empty `apply_topology` hook for step 4, then `provision.sql -v service=<service>` through `docker exec -e` and `provision-users.sh <env> <service>_<env>`), the rename of `.new`, migrated, started (`up -d --wait --wait-timeout 120 --no-deps` on the process types), verified (the release's `infra/scripts/smoke-deploy.sh`, which step 4 adds; failing closed without it) and recorded (`versions.env`, `previous.env`, images and release folders pruned to current and previous). One journal line per state goes to `deploy.log` and stdout and nothing else is printed. A failure before provisioned is `aborted` with the `.new` file and the fetched release removed; from provisioned on it is `rolling_back` to the current digest and release files, then `rolled_back` or `failed`. Also: `flock -n` (exit 75), `trap '' HUP PIPE`, the semver comparison, and every Compose call built from one `ENV_NAME` with `--profile <service>` and `jadero.invalid/not-deployed` for images `versions.env` does not hold. `deploy-entry` takes the environment from its key line (`no-binding`, `env-mismatch`) and accepts `deploy` and `rollback`. `provision.sql` gains `service` (api, agent, contact), `provision-users.sh` a user argument, and `compose.services.yml` a profile per process type, held by `checkServicesHardening`. 58 stubbed tests in `scripts/deploy.test.mjs` (docker, op and git on PATH, a perl `flock` shim on macOS), the deploy-entry tests rewritten for the binding, and integration tests for both provisioning filters.
- Step 3 why: a deploy touches five systems and can lose its runner half way, so each state is written before the next transition and the zone decides the recovery. Before `provisioned` nothing shared moved, so throwing the run away is enough. After it, the compensating action is the previous release on the newest env file, which only works because configuration, schema and topology change expand-only. The guards (anti-rollback, a key bound to its environment, the revision check, one environment value for every Compose input, passwords parsed from the one render) sit on the trusted side, because the client's words are valid by form but not by meaning. Writing the stdout copy of the journal from a subshell stops bash from flushing a failed write into the journal, which the closed-stdout test caught.
- Step 3 check (2026-10-19): rollback after provisioned with a password rotated in 1Password; which env does 0.3.0 start with? Right: the env rendered in this run, because provisioned already set the new password in Postgres and shared state only moves forward (N-1). Added after: with the old env every new connection fails auth, the health gate fails and the run ends `failed`, not `rolled_back`.
- Step 3 follow-ups: owner yes (2026-10-19) to stopping the new containers when a first deploy fails (no previous version to roll back to): a first deploy runs whole or not at all, logs stay readable from the stopped containers. First change of step 4.
- Step 4, first part (topology, first-deploy stop, maintenance page; D6, D7 "Downtime", ADR-053; `smoke-deploy.sh` waits on two owner questions): `deploy.sh` fetches `packages/messaging/package.json` with `infra/` at the tag and aborts `no-topology-files` before `provisioned` when it, the env's definitions or `import-definitions.sh` is missing or the version is not semver; `apply_topology` compares the release's messaging version with `MESSAGING_VERSION` in `versions.env` (a bad value refuses `bad-manifest`), skips an older one (`provisioned topology-skipped-older`), writes a newer one before importing, then runs the release's new `infra/rabbitmq/import-definitions.sh <env>` (python3 checks that the file holds only `/<env>` and no users, `rabbitmqctl import_definitions` on stdin, a poll of `list_queues name type` bounded by 60 s that fails at once on a type that differs); `rollback` and `previous.env` never touch the record. A first deploy that fails after `up` runs `docker compose stop` on its process types (`failed nothing-to-roll-back-to`, or `stop-failed`). `new.jadero.dev` serves `/srv/jadero/www/maintenance/maintenance.html` on the 502, 503 and 504 nginx generates, from an internal location, with `no-store`, a static CSP and `Retry-After: 10` on 503 added at the server level through `$uri` maps that are empty for every other response; `nginx-hardening.mjs` requires every `error_page` to be an exact internal static location, and `smoke-edge.sh` checks the page when `/` answers 5xx and `/maintenance.html` answers 404. Tests: 10 new stubbed deploy tests, 6 for the import script, a generator test that every queue is quorum with only its type, and `topology-import.int.test.ts`, which found that RabbitMQ 4.3.6 accepts a file redeclaring a queue as classic (exit 0, no log error) and silently keeps it quorum, and that an older file re-imported puts back the older delivery limit while the newer queue stays.
- Step 4 first part why: the import moves a broker that both releases share, so the record of what it holds is written ahead of the import, like the journal, and the guard that reads it stays in the hand-installed `deploy.sh`, never in the fetched files it judges; the record only moves forward, because a rollback that re-imported older definitions would undo newer policies (the int test shows it). Since RabbitMQ does not refuse a type change, our own check after the import turns it into a failed deploy, which rolls back, instead of a consumer starting on a queue its release did not declare. A first deploy has nothing to return to, so stopping its containers is its compensating action, keeping logs; the maintenance page answers only for errors nginx itself generates, so api's own problem details are never replaced.
- Step 4, smoke part (D7; owner answers of 2026-10-22: skip a check whose path is not whole yet, open the ping window when `up --wait` returns): `infra/scripts/smoke-deploy.sh <env> <service> <since> <deployed>` runs `ready` (api and web from the host on their 127.0.0.1 ports, `/health/ready` and web's `/robots.txt`; api-worker, agent and agent-consumer with the image's own probe through `docker exec` on 127.0.0.1), `pages` (path web and api: `/es/`, `/en/`, `/de/` through the edge with `--resolve new.jadero.dev:443:127.0.0.1` on staging, 127.0.0.1:3110 in production), `content` (path api: `/api/v1/content/en/projects`, or 127.0.0.1:3111 `/v1/...`) and `ping` (path api and agent: `SELECT floor(extract(epoch FROM last_seen_at))` for `jadero/api` in `agent_<env>` in a read-only transaction through `docker exec` on the ops Postgres, polled every 5 s for up to 90 s, newer than `<since>`); a check runs only when the deployed service is on its path and is reported `skipped` while another service on it is missing, and stdout holds only `check=<name> result=<ok|skipped|failed>` lines. `deploy.sh` takes `healthy_at` right after `up --wait` (deploy and rollback), passes the services `versions.env` holds, reads the skipped names against a fixed list and journals `verified smoke-passed-partial-<names>` or `smoke-passed`, and unsets `SMOKE_PING_*`. `smoke-deploy.sh` joins every service's deploy files in `release-inputs.txt`. 17 smoke tests (curl and docker stubs) and 4 more deploy tests. `infra/compose/README.md` "Retiring a consumer" now runs: generator and deploy, unbind by hand, drain to 0, stop the consumer, delete queue, DLQ, policy and (last queue) user.
- Step 4 smoke part why: the first round of an environment cannot have a whole path for every service (agent before api, api before web), so skipping by path, named in the journal, still checks each path once in that round instead of failing every first deploy. The window opens after `up --wait` because only then are the old containers gone, so no old worker or consumer can write the heartbeat that passes a broken new one; it costs up to one heartbeat interval. The old retiring order stopped the consumer while the binding still copied every new event into the queue, so with a live producer it never reached 0.
- Step 4 check (2026-10-23): rollback of api 0.4.0 (messaging 0.3.1, delivery limit 20, a new queue) to 0.3.0 (messaging 0.3.0, limit 10). Right: the guard skips the import, the limit stays 20, the queue stays and the recorded version stays 0.3.1. Added after: without the guard the result is not the old topology but a mix, because an import never deletes: the new queue stays and only the policy reverts to 10, so messages dead-letter after 10 attempts with no error anywhere.
- Step 4 follow-ups: the retiring order in `infra/compose/README.md` meets the generated read permission (removing the queue from the generator takes the consumer's read right, so the drain runs through a shovel or `ops_admin`); the unbind call and this order are checked against the real broker in the step 6 runbook.
- Step 4b (mid-WP review fixes): `deploy.sh` sets `credentials_written=1` right before `provision_postgres`, and a new `settle_env`, run first in `roll_back` and in the exit trap past the point of no return, moves `<service>.env.new` into place when the flag is set and removes it otherwise; the lock is now `LOCK_FILE="$ENV_DIR/deploy.lock"` (`LOCK_DIR=/run/lock` removed, `take_lock` runs `mkdir -p "$ENV_DIR"` under umask 077 first), and the header states the new boundary. Tests: the docker stub gains `STUB_FAIL=broker`; three new deploy tests (the broker step fails after Postgres: `api.env` holds the new secret at 600, no `.new` is left, and the only Compose call is `up` on 0.2.0's files and digest; a redeploy whose `psql` fails keeps the new env; a topology failure keeps `OLD=1` and leaves no `.new`); the lock test uses the state folder and checks mode 600. `compose.services.yml`'s header shows the image variables passed through the environment instead of `--env-file versions.env`; `server-access.md` names the lock path.
- Step 4b why: which env a rollback needs depends on whether Postgres may already hold this run's passwords, and that starts with the first provisioning write, not with the journal line after the last one. Starting the previous release on the new file is also what makes Compose recreate it (a changed env is a changed container config); with the old file warm pooled connections hid the mismatch until the next restart. A `.new` file that matches nothing that moved is only secrets on disk, so it goes. The lock left `/run/lock` because a file any local user can create is a lock any local user can hold.
- Step 5 (CI deploy workflow, D2, D8, ADR-049 deploy mechanics B): new `.github/workflows/deploy.yml`, a `workflow_call` (environment, service, version, digest) and `workflow_dispatch` (action deploy or rollback, environment, service, version) job on the GitHub environment of that name, `concurrency: deploy-<environment>-<service>` without cancel (after the follow-ups), `timeout-minutes: 20`, permissions `contents`, `packages` and `attestations: read` plus `id-token: write`; it checks every input through `env:` (main only, `production` mapped to the server word `prod`, semver, a `sha256:` digest on a call, no version on a rollback), on a manual deploy logs in to GHCR, resolves the tag's index digest with `docker buildx imagetools inspect` and requires `gh attestation verify` with `--repo`, `--signer-workflow .../release.yml`, `--source-ref refs/heads/main` and `--deny-self-hosted-runners`; joins the tailnet with `tailscale/github-action` v4.2.0 by SHA (federation inputs, `tag:ci`, 1.104.1 with its pinned tarball checksum, cache off); writes the key and pinned `known_hosts` under `$RUNNER_TEMP` at mode 600 and runs one `ssh -T` (`BatchMode`, `StrictHostKeyChecking=yes`, `IdentitiesOnly`) as `deploy` with the repository owner, the job token and the digest on stdin (nothing for a rollback), streams the journal with workflow commands stopped, writes it to the job summary and maps exit 0, 75, 1 (by the last journal state: aborted, rolled_back, failed, refused) and 255 to error lines. `release.yml` lists the released services in deploy order (agent, api, web), each images leg uploads `image-<service>` with its version and pushed digest, a new `digests` job joins them into one output, and `deploy-staging` and `deploy-production` call `./.github/workflows/deploy.yml` as matrices with `max-parallel: 1` and `fail-fast`, production only after every staging leg. The workflows README gains the `deploy.yml` section, the concurrency behavior, the security model lines, the red-deploy runbook and the owner setup checklist.
- Step 5 why: events made with the job's token start no workflow, so the deploy is a reusable workflow called from the release run, and the digest travels from the push that was attested to both environments, the server comparing it with what it pulled (promotion by digest, like for like: the index digest in both places). Matrix outputs overwrite each other across legs, so each leg writes its own artifact and one job joins them. The key, the token and the federation are scoped to one job and one environment, every input is validated before the shell sees it, and the server's output is printed with workflow commands stopped, because the job trusts the server's words no more than the server trusts the job's.
- Step 5 follow-ups (owner, 2026-10-24, after the step 5 review): (1) `DEPLOY_HOST`, `DEPLOY_SSH_PORT` and `DEPLOY_KNOWN_HOSTS` are environment secrets, not variables, because a variable's value is printed in the public log's env block; the known_hosts secret is written whole to a 600 file with carriage returns stripped, never printed. (2) `release.yml` drops its workflow-level group, which stayed held while production waited for approval and stopped every later release: `release-please` keeps a job-level group (one at a time, a newer pending job replaces an older one, safe because it tags every merged Release PR still pending), `images` has none (each leg pushes its own tagged version, so nothing can cancel one and leave a tag without its image), and the deploy group is `deploy-<environment>-<service>` for calls and dispatches alike, so only a newer deploy of the same service replaces a pending one; two services of one environment can still meet the server's lock (exit 75, nothing touched, rerun), written in the README. (3) The calls use `./.github/workflows/deploy.yml` with an inline `zizmor: ignore[self-repository]`, since GitHub resolves `./` for a reusable workflow call at the caller's commit and actionlint 1.7.12 rejects `$/`.
- Step 5 check (2026-10-24): the `api:0.3.0` tag is moved in the registry between staging and the production approval; what does production run? Right on the first half: the pulled digest differs from the one the images job recorded, the run ends `aborted` before the point of no return and production keeps its version. Second half (only the tag sent) not answered; taught: the server would run the attacker's image, the revision label does not help because whoever builds the image writes it, and the smoke would pass, so production would run bytes staging never tested. A tag is a movable pointer, the digest an immutable reference; signatures (the attestation) prove origin, labels do not.
- Step 5 review fixes (2026-10-24): `deploy.sh` runs the tag fetch, `op inject`, the registry login (30 s each), the pull (180 s) and the migrate run (120 s) under `timeout --kill-after=10`, journaling `aborted reason=fetch-timeout`, `render-timeout`, `login-timeout` or `pull-timeout` before the point of no return and `rolling_back reason=migrate-timeout` after it (plus removing a leftover one-off migrate container), and `runMigrations` opens its session with `lock_timeout` 10 s and `statement_timeout` 60 s, migrate only; `/api/v1/content/` answers an nginx-made 502, 503 or 504 with `maintenance.problem.json` (RFC 9457, `application/problem+json`, always 503, the page's `no-store`, CSP and `Retry-After`), checked by the hardening test, `smoke-edge.sh` and `nginx-check.sh`; `deploy.yml` drops the tailscale action's `ping:` for a silent bounded wait on the SSH port (six 5 s connects), maps the exact journal line `refused reason=not-newer` for this environment, service and version to a notice and exit 0 on a release call, and the README sets two federated identities with exact environment subjects, says a later queued job replaces the pending one whatever its version, and adds: approve production runs in release order, reject a waiting approval before a manual rollback. Why: a hung step held the environment lock past the 20-minute job so every later deploy exited 75; a wildcard subject let any branch mint a `tag:ci` node; the ping printed the tailnet address in a public log; an API client must not parse HTML; and with the queue replacing by arrival, an older release meeting a newer one is expected, not a failure that should trip fail-fast.
- Step 5 review fixes, second pass (2026-10-24): `bounded` in `deploy.sh` turns a 137 into 124 only when the limit has passed (timeout's KILL comes 10 s after it) and `timed_out` reads only 124, so a migrate container OOM-killed under its `mem_limit` (also 137, but early) is journaled `rolling_back reason=migrate-failed`, covered by stub tests with a fake clock (124 and 137 timeouts, an early 137); `deploy.yml` sparse-checks out `scripts/ci/deploy-result.mjs` at its own commit and hands it the SSH exit code and the journal, which keeps the 0, 75, 1 and 255 messages, gives the green notice only for the exact six-field `refused reason=not-newer` line of this request on a release call (a near miss or a manual dispatch stays an error), and is covered by `node --test`; the API maintenance answer (a static RFC 9457 body served as 503 for `/api/`) is read as within ADR-026 "Downtime" (a static maintenance page on 502) together with RFC 9457, so no new ADR. Why: 137 alone cannot tell timeout's KILL from the kernel's, and a wrong reason sends the owner after a slow migration instead of a memory limit; the one exit 1 that turns green had no test, and a mapping that hides a failure must be proven exact.
- Step 6a, pre-flight (2026-10-24, owner's sudo, read-only SSH through the owner's profile first): the host key fingerprint matches `DEPLOY_KNOWN_HOSTS`; `/srv/jadero/bin/deploy-entry` and `deploy.sh` were WP-8's and are now `main`'s (checked by `sha256sum`); `authorized_keys` holds the two environment-bound lines and no WP-8 test key; the token file and the one sudoers rule are in place; only `new.jadero.dev.conf` and `www/maintenance/` differed from the repo's nginx files, now installed, so the site answers the maintenance page (502 with no service behind it) and `/api/v1/content/` a 503 `application/problem+json` with `Retry-After`, the other sites still 200; the long-running services of both environments are limited to 3.4 GB plus 1.8 GB of the ops stack on 7.7 GB (1.4 GB used today); every `op://` item the templates name exists for both environments; a throwaway Compose project (local Compose 2.31) recreates a container when only its env file's content changes and keeps it when nothing changed. `.github/workflows/README.md`: `nginx` and `backup` required (eleven checks), and the setup checklist gains the server install of the scripts and the site and the full MagicDNS name for `DEPLOY_HOST`.
- Step 6a why: the scripts on the server never update themselves (ADR-053), so a pipeline that checks the release tag still ran WP-8's checks until they were installed by hand; the short host name resolved only through the owner's SSH profile; the recreate rule is what makes a rotation and a rollback take the new env, and the server runs Compose 5.6.0, so the 6c rotation drill is the proof on the real host (no test containers on the shared server).

- Step 6b, first deploy (2026-10-24): Release PR #154 (agent and api 0.3.0, web 0.2.0) merged after its pending runs were approved. Four faults showed up in order and each got a fix: (1) Tailscale answered 403 because the repository signs OIDC tokens with GitHub's immutable subject `repo:JoseAlbDR@128265706/jadero-dev@1402255543:environment:<name>`, and the two credentials' descriptions were swapped (the owner rebound each by its client ID; README and `deploy.yml` comment updated); (2) the deploy secrets arrived empty in the reusable workflow, fixed by `secrets: inherit` (#157), the first deploys then ran by `workflow_dispatch`; (3) every deploy after the first exited 75: `op inject` left a root `op daemon` holding the lock's descriptor 9 (`lsof` showed it), fixed by closing fd 9 in `bounded` plus `OP_CACHE=false` (#158, reinstalled by hand, sha256 `2b983108...`); (4) web's smoke failed twice, once on an unseeded staging and then because `/es/` answers 308 and curl follows no redirect, fixed by checking `/<locale>` (#159). Release PR #160 (agent and api 0.3.1, web 0.2.1) then deployed itself to staging in order with no busy exit, and production took agent and api on the owner's approval: prod api `verified reason=smoke-passed-partial-pages`, so the ping crossed the production broker (the R0 milestone). Web was rejected for production: on the empty content database the home page is a 404 (#162). Staging was seeded by the owner (`docker exec jadero-staging-api-1 node dist/seed.js`, 12 items). The owner skipped the 6a and 6b check questions to finish the WP.
- Step 6b why: a pipeline is only proven by its first real run; each fault sat at a boundary no stub covers (the OIDC subject format, how GitHub hands secrets to a called workflow, a daemon a CLI starts behind the script's back, a framework's redirect). The plan's order was wrong in one place: staging's web smoke needs the seed before the first web deploy, not after.
- Step 6b follow-ups: pass the four deploy secrets by name instead of `inherit` (GitHub allows it for environment secrets; reviewer of #157); `OP_CACHE=false` does not stop `op daemon` from starting (seen after #158), so decide whether to kill it at the end of a deploy or accept it; journal the failed smoke check by name (`smoke-failed-pages`), the journal said only `smoke-failed`; a `smoke-deploy` timing test flaked under load; 13 new Dependabot alerts on `main` (2 critical); `pnpm verify` without a cache flaked under load 25.

## Recap

## Named here

| Name | What it is, in one line | When |
|---|---|---|
| WP-5 | Messaging: outbox, inbox, topology generator, users without `configure` (T4), the ping | R0, done |
| WP-7 | Images, `release.yml`, build once and promote, the job token for GHCR | R0, done |
| WP-8 | The server: Tailscale, the forced command, the ops stack, the edge, backups | R0, done |
| WP-10 | Migrations as one-off steps, expand-only, no down migrations | R1, done |
| WP-12 | Content domain, the publish state machine, the seed | R1, done |
| WP-29 | Cutover of `jadero.dev`; production gets its public host | R1 |
| WP-33 | Blue-green deploys (optional) | R7 |
| ADR-049 | Images and release; restates ADR-048's pipeline, deploy mechanics and deploy steps | accepted |
| ADR-043 | Config before Nest; secrets from 1Password with `op inject` | accepted |
| ADR-051 | Hosting layout (restating ADR-050 and ADR-027), with the first-party analytics path | accepted |
| ADR-029 | Service boundaries, expand/contract for messages, the topology | accepted |
| ADR-005 | Drizzle; the migrate container before the service | accepted |
| ADR-047 | HTTP hardening; the edge closes internal routes | accepted |
| `tailscale/github-action` | Joins a workflow run to the tailnet as an ephemeral tagged node | step 5 |
| Workload identity federation | Trading a CI job's OIDC token for access, with no stored secret | step 5 |
| GitHub environments | Deployment targets with reviewers, branch rules and their own secrets | step 5 |
| `op inject` | Renders `op://` references in a template into a file | step 3 |
| `rabbitmqctl import_definitions` | Imports a definitions file into a running broker, additively | step 4 |
| `flock` | Advisory file lock from util-linux, here one deploy per environment | step 3 |

## Facts checked

| Tool | Version on 2026-10-18 | Source | Note |
|---|---|---|---|
| `tailscale/github-action` | v4.2.0, 2026-09-22, commit `d1b6cd204f8dceda5b3eaad7f1f767be390056cd` | GitHub releases and tag API; `action.yml` and `README.md` at v4.2.0 | Inputs `oauth-client-id`, `audience` (federation), `oauth-secret`, `authkey` (deprecated), `tags`, `version` (default 1.94.2), `ping`; nodes ephemeral and preapproved; federation needs `id-token: write`, Tailscale 1.90.1 or later and at least one tag |
| Tailscale | 1.104.1, 2026-10-07 | GitHub releases | Same as WP-8 |
| Tailscale workload identity federation | kb 1581 | tailscale.com | Issuer, subject and custom claims with `*` wildcards; GitHub Actions supported; plan availability not stated (**verify**) |
| GitHub OIDC | docs | docs.github.com, OIDC reference | Subject `repo:ORG/REPO:environment:NAME` for a job with an environment; issuer `https://token.actions.githubusercontent.com` |
| GitHub environments | docs | docs.github.com, deployments and environments | Free: required reviewers and environment secrets on public repositories; secrets only after approval; up to six reviewers; "prevent self-reviews" optional; branch and tag rules; wait timer up to 30 days |
| `GITHUB_TOKEN` | docs | docs.github.com, GITHUB_TOKEN concept | Expires when the job ends, at most 6 hours on GitHub-hosted runners |
| GHCR | docs | docs.github.com, container registry | A package linked to the repository inherits its access; `GITHUB_TOKEN` can pull when the repository has read access; the username for a token login is not documented (**verify**; `release.yml` uses `github.actor`) |
| GHCR packages | `jadero-dev-api` and `-agent` 0.2.0 (`sha-0b68419`, 2026-10-18), `jadero-dev-web` 0.1.0 (`sha-f9bdedb`, 2026-10-13), all private | GitHub packages API | `api-v0.2.0` points at `0b68419` |
| 1Password CLI | 2.41.0 | app-updates.agilebits.com | `op inject`: `{{ op://... }}` templates, variables in references (`op://$env/db/password`), `--file-mode` default 0600; exit code and partial output on failure not documented (**verify**; the render writes a `.new` file regardless); a variable inside an item name (`postgres-content-$JADERO_ENV`) **verify** |
| Docker Compose | 5.6.0, 2026-10-02 | GitHub releases, `docs/reference/compose_up.md` at v5.6.0 | `up --wait` (implies detached), `--wait-timeout` seconds, `--no-deps`, `--pull`; the server's version **verify** |
| RabbitMQ CLI | 4.3.6 | `import_definitions_command.ex` at tag v4.3.6 | Reads a file or standard input; `--skip-if-unchanged`; prints "Successfully started definition import. This process is asynchronous"; behavior on existing objects and on a queue with other arguments **verify** in step 4's test |
| RabbitMQ definitions | 4.x docs | rabbitmq.com/docs/definitions | Boot import "will not overwrite anything already in the broker"; `definitions.skip_if_unchanged` |
| release-please config | the repo | `release-please-config.json`, `.release-please-manifest.json` | Components: `apps/agent`, `apps/api`, `apps/web`, `packages/contracts`, `packages/messaging`, `packages/platform-nest`, `packages/ui`; `node-workspace` plugin; `infra/` is no component |
| Repository rulesets | the repo | GitHub rulesets API | Only `protect-main` (branch); no tag ruleset |

**Verify** (no primary source confirmed, or only the server or a test can tell):
- Workload identity federation on the owner's Tailscale plan; else the OAuth client fallback.
- `op inject` on failure, and a variable inside an item name segment.
- `rabbitmqctl import_definitions` on existing objects and on a redeclare with other arguments (step 4's integration test).
- The GHCR username accepted with a `GITHUB_TOKEN`.
- Whether `web`'s home page answers 200 on an empty content database (production's smoke).
- The memory with both environments running (step 6, before production's first `up`).
- The server's Docker Compose version supports `--wait-timeout`.
- The free external monitor's terms (step 6).

## Delegated details

- `flock -n 9` on a file descriptor opened with `exec 9>/run/lock/jadero-deploy-staging.lock`: the lock dies with the process, so a crash never leaves it held.
- `trap '' HUP` ignores the hangup; `trap cleanup EXIT` removes the `.new` file and the temporary `DOCKER_CONFIG` on every exit path.
- Semver precedence: compare major, minor and patch numerically; a version with a pre-release is lower than the same version without; pre-release identifiers compare left to right, numeric ones as numbers.
- `docker image inspect --format '{{index .RepoDigests 0}}'` gives the digest; `--format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` the commit.
- `git fetch --depth 1 <url> refs/tags/<tag>:refs/tags/<tag>` into a bare cache, then `git archive <commit> infra/ | tar -x -C <dir>`.
- `docker compose --env-file versions.env -p jadero-staging -f compose.services.yml -f compose.staging.yml ...`: later files override earlier ones key by key.
- Tailscale policy for CI: `"tagOwners": {"tag:ci": ["autogroup:admin"]}` and a grant `{"src": ["tag:ci"], "dst": ["tag:server"], "ip": ["tcp:<ssh-port>"]}`, with a test that accepts `tag:server:<ssh-port>` and denies another port.
- A reusable workflow called from `release.yml` receives no secret the caller does not pass, environment secrets included, even when its job names the environment (an unpassed one resolves to an empty string); the calls pass `secrets: inherit` (#157), and permissions are the caller's at most.
