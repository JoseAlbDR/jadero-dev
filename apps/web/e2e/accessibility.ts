import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Runs axe for WCAG 2.2 AA with the decorative backgrounds hidden (ADR-045): axe cannot measure
 * text against a gradient and would skip it, so contrast is checked on the solid surface instead.
 * Fails on a violation, on an axe crash and on any text node left without a contrast verdict.
 * @param page the page under test, already loaded.
 */
export async function expectAccessible(page: Page): Promise<void> {
  // A constructed stylesheet, not a <style> tag: the enforced CSP (ADR-047) blocks an inline style
  // without the nonce, test helpers included.
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, "[data-aurora] { display: none !important; }");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  // An axe crash (for example a color it cannot parse) lands in `incomplete`, not `violations`.
  expect(results.incomplete.filter((r) => r.error)).toEqual([]);
  // Every text node gets a contrast verdict; axe never measures symbol glyphs (the decorative
  // arrows), which it reports as "nonBmp".
  const unchecked = (results.incomplete.find((r) => r.id === "color-contrast")?.nodes ?? []).filter(
    (n) => n.any[0]?.data?.messageKey !== "nonBmp",
  );
  expect(unchecked.map((n) => n.html)).toEqual([]);
}
