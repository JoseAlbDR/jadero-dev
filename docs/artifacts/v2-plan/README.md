# jadero.dev v2 Plan (archived artifact)

Archive of the review page at https://claude.ai/artifact/HJZzB1Bkafy3t22kcUnHVA, taken on 2026-10-04 from version 1790988459-6bab (ADR-046). The owner used it to mark each of the 76 plan decisions with a choice and a note.

| File | Size | What it is |
| --- | --- | --- |
| `index.html` | 25,634 bytes | The page as served, including the document skeleton the artifact service adds at publish time. It loads `data.json` and, inside claude.ai, reads and writes the `marks` collection of the artifact database (capabilities `db` and `user`). |
| `data.json` | 264,885 bytes | The published data file, byte-identical to the artifact. Generated from `docs/plan/decisions.json`. |
| `owner-marks.json` | 14,672 bytes | The 76 documents of the `marks` collection (`{ at, choice, note }` per decision id), exported from the artifact database on 2026-10-04. |

## Differences from the repo and from the live artifact

- **`data.json` is stale.** D-23 changed after the page was last published: the visual direction moved to Bento glass with the agent terminal (ADR-045, PRs #88 and #90). `docs/plan/decisions.json` has the new D-23 and the review counts; this file still has the old one. The page was not republished, because the owner's marks live in its database and a republish is the owner's call.
- **`owner-marks.json` is newer than `docs/plan/owner-marks.json`.** The live database has later edits for D-16, D-45, D-49, D-50, D-52, D-59 and D-67 than the export in `docs/plan/`.
- **Redacted for the content rules (ADR-031).** The notes of D-4, D-6, D-45, D-52 and D-76 named the owner's employer and some of its internals. Those passages read `[redacted: ...]` or `[employer]` here; the live database still has the original text.

## Republish

Only on the owner's request. Regenerate `data.json` from `docs/plan/decisions.json` (`cp docs/plan/decisions.json docs/artifacts/v2-plan/data.json`), then publish `index.html` with the Artifact tool, `url` set to the link above and `files` mapping `data.json` to this folder's copy. Do not pass `capabilities`, so the page keeps `db` and `user`, and never write to the `marks` collection: it holds the owner's marks.
