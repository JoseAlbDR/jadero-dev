#!/usr/bin/env node
// WP-49: seed GitHub tracking (ADR-041, report.md 14.1) from docs/plan/decisions.json.
// Idempotent: everything is looked up by name or title before it is created, so it can be re-run.
// Needs: node >= 20, gh >= 2.60 logged in with scopes repo, project (gh auth refresh -s project).
// Usage: node scripts/github/seed.mjs [--repo OWNER/NAME] [--dry-run] [--skip-project]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const argValue = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; };
const REPO = argValue("--repo") ?? "JoseAlbDR/jadero-dev";
const [OWNER, NAME] = REPO.split("/");
const DRY = args.has("--dry-run");
const SKIP_PROJECT = args.has("--skip-project");
const plan = JSON.parse(readFileSync(new URL("../../docs/plan/decisions.json", import.meta.url), "utf8"));

const log = (...m) => console.log(...m);
function gh(cmdArgs, { json = false, input } = {}) {
  if (DRY && !/^(api|issue list|label list|project list|project field-list|project item-list)/.test(cmdArgs.join(" ")) ) { log("  dry-run: gh", cmdArgs.join(" ")); return json ? [] : ""; }
  if (DRY && cmdArgs[0] === "api" && cmdArgs.includes("--method")) { log("  dry-run: gh", cmdArgs.join(" ")); return json ? {} : ""; }
  const out = execFileSync("gh", cmdArgs, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });
  return json ? JSON.parse(out || "null") : out.trim();
}

// 1. Labels -----------------------------------------------------------------
const COLORS = { type: "0E8A16", tag: "1D76DB", size: "FBCA04", area: "5319E7", flags: "B60205" };
const DESCRIPTIONS = {
  "type:epic": "The one roadmap issue", "type:wp": "A work package from the plan", "type:task": "A step inside a WP",
  "type:bug": "Behavior differs from an ADR or acceptance criterion", "type:chore": "No behavior change", "type:adr": "Architecture decision proposal",
  "tag:learning": "Explained through the learning gate (report.md 12.3)", "tag:frontend": "Result only, screenshots", "tag:ops": "Operations, owner present",
  "tag:owner": "The owner's own work", "tag:agent-tooling": "Claude Code tooling for the repo",
  blocked: "Waiting on another issue", "needs-decision": "An ADR or owner decision is pending", optional: "Ships only if it earns its place",
  superseded: "Replaced by another WP; closed as not planned", security: "Security relevant; reviewer agent checks OWASP mapping",
};
log("Labels");
const existingLabels = new Set(gh(["label", "list", "--repo", REPO, "--limit", "200", "--json", "name", "--jq", ".[].name"]).split("\n").filter(Boolean));
for (const [group, names] of Object.entries(plan.tracking.labels)) {
  for (const n of names) {
    if (existingLabels.has(n)) continue;
    gh(["label", "create", n, "--repo", REPO, "--color", COLORS[group], "--description", DESCRIPTIONS[n] ?? group, "--force"]);
    log("  created", n);
  }
}

// 2. Milestones R0..R7 (no due dates: D-75 e) --------------------------------
log("Milestones");
const milestones = gh(["api", `repos/${REPO}/milestones?state=all&per_page=100`], { json: true }) ?? [];
const msByTitle = new Map(milestones.map((m) => [m.title, m]));
for (const r of plan.tracking.milestones) {
  const title = `${r.id} ${r.name}`;
  if (msByTitle.has(title)) continue;
  const created = gh(["api", `repos/${REPO}/milestones`, "--method", "POST", "-f", `title=${title}`, "-f", `description=Exit criterion: ${r.exitCriterion}`], { json: true });
  if (created?.number) msByTitle.set(title, created);
  log("  created", title);
}
const milestoneNumber = (releaseId) => { const r = plan.tracking.milestones.find((m) => m.id === releaseId); return msByTitle.get(`${r.id} ${r.name}`)?.number; };

