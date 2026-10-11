import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/projects.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

/** The localized pathnames of the projects pages (routing.pathnames). */
const PAGES = {
  en: { list: "/en/projects", messages: en },
  es: { list: "/es/proyectos", messages: es },
  de: { list: "/de/projekte", messages: de },
} as const;

type Locale = keyof typeof PAGES;

/** The path of a project page in a locale. */
const detailPath = (locale: Locale, slug: string) => `${PAGES[locale].list}/${slug}`;

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, { list, messages }] of Object.entries(PAGES)) {
  const locale = key as Locale;
  const t = messages.ProjectsPage;
  const items = fixtures[locale];
  const caseStudy = items[0];
  if (!caseStudy) throw new Error("projects.json needs a case study first");

  test.describe(list, () => {
    test("renders its title, canonical and hreflang links", async ({ page }) => {
      await page.goto(list);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${list}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}/en/projects`],
        ["es", `${SITE}/es/proyectos`],
        ["de", `${SITE}/de/projekte`],
        ["x-default", `${SITE}/en/projects`],
      ]);
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.projects })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("lists case studies, projects and the early archive in that order", async ({ page }) => {
      await page.goto(list);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        t.sections.case_study,
        t.sections.project,
        t.sections.early,
      ]);
      for (const item of items) {
        const link = page.getByRole("link", { name: item.title, exact: true });
        await expect(link).toHaveAttribute("href", detailPath(locale, item.slug));
      }
    });

    test("marks a project in another language with its lang", async ({ page }) => {
      await page.goto(list);
      for (const item of items.filter((i) => i.kind !== "early")) {
        const heading = page.getByRole("heading", { level: 3, name: item.title });
        if (item.locale === locale) await expect(heading).not.toHaveAttribute("lang");
        else await expect(heading).toHaveAttribute("lang", item.locale);
      }
    });

    test("renders a case study with its links and its body through the safe pipeline", async ({
      page,
    }) => {
      const path = detailPath(locale, caseStudy.slug);
      await page.goto(path);
      await expect(page).toHaveTitle(`${caseStudy.title} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(caseStudy.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}${detailPath("en", caseStudy.alternates.en)}`],
        ["es", `${SITE}${detailPath("es", caseStudy.alternates.es)}`],
        ["de", `${SITE}${detailPath("de", caseStudy.alternates.de as string)}`],
        ["x-default", `${SITE}${detailPath("en", caseStudy.alternates.en)}`],
      ]);
      await expect(page.getByRole("link", { name: t.repo })).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );

      // The fixture body carries a script, a javascript: link and an unknown directive.
      const body = page.locator("article [data-slot=card]").nth(1);
      await expect(body.getByRole("note")).toBeVisible();
      await expect(body.getByRole("table")).toBeVisible();
      await expect(body.locator("script")).toHaveCount(0);
      expect(await page.evaluate(() => "__xss" in window)).toBe(false);
      await expect(body).not.toContainText("Hidden embed");
      await expect(body.locator('a[href^="https://"]')).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
      // The javascript: link is left as its text, with no anchor at all.
      await expect(body.locator("a")).toHaveCount(1);
      await expect(body.locator("a:not([href])")).toHaveCount(0);
      await expect(body.locator("[style]")).toHaveCount(0);
    });

    test("answers a slug the API does not know with the 404 page", async ({ page }) => {
      const response = await page.goto(detailPath(locale, "not-a-project"));
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`list has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(list);
        await expectAccessible(page);
      });

      test(`case study has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(detailPath(locale, caseStudy.slug));
        await expectAccessible(page);
      });
    }
  });
}

test.describe("localized project slugs", () => {
  test("the German fallback shows the English project with lang and an English canonical", async ({
    page,
  }) => {
    const fallback = fixtures.de.find((p) => p.locale === "en");
    if (!fallback) throw new Error("projects.json needs a German fallback");
    await page.goto(detailPath("de", fallback.slug));
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
    // The labels around the English text stay German.
    const kind = fallback.kind as keyof typeof de.ProjectsPage.kind;
    await expect(page.getByText(de.ProjectsPage.kind[kind], { exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE}${detailPath("en", fallback.slug)}`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveCount(0);
  });

  // The same case study in each locale, with its own slug.
  const relay = fixtures.en[0]?.alternates;

  test("another locale's slug redirects to this locale's slug", async ({ page }) => {
    await page.goto(detailPath("de", relay?.es ?? ""));
    await expect(page).toHaveURL(detailPath("de", relay?.de ?? ""));
    await page.goto(detailPath("en", relay?.de ?? ""));
    await expect(page).toHaveURL(detailPath("en", relay?.en ?? ""));
  });

  test("the language switcher on a project page lands on the translated page", async ({ page }) => {
    await page.goto(detailPath("en", relay?.en ?? ""));
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(detailPath("es", relay?.es ?? ""));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixtures.es[0]?.title ?? "");
  });
});
