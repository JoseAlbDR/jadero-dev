import { expect, type Page, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };

const LOCALES = { en, es, de } as const;

// The server runs report-only unless CSP_MODE=enforce (src/config/site.ts, ADR-047).
const ENFORCED = process.env.CSP_MODE === "enforce";
const HEADER = ENFORCED ? "content-security-policy" : "content-security-policy-report-only";
const OTHER = ENFORCED ? "content-security-policy-report-only" : "content-security-policy";

/**
 * Records every CSP violation of the page from its first script on, as `<directive> <blocked>`.
 * The `securitypolicyviolation` event fires in both modes, enforced or report-only.
 * @param page the page, before it navigates.
 */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
}

/**
 * The violations `recordViolations` has seen so far.
 * @param page the page under test.
 */
async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** The nonce of a CSP header value, or undefined when it has none. */
function nonceOf(policy: string | undefined): string | undefined {
  return policy?.match(/script-src 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/)?.[1];
}

test.describe(`content security policy, ${ENFORCED ? "enforced" : "report-only"} (ADR-047)`, () => {
  test("sends the policy with a nonce that changes on every request", async ({ request }) => {
    const first = await request.get("/en");
    const second = await request.get("/en");
    const policy = first.headers()[HEADER];
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(first.headers()[OTHER]).toBeUndefined();
    // The nonce reaches the browser only inside the policy and the tags, never as its own header.
    expect(first.headers()["x-nonce"]).toBeUndefined();
    const nonce = nonceOf(policy);
    expect(nonce).toBeTruthy();
    expect(nonceOf(second.headers()[HEADER])).not.toBe(nonce);
    expect(await first.text()).toContain(`nonce="${nonce}"`);
  });

  test("catches an injected inline script without the nonce", async ({ page }) => {
    await recordViolations(page);
    // What a stored XSS would do: the server's HTML carries a script the server did not nonce.
    await page.route("**/en", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</body>",
        "<script>window.__injected = true;</script></body>",
      );
      await route.fulfill({ response, body });
    });
    await page.goto("/en");

    expect(await violations(page)).toContainEqual(expect.stringMatching(/^script-src-elem inline/));
    // Enforced, the browser blocks it; report-only, it only reports and the script still runs.
    const ran = await page.evaluate(() => (window as { __injected?: boolean }).__injected === true);
    expect(ran).toBe(!ENFORCED);
  });

  for (const [locale, messages] of Object.entries(LOCALES)) {
    test(`/${locale} loads, hydrates and switches theme with no CSP violation`, async ({
      page,
    }) => {
      await recordViolations(page);
      // Chrome also logs each violation to the console.
      const consoleViolations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) consoleViolations.push(message.text());
      });

      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`/${locale}`);
      // The theme switch works only once React hydrated: proof the app's scripts ran.
      await page.getByRole("button", { name: messages.ThemeToggle.dark }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.waitForLoadState("networkidle");

      expect(await violations(page)).toEqual([]);
      expect(consoleViolations).toEqual([]);
    });
  }
});
