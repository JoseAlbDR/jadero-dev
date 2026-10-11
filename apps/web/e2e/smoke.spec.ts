import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import profiles from "./stub/profile.json" with { type: "json" };

const LOCALES = { en, es, de } as const;
// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

test.describe("locale routing (ADR-022)", () => {
  test("sends / to the Accept-Language locale", async ({ browser }) => {
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
    await context.close();
  });

  test("falls back to English for an unsupported language", async ({ browser }) => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await context.close();
  });

  test("remembers the chosen locale in a session cookie", async ({ page, context }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Deutsch" }).click();
    await expect(page).toHaveURL(/\/de$/);
    const cookie = (await context.cookies()).find((c) => c.name === "NEXT_LOCALE");
    expect(cookie?.value).toBe("de");
    expect(cookie?.expires).toBe(-1); // session cookie: no persistent preference (owner's choice)
    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
  });
});

for (const [locale, messages] of Object.entries(LOCALES)) {
  test.describe(`/${locale}`, () => {
    test("renders the home in its language with hreflang alternates", async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      // The h1 is the profile headline from the stub content API.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        profiles[locale as keyof typeof profiles].headline,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}/${locale}`,
      );
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}/en`],
        ["es", `${SITE}/es`],
        ["de", `${SITE}/de`],
        ["x-default", `${SITE}/en`],
      ]);
    });

    test("renders the site shell around the page", async ({ page }) => {
      await page.goto(`/${locale}`);
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.home })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("contentinfo")).toContainText(messages.Footer.note);
    });

    test("renders the localized 404", async ({ page }) => {
      const response = await page.goto(`/${locale}/does-not-exist`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(`/${locale}`);
        await expectAccessible(page);
      });
    }
  });
}

test.describe("fonts (ADR-045)", () => {
  test("loads Geist from the site itself, never from a font CDN", async ({ page }) => {
    const fontHosts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontHosts.push(new URL(request.url()).host);
    });
    await page.goto("/en");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toMatch(/Geist/);
    expect(fontHosts.length).toBeGreaterThan(0);
    expect(new Set(fontHosts)).toEqual(new Set([new URL(page.url()).host]));
  });
});

test.describe("theme (ADR-023)", () => {
  test("switches to dark and keeps it across a reload without a flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    await page.getByRole("button", { name: en.ThemeToggle.dark }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    // The class must be on <html> before any script of the app runs: read it at DOMContentLoaded.
    await page.reload({ waitUntil: "domcontentloaded" });
    const classAtLoad = await page.evaluate(() => document.documentElement.className);
    expect(classAtLoad).toMatch(/\bdark\b/);
    await expect(page.getByRole("button", { name: en.ThemeToggle.dark })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("keeps the chosen theme when the locale changes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    await page.getByRole("button", { name: en.ThemeToggle.dark }).click();
    // A locale change mounts the [locale] layout again on the client, theme script included.
    // The marker proves the navigation stayed in the page instead of a full load.
    await page.evaluate(() => {
      (window as { __spa?: boolean }).__spa = true;
    });
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(/\/es$/);
    expect(await page.evaluate(() => (window as { __spa?: boolean }).__spa)).toBe(true);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("button", { name: es.ThemeToggle.dark })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("follows the system preference by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/es");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});
