const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
