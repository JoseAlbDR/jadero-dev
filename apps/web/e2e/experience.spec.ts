import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/experience.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

/** The localized pathnames of the experience page (routing.pathnames). */
const PAGES = {
  en: { path: "/en/experience", messages: en },
  es: { path: "/es/experiencia", messages: es },
  de: { path: "/de/erfahrung", messages: de },
} as const;

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [locale, { path, messages }] of Object.entries(PAGES)) {
  const items = fixtures[locale as keyof typeof fixtures].items;

  test.describe(path, () => {
    test("renders its title, canonical and hreflang links", async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${messages.ExperiencePage.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages.ExperiencePage.title,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}/en/experience`],
        ["es", `${SITE}/es/experiencia`],
        ["de", `${SITE}/de/erfahrung`],
        ["x-default", `${SITE}/en/experience`],
      ]);
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.experience })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("lists every role with its CV bullets in API order", async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(items.map((i) => i.role));
      const bullets = items.flatMap((i) => i.bullets);
      const asks = page.getByRole("link", { name: messages.ExperiencePage.ask });
      await expect(asks).toHaveCount(bullets.length);
      for (const [index, bullet] of bullets.entries()) {
        // Resting until WP-25: a plain link to the home terminal that only carries the bullet id.
        await expect(asks.nth(index)).toHaveAttribute("href", `/${locale}?ask=${bullet.id}#ask`);
        await expect(asks.nth(index)).toHaveAccessibleDescription(bullet.text);
      }
    });

    test("marks content in another language with its lang", async ({ page }) => {
      await page.goto(path);
      for (const item of items) {
        const heading = page.getByRole("heading", { level: 2, name: item.role });
        if (item.locale === locale) await expect(heading).not.toHaveAttribute("lang");
        else await expect(heading).toHaveAttribute("lang", item.locale);
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
