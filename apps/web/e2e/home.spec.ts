import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import experience from "./stub/experience.json" with { type: "json" };
import profiles from "./stub/profile.json" with { type: "json" };
import projects from "./stub/projects.json" with { type: "json" };

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

/** Localized pathnames the home links to (`routing.pathnames`). */
const PATHS: Record<Locale, { projects: string; work: string; stack: string }> = {
  en: { projects: "/en/projects", work: "/en/work", stack: "/en/stack" },
  es: { projects: "/es/proyectos", work: "/es/trabajo", stack: "/es/stack" },
  de: { projects: "/de/projekte", work: "/de/arbeit", stack: "/de/stack" },
};

/** Evidence with a page today, and the page it links to; every other piece is plain text. */
const LINKED_EVIDENCE = {
  caseStudies: "projects",
  workLog: "work",
  elRefugio: "projects",
  langChainAssistant: "projects",
  frameworkCase: "projects",
} as const;

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const home = `/${locale}`;
  const profile = profiles[locale];
  const t = messages.HomePage;
  const terminal = messages.AgentTerminal;
  const bullet = experience[locale].items.flatMap((item) => item.bullets)[0];
  if (!bullet) throw new Error(`experience.json needs a bullet in ${locale}`);

  test.describe(`home ${home}`, () => {
    test("shows the hero from the profile and the resting terminal", async ({ page }) => {
      await page.goto(home);
      const lang = profile.locale === locale ? null : profile.locale;
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveText(profile.headline);
      if (lang) await expect(h1).toHaveAttribute("lang", lang);
      else await expect(h1).not.toHaveAttribute("lang");
      await expect(page.getByText(profile.name, { exact: true })).toBeVisible();
      // The summary goes through the Markdown pipeline: the bold survives as <strong>.
      await expect(page.locator("main strong").first()).toBeVisible();

      const ask = page.locator("#ask");
      await expect(ask).toHaveAccessibleName(terminal.title);
      await expect(ask).toContainText(terminal.placeholder);
      await expect(ask).toContainText(terminal.resting);
      await expect(ask.getByRole("button", { name: terminal.send })).toBeDisabled();
      // Resting: no form and no field, so nothing can be submitted.
      await expect(ask.locator("form, input, textarea")).toHaveCount(0);
    });

    test("puts the question about a CV bullet in the prompt from ?ask=", async ({
      page,
      baseURL,
    }) => {
      // Resting: nothing leaves the page. Next's own GET prefetches of the links stay on the site;
      // a send would be a POST or a request to another origin.
      const sent: string[] = [];
      page.on("request", (request) => {
        const offSite = new URL(request.url()).origin !== new URL(baseURL ?? "http://x").origin;
        if (request.method() !== "GET" || offSite)
          sent.push(`${request.method()} ${request.url()}`);
      });
      await page.goto(`${home}?ask=${bullet.id}#ask`);
      const ask = page.locator("#ask");
      await expect(ask).toContainText(bullet.text);
      await expect(ask).not.toContainText(terminal.placeholder);
      const fallback = experience[locale].items.find((item) =>
        item.bullets.some((b) => b.id === bullet.id),
      );
      if (fallback && fallback.locale !== locale) {
        await expect(ask.getByText(bullet.text)).toHaveAttribute("lang", fallback.locale);
      }
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`/${locale}$`),
      );
      await page.waitForLoadState("networkidle");
      expect(sent).toEqual([]);
    });

    test("ignores an ?ask= that is not a published bullet and never reflects it", async ({
      page,
    }) => {
      for (const value of ["no-such-bullet", "<b>injected</b>", "x".repeat(200)]) {
        await page.goto(`${home}?ask=${encodeURIComponent(value)}`);
        const ask = page.locator("#ask");
        await expect(ask).toContainText(terminal.placeholder);
        // Next keeps the URL in its router state; the rendered page must never hold the value.
        for (const part of ["header", "main", "footer"]) {
          expect(await page.locator(part).innerHTML()).not.toContain(value);
        }
      }
    });

    test("lists the eight pillars with their evidence map", async ({ page }) => {
      await page.goto(home);
      const strip = page.getByRole("region", { name: t.pillarsTitle });
      const pillars = Object.values(t.pillars);
      await expect(strip.getByRole("heading", { level: 3 })).toHaveText(
        pillars.map((p) => p.title),
      );
      for (const pillar of pillars) await expect(strip).toContainText(pillar.line);
      for (const [evidence, label] of Object.entries(t.evidence)) {
        const page_ = LINKED_EVIDENCE[evidence as keyof typeof LINKED_EVIDENCE];
        const links = strip.getByRole("link", { name: label, exact: true });
        if (page_) {
          await expect(links.first()).toHaveAttribute("href", PATHS[locale][page_]);
        } else {
          await expect(links).toHaveCount(0);
          await expect(strip.getByText(label, { exact: true }).first()).toBeVisible();
        }
      }
    });

    test("shows the stack tile and the featured case study", async ({ page }) => {
      await page.goto(home);
      const stack = page.getByRole("region", { name: t.stackTitle });
      await expect(stack.getByRole("link", { name: t.stackLink })).toHaveAttribute(
        "href",
        PATHS[locale].stack,
      );
      await expect(stack.getByRole("listitem").first()).toBeVisible();
      const featured = projects[locale].find((p) => p.kind === "case_study" && p.featured);
      if (!featured) throw new Error(`projects.json needs a featured case study in ${locale}`);
      const tile = page.getByRole("region", { name: t.caseTitle });
      await expect(tile.getByRole("link", { name: featured.title })).toHaveAttribute(
        "href",
        `${PATHS[locale].projects}/${featured.slug}`,
      );
    });

    for (const colorScheme of ["light", "dark"] as const) {
      for (const query of ["", `?ask=${bullet.id}`]) {
        test(`has no WCAG 2.2 AA violations in ${colorScheme} mode${query && " with ?ask="}`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme });
          await page.goto(`${home}${query}`);
          await expectAccessible(page);
        });
      }
    }
  });
}

