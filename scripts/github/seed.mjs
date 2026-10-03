#!/usr/bin/env node
// WP-49: seed GitHub tracking (ADR-041, report.md 14.1) from docs/plan/decisions.json.
// Idempotent: everything is looked up by name or title before it is created, so it can be re-run.
// Needs: node >= 20, gh >= 2.60 logged in with scopes repo, project (gh auth refresh -s project,repo).
// Usage: node scripts/github/seed.mjs [--repo OWNER/NAME] [--dry-run] [--skip-project]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const REPO = argValue("--repo") ?? "JoseAlbDR/jadero-dev";
const [OWNER] = REPO.split("/");
const DRY = args.has("--dry-run");
const SKIP_PROJECT = args.has("--skip-project");
const plan = JSON.parse(
  readFileSync(new URL("../../docs/plan/decisions.json", import.meta.url), "utf8"),
);

const log = (...m) => console.log(...m);
const READ_ONLY =
  /^(api (?!.*--method)|label list|issue list|project list|project view|project field-list|project item-list)/;
function gh(cmdArgs, { json = false, input } = {}) {
  const line = cmdArgs.join(" ");
  if (DRY && !READ_ONLY.test(line)) {
    log("  dry-run: gh", line.length > 160 ? line.slice(0, 160) + "..." : line);
    return json ? null : "";
  }
  const out = execFileSync("gh", cmdArgs, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
  return json ? JSON.parse(out || "null") : out.trim();
}
// REST helpers: the REST API returns both `number` and the numeric `id` that the sub-issue and dependency endpoints need
// (gh issue list --json id returns the GraphQL node id, which those endpoints reject).
const api = (path, body) =>
  gh(["api", path, ...(body ? ["--method", "POST", "--input", "-"] : [])], {
    json: true,
    input: body ? JSON.stringify(body) : undefined,
  });
const apiAll = (path) => (gh(["api", path, "--paginate", "--slurp"], { json: true }) ?? []).flat();

// 1. Labels -----------------------------------------------------------------
const COLORS = { type: "0E8A16", tag: "1D76DB", size: "FBCA04", area: "5319E7", flags: "B60205" };
const DESCRIPTIONS = {
  "type:epic": "The one roadmap issue",
  "type:wp": "A work package from the plan",
  "type:task": "A step inside a WP",
  "type:bug": "Behavior differs from an ADR or acceptance criterion",
  "type:chore": "No behavior change",
  "type:adr": "Architecture decision proposal",
  "tag:learning": "Explained through the learning gate (report.md 12.3)",
  "tag:frontend": "Result only, screenshots",
  "tag:ops": "Operations, owner present",
  "tag:owner": "The owner's own work",
  "tag:agent-tooling": "Claude Code tooling for the repo",
  blocked: "Waiting on another issue",
  "needs-decision": "An ADR or owner decision is pending",
  optional: "Ships only if it earns its place",
  superseded: "Replaced by another WP; closed as not planned",
  security: "Security relevant; reviewer agent checks OWASP mapping",
};
log("Labels");
const existingLabels = new Set(
  gh(["label", "list", "--repo", REPO, "--limit", "200", "--json", "name", "--jq", ".[].name"])
    .split("\n")
    .filter(Boolean),
);
for (const [group, names] of Object.entries(plan.tracking.labels)) {
  for (const n of names) {
    if (existingLabels.has(n)) continue;
    gh([
      "label",
      "create",
      n,
      "--repo",
      REPO,
      "--color",
      COLORS[group],
      "--description",
      DESCRIPTIONS[n] ?? group,
      "--force",
    ]);
    log("  created", n);
  }
}

// 2. Milestones R0..R7 (no due dates: D-75 e) --------------------------------
log("Milestones");
const msByTitle = new Map(
  apiAll(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m]),
);
for (const r of plan.tracking.milestones) {
  const title = `${r.id} ${r.name}`;
  if (msByTitle.has(title)) continue;
  const created = api(`repos/${REPO}/milestones`, {
    title,
    description: `Exit criterion: ${r.exitCriterion}`,
  });
  if (created?.number) msByTitle.set(title, created);
  log("  created", title);
}
const milestoneNumber = (releaseId) => {
  const r = plan.tracking.milestones.find((m) => m.id === releaseId);
  return msByTitle.get(`${r.id} ${r.name}`)?.number;
};

