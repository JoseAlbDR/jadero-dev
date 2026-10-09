import { describe, expect, it } from "vitest";
import { CvBullet, type CvBulletDocument, type StoredCvBullet } from "./cv-bullet.js";
import {
  ExperienceItem,
  type ExperienceItemDocument,
  type StoredExperienceItem,
} from "./experience-item.js";
import type { Locale } from "./locale.js";
import { Post, type PostDocument, type StoredPost } from "./post.js";
import { Profile, type ProfileDocument, type StoredProfile } from "./profile.js";
import { Project, type ProjectDocument, type StoredProject } from "./project.js";
import type { Revision, RevisionOrigin } from "./revision.js";
import { Skill, type SkillDocument, type StoredSkill } from "./skill.js";

const SAVED = new Date("2026-11-01T09:00:00.000Z");
const NOW = new Date("2026-11-03T10:12:00.000Z");

/** What the round trip needs from every localized aggregate. */
interface Aggregate<TDoc extends object, TStored> {
  saveRevision(
    locale: Locale,
    document: TDoc,
    origin: RevisionOrigin,
    revisionId: string,
    at: Date,
  ): Revision<TDoc>;
  publish(targets: readonly Locale[], at: Date): unknown;
  snapshot(): TStored;
  unsavedRevisions(): readonly Revision<TDoc>[];
}

interface Case<TDoc extends object, TStored> {
  readonly type: string;
  readonly create: () => Aggregate<TDoc, TStored>;
  readonly reconstitute: (stored: TStored) => Aggregate<TDoc, TStored>;
  /** A complete document, varied by a word so revisions differ. */
  readonly doc: (word: string) => TDoc;
}

function roundTrip<TDoc extends object, TStored>(c: Case<TDoc, TStored>): void {
  describe(`${c.type} persistence view`, () => {
    it("lists every save of one use case, two to one locale numbered consecutively", () => {
      const item = c.create();
      item.saveRevision("es", c.doc("uno"), "owner", "es-1", SAVED);
      item.saveRevision("en", c.doc("one"), "owner", "en-1", SAVED);
      item.saveRevision("en", c.doc("two"), "machine", "en-2", SAVED);
      expect(item.unsavedRevisions().map((r) => [r.locale, r.id, r.number])).toEqual([
        ["es", "es-1", 1],
        ["en", "en-1", 1],
        ["en", "en-2", 2],
      ]);
    });

    it("round-trips through its snapshot, and a reloaded one has nothing unsaved", () => {
      const item = c.create();
      item.saveRevision("es", c.doc("uno"), "owner", "es-1", SAVED);
      item.saveRevision("en", c.doc("one"), "owner", "en-1", SAVED);
      item.publish(["es", "en"], NOW);
      item.saveRevision("en", c.doc("two"), "owner", "en-2", NOW);
      const snapshot = item.snapshot();
      const reloaded = c.reconstitute(snapshot);
      expect(reloaded.snapshot()).toEqual(snapshot);
      expect(reloaded.unsavedRevisions()).toEqual([]);
    });
  });
}

roundTrip<ProfileDocument, StoredProfile>({
  type: "Profile",
  create: () => Profile.create("profile"),
  reconstitute: Profile.reconstitute,
  doc: (word) => ({ name: "Sample Person", headline: word, summary: "Summary.", links: [] }),
});

roundTrip<ExperienceItemDocument, StoredExperienceItem>({
  type: "ExperienceItem",
  create: () => ExperienceItem.create({ id: "e-1", sortOrder: 2 }),
  reconstitute: ExperienceItem.reconstitute,
  doc: (word) => ({
    organization: "Sample Company",
    role: word,
    period: { from: "2024-03", to: null },
    locationType: "remote",
    stackTags: [],
  }),
});

roundTrip<ProjectDocument, StoredProject>({
  type: "Project",
  create: () =>
    Project.create({ id: "p-1", slug: "sample", kind: "project", featured: true, sortOrder: 1 }),
  reconstitute: Project.reconstitute,
  doc: (word) => ({
    slug: `sample-${word}`,
    title: word,
    summary: "",
    body: "Body.",
    stackTags: [],
    repoUrl: null,
    demoUrl: null,
  }),
});

roundTrip<PostDocument, StoredPost>({
  type: "Post",
  create: () => Post.create({ id: "post-1", slug: "sample" }),
  reconstitute: Post.reconstitute,
  doc: (word) => ({ slug: `post-${word}`, title: word, excerpt: "", body: "Body.", tags: [] }),
});

roundTrip<SkillDocument, StoredSkill>({
  type: "Skill",
  create: () => Skill.create({ id: "s-1", sortOrder: 4 }),
  reconstitute: Skill.reconstitute,
  doc: (word) => ({ name: word, category: "backend", projectSlugs: [] }),
});

roundTrip<CvBulletDocument, StoredCvBullet>({
  type: "CvBullet",
  create: () =>
    CvBullet.create({
      id: "backend-10",
      parent: { kind: "project", projectId: "p-1" },
      sortOrder: 3,
      importance: 2,
    }),
  reconstitute: CvBullet.reconstitute,
  doc: (word) => ({ text: `Built ${word}.` }),
});
