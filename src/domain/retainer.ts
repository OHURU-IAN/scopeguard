import type { Contract, RetainerBurn, Worklog } from "./types";

export const WATCH_THRESHOLD = 0.8;
export const MIN_PROJECTION_FRACTION = 0.25;
const SECONDS_PER_HOUR = 3600;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Month-to-date retainer burn with a straight-line projection to month end. */
export function computeBurn(
  worklogs: readonly Worklog[],
  contract: Pick<Contract, "retainerHours" | "rate" | "currency">,
  now: Date,
): RetainerBurn {
  const month = monthKey(now);
  const inMonth = worklogs.filter((w) => monthKey(new Date(w.started)) === month);

  const byIssue = new Map<string, number>();
  for (const w of inMonth) {
    byIssue.set(w.issueKey, (byIssue.get(w.issueKey) ?? 0) + w.timeSpentSeconds / SECONDS_PER_HOUR);
  }
  const usedHours = round1([...byIssue.values()].reduce((sum, h) => sum + h, 0));
  const topIssues = [...byIssue.entries()]
    .map(([issueKey, hours]) => ({ issueKey, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  // Early in the month a straight-line projection is noise, so report hours used until enough of the month has passed.
  const elapsedFraction = (now.getUTCDate() - 1 + now.getUTCHours() / 24) / daysInMonth(now);
  const projectedHours = round1(elapsedFraction >= MIN_PROJECTION_FRACTION ? usedHours / elapsedFraction : usedHours);

  const { retainerHours, rate, currency } = contract;
  if (retainerHours <= 0) {
    return { month, retainerHours: 0, usedHours, remainingHours: 0, percentUsed: 0, projectedHours, overageHours: 0, overageCost: 0, currency, status: "NO_RETAINER", topIssues };
  }

  const overageHours = round1(Math.max(usedHours - retainerHours, 0));
  const percentUsed = Math.round((usedHours / retainerHours) * 100);
  const status = usedHours > retainerHours ? "OVER" : usedHours >= retainerHours * WATCH_THRESHOLD || projectedHours > retainerHours ? "WATCH" : "HEALTHY";

  return {
    month,
    retainerHours,
    usedHours,
    remainingHours: round1(Math.max(retainerHours - usedHours, 0)),
    percentUsed,
    projectedHours,
    overageHours,
    overageCost: Math.round(overageHours * rate * 100) / 100,
    currency,
    status,
    topIssues,
  };
}