// 3. Issues: one listing, looked up by exact title (search indexing lags behind creation) ----
const issuesByTitle = new Map(
  apiAll(`repos/${REPO}/issues?state=all&per_page=100`)
    .filter((i) => !i.pull_request)
    .map((i) => [i.title, i]),
);
function ensureIssue({ title, body, labels, milestone }) {
  const found = issuesByTitle.get(title);
  if (found) return found;
  const created = api(`repos/${REPO}/issues`, {
    title,
    body,
    labels,
    ...(milestone ? { milestone } : {}),
  }) ?? { number: 0, id: 0, html_url: title };
  issuesByTitle.set(title, created);
  log("  created", created.html_url ?? `#${created.number}`);
  return created;
}

log("Epic");
const EPIC_TITLE = "jadero.dev v2";
const epic = ensureIssue({
  title: EPIC_TITLE,
  labels: ["type:epic"],
  body: [
    "The roadmap of jadero.dev v2 as one epic; one sub-issue per work package. Plan: `docs/plan/report.md` (section 14), decisions: `docs/adr/`.",
    "",
    "## Releases (no dates; the order is the commitment)",
    "",
    ...plan.tracking.milestones.map(
      (m) => `- **${m.id} ${m.name}**: ${m.exitCriterion}. WPs: ${m.workPackages.join(", ")}`,
    ),
    "",
    "Lifecycle per WP: Backlog, Ready (acceptance written, ADRs decided, explainer scheduled), In progress (branch `wp/NN-slug`), In review (PR, CI, reviewer agent), Done (merge closes it), released (release-please), deployed (staging, then production), written up (journal).",
  ].join("\n"),
});

// 4. Work packages ------------------------------------------------------------
log("Work packages");
const TAG_LABEL = {
  learning: "tag:learning",
  frontend: "tag:frontend",
  ops: "tag:ops",
  owner: "tag:owner",
  "agent-tooling": "tag:agent-tooling",
};
const SUPERSEDED = new Set(["WP-30", "WP-34"]);
const wpIssues = new Map(); // WP id -> issue (REST shape: number, id, state)
for (const wp of plan.workPackages) {
  const labels = ["type:wp", TAG_LABEL[wp.tag] ?? "tag:learning", `size:${wp.size}`];
  if (SUPERSEDED.has(wp.id)) labels.push("superseded");
  if (/optional/i.test(wp.title)) labels.push("optional");
  const learning = wp.tag === "learning";
  const body = [
    `**Release:** ${wp.milestone}  ·  **Tag:** ${wp.tag}  ·  **Size:** ${wp.size}`,
    wp.dependsOn?.length ? `**Depends on:** ${wp.dependsOn.join(", ")}` : "**Depends on:** nothing",
    "",
    "## Deliverable",
    "",
    wp.deliverable,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] Every item of the deliverable is present and demonstrated (screenshot, test or trace linked in the PR)",
    "- [ ] ADRs this WP implements are listed in the PR and nothing contradicts them",
    ...(learning
      ? [
          "",
          "## Learning gate (report.md 12.3; D-38 fast path allowed for known steps)",
          "",
          `- [ ] Explainer \`docs/learning/${wp.id.toLowerCase()}.md\` written, or the step marked \`known\``,
          "- [ ] Decision recorded (ADR link in the explainer front matter)",
          "- [ ] Small visible steps in the main session, each with a two-line note in the explainer",
          "- [ ] Explained back by the owner",
          "",
          `**The owner learns:** ${wp.learns || "see deliverable"}`,
        ]
      : []),
    "",
    "## Definition of done",
    "",
    "- [ ] Tests green with the coverage gates of ADR-009",
    "- [ ] AGENTS.md and docs updated where a rule or command changed",
    learning ? "- [ ] Journal post drafted" : "- [ ] n/a journal post",
    ...(wp.milestone === "R0"
      ? [
          "- [ ] Deployed to staging: n/a until WP-8 and WP-9 land",
          "- [ ] Changelog entry (release-please): n/a until WP-6 and WP-7 land",
        ]
      : ["- [ ] Deployed to staging", "- [ ] Changelog entry present (release-please)"]),
    "",
    "Content rules apply: public-level only, no employer details, no secrets (the repo becomes public).",
  ].join("\n");
  wpIssues.set(
    wp.id,
    ensureIssue({
      title: `${wp.id}: ${wp.title}`,
      body,
      labels,
      milestone: milestoneNumber(wp.milestone),
    }),
  );
}

