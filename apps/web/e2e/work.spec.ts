import { expect, type Page, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/work.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

/** The localized segment of the work log in each locale (`routing.pathnames`). */
const SEGMENT: Record<Locale, string> = { en: "work", es: "trabajo", de: "arbeit" };

/** The path of an entry page in a locale; the entry id is the same in every locale. */
const entryPath = (locale: Locale, id: string) => `/${locale}/${SEGMENT[locale]}/${id}`;

/** The canonical and hreflang links of the page, as `[hreflang, href]` pairs. */
async function hreflangLinks(page: Page): Promise<(string | null)[][]> {
  return page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));
}

const indexable = fixtures.find((entry) => entry.indexable);
const hidden = fixtures.find((entry) => !entry.indexable);
if (!indexable || !hidden) throw new Error("work.json needs an indexable and a noindex entry");

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const list = `/${locale}/${SEGMENT[locale]}`;
  const t = messages.WorkPage;
  const english = locale === "en";

  test.describe(list, () => {
    test("renders its title, canonical and hreflang links", async ({ page }) => {
      await page.goto(list);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${list}`);
      expect(await hreflangLinks(page)).toEqual([
        ["en", `${SITE}/en/work`],
        ["es", `${SITE}/es/trabajo`],
        ["de", `${SITE}/de/arbeit`],
        ["x-default", `${SITE}/en/work`],
      ]);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      // In the main nav (current page) and in the footer.
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.work })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(
        page.getByRole("contentinfo").getByRole("link", { name: messages.Footer.work }),
      ).toHaveAttribute("href", list);
    });

    test("lists every approved entry with its link, facts and lang, and the note off English", async ({
      page,
    }) => {
      await page.goto(list);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(
        fixtures.map((entry) => entry.title),
      );
      for (const entry of fixtures) {
        const link = page.getByRole("link", { name: entry.title, exact: true });
        await expect(link).toHaveAttribute("href", entryPath(locale, entry.id));
        const card = page.locator("article", { has: link });
        await expect(card).toContainText(t.type[entry.type as keyof typeof t.type]);
        await expect(card.locator("time").first()).toHaveAttribute("datetime", entry.period.from);
        await expect(card.getByRole("list", { name: t.stack }).getByRole("listitem")).toHaveText(
          entry.stack,
        );
        const heading = card.getByRole("heading", { level: 2 });
        if (english) await expect(heading).not.toHaveAttribute("lang");
        else await expect(heading).toHaveAttribute("lang", "en");
      }
      // The summary is shown as plain text: the Markdown's `**` is gone.
      await expect(page.locator("main")).not.toContainText("**");
      const note = page.getByRole("note");
      if (english) await expect(note).toHaveCount(0);
      else await expect(note).toHaveText(t.listNote);
    });

    test("renders an entry with its sections at their citation anchors", async ({ page }) => {
      const path = entryPath(locale, indexable.id);
      await page.goto(path);
      await expect(page).toHaveTitle(`${indexable.title} · jadero.dev`);
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toHaveText(indexable.title);
      if (english) await expect(title).not.toHaveAttribute("lang");
      else await expect(title).toHaveAttribute("lang", "en");
      // Every section's heading carries its contract key as id: `/en/work/<id>#tradeoffs` lands there.
      for (const section of indexable.sections) {
        const heading = page.locator(`h2#${section.key}`);
        await expect(heading).toHaveText(t.sections[section.key as keyof typeof t.sections]);
        const body = page.locator(`section[aria-labelledby="${section.key}"] > div`);
        if (english) await expect(body).not.toHaveAttribute("lang");
        else await expect(body).toHaveAttribute("lang", "en");
      }
      await expect(page.locator("h2#questions")).toHaveText(t.questions);
      await expect(
        page.getByRole("region", { name: t.questions }).getByRole("listitem"),
      ).toHaveText(indexable.questions);
      // The trade-offs body carries a script tag the pipeline must drop.
      await expect(page.locator("article script")).toHaveCount(0);
      expect(await page.evaluate(() => "__xss" in window)).toBe(false);
      await expect(page.locator("article [style]")).toHaveCount(0);
    });

    test("points the canonical and hreflang at the English entry and notes it off English", async ({
      page,
    }) => {
      await page.goto(entryPath(locale, indexable.id));
      const englishPage = `${SITE}${entryPath("en", indexable.id)}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", englishPage);
      expect(await hreflangLinks(page)).toEqual([
        ["en", englishPage],
        ["x-default", englishPage],
      ]);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      const note = page.getByRole("note");
      if (english) await expect(note).toHaveCount(0);
      else await expect(note).toHaveText(t.entryNote);
      // The labels around the English entry stay in the page's language.
      await expect(page.getByRole("link", { name: t.back })).toHaveAttribute("href", list);
    });

    test("marks an entry that is not indexable noindex, follow", async ({ page }) => {
      await page.goto(entryPath(locale, hidden.id));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(hidden.title);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, follow",
      );
      // An ongoing entry ends "now" in the page's language.
      await expect(page.locator("article header")).toContainText(t.present);
    });

    test("answers an unknown or malformed entry id with the 404 page", async ({ page }) => {
      for (const id of ["kb-not-an-entry", "not-an-entry-id"]) {
        const response = await page.goto(entryPath(locale, id));
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
      }
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`list has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(list);
        await expectAccessible(page);
      });

      test(`entry has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(entryPath(locale, indexable.id));
        await expectAccessible(page);
      });
    }
  });
}
