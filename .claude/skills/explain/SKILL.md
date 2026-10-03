---
name: explain
description: Explain a concept, pattern, file or decision of this codebase from first principles with a concrete trace (real payloads, file:line). Use whenever the owner asks "why" or "how does X work".
user-invocable: true
arguments: [topic]
allowed-tools: Read, Glob, Grep, Bash(git log*), Bash(git blame*)
---
Explain: $topic

Rules for the explanation:
- Start from first principles in two or three sentences a strong backend engineer who has never used this would follow.
- Then one concrete trace through this repository: real file paths with line numbers, the actual payload, SQL or message, in order. Prefer what exists in the code; when the code does not exist yet, trace what the ADR specifies and say so.
- Name the pattern(s) and link the ADR(s) that decided it (`docs/adr/`).
- End with what the owner could change and what would break if they did, and one question that checks understanding.
- Plain English, no hype words, no em dashes. Short paragraphs, no bullet walls.
