import { describe, expect, it } from "vitest";
import { ConcurrentModification } from "../domain/content.errors.js";
import type { Locale } from "../domain/locale.js";
import type {
  LocalizedRevisionsView,
  PublishResult,
  PublishTarget,
} from "../domain/localized-revisions.js";
import type { Revision } from "../domain/revision.js";
import { at } from "./content.contract-fixtures.js";

/** What every localized aggregate exposes that the shared contract drives. */
export interface LocalizedAggregate<TDoc extends object> {
  readonly id: string;
  readonly version: number;
  readonly translations: LocalizedRevisionsView<TDoc>;
  snapshot(): { readonly version: number };
  unsavedRevisions(): readonly Revision<TDoc>[];
  publish(targets: readonly PublishTarget<TDoc>[], at: Date): PublishResult;
}

/** How the shared contract reaches one localized type through its port. */
export interface LocalizedContractSubject<
  TDoc extends object,
  A extends LocalizedAggregate<TDoc>,
  R,
> {
  /** The port's name, shown in the test report. */
  readonly port: string;
  /** Builds the repository (or a fixture holding it) for each test. */
  readonly make: () => R | Promise<R>;
  /** A new item with no revision, never stored; stores first what it needs (a bullet's parent). */
  readonly create: (repository: R) => A | Promise<A>;
  /** Saves one complete owner revision of a locale with a fresh id; returns the id. */
  readonly saveRevision: (item: A, locale: Locale, minutes?: number, title?: string) => string;
  /** Loads the stored item `item` names (the profile is found, not looked up by id). */
  readonly load: (repository: R, item: A) => Promise<A | undefined>;
  /** Loads an item nobody stored (an unknown id; for the profile, a fresh store). */
  readonly loadUnknown: (repository: R) => Promise<A | undefined>;
  /** Saves through the port. */
  readonly save: (repository: R, item: A, expectedVersion: number) => Promise<void>;
  /** Archives the item; absent for the profile, which has none. */
  readonly archive?: (item: A, at: Date) => void;
}

/**
 * The part of the contract every localized repository passes (ADR-009, D2, D5, Q1 B), shared by
 * the profile, experience item, post, skill and CV bullet suites, which add their own rules. It
 * checks what goes through the port: a reload equals what was saved, the version check refuses a
 * stale save and writes nothing, every new revision is stored, and the published pointer, its time
 * and its first time are the ones the domain chose.
 * @param name the adapter's name, shown in the test report.
 * @param subject how the contract reaches the type.
 */
export function localizedRepositoryContract<
  TDoc extends object,
  A extends LocalizedAggregate<TDoc>,
  R,
>(name: string, subject: LocalizedContractSubject<TDoc, A, R>): void {
  const { make, create, saveRevision, load, save } = subject;

  /** Saves a new item with es and en at revision 1; returns it reloaded at version 1. */
  async function stored(repository: R): Promise<A> {
    const item = await create(repository);
    saveRevision(item, "es");
    saveRevision(item, "en");
    await save(repository, item, 0);
    return (await load(repository, item)) as A;
  }

  describe(`${subject.port} contract (localized): ${name}`, () => {
    it("returns undefined when nothing is stored", async () => {
      const repository = await make();
      expect(await subject.loadUnknown(repository)).toBeUndefined();
    });

    it("reloads a new item equal to its snapshot, at version 1", async () => {
      const repository = await make();
      const item = await create(repository);
      saveRevision(item, "es");
      saveRevision(item, "en", 1);
      await save(repository, item, 0);
      const reloaded = await load(repository, item);
      expect(reloaded?.snapshot()).toEqual({ ...item.snapshot(), version: 1 });
      expect(reloaded?.translations.stateOf("es")).toBe("draft");
      expect(reloaded?.translations.stateOf("de")).toBe("missing");
    });

    it("refuses a stale version with ConcurrentModification and writes nothing", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      const before = loaded.snapshot();
      saveRevision(loaded, "es", 5, "Changed");
      await expect(save(repository, loaded, 7)).rejects.toBeInstanceOf(ConcurrentModification);
      expect((await load(repository, loaded))?.snapshot()).toEqual(before);
    });

    it("refuses a create of an item that exists", async () => {
      const repository = await make();
      const existing = await stored(repository);
      await expect(save(repository, existing, 0)).rejects.toBeInstanceOf(ConcurrentModification);
    });

    it("refuses an update of an item never stored", async () => {
      const repository = await make();
      const item = await create(repository);
      saveRevision(item, "es");
      await expect(save(repository, item, 1)).rejects.toBeInstanceOf(ConcurrentModification);
      expect(await load(repository, item)).toBeUndefined();
    });

    it("stores both revisions saved in one locale before a save", async () => {
      const repository = await make();
      const item = await create(repository);
      const first = saveRevision(item, "es", 0, "First");
      const second = saveRevision(item, "es", 1, "Second");
      saveRevision(item, "en");
      // Publish the older one: a reload can only show it if its row was inserted too.
      const older = item.unsavedRevisions().find((revision) => revision.id === first);
      if (!older) throw new Error("the first revision is not held");
      item.publish([{ locale: "es", revision: older }, "en"], at(2));
      await save(repository, item, 0);
      const reloaded = await load(repository, item);
      expect(reloaded?.translations.published("es")?.id).toBe(first);
      expect(reloaded?.translations.latest("es")?.id).toBe(second);
      expect(reloaded?.translations.latest("es")?.number).toBe(2);
      expect(reloaded?.translations.stateOf("es")).toBe("changed");
    });

    it("stores the published pointer the domain returned", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      const result = loaded.publish(["es", "en"], at(3));
      await save(repository, loaded, 1);
      const reloaded = await load(repository, loaded);
      expect(reloaded?.version).toBe(2);
      expect(result.published).toHaveLength(2);
      for (const { locale, revisionId } of result.published) {
        expect(reloaded?.translations.published(locale)?.id).toBe(revisionId);
        expect(reloaded?.translations.stateOf(locale)).toBe("published");
        expect(reloaded?.translations.publishedAt(locale)).toEqual(at(3));
        expect(reloaded?.translations.firstPublishedAt(locale)).toEqual(at(3));
      }
    });

    it("moves the publish time on a republish and keeps the first publish time", async () => {
      const repository = await make();
      const loaded = await stored(repository);
      loaded.publish(["es", "en"], at(3));
      await save(repository, loaded, 1);
      const again = (await load(repository, loaded)) as A;
      const newer = saveRevision(again, "es", 4, "Newer");
      expect(again.translations.published("es")?.id).not.toBe(newer);
      again.publish(["es"], at(5));
      await save(repository, again, 2);
      const reloaded = await load(repository, loaded);
      expect(reloaded?.translations.published("es")?.id).toBe(newer);
      expect(reloaded?.translations.publishedAt("es")).toEqual(at(5));
      expect(reloaded?.translations.firstPublishedAt("es")).toEqual(at(3));
      expect(reloaded?.translations.publishedAt("en")).toEqual(at(3));
      expect(reloaded?.snapshot()).toEqual({ ...again.snapshot(), version: 3 });
    });

    const archive = subject.archive;
    if (archive) {
      it("stores the archive mark", async () => {
        const repository = await make();
        const loaded = await stored(repository);
        archive(loaded, at(9));
        await save(repository, loaded, 1);
        expect((await load(repository, loaded))?.translations.archivedAt()).toEqual(at(9));
      });
    }
  });
}
