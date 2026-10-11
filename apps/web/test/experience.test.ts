import { describe, expect, it } from "vitest";
import { ASK_ANCHOR_ID, ASK_QUERY_PARAM, askAboutHref } from "../src/components/ask-about-link";
import { formatYearMonth, periodLabels } from "../src/content/period";

describe("formatYearMonth", () => {
  it.each([
    ["en", "Jan 2024"],
    ["es", "ene 2024"],
    ["de", "Jan. 2024"],
  ] as const)("prints 2024-01 as a short month and year in %s", (locale, expected) => {
    expect(formatYearMonth("2024-01", locale)).toBe(expected);
  });

  it("never moves the month with the server's time zone", () => {
    // Built and printed in UTC: a server west of UTC must not print December 2023.
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatYearMonth("2024-01", "en")).toBe("Jan 2024");
      expect(formatYearMonth("2023-12", "en")).toBe("Dec 2023");
    } finally {
      process.env.TZ = previous;
    }
  });
});

describe("periodLabels", () => {
  it("labels both ends of a closed period with their dateTime values", () => {
    expect(periodLabels({ from: "2022-03", to: "2023-12" }, "en")).toEqual({
      from: { value: "2022-03", label: "Mar 2022" },
      to: { value: "2023-12", label: "Dec 2023" },
    });
  });

  it("leaves the end empty while the period lasts, for the page's own 'now'", () => {
    expect(periodLabels({ from: "2024-09", to: null }, "es")).toEqual({
      from: { value: "2024-09", label: "sept 2024" },
      to: null,
    });
  });
});

describe("askAboutHref", () => {
  it("points at the home terminal with the bullet id in the query, sending nothing", () => {
    expect(askAboutHref("backend-10")).toEqual({
      pathname: "/",
      query: { [ASK_QUERY_PARAM]: "backend-10" },
      hash: ASK_ANCHOR_ID,
    });
  });
});
