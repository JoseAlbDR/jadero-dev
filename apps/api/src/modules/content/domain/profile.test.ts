import { describe, expect, it } from "vitest";
import { FieldFormatInvalid, RequiredLocalesMissing } from "./content.errors.js";
import { Profile, type ProfileDocument, profileRules } from "./profile.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

function doc(over: Partial<ProfileDocument> = {}): ProfileDocument {
  return {
    name: "Sample Person",
    headline: "Backend engineer",
    summary: "A placeholder summary.",
    links: [
      { kind: "github", url: "https://example.com/sample" },
      { kind: "email", url: "mailto:sample@example.com" },
    ],
    ...over,
  };
}

describe("Profile", () => {
  it.each`
    case             | document                  | complete
    ${"no links"}    | ${doc({ links: [] })}     | ${true}
    ${"no name"}     | ${doc({ name: "" })}      | ${false}
    ${"no headline"} | ${doc({ headline: " " })} | ${false}
    ${"no summary"}  | ${doc({ summary: "" })}   | ${false}
  `("is complete: $complete with $case", ({ document, complete }) => {
    expect(profileRules.isComplete(doc())).toBe(true);
    expect(profileRules.isComplete(document)).toBe(complete);
  });

  it.each`
    url                      | fields
    ${""}                    | ${["links[0].url"]}
    ${"http://example.com"}  | ${["links[0].url"]}
    ${"not a url"}           | ${["links[0].url"]}
    ${"https://example.com"} | ${[]}
  `("checks the link URL $url on save", ({ url, fields }) => {
    const document = doc({ links: [{ kind: "website", url }] });
    expect(profileRules.invalidFields(document)).toEqual(fields);
    if (fields.length > 0) {
      expect(() =>
        Profile.create("profile").saveRevision("es", document, "owner", "r", AT),
      ).toThrow(FieldFormatInvalid);
    }
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
