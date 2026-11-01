export type Priority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

export const PRIORITIES: readonly Priority[] = ["Highest", "High", "Medium", "Low", "Lowest"];

/** A client contract parsed from a statement of work (SOW). */
export interface Contract {
  readonly client: string;
  readonly inScope: readonly string[];
  readonly outOfScope: readonly string[];
  /** Retainer hours included per calendar month. 0 means no retainer. */
  readonly retainerHours: number;
  /** Hourly rate for out-of-scope / overage work. */
  readonly rate: number;
  readonly currency: string;
  /** Resolution targets in hours, per Jira priority. */
  readonly slaHours: Readonly<Partial<Record<Priority, number>>>;
  /** Parser notes for the user, e.g. sections that were missing. */
  readonly warnings: readonly string[];
}

export type ScopeVerdict = "IN_SCOPE" | "OUT_OF_SCOPE" | "NEEDS_REVIEW";

export interface ScopeResult {
  readonly verdict: ScopeVerdict;
  /** 0..1, how strongly the best clause matched. */
  readonly confidence: number;
  readonly matchedClause: string | null;
  readonly matchedTerms: readonly string[];
  readonly reason: string;
}

export interface Worklog {
  readonly issueKey: string;
  readonly started: string; // ISO date-time
  readonly timeSpentSeconds: number;
}

export type BurnStatus = "HEALTHY" | "WATCH" | "OVER" | "NO_RETAINER";

export interface RetainerBurn {
  readonly month: string; // YYYY-MM
  readonly retainerHours: number;
  readonly usedHours: number;
  readonly remainingHours: number;
  readonly percentUsed: number;
  readonly projectedHours: number;
  readonly overageHours: number;
  readonly overageCost: number;
  readonly currency: string;
  readonly status: BurnStatus;
  readonly topIssues: readonly { issueKey: string; hours: number }[];
}

export type SlaState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "NO_TARGET";

export interface SlaResult {
  readonly priority: string;
  readonly targetHours: number | null;
  readonly elapsedHours: number;
  readonly remainingHours: number | null;
  readonly state: SlaState;
}

export type ChangeOrderStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ChangeOrder {
  readonly id: string; // e.g. CO-SAV-003
  readonly projectKey: string;
  readonly issueKey: string;
  readonly title: string;
  readonly justification: string;
  readonly estimateHours: number;
  readonly rate: number;
  readonly currency: string;
  readonly amount: number;
  readonly status: ChangeOrderStatus;
  readonly createdAt: string;
  readonly createdBy: string; // accountId, or "rovo" for agent drafts
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly confluencePageUrl?: string;
}
