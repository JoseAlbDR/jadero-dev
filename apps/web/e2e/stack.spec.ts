import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/skills.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const path = `/${locale}/stack`;
  const t = messages.StackPage;
  const skills = fixtures[locale].items;
  const categories = [...new Set(skills.map((s) => s.category))];

  test.describe(path, () => {
    test("renders its title, canonical and hreflang links", async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}/en/stack`],
        ["es", `${SITE}/es/stack`],
        ["de", `${SITE}/de/stack`],
        ["x-default", `${SITE}/en/stack`],
      ]);
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.stack })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("groups the skills in one tile per category, in API order", async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(categories);
      for (const category of categories) {
        const tile = page.getByRole("region", { name: category });
        await expect(tile.getByRole("listitem")).toHaveText(
          skills.filter((s) => s.category === category).map((s) => s.name),
        );
      }
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expectAccessible(page);
      });
    }
  });
}

test("the German fallback marks an English category and skill with lang", async ({ page }) => {
  const fallback = fixtures.de.items.find((s) => s.locale === "en");
  if (!fallback) throw new Error("skills.json needs a German fallback");
  await page.goto("/de/stack");
  await expect(page.getByRole("heading", { level: 2, name: fallback.category })).toHaveAttribute(
    "lang",
    "en",
  );
  const tile = page.getByRole("region", { name: fallback.category });
  await expect(tile.getByRole("listitem").filter({ hasText: fallback.name })).toHaveAttribute(
    "lang",
    "en",
  );
});