// 3. Epic ---------------------------------------------------------------------
log("Epic");
const findIssue = (title) => {
  const list = gh(["issue", "list", "--repo", REPO, "--state", "all", "--limit", "300", "--search", `in:title "${title}"`, "--json", "number,title,id"], { json: true }) ?? [];
  return list.find((i) => i.title === title);
};
const EPIC_TITLE = "jadero.dev v2";
let epic = findIssue(EPIC_TITLE);
if (!epic) {
  const body = [
    "The roadmap of jadero.dev v2 as one epic; one sub-issue per work package. Plan: `docs/plan/report.md` (section 14), decisions: `docs/adr/`.",
    "",
    "## Releases (no dates; the order is the commitment)",
    "",
    ...plan.tracking.milestones.map((m) => `- **${m.id} ${m.name}**: ${m.exitCriterion}. WPs: ${m.workPackages.join(", ")}`),
    "",
    "Lifecycle per WP: Backlog, Ready (acceptance written, ADRs decided, explainer scheduled), In progress (branch `wp/NN-slug`), In review (PR, CI, reviewer agent), Done (merge closes it), released (release-please), deployed (staging, then production), written up (journal).",
  ].join("\n");
  const url = gh(["issue", "create", "--repo", REPO, "--title", EPIC_TITLE, "--label", "type:epic", "--body", body]);
  epic = DRY ? { number: 0, id: 0 } : findIssue(EPIC_TITLE);
  log("  created", url || EPIC_TITLE);
}

// 4. Work packages as sub-issues ----------------------------------------------
log("Work packages");
const TAG_LABEL = { learning: "tag:learning", frontend: "tag:frontend", ops: "tag:ops", owner: "tag:owner", "agent-tooling": "tag:agent-tooling" };
const SUPERSEDED = new Set(["WP-30", "WP-34"]);
const wpIssues = new Map(); // WP id -> {number,id}
for (const wp of plan.workPackages) {
  const title = `${wp.id}: ${wp.title}`;
  let issue = findIssue(title);
  if (!issue) {
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
      ...(learning ? [
        "",
        "## Learning gate (report.md 12.3; D-38 fast path allowed for known steps)",
        "",
        "- [ ] Explainer `docs/learning/wp-NN.md` written, or the step marked `known`",
        "- [ ] Decision recorded (ADR link in the explainer front matter)",
        "- [ ] Small visible steps in the main session, each with a two-line note in the explainer",
        "- [ ] Explained back by the owner",
        "",
        `**The owner learns:** ${wp.learns || "see deliverable"}`,
      ] : []),
      "",
      "## Definition of done",
      "",
      "- [ ] Tests green with the coverage gates of ADR-009",
      "- [ ] AGENTS.md and docs updated where a rule or command changed",
      learning ? "- [ ] Journal post drafted" : "- [ ] n/a journal post",
      "- [ ] Deployed to staging",
      "- [ ] Changelog entry present (release-please)",
      "",
      "Content rules apply: public-level only, no employer details, no secrets (the repo becomes public).",
    ].join("\n");
    const cmd = ["issue", "create", "--repo", REPO, "--title", title, "--body", body];
    for (const l of labels) cmd.push("--label", l);
    const ms = milestoneNumber(wp.milestone);
    if (ms) cmd.push("--milestone", String(ms));
    gh(cmd);
    issue = DRY ? { number: 0, id: 0 } : findIssue(title);
    log("  created", title);
  }
  wpIssues.set(wp.id, issue);
}

