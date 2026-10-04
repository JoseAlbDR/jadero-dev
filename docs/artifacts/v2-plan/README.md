# jadero.dev v2 Plan (archived artifact)

Archive of the review page at https://claude.ai/artifact/HJZzB1Bkafy3t22kcUnHVA, taken on 2026-10-04 from version 1790988459-6bab (ADR-046). The owner used it to mark each of the 76 plan decisions with a choice and a note.

| File | Size | What it is |
| --- | --- | --- |
| `index.html` | 25,634 bytes | The page as served, including the document skeleton the artifact service adds at publish time. It loads `data.json` and, inside claude.ai, reads and writes the `marks` collection of the artifact database (capabilities `db` and `user`). |
| `data.json` | 264,885 bytes | The published data file, byte-identical to the artifact. Generated from `docs/plan/decisions.json`. |
| `owner-marks.json` | 15055 bytes | The 76 documents of the `marks` collection (`{ at, choice, note }` per decision id), exported from the artifact database on 2026-10-04. |

## Differences from the repo and from the live artifact

- **`data.json` is stale.** D-23 changed after the page was last published: the visual direction moved to Bento glass with the agent terminal (ADR-045, PRs #88 and #90). `docs/plan/decisions.json` has the new D-23 and the review counts; this file still has the old one. The page was not republished, because the owner's marks live in its database and a republish is the owner's call.
- **`docs/plan/owner-marks.json` is the same export.** Both files were refreshed from the live database on 2026-10-04, so the later edits for D-16, D-45, D-49, D-50, D-52, D-59 and D-67 are in both.
- **Not redacted.** The notes name the owner's employer and the owner's work there. That passes the content rules (ADR-031): no proprietary code or configuration, no client names, no personal data, no secrets.

## Republish

Only on the owner's request. Regenerate `data.json` from `docs/plan/decisions.json` (`cp docs/plan/decisions.json docs/artifacts/v2-plan/data.json`), then publish `index.html` with the Artifact tool, `url` set to the link above and `files` mapping `data.json` to this folder's copy. Do not pass `capabilities`, so the page keeps `db` and `user`, and never write to the `marks` collection: it holds the owner's marks.
