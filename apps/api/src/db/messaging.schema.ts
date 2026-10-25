// The messaging tables api uses, for drizzle-kit only (drizzle.config.ts): api publishes events
// through the outbox, and since WP-14 consumes them too (api-worker's revalidation consumer on
// `api.revalidate`), so it has the inbox as well (WP-10 Q1 A, WP-14 D5). drizzle-kit takes file
// paths, not package names, so this file re-exports from `@jadero/messaging/schema`; the
// `messaging` schema value is what makes it write `CREATE SCHEMA "messaging"`.
export { inbox, messaging, outbox } from "@jadero/messaging/schema";