// 4b. Sub-issues of the epic, "blocked by" dependencies, close superseded ------
log("Hierarchy and dependencies");
if (!DRY) {
  const existingSubs = new Set(
    apiAll(`repos/${REPO}/issues/${epic.number}/sub_issues?per_page=100`).map((s) => s.number),
  );
  for (const [wpId, issue] of wpIssues) {
    if (existingSubs.has(issue.number)) continue;
    try {
      api(`repos/${REPO}/issues/${epic.number}/sub_issues`, { sub_issue_id: issue.id });
    } catch {
      log("  could not add sub-issue", wpId);
    }
  }
  for (const wp of plan.workPackages) {
    const blocked = wpIssues.get(wp.id);
    let existing = null;
    for (const dep of wp.dependsOn ?? []) {
      const blocker = wpIssues.get(dep);
      if (!blocker || !blocked) continue;
      try {
        existing ??= new Set(
          apiAll(`repos/${REPO}/issues/${blocked.number}/dependencies/blocked_by?per_page=100`).map(
            (d) => d.number,
          ),
        );
        if (existing.has(blocker.number)) continue;
        api(`repos/${REPO}/issues/${blocked.number}/dependencies/blocked_by`, {
          issue_id: blocker.id,
        });
      } catch {
        log(`  dependencies API unavailable for ${wp.id}; the body carries "Depends on"`);
        break;
      }
    }
  }
  for (const wpId of SUPERSEDED) {
    const issue = wpIssues.get(wpId);
    if (!issue || issue.state === "closed") continue;
    const comment =
      wpId === "WP-30"
        ? "Superseded by WP-36 (D-58). Id kept for traceability."
        : "Superseded by D-7 d: secrets come from 1Password through op inject (WP-8, WP-9).";
    try {
      gh([
        "issue",
        "close",
        String(issue.number),
        "--repo",
        REPO,
        "--reason",
        "not planned",
        "--comment",
        comment,
      ]);
      log("  closed", wpId, "as not planned");
    } catch {}
  }
} else {
  log(
    "  dry-run: sub-issues, blocked-by links and closing WP-30/WP-34 are skipped (they need the created issue ids)",
  );
}

