import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ApprovalChecklist } from "../../domain/approval-checklist.js";
import type {
  KnowledgeEntryDocument,
  KnowledgeEntryProvenance,
} from "../../domain/knowledge-entry.js";
import { LOCALES, type Locale } from "../../domain/locale.js";
import { type ContentScope, ContentUnitOfWork } from "../content.unit-of-work.js";
import {
  knowledgeEntryDocumentSchema,
  knowledgeEntryProvenanceSchema,
} from "../content-documents.js";
import { ApproveKnowledgeEntry } from "./approve-knowledge-entry.use-case.js";
import { seedSchemaParts } from "./content-commands.js";
import { CreateContentItem } from "./create-content-item.use-case.js";
import { CreateKnowledgeEntry } from "./create-knowledge-entry.use-case.js";
import {
  type DocumentOf,
  LOCALIZED,
  type LocalizedType,
  type NewItemOf,
} from "./localized-types.js";
import { PublishContentItem } from "./publish-content-item.use-case.js";
import { SaveContentRevision } from "./save-content-revision.use-case.js";

/**
 * One localized item to seed: its type, its fixed id, its layout, and one document per locale.
 * es and en are required, because the seed publishes every locale it has and D-20 refuses a publish
 * without both; de is optional, so some items exercise the missing-German warning.
 */
export type LocalizedSeedItemOf<K extends LocalizedType> = { readonly type: K } & NewItemOf[K] & {
    readonly id: string;
    readonly documents: {
      readonly es: DocumentOf[K];
      readonly en: DocumentOf[K];
      readonly de?: DocumentOf[K] | undefined;
    };
  };

/** One knowledge entry to seed, approved with its first revision. */
export interface KnowledgeEntrySeedItem {
  readonly type: "knowledge-entry";
  readonly id: string;
  readonly document: KnowledgeEntryDocument;
  readonly provenance: KnowledgeEntryProvenance;
}

/** Any item the seed can load. */
export type ContentSeedItem =
  | { [K in LocalizedType]: LocalizedSeedItemOf<K> }[LocalizedType]
  | KnowledgeEntrySeedItem;

/** The types the seed reports on. */
export type SeedType = ContentSeedItem["type"];

/** Per type, how many items the run created and how many it found already stored. */
export type SeedReport = Record<SeedType, { created: number; skipped: number }>;

const { documentSchemas, layoutFields, uuidId, bulletId } = seedSchemaParts;

function localizedMember<K extends LocalizedType, L extends z.ZodRawShape>(
  type: K,
  id: z.ZodType<string>,
  layout: L,
) {
  const document = documentSchemas[type];
  return z.object({
    type: z.literal(type),
    id,
    ...layout,
    documents: z.object({ es: document, en: document, de: z.optional(document) }),
  });
}

/** Validates the seed data before anything is written. */
const contentSeedItems: z.ZodType<readonly ContentSeedItem[]> = z.array(
  z.discriminatedUnion("type", [
    localizedMember("profile", uuidId, layoutFields.profile),
    localizedMember("experience-item", uuidId, layoutFields["experience-item"]),
    localizedMember("project", uuidId, layoutFields.project),
    localizedMember("post", uuidId, layoutFields.post),
    localizedMember("skill", uuidId, layoutFields.skill),
    localizedMember("cv-bullet", bulletId, layoutFields["cv-bullet"]),
    z.object({
      type: z.literal("knowledge-entry"),
      id: z.string().min(1),
      document: knowledgeEntryDocumentSchema,
      provenance: knowledgeEntryProvenanceSchema,
    }),
  ]),
);

/**
 * The checklist the seed approves its entries with. The seed holds placeholder text written for
 * it and reviewed with its pull request, which is the review the five boxes record.
 */
const SEED_CHECKLIST: ApprovalChecklist = {
  noClientNames: true,
  noInternalNames: true,
  noNonPublicNumbers: true,
  noEmployerCode: true,
  ownVoice: true,
};

/**
 * Loads placeholder content through the use cases (Q2 A), so seeded data passes the same rules as
 * any other. Idempotent by "create if missing, never touch what exists" (owner decision A): every
 * item has a fixed id; an item already stored (for the profile, any profile) is skipped, never
 * updated; a missing one is created, given a revision per locale and published (entries: created
 * and approved) in ONE unit of work run, one aggregate per transaction, so a failure leaves that
 * item absent, never half-seeded, and the next run tries it again. Never upserts, never truncates.
 * Run by hand (`db:seed`), never by a deploy.
 */
@Injectable()
export class SeedContent {
  constructor(
    private readonly uow: ContentUnitOfWork,
    private readonly createItem: CreateContentItem,
    private readonly saveRevision: SaveContentRevision,
    private readonly publish: PublishContentItem,
    private readonly createEntry: CreateKnowledgeEntry,
    private readonly approveEntry: ApproveKnowledgeEntry,
  ) {}

  /**
   * Seeds the items in order, one transaction each. A CV bullet's parent must come before it.
   * @param items the seed data.
   * @returns per type, the items created and the items skipped.
   * @throws {ZodError} when the seed data breaks its schema; nothing is written.
   * @throws any domain error of the use cases, for the item that failed; the items before it stay.
   */
  async execute(items: readonly ContentSeedItem[]): Promise<SeedReport> {
    const parsed = contentSeedItems.parse(items);
    const report = emptyReport();
    for (const item of parsed) {
      const created = await this.uow.run((scope) =>
        item.type === "knowledge-entry"
          ? this.seedEntry(scope, item)
          : this.seedLocalized(scope, item),
      );
      report[item.type][created ? "created" : "skipped"] += 1;
    }
    return report;
  }

  /** Creates, revises and publishes one localized item, unless it exists. True when created. */
  private async seedLocalized<K extends LocalizedType>(
    scope: ContentScope,
    item: LocalizedSeedItemOf<K>,
  ): Promise<boolean> {
    if (await LOCALIZED[item.type].exists(scope, item.id)) return false;
    let { version } = await this.createItem.executeIn(scope, item);
    const locales: Locale[] = [];
    for (const locale of LOCALES) {
      const document = item.documents[locale];
      if (document === undefined) continue;
      ({ version } = await this.saveRevision.executeIn(scope, {
        type: item.type,
        id: item.id,
        locale,
        document,
        expectedVersion: version,
      }));
      locales.push(locale);
    }
    await this.publish.executeIn(scope, {
      type: item.type,
      id: item.id,
      locales,
      expectedVersion: version,
    });
    return true;
  }

  /** Creates and approves one knowledge entry, unless it exists. True when created. */
  private async seedEntry(scope: ContentScope, item: KnowledgeEntrySeedItem): Promise<boolean> {
    if ((await scope.knowledgeEntries.get(item.id)) !== undefined) return false;
    const { revisionId, version } = await this.createEntry.executeIn(scope, item);
    await this.approveEntry.executeIn(scope, {
      id: item.id,
      revisionId,
      checklist: SEED_CHECKLIST,
      expectedVersion: version,
    });
    return true;
  }
}

function emptyReport(): SeedReport {
  return {
    profile: { created: 0, skipped: 0 },
    "experience-item": { created: 0, skipped: 0 },
    project: { created: 0, skipped: 0 },
    post: { created: 0, skipped: 0 },
    skill: { created: 0, skipped: 0 },
    "cv-bullet": { created: 0, skipped: 0 },
    "knowledge-entry": { created: 0, skipped: 0 },
  };
}
