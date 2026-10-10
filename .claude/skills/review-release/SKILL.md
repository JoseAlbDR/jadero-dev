---
name: review-release
description: Close a release's study backlog with a review loop in four phases (cold diagnostic, /teach on what still fails, mastery loop, spaced re-check). Runs in the main session because it teaches. Use when a release milestone is closed, before the release counts as closed.
user-invocable: true
arguments: [release]
allowed-tools: Read, Glob, Grep, Edit, Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git fetch*), Bash(git switch *), Bash(git checkout -b *), Bash(git add *), Bash(git commit *), Bash(git push*), Bash(gh pr *), Bash(pnpm verify*)
---
Review release $release. The order is test, teach, retest: the diagnostic finds what the owner already knows, so `/teach` is spent only on what still fails (retrieval practice, pretesting effect, spacing). The main session runs it, because it teaches and challenges; it reads only the `$release` section of `docs/learning/study-backlog.md` and the step log entries a line links to, never the whole backlog or other docs.

0. **Branch.** A `docs/` or `chore/` branch from `origin/main` (`docs/review-$release`). Marks and feedback are committed there, one commit per phase, and opened as one PR without `Closes`.
1. **Cold diagnostic.** One question per open `weak` or `weak again` line of $release, one at a time, with no explanation first. Each is still self-contained per `AGENTS.md` section 5: the context, the facts needed and a hint, never the answer; use the line's `Question feedback:` note to choose the form. Challenge each answer in a few lines. A right answer closes the line: `solid <date> (review)`. A wrong or partial one stays open and gets an updated `Question feedback:` note.
2. **`/teach`.** Only on the themes that still have a failing line, plus the `interesting` lines, two to four themes per run. The owner runs it from their local profile in the separate `study/` folder (`docs/sessions.md`, "Study a release"); this session prints the prompt with the exact lines and waits. The owner reviews what it generates. Mark the covered lines `studied <date>`.
3. **Mastery loop.** The questions on those themes again, reformulated from each line's `Question feedback:` note, each time with a new explanation and a new example, repeated until answered right; a right answer marks `solid <date> (review)`. Each `interesting` line closes with one transfer question: the same pattern in another domain (an online shop, payments, bookings, a typical company service), no project names. Every miss updates the line's feedback note.
4. **Spaced re-check.** Lines closed here come back as warm-ups in the next release's `/step` runs (`/step` step 2 may pick a `solid (review)` line when it is the oldest).

The release is closed only when no line of it stays open: move its heading from `(open)` to `(closed <date>)`. Style: plain English, no hype words, no em dashes.
