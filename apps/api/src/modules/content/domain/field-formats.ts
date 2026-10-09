const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Tells whether a string is a URL slug: lowercase letters and digits in words joined by single
 * hyphens, at most 120 characters (`portal-de-empleo`). The same rule as the public contract's
 * `slug`, kept here because the domain imports no package.
 * @param value the candidate slug.
 * @returns true when it is a slug.
 */
export function isSlug(value: string): boolean {
  return value.length <= 120 && KEBAB.test(value);
}

/**
 * Tells whether a text field is filled: something other than whitespace.
 * @param value the field.
 * @returns true when it holds a visible character.
 */
export function isFilled(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Tells whether a string is a year and month, `2025-03` (the contract's `yearMonth`).
 * @param value the candidate.
 * @returns true for `YYYY-MM` with a month from 01 to 12.
 */
export function isYearMonth(value: string): boolean {
  return YEAR_MONTH.test(value);
}

/**
 * Tells whether a string is a display tag: 1 to 60 characters (the contract's `tags`).
 * @param value the candidate tag.
 * @returns true when it fits.
 */
export function isTag(value: string): boolean {
  return value.length >= 1 && value.length <= 60;
}

/**
 * Tells whether a string is an absolute URL with one of the given schemes (`https`, `mailto`).
 * @param value the candidate URL.
 * @param schemes the schemes allowed, without the colon.
 * @returns true when it parses and its scheme is allowed.
 */
export function isUrlWith(value: string, schemes: readonly string[]): boolean {
  if (!URL.canParse(value)) return false;
  return schemes.includes(new URL(value).protocol.slice(0, -1));
}

/**
 * The paths of the malformed entries of a list (`stackTags[1]`).
 * @param field the list's field name.
 * @param values the entries.
 * @param valid the rule each entry must pass.
 * @returns one path per entry that fails.
 */
export function invalidEntries(
  field: string,
  values: readonly string[],
  valid: (value: string) => boolean,
): string[] {
  return values.flatMap((value, index) => (valid(value) ? [] : [`${field}[${index}]`]));
}
