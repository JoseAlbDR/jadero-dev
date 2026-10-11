import type { ExperienceListDto } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { askBulletIdParam, findAskBullet } from "../src/content/ask";

const EXPERIENCE: ExperienceListDto = {
  items: [
    {
      locale: "de",
      organization: "Beispiel GmbH",
      role: "Backend-Entwickler",
      period: { from: "2024-09", to: null },
      locationType: "remote",
      stackTags: [],
      bullets: [{ id: "backend-10", text: "Einen Outbox-Relay gebaut.", entryIds: [] }],
    },
    {
      locale: "en",
      organization: "Example Studio",
      role: "Developer",
      period: { from: "2022-03", to: "2024-08" },
      locationType: "onsite",
      stackTags: [],
      bullets: [{ id: "frontend-2", text: "Shipped a design system.", entryIds: [] }],
    },
  ],
};

describe("askBulletIdParam", () => {
  it("accepts one CV bullet id", () => {
    expect(askBulletIdParam("backend-10")).toBe("backend-10");
  });

  it.each([
    ["absent", undefined],
    ["repeated", ["backend-10", "backend-11"]],
    ["empty", ""],
    ["upper case", "Backend-10"],
    ["markup", "<script>alert(1)</script>"],
    ["a path", "../admin"],
    ["spaces", "backend 10"],
    ["too long", `a${"-a".repeat(40)}`],
  ])("ignores a value that is not a bullet id (%s)", (_, value) => {
    expect(askBulletIdParam(value)).toBeNull();
  });
});

describe("findAskBullet", () => {
  it("returns the bullet text from the API with the language of its item", () => {
    expect(findAskBullet("backend-10", EXPERIENCE)).toEqual({
      id: "backend-10",
      text: "Einen Outbox-Relay gebaut.",
      locale: "de",
    });
  });

  it("marks a bullet of an English fallback item as English", () => {
    expect(findAskBullet("frontend-2", EXPERIENCE)?.locale).toBe("en");
  });

  it("returns null for an id no published bullet has", () => {
    expect(findAskBullet("backend-99", EXPERIENCE)).toBeNull();
  });
});
