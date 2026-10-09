import { describe, expect, it } from "vitest";
import { RequiredLocalesMissing } from "./content.errors.js";
import { isProfileComplete, Profile, type ProfileDocument } from "./profile.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

function doc(over: Partial<ProfileDocument> = {}): ProfileDocument {
  return {
    name: "Sample Person",
    headline: "Backend engineer",
    summary: "A placeholder summary.",
    links: [{ kind: "github", url: "https://example.com/sample" }],
    ...over,
  };
}

describe("Profile", () => {
  it.each`
    case                    | document
    ${"no name"}            | ${doc({ name: "" })}
    ${"no headline"}        | ${doc({ headline: " " })}
    ${"no summary"}         | ${doc({ summary: "" })}
    ${"a link with no URL"} | ${doc({ links: [{ kind: "email", url: "" }] })}
  `("is incomplete with $case", ({ document }) => {
    expect(isProfileComplete(doc())).toBe(true);
    expect(isProfileComplete(doc({ links: [] }))).toBe(true);
    expect(isProfileComplete(document)).toBe(false);
  });

  it("refuses to go public in Spanish alone", () => {
    const profile = Profile.create("profile");
    expect(profile.version).toBe(0);
    profile.saveRevision("es", doc(), "owner", "r-es", AT);
    expect(() => profile.publish(["es"], AT)).toThrow(RequiredLocalesMissing);
  });

  it("publishes es and en, then archives", () => {
    const profile = Profile.create("profile");
    profile.saveRevision("es", doc(), "owner", "r-es", AT);
    profile.saveRevision("en", doc(), "owner", "r-en", AT);
    expect(profile.publish(["es", "en"], AT).published).toHaveLength(2);
    profile.archive(AT);
    expect(profile.translations.archivedAt()).toEqual(AT);
  });

  it("reconstitutes with its stored version", () => {
    const profile = Profile.reconstitute({
      id: "profile",
      version: 9,
      translations: { locales: {}, archivedAt: null },
    });
    expect(profile).toMatchObject({ id: "profile", version: 9 });
  });
});