// 4b. Attach as sub-issues of the epic, dependencies, close superseded -------
log("Hierarchy and dependencies");
if (!DRY) {
  const existingSubs = new Set((gh(["api", `repos/${REPO}/issues/${epic.number}/sub_issues?per_page=100`], { json: true }) ?? []).map((s) => s.number));
  for (const [wpId, issue] of wpIssues) {
    if (!existingSubs.has(issue.number)) {
      try { gh(["api", `repos/${REPO}/issues/${epic.number}/sub_issues`, "--method", "POST", "-F", `sub_issue_id=${issue.id}`]); } catch { log("  could not add sub-issue", wpId); }
    }
  }
  for (const wp of plan.workPackages) {
    for (const dep of wp.dependsOn ?? []) {
      const blocker = wpIssues.get(dep); const blocked = wpIssues.get(wp.id);
      if (!blocker || !blocked) continue;
      try { gh(["api", `repos/${REPO}/issues/${blocked.number}/dependencies/blocked_by`, "--method", "POST", "-F", `issue_id=${blocker.id}`]); }
      catch { /* dependencies API not available on this plan; the body carries "Depends on" */ }
    }
  }
  for (const wpId of SUPERSEDED) {
    const issue = wpIssues.get(wpId);
    if (issue) { try { gh(["issue", "close", String(issue.number), "--repo", REPO, "--reason", "not planned", "--comment", wpId === "WP-30" ? "Superseded by WP-36 (D-58). Id kept for traceability." : "Superseded by D-7 d: secrets come from 1Password through op inject (WP-8, WP-9)."]); } catch {} }
  }
}

// 5. Project ------------------------------------------------------------------
if (!SKIP_PROJECT) {
  log("Project");
  const PROJECT_TITLE = "jadero.dev v2";
  const projects = gh(["project", "list", "--owner", OWNER, "--format", "json", "--limit", "50"], { json: true })?.projects ?? [];
  let project = projects.find((p) => p.title === PROJECT_TITLE);
  if (!project) {
    project = gh(["project", "create", "--owner", OWNER, "--title", PROJECT_TITLE, "--format", "json"], { json: true });
    log("  created project", project?.number);
    if (project?.number) gh(["project", "link", String(project.number), "--owner", OWNER, "--repo", REPO]);
  }
  if (project?.number) {
    const fields = gh(["project", "field-list", String(project.number), "--owner", OWNER, "--format", "json", "--limit", "50"], { json: true })?.fields ?? [];
    const have = new Set(fields.map((f) => f.name));
    const want = [
      ["WP id", "TEXT"], ["Tag", "SINGLE_SELECT", ["learning", "frontend", "ops", "owner", "agent-tooling"]],
      ["Size", "SINGLE_SELECT", ["S", "M", "L"]], ["Area", "SINGLE_SELECT", ["web", "admin", "api", "agent", "contact", "messaging", "mcp", "evals", "infra"]],
      ["Learning gate", "SINGLE_SELECT", ["n/a", "explainer written", "decision recorded", "explained back"]],
      ["Release", "SINGLE_SELECT", plan.tracking.milestones.map((m) => m.id)], ["Start date", "DATE"], ["Target date", "DATE"],
    ];
    for (const [name, type, options] of want) {
      if (have.has(name)) continue;
      const cmd = ["project", "field-create", String(project.number), "--owner", OWNER, "--name", name, "--data-type", type];
      if (options) cmd.push("--single-select-options", options.join(","));
      gh(cmd); log("  created field", name);
    }
    if (!DRY) {
      const items = gh(["project", "item-list", String(project.number), "--owner", OWNER, "--format", "json", "--limit", "200"], { json: true })?.items ?? [];
      const inProject = new Set(items.map((i) => i.content?.number));
      for (const [wpId, issue] of wpIssues) {
        if (inProject.has(issue.number)) continue;
        gh(["project", "item-add", String(project.number), "--owner", OWNER, "--url", `https://github.com/${REPO}/issues/${issue.number}`]);
      }
      if (epic && !inProject.has(epic.number)) gh(["project", "item-add", String(project.number), "--owner", OWNER, "--url", `https://github.com/${REPO}/issues/${epic.number}`]);
      log("  items added. Manual steps left (no CLI support): Status options Backlog/Ready/In progress/In review/Done; views Board by status, Roadmap by Release, Table grouped by Tag, Learning (tag:learning); built-in workflows 'item added -> Backlog', 'PR opened -> In review', 'issue closed -> Done'. Field values per item (WP id, Tag, Size, Release) are set by scripts/github/project-fields.mjs if present, else by hand.");
    }
  }
}
log("Done.");
