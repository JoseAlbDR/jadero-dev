---
wp: 9
title: "The deploy pipeline: a state machine, a digest and seven faults no stub caught"
status: draft
date: 2026-10-24
locale: en
---

# The deploy pipeline: a state machine, a digest and seven faults no stub caught

WP-9 closes R0. A merged Release PR now deploys itself to staging, waits for my approval and deploys the same bytes to production on new.jadero.dev. The ping event crossed the production broker on the first real run, which was the milestone.

## What I built

`deploy.sh` is a state machine: checked, fetched, rendered, pulled, provisioned, migrated, started, verified, recorded. Each state goes to a journal before the next step, so a deploy that dies half way leaves a record of where it stopped. Before the first provisioning write a failure just throws the run away. After it there is no going back to "nothing happened", so the script starts the previous release on the newest env file and schema. That only works because every shared change is additive and the previous release still runs on it.

CI gets in over Tailscale with a short-lived identity, one SSH key per environment, and one forced command on the server. The digest the images job pushed travels to both environments, and the server refuses an image whose digest differs. Secrets are rendered from 1Password right before the start, into a new file, so a 1Password outage aborts the deploy and leaves the running services alone. Each `api` and `agent` deploy imports its own RabbitMQ definitions, and only when they are newer than the ones already there.

Outside the box, UptimeRobot watches the site and Uptime Kuma's status page, because Kuma dies with the server.

## What I learned

Most of it came from the first real run, at boundaries no stub covers:

- **Tailscale answered 403.** The OIDC subject GitHub signs uses the immutable form with numeric ids, and the two credentials had their descriptions swapped. Rebinding each by its client ID fixed it.
- **Secrets did not reach the called workflow.** A reusable workflow gets no secrets unless the caller passes them. `secrets: inherit` for now; passing them by name is a follow-up.
- **The op daemon held my lock.** `op inject` started a background daemon that inherited the lock's file descriptor, so every later deploy exited 75 as "busy". `lsof` showed it. Closing that descriptor in the wrapper fixed it.
- **Next.js redirected my smoke.** `/es/` answers 308 and curl follows nothing, so the web check failed on a working site.
- **A manual redeploy hung.** From my root shell, `timeout` put compose in a background process group, compose touched the terminal, and the kernel stopped both. The time limit never fired. Stdin from `/dev/null` fixed it, and the rollback after the kill did exactly what the design said.
- **Hetzner blocks outbound SMTP on 465.** The Kuma mail had to go over 587 with STARTTLS.
- **Kuma had no notification at all.** The backup heartbeat from WP-8 could never have alerted anyone. A dead man's switch with no one on the other end is just a dashboard. <!-- owner: check -->

The design lessons: a tag is a movable pointer and the digest is the bytes, so I only half answered what happens when a tag moves between staging and the approval. A rollback is a new action forward, not an undo, which is the same idea as a refund in a saga. And a monitor has to live outside what it watches.

## What I would change

I would run one real deploy much earlier, even of a hello world image, before writing the full state machine. Four of the faults were about the path into the server, not the deploy logic. <!-- owner: check -->

I would seed staging before the first web deploy. The plan had it after, and the smoke failed on an empty database.

I skipped the check questions of the last steps and deferred the explain-back to finish the WP. It was the right call for the day, but those questions now wait for the R0 review. <!-- owner: check -->

**Next:** the R0 review over the study backlog, then R1 starts. Production web waits for its content (#162), and HSTS goes up in its own PR.
