const TRAINING_DAY_OFFSET_MS = 60 * 60 * 1000;

export const JSOS_TIME_ZONE = "Asia/Shanghai";

/**
 * A JSOS training day changes at 01:00 Beijing time. Shifting the instant back
 * one hour lets the calendar date use that boundary without special cases.
 */
export function getJsosTrainingDate(now = new Date()) {
  return new Date(now.getTime() - TRAINING_DAY_OFFSET_MS).toLocaleDateString("en-CA", {
    timeZone: JSOS_TIME_ZONE,
  });
}

export function getPreviousTrainingDate(date: string) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
}

export function millisecondsUntilNextTrainingDay(now = new Date(), graceMs = 10_000) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JSOS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const localNow = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  let nextBoundary = Date.UTC(values.year, values.month - 1, values.day, 1, 0, 0);
  if (localNow >= nextBoundary) nextBoundary = Date.UTC(values.year, values.month - 1, values.day + 1, 1, 0, 0);
  return Math.max(0, nextBoundary - localNow + graceMs);
}
