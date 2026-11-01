import type { Contract, Priority, SlaResult } from "./types";

export const AT_RISK_FRACTION = 0.75;
const MS_PER_HOUR = 3_600_000;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface SlaInput {
  readonly priority: string;
  readonly created: string;
  readonly resolved?: string | null;
}

/** Wall-clock resolution SLA by Jira priority (business-hours calendars are a roadmap item). */
export function slaStatus(issue: SlaInput, contract: Pick<Contract, "slaHours">, now: Date): SlaResult {
  const target = contract.slaHours[issue.priority as Priority];
  const end = issue.resolved ? new Date(issue.resolved) : now;
  const elapsedHours = round1(Math.max(end.getTime() - new Date(issue.created).getTime(), 0) / MS_PER_HOUR);

  if (target === undefined) {
    return { priority: issue.priority, targetHours: null, elapsedHours, remainingHours: null, state: "NO_TARGET" };
  }

  const remainingHours = round1(target - elapsedHours);
  const state = issue.resolved
    ? elapsedHours <= target ? "MET" : "BREACHED"
    : elapsedHours > target ? "BREACHED" : elapsedHours >= target * AT_RISK_FRACTION ? "AT_RISK" : "ON_TRACK";

  return { priority: issue.priority, targetHours: target, elapsedHours, remainingHours, state };
}
