// Runs with the Node test runner (`node --test`), like the ADR scripts: no dependencies.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entriesOlderThanBase,
  journalOnlyGrew,
  journalOrderProblems,
  migrationViolations,
  parseNameStatus,
} from "./check-migrations.mjs";

const entry = (idx, when, tag) => ({ idx, version: "7", when, tag, breakpoints: true });
const journal = (...entries) => JSON.stringify({ version: "7", dialect: "postgresql", entries });
const facts = (overrides = {}) => ({
  journalOnlyGrew: () => true,
  differsOnBase: () => false,
  ...overrides,
});

describe("parseNameStatus", () => {
  it("reads one status letter and a path per line, ignoring the similarity score", () => {
    assert.deepEqual(
      parseNameStatus("A\tapps/api/drizzle/0001_x.sql\nM\tapps/api/src/main.ts\nT100\tapps/a b\n"),
      [
        { status: "A", path: "apps/api/drizzle/0001_x.sql" },
        { status: "M", path: "apps/api/src/main.ts" },
        { status: "T", path: "apps/a b" },
      ],
    );
  });
});

describe("migrationViolations", () => {
  it("lets a branch add migrations and grow the journal", () => {
    const changes = [
      { status: "A", path: "apps/api/drizzle/0001_projects.sql" },
      { status: "A", path: "apps/api/drizzle/meta/0001_snapshot.json" },
      { status: "M", path: "apps/api/drizzle/meta/_journal.json" },
    ];
    assert.deepEqual(migrationViolations(changes, facts()), []);
  });

  it("fails an edited or deleted migration that main already has", () => {
    const changes = [
      { status: "M", path: "apps/agent/drizzle/0000_enable_vector.sql" },
      { status: "D", path: "apps/api/drizzle/0000_messaging.sql" },
      { status: "D", path: "apps/api/drizzle/meta/_journal.json" },
      { status: "M", path: "apps/api/drizzle/meta/0000_snapshot.json" },
    ];
    const problems = migrationViolations(changes, facts());
    assert.equal(problems.length, 4);
    assert.match(problems[0], /0000_enable_vector\.sql: changed \(M\)/);
    assert.match(problems[1], /0000_messaging\.sql: deleted/);
  });

  it("fails a journal whose existing entries changed", () => {
    const changes = [{ status: "M", path: "apps/api/drizzle/meta/_journal.json" }];
    const problems = migrationViolations(changes, facts({ journalOnlyGrew: () => false }));
    assert.match(problems[0], /entries main already has were changed/);
  });

  it("fails an added file that main has under the same name with other content", () => {
    const changes = [{ status: "A", path: "apps/api/drizzle/0001_projects.sql" }];
    const problems = migrationViolations(changes, facts({ differsOnBase: () => true }));
    assert.match(problems[0], /merge main, delete yours and run db:generate again/);
  });

  it("ignores everything outside apps/<service>/drizzle/", () => {
    const changes = [
      { status: "D", path: "apps/api/src/migrate-raw-sql.ts" },
      { status: "M", path: "packages/messaging/src/schema.ts" },
      { status: "M", path: "apps/api/drizzle.config.ts" },
    ];
    assert.deepEqual(migrationViolations(changes, facts()), []);
  });
});

describe("journalOnlyGrew", () => {
  const base = journal(entry(0, 1, "0000_a"));

  it("accepts appended entries", () => {
    assert.equal(
      journalOnlyGrew(base, journal(entry(0, 1, "0000_a"), entry(1, 2, "0001_b"))),
      true,
    );
  });

  it("rejects an edited timestamp, a removed or a reordered entry", () => {
    assert.equal(journalOnlyGrew(base, journal(entry(0, 5, "0000_a"))), false);
    assert.equal(journalOnlyGrew(base, journal()), false);
    assert.equal(
      journalOnlyGrew(base, journal(entry(0, 2, "0001_b"), entry(1, 1, "0000_a"))),
      false,
    );
  });

  it("rejects a changed format and text that is not JSON", () => {
    const v8 = JSON.stringify({ version: "8", dialect: "postgresql", entries: [] });
    assert.equal(journalOnlyGrew(base, v8), false);
    assert.equal(journalOnlyGrew(base, "{"), false);
  });
});

describe("journalOrderProblems", () => {
  const path = "apps/api/drizzle/meta/_journal.json";

  it("accepts entries in idx order with strictly increasing when", () => {
    const text = journal(entry(0, 100, "0000_a"), entry(1, 200, "0001_b"), entry(2, 300, "0002_c"));
    assert.deepEqual(journalOrderProblems(path, text), []);
    assert.deepEqual(journalOrderProblems(path, journal()), []);
  });

  it("fails a when that is not greater than the previous entry's, naming the entry and the fix", () => {
    const text = journal(entry(0, 100, "0000_a"), entry(1, 300, "0001_b"), entry(2, 300, "0002_c"));
    const problems = journalOrderProblems(path, text);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^apps\/api\/drizzle\/meta\/_journal\.json: entry 0002_c \(idx 2\)/);
    assert.match(problems[0], /not after 0001_b \(300\)/);
    assert.match(problems[0], /delete it and run db:generate again/);
  });

  it("fails a gap in idx and a tag whose prefix does not match its idx", () => {
    const gap = journalOrderProblems(
      path,
      journal(entry(0, 100, "0000_a"), entry(2, 200, "0002_c")),
    );
    assert.equal(gap.length, 1);
    assert.match(gap[0], /entry 0002_c \(idx 2\) sits at position 1/);
    const tag = journalOrderProblems(
      path,
      journal(entry(0, 100, "0000_a"), entry(1, 200, "0002_b")),
    );
    assert.match(tag[0], /does not start with 0001_/);
  });

  it("fails text that is not a journal", () => {
    assert.match(journalOrderProblems(path, "{")[0], /not a journal/);
  });
});

describe("entriesOlderThanBase", () => {
  const path = "apps/api/drizzle/meta/_journal.json";
  const base = journal(entry(0, 100, "0000_a"), entry(1, 300, "0001_main"));

  it("accepts entries the branch adds after main's last", () => {
    const current = journal(
      entry(0, 100, "0000_a"),
      entry(1, 300, "0001_main"),
      entry(2, 400, "0002_b"),
    );
    assert.deepEqual(entriesOlderThanBase(path, base, current), []);
  });

  it("fails a new branch entry older than main's last, as after a hand-merged journal", () => {
    const current = journal(entry(0, 100, "0000_a"), entry(1, 200, "0001_branch"));
    const problems = entriesOlderThanBase(path, base, current);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /entry 0001_branch has when 200, not after main's last 0001_main \(300\)/,
    );
    assert.match(problems[0], /merge main, then regenerate/);
  });

  it("passes when main has no journal for the service yet", () => {
    assert.deepEqual(entriesOlderThanBase(path, null, journal(entry(0, 1, "0000_a"))), []);
  });
});
