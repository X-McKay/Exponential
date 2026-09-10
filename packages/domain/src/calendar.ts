/** The delivery calendar the mockup pins: Jan 2026 … Mar 2027, with "today" = Sep 2026. */
export const MONTHS: readonly string[] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan '27", "Feb '27", "Mar '27",
];

/** Index into MONTHS for the current month. */
export const TODAY = 8;

export const monthLabel = (i: number): string => MONTHS[i] ?? `M${i}`;
