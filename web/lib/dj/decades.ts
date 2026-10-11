/** Decades guests can ask for. Stored as the start year (1980, 2000...) and shown as "80s", "2000s". */
export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

/** "80s", "1980s", "2000s", "00s" -> 1980 / 1980 / 2000 / 2000. Null if it is not a supported decade. */
export function parseDecade(text: string): number | null {
  const m = /(\d{2,4})\s*'?s?/.exec(text.trim().toLowerCase());
  if (!m) return null;
  let y = Number(m[1]);
  if (m[1].length === 2) y = y >= 30 ? 1900 + y : 2000 + y;
  y = Math.floor(y / 10) * 10;
  return (DECADES as readonly number[]).includes(y) ? y : null;
}

export const decadeLabel = (start: number) => (start >= 2000 ? `${start}s` : `${String(start % 100).padStart(2, "0")}s`);

export const inDecades = (year: number, decades: number[]) => decades.some((d) => year >= d && year < d + 10);