// 5. Project ------------------------------------------------------------------
if (!SKIP_PROJECT) {
  log("Project");
  const PROJECT_TITLE = "jadero.dev v2";
  const projects =
    gh(["project", "list", "--owner", OWNER, "--format", "json", "--limit", "50"], { json: true })
      ?.projects ?? [];
  let project = projects.find((p) => p.title === PROJECT_TITLE);
  if (!project) {
    project = gh(
      ["project", "create", "--owner", OWNER, "--title", PROJECT_TITLE, "--format", "json"],
      { json: true },
    );
    log("  created project", project?.number ?? "(dry-run)");
    if (project?.number)
      gh(["project", "link", String(project.number), "--owner", OWNER, "--repo", REPO]);
  }
  if (project?.number) {
    const N = String(project.number);
    const STATUS_OPTIONS = ["Backlog", "Ready", "In progress", "In review", "Done"];
    const want = [
      ["WP id", "TEXT"],
      ["Tag", "SINGLE_SELECT", ["learning", "frontend", "ops", "owner", "agent-tooling"]],
      ["Size", "SINGLE_SELECT", ["S", "M", "L"]],
      [
        "Area",
        "SINGLE_SELECT",
        ["web", "admin", "api", "agent", "contact", "messaging", "mcp", "evals", "infra"],
      ],
      [
        "Learning gate",
        "SINGLE_SELECT",
        ["n/a", "explainer written", "decision recorded", "explained back"],
      ],
      ["Release", "SINGLE_SELECT", plan.tracking.milestones.map((m) => m.id)],
      ["Start date", "DATE"],
      ["Target date", "DATE"],
    ];
    let fields =
      gh(["project", "field-list", N, "--owner", OWNER, "--format", "json", "--limit", "50"], {
        json: true,
      })?.fields ?? [];
    const have = new Set(fields.map((f) => f.name));
    for (const [name, type, options] of want) {
      if (have.has(name)) continue;
      const cmd = [
        "project",
        "field-create",
        N,
        "--owner",
        OWNER,
        "--name",
        name,
        "--data-type",
        type,
      ];
      if (options) cmd.push("--single-select-options", options.join(","));
      gh(cmd);
      log("  created field", name);
    }
    // Status options: the UI default is Todo/In Progress/Done; rename through GraphQL (no gh subcommand for it).
    const status = fields.find((f) => f.name === "Status");
    if (status && status.options?.map((o) => o.name).join("|") !== STATUS_OPTIONS.join("|")) {
      const COLORS = ["GRAY", "BLUE", "YELLOW", "PURPLE", "GREEN"];
      const opts = STATUS_OPTIONS.map(
        (name, i) => `{name: "${name}", color: ${COLORS[i]}, description: ""}`,
      ).join(", ");
      const mutation = `mutation { updateProjectV2Field(input: {fieldId: "${status.id}", singleSelectOptions: [${opts}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
      try {
        gh(["api", "graphql", "--method", "POST", "-f", `query=${mutation}`]);
        log("  Status options set to", STATUS_OPTIONS.join(", "));
      } catch {
        log("  could not rename Status options; do it in the Project UI (see README)");
      }
    }
    if (!DRY) {
      // Add items, then fill WP id, Tag, Size and Release per item (Area and Learning gate are set during the WP).
      const projectId = gh(["project", "view", N, "--owner", OWNER, "--format", "json"], {
        json: true,
      })?.id;
      const listItems = () =>
        gh(["project", "item-list", N, "--owner", OWNER, "--format", "json", "--limit", "500"], {
          json: true,
        })?.items ?? [];
      let items = listItems();
      const inProject = new Set(items.map((i) => i.content?.number));
      let added = 0;
      for (const issue of [epic, ...wpIssues.values()]) {
        if (inProject.has(issue.number)) continue;
        gh([
          "project",
          "item-add",
          N,
          "--owner",
          OWNER,
          "--url",
          `https://github.com/${REPO}/issues/${issue.number}`,
        ]);
        added++;
      }
      if (added) {
        items = listItems();
        log("  added", added, "items");
      }
      fields =
        gh(["project", "field-list", N, "--owner", OWNER, "--format", "json", "--limit", "50"], {
          json: true,
        })?.fields ?? [];
      const field = (name) => fields.find((f) => f.name === name);
      const optionId = (fieldName, value) =>
        field(fieldName)?.options?.find((o) => o.name === value)?.id;
      const setText = (itemId, fieldName, text) =>
        gh([
          "project",
          "item-edit",
          "--id",
          itemId,
          "--project-id",
          projectId,
          "--field-id",
          field(fieldName).id,
          "--text",
          text,
        ]);
      const setOption = (itemId, fieldName, value) => {
        const oid = optionId(fieldName, value);
        if (oid)
          gh([
            "project",
            "item-edit",
            "--id",
            itemId,
            "--project-id",
            projectId,
            "--field-id",
            field(fieldName).id,
            "--single-select-option-id",
            oid,
          ]);
      };
      if (projectId && field("WP id") && field("Tag") && field("Size") && field("Release")) {
        // item-list exposes field values under keys derived from the field name; an item that already carries its WP id is skipped.
        const hasWpId = (item, id) =>
          Object.entries(item).some(
            ([k, v]) => k.replace(/\W/g, "").toLowerCase() === "wpid" && v === id,
          );
        let set = 0;
        for (const wp of plan.workPackages) {
          const item = items.find((i) => i.content?.number === wpIssues.get(wp.id)?.number);
          const itemId = item?.id;
          if (!itemId || hasWpId(item, wp.id)) continue;
          set++;
          setText(itemId, "WP id", wp.id);
          setOption(itemId, "Tag", wp.tag);
          setOption(itemId, "Size", wp.size);
          setOption(itemId, "Release", wp.milestone);
          if (SUPERSEDED.has(wp.id)) setOption(itemId, "Status", "Done");
        }
        log("  field values set for", set, "work packages");
      } else {
        log(
          "  could not set field values (project id or fields missing); set WP id, Tag, Size, Release by hand",
        );
      }
      log(
        "  Manual steps left (no API): the four views and the built-in workflows. See scripts/github/README.md.",
      );
    }
  }
}
log("Done.");