test.describe("phone layout (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the hero, then the terminal, then the pillars", async ({ page }) => {
    await page.goto("/en");
    const top = async (selector: string) =>
      (await page.locator(selector).first().boundingBox())?.y ?? Number.NaN;
    const hero = await top("h1");
    const terminal = await top("#ask");
    const pillars = await top("#pillars-title");
    expect(hero).toBeLessThan(terminal);
    expect(terminal).toBeLessThan(pillars);
  });

  test("keeps every pillar card's text inside the card", async ({ page }) => {
    await page.goto("/de");
    const overflowing = await page
      .locator('[aria-labelledby^="pillar-"]')
      .evaluateAll((cards) =>
        cards
          .filter((card) => card.scrollWidth > card.clientWidth)
          .map((card) => card.getAttribute("aria-labelledby")),
      );
    expect(overflowing).toEqual([]);
  });

  test("opens the menu with the nav, the language and the theme, and closes on navigation", async ({
    page,
  }) => {
    await page.goto("/en");
    const toggle = page.getByRole("button", { name: en.Header.menu });
    const nav = page.getByRole("navigation", { name: en.Nav.label });
    await expect(nav).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const label of Object.values(en.Nav).filter((label) => label !== en.Nav.label)) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Deutsch" })).toBeVisible();
    await expect(page.getByRole("button", { name: en.ThemeToggle.dark })).toBeVisible();
    await expectAccessible(page);

    await nav.getByRole("link", { name: en.Nav.projects }).click();
    await expect(page).toHaveURL(/\/en\/projects$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
  });

  test("works from the keyboard and closes on Escape", async ({ page }) => {
    await page.goto("/en");
    const toggle = page.getByRole("button", { name: en.Header.menu });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The panel follows the button in reading order: Tab lands on the first link.
    await page.keyboard.press("Tab");
    const nav = page.getByRole("navigation", { name: en.Nav.label });
    await expect(nav.getByRole("link", { name: en.Nav.home })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});

test.describe("desktop header (1280 px)", () => {
  test("shows the nav inline and no menu button", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    await expect(page.getByRole("button", { name: en.Header.menu })).toBeHidden();
    const nav = page.getByRole("navigation", { name: en.Nav.label });
    await expect(nav.getByRole("link", { name: en.Nav.work })).toHaveAttribute("href", "/en/work");
  });
});
