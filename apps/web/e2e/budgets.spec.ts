import { expect, test } from "@playwright/test";
import { PAGE_TYPES } from "./pages";

/**
 * The JavaScript budget of a page (`.claude/rules/frontend.md`): the bytes of script the browser
 * downloads on a first visit, as sent on the wire (gzip from the standalone server). Measured on
 * 2026-10-11 at 168 kB for every page type, all of it the shared React, Next and layout code: no
 * page ships its own client chunk yet. The budget leaves about 20% headroom, so a page that pulls
 * a heavy library into the client fails here before it reaches Lighthouse. Raise it only with a
 * reason in the commit (apps/web/AGENTS.md, "Budgets").
 */
const JS_BUDGET_BYTES = 200_000;

test.describe("performance budget", () => {
  for (const [type, path] of Object.entries(PAGE_TYPES.en)) {
    test(`${type} (${path}) downloads at most ${JS_BUDGET_BYTES / 1000} kB of JavaScript`, async ({
      page,
    }) => {
      const sizes: Promise<number>[] = [];
      page.on("requestfinished", (request) => {
        if (request.resourceType() === "script") {
          sizes.push(request.sizes().then((s) => s.responseBodySize));
        }
      });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const total = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
      test.info().annotations.push({ type: "js-bytes", description: String(total) });
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(JS_BUDGET_BYTES);
    });
  }
});
