import { config } from "../config.js";

export const now = () => Date.now();
export const DAY = 24 * 60 * 60 * 1000;

const offsetMs = config.tzOffsetMinutes * 60 * 1000;

// Calendar date in the operator's time zone (default UTC+8), e.g. "2026-10-29".
export function localDate(ts = Date.now()) {
  return new Date(ts + offsetMs).toISOString().slice(0, 10);
}

// Start of the operator-local day containing ts, as a UTC epoch in ms.
export function startOfLocalDay(ts = Date.now()) {
  const shifted = ts + offsetMs;
  return shifted - (shifted % DAY) - offsetMs;
}

// "2026-10-29 21:05:09" in the operator's time zone (Alipay expects Beijing time).
export function localDateTime(ts = Date.now()) {
  return new Date(ts + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

// SQL fragment converting a ms epoch column to the operator-local date.
export function sqlLocalDate(column) {
  return `date(${column} / 1000, 'unixepoch', '${config.tzOffsetMinutes >= 0 ? "+" : ""}${config.tzOffsetMinutes} minutes')`;
}
