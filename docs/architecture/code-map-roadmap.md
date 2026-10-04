# Code map roadmap

Improvements to `docs/architecture/code-map.html` that the owner approved for later. Focus by selection, layer toggles and the event explorer shipped first (2026-10-04) because the graphs were already too crowded to read. The items below build on them; each one is a separate change, in any order.

## (a) Failure simulator

A toggle row per scenario: "RabbitMQ down", "Postgres down", "agent down" (later one per process type). Turning one on greys out the boxes and arrows that stop and keeps the ones that still work: with RabbitMQ down, `api` still answers and rows pile up in `messaging.outbox`, while the relay, the exchange and the consumer go grey. The data comes from `docs/plan/report.md` section 3.5 (who sees what when each part goes down), written once per scenario as the list of nodes and edges that stop plus one caption. Why: a review on the code map is a design review of what happens when a piece fails, and the table in 3.5 is easier to remember as a picture. It also turns the outbox and the inbox from text into something you can watch absorb a failure.

## (b) Timeline by release

A slider or a row of buttons R0 to R7 that shows the map as it was planned at each release and as it really is, with planned and real side by side. Every node already carries `wp` and `status`; it needs the release each WP belongs to (from the GitHub milestones or `docs/plan/report.md` section 14) and, for real nodes, the release they landed in. Why: the map shows today, but a portfolio reader and the owner both want to see how the system grew, and where the plan and the result drifted apart.

## (c) Data generated from the code

Generate the facts and keep only the explanations hand-written. Workspace dependencies come from the dependency-cruiser JSON output, queues and bindings from `packages/messaging/src/topology`, events from the `eventContracts` list in `packages/contracts`. A script merges them into the JSON block and a check (in `pnpm verify` or CI) fails when the map and the code drift apart, the same way `pnpm adr:index --check` and the topology test already do. Why: the map is updated by hand in every WP, and a forgotten arrow is a wrong design review. Placement, captions and the what/how/why texts stay hand-written, because those are the parts that teach.

## (d) Search box

One input at the top that filters boxes, cards and steps by label, sub-label and file path, jumps to the first match and opens its details. Why: with eight sections and more services coming, "where is the inbox?" should take one keystroke, not a scroll.

## (e) Links to source files

Each entry in a node's `files` becomes a link to the file on GitHub (main branch, or the commit the map was last updated at). Why: the map explains a design; the next question is always "show me the code", and the repo becomes public, so the links work for every reader.

## (f) Quiz mode

A toggle that hides labels and asks questions on the graph: "where does the outbox row live?", "which process talks to RabbitMQ for api?", "click the box that dedupes a redelivery". Answers are checked against the same JSON; wrong answers show the right box and the node's "why". Why: the learning protocol ends every WP with an explain-back, and recall from a picture is the same exercise in a form the owner can repeat on a phone between WPs.
