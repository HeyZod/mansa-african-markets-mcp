/**
 * Builds the Proshare "Stock Recommendations for the Week of..." URL
 * for a given Monday date.
 *
 * Pattern: https://proshare.co/articles/stock-recommendation-for-the-week-of-{month}-{day}-{year}
 * Examples:
 *   May 19, 2026  → .../stock-recommendation-for-the-week-of-may-19-2026
 *   January 5, 2026 → .../stock-recommendation-for-the-week-of-january-5-2026
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * @param {Date} date - A Monday date (defaults to this Monday)
 * @returns {string} Full Proshare article URL (zero-padded day — Proshare's
 *   convention, confirmed June 2026: ...-june-08-2026, NOT ...-june-8-2026.
 *   The unpadded form 404'd silently for two consecutive single-digit
 *   Mondays; use buildProshareUrlCandidates to try both.)
 */
export function buildProshareUrl(date = new Date()) {
  return buildProshareUrlCandidates(date)[0];
}

/**
 * All plausible URL forms for the week's article, most likely first.
 * @param {Date} date - A Monday date
 * @returns {string[]}
 */
export function buildProshareUrlCandidates(date = new Date()) {
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const query = "?menu=Market&classification=Read&category=Stock+Picks";
  const days = [String(date.getDate()).padStart(2, "0"), String(date.getDate())];
  return [...new Set(days)].map(
    (day) => `https://proshare.co/articles/stock-recommendation-for-the-week-of-${month}-${day}-${year}${query}`
  );
}

/**
 * Returns the most recent Monday (or today if today is Monday).
 * @returns {Date}
 */
export function getThisMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns ISO week string used as the primary key in Supabase.
 * Format: "2026-W21"
 */
export function getWeekKey(date = new Date()) {
  const monday = getThisMonday(date);
  const year = monday.getFullYear();

  // ISO week number
  const startOfYear = new Date(year, 0, 1);
  const weekNum = Math.ceil(
    ((monday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}
