import { z } from "zod";
import { formatMoney } from "../domain/changeOrder";
import { checkIssue, draftOrder, loadContract, retainerStatus, reviewProject, type IssueCheck } from "../services/core";

/** Rovo passes LLM-extracted inputs plus deterministic context; prefer context when inputs are missing or malformed. */
interface ActionPayload {
  readonly [input: string]: unknown;
  readonly context?: { jira?: { issueKey?: string | number; projectKey?: string } };
}
interface ActionContext {
  readonly principal?: { accountId?: string };
  readonly accountId?: string;
}

const issueKeyInput = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]+-\d+$/);
const projectKeyInput = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/);

export function resolveIssueKey(payload: ActionPayload): string {
  const fromInput = issueKeyInput.safeParse(payload.issueKey);
  if (fromInput.success) return fromInput.data.toUpperCase();
  const fromContext = issueKeyInput.safeParse(String(payload.context?.jira?.issueKey ?? ""));
  if (fromContext.success) return fromContext.data.toUpperCase();
  throw new Error("Tell me which Jira issue to check, for example SAV-12.");
}

export function resolveProjectKey(payload: ActionPayload): string {
  const fromInput = projectKeyInput.safeParse(payload.projectKey);
  if (fromInput.success) return fromInput.data.toUpperCase();
  const fromContext = projectKeyInput.safeParse(payload.context?.jira?.projectKey ?? "");
  if (fromContext.success) return fromContext.data.toUpperCase();
  const issue = issueKeyInput.safeParse(payload.issueKey ?? String(payload.context?.jira?.issueKey ?? ""));
  if (issue.success) return issue.data.split("-")[0].toUpperCase();
  throw new Error("Tell me which Jira project (client) you mean, for example SAV.");
}

/** Actions return a message instead of throwing so the agent can explain the problem to the user. */
async function safely<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    console.error("[ScopeGuard] action failed", error);
    return { error: error instanceof Error ? error.message : "ScopeGuard hit an unexpected error." };
  }
}

function describeCheck(c: IssueCheck): Record<string, unknown> {
  return {
    issueKey: c.issue.key,
    summary: c.issue.summary,
    description: c.issue.description.slice(0, 1500),
    verdict: c.scope.verdict,
    confidence: c.scope.confidence,
    matchedSowClause: c.scope.matchedClause,
    reason: c.scope.reason,
    sla: c.sla,
    url: c.issue.url,
  };
}

export const getContract = (payload: ActionPayload) =>
  safely(async () => {
    const { contract, source, sowPage } = await loadContract(resolveProjectKey(payload));
    return { ...contract, sowSource: source, sowUrl: sowPage?.url ?? null };
  });

export const checkScope = (payload: ActionPayload) =>
  safely(async () => {
    const check = await checkIssue(resolveIssueKey(payload));
    const { contract } = await loadContract(check.issue.projectKey);
    return { ...describeCheck(check), client: check.client, inScope: contract.inScope, outOfScope: contract.outOfScope };
  });

export const getRetainer = (payload: ActionPayload) =>
  safely(async () => {
    const burn = await retainerStatus(resolveProjectKey(payload));
    return { ...burn, overageCostFormatted: formatMoney(burn.overageCost, burn.currency) };
  });

export const scanProject = (payload: ActionPayload) =>
  safely(async () => {
    const review = await reviewProject(resolveProjectKey(payload));
    return {
      client: review.client,
      scannedOpenIssues: review.scanned,
      possibleScopeCreep: review.flagged.slice(0, 15).map(describeCheck),
      slaAtRiskOrBreached: review.slaRisks.slice(0, 15).map(describeCheck),
    };
  });

const draftInput = z.object({
  estimateHours: z.coerce.number().positive().max(1000),
  justification: z.string().max(2000).optional(),
});

export const draftChangeOrderAction = (payload: ActionPayload, context?: ActionContext) =>
  safely(async () => {
    const input = draftInput.parse({ estimateHours: payload.estimateHours, justification: payload.justification ?? undefined });
    const order = await draftOrder({
      issueKey: resolveIssueKey(payload),
      estimateHours: input.estimateHours,
      justification: input.justification,
      createdBy: context?.principal?.accountId ?? context?.accountId ?? "rovo",
    });
    return {
      ...order,
      amountFormatted: formatMoney(order.amount, order.currency),
      nextStep: `Drafted as PENDING. A project member must approve ${order.id} in the ScopeGuard panel on ${order.issueKey} before it is shared with the client.`,
    };
  });
