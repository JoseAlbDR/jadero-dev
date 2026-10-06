// The messaging tables agent uses, for drizzle-kit only (drizzle.config.ts): agent consumes events,
// so it needs the inbox and not the outbox until it publishes one (WP-10 Q1 A). drizzle-kit takes
// file paths, not package names, so this file re-exports from `@jadero/messaging/schema`; the
// `messaging` schema value is what makes it write `CREATE SCHEMA "messaging"`.
export { inbox, messaging } from "@jadero/messaging/schema";
