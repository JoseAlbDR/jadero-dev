---
id: ADR-030
title: "Contact service"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-28, D-37, D-46]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-030: Contact service (new 2026-10-02)")
---

# ADR-030: Contact service

**Status:** Accepted (owner review 2026-10-03, D-37 and D-46). Replaces the earlier D-37 recommendation of "no contact form in v1".

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-28, D-37, D-46). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner wants a contact form with bot protection as a service of its own. The old site's reCAPTCHA service retires at cutover. Hetzner blocks outbound ports 25 and 465 on new cloud servers, so mail goes out through a provider's HTTPS API (or SMTP submission on 587).

## Flow

browser to nginx (`/api/contact`, edge rate limit) to `contact`: Zod validation, honeypot field and time-to-submit check, bot token verified server-side, per-IP limit; then in one transaction the submission is stored (`received`) and an outbox row `contact.received.v1` is written; the response is `202 Accepted`. The relay publishes, the mailer consumer (same service) sends a notification **to the owner only** through a `MailPort` adapter and marks the submission `notified`. On provider failure: circuit breaker, retries with backoff, dead-letter queue; the submission is never lost and is visible in the admin.

## Security

no auto-reply to the address the visitor typed (an auto-reply turns a form into a spam relay; the owner answers by hand); length limits and sanitization on every field; IP stored as a salted hash; retention of 12 months, then purge (named in the privacy notice); admin endpoints behind nginx `auth_request`.

## Options, bot protection

Cloudflare Turnstile (free, privacy-friendly, usually invisible, works without proxying the site through Cloudflare); Google reCAPTCHA v3 (score-based, familiar from the old site, but Google tracking and cookie-consent implications); hCaptcha; honeypot plus timing only (no third party, weak against targeted bots).

## Options, mail provider

Resend (free tier 3,000 emails per month, 100 per day, simple API); Postmark (free developer plan of 100 emails per month, strong deliverability reputation); SMTP submission on port 587 through a mailbox the owner already has; self-hosted SMTP (blocked ports and deliverability pain: discarded).

## Decision

Turnstile + honeypot (the same Turnstile site key also protects the chat, ADR-021); Resend behind `MailPort`, with a fake adapter for tests and Postmark as the documented alternative.

## Consequences

the contact service is the smallest complete microservice in the system, so it is the recommended **first service to build after the messaging foundation**: it exercises outbox, consumer, idempotency, retries, dead letters and a circuit breaker on a tiny domain before the same patterns meet the agent.

## Pattern names

asynchronous request-reply (202 Accepted), store-and-forward, transactional outbox, circuit breaker, anti-spam relay rule.
