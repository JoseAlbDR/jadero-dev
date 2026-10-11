import type { Period } from "@jadero/contracts";
import type { Locale } from "next-intl";

/**
 * The labels of a period in one locale: each end as a short month and year (`Jan 2024`), and the
 * machine-readable value for a `<time dateTime>`. `to` is `null` while the period lasts; the page
 * shows its localized "now" there.
 */
export type PeriodLabels = Readonly<{
  from: Readonly<{ value: string; label: string }>;
  to: Readonly<{ value: string; label: string }> | null;
}>;

/**
 * Formats a `YYYY-MM` value as a short month and year in a locale. The month is built and printed
 * in UTC, so the server's time zone can never move `2024-01` back to December 2023.
 * @param value a year and month from the contract, for example `2024-01`.
 * @param locale the page locale.
 * @returns the label, for example `Jan 2024` (en), `ene 2024` (es) or `Jan. 2024` (de).
 */
export function formatYearMonth(value: string, locale: Locale): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Turns a contract period into the labels the timeline prints.
 * @param period the period from the content API (`to: null` while it lasts).
 * @param locale the page locale; month names follow the page, not the content's language.
 * @returns both ends with their label and `dateTime` value.
 */
export function periodLabels(period: Period, locale: Locale): PeriodLabels {
  return {
    from: { value: period.from, label: formatYearMonth(period.from, locale) },
    to: period.to === null ? null : { value: period.to, label: formatYearMonth(period.to, locale) },
  };
}
