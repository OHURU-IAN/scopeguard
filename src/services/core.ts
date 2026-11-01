import { decideChangeOrder, decisionComment, draftChangeOrder, renderChangeOrderPage, type Decision } from "../domain/changeOrder";
import { computeBurn } from "../domain/retainer";
import { classifyScope } from "../domain/scope";
import { slaStatus } from "../domain/sla";
import { parseSow, storageToText } from "../domain/sow";
import type { ChangeOrder, Contract, RetainerBurn, ScopeResult, SlaResult } from "../domain/types";
import { createChildPage, getPage, type ConfluencePage } from "./confluence";
import { addComment, getIssue, getMonthWorklogs, searchOpenIssues, setLabel, SCOPE_LABEL, type IssueSummary } from "./jira";
import { getSettings, listOrders, putOrder, saveVerdict } from "./store";

export class NotConfiguredError extends Error {
  constructor(projectKey: string) {
    super(`ScopeGuard is not set up for project ${projectKey} yet. Open the ScopeGuard project page and link the client's SOW.`);
  }
}

export interface LoadedContract {
  readonly contract: Contract;
  readonly source: "confluence" | "text";
  readonly sowPage: ConfluencePage | null;
}

export async function loadContract(projectKey: string): Promise<LoadedContract> {
  const settings = await getSettings(projectKey);
  if (!settings) throw new NotConfiguredError(projectKey);
  if (settings.sowSource === "confluence" && settings.confluencePage) {
    const page = await getPage(settings.confluencePage);
    return { contract: parseSow(storageToText(page.storage)), source: "confluence", sowPage: page };
  }
  return { contract: parseSow(settings.sowText ?? ""), source: "text", sowPage: null };
}

export interface IssueCheck {
  readonly issue: IssueSummary;
  readonly client: string;
  readonly scope: ScopeResult;
  readonly sla: SlaResult;
  readonly sowUrl: string | null;
}

export function evaluateIssue(issue: IssueSummary, loaded: LoadedContract, now: Date): IssueCheck {
  return {
    issue,
    client: loaded.contract.client,
    scope: classifyScope(`${issue.summary}\n${issue.description}`, loaded.contract),
    sla: slaStatus(issue, loaded.contract, now),
    sowUrl: loaded.sowPage?.url ?? null,
  };
}

export async function checkIssue(issueKey: string, now = new Date()): Promise<IssueCheck> {
  const issue = await getIssue(issueKey);
  const check = evaluateIssue(issue, await loadContract(issue.projectKey), now);
  await saveVerdict(issue.key, { ...check.scope, checkedAt: now.toISOString() });
  return check;
}

export async function retainerStatus(projectKey: string, now = new Date()): Promise<RetainerBurn & { client: string }> {
  const { contract } = await loadContract(projectKey);
  return { ...computeBurn(await getMonthWorklogs(projectKey), contract, now), client: contract.client };
}

export interface ProjectReview {
  readonly client: string;
  readonly flagged: readonly IssueCheck[];
  readonly slaRisks: readonly IssueCheck[];
  readonly scanned: number;
}

/** Scan open issues for scope creep and SLA risk in one pass. */
export async function reviewProject(projectKey: string, now = new Date()): Promise<ProjectReview> {
  const loaded = await loadContract(projectKey);
  const checks = (await searchOpenIssues(projectKey)).map((issue) => evaluateIssue(issue, loaded, now));
  return {
    client: loaded.contract.client,
    flagged: checks.filter((c) => c.scope.verdict !== "IN_SCOPE"),
    slaRisks: checks
      .filter((c) => c.sla.state === "AT_RISK" || c.sla.state === "BREACHED")
      .sort((a, b) => (a.sla.remainingHours ?? 0) - (b.sla.remainingHours ?? 0)),
    scanned: checks.length,
  };
}

function nextSequence(orders: readonly ChangeOrder[]): number {
  const seqs = orders.map((o) => Number(o.id.split("-").pop())).filter(Number.isFinite);
  return (seqs.length ? Math.max(...seqs) : 0) + 1;
}

export interface DraftRequest {
  readonly issueKey: string;
  readonly estimateHours: number;
  readonly justification?: string;
  readonly createdBy: string;
}

/** Drafts are always PENDING: nothing reaches the client until a person approves it in Jira. */
export async function draftOrder(req: DraftRequest, now = new Date()): Promise<ChangeOrder> {
  const issue = await getIssue(req.issueKey);
  const loaded = await loadContract(issue.projectKey);
  const scope = classifyScope(`${issue.summary}\n${issue.description}`, loaded.contract);
  const orders = await listOrders(issue.projectKey);
  const existing = orders.find((o) => o.issueKey === issue.key && o.status === "PENDING");
  if (existing) return existing;

  const order = draftChangeOrder(
    {
      projectKey: issue.projectKey,
      issueKey: issue.key,
      title: issue.summary,
      justification: req.justification?.trim() || scope.reason,
      estimateHours: req.estimateHours,
      sequence: nextSequence(orders),
      createdBy: req.createdBy,
      now,
    },
    loaded.contract,
  );
  await putOrder(order);
  return order;
}

export interface DecisionRequest {
  readonly projectKey: string;
  readonly orderId: string;
  readonly decision: Decision;
  readonly actor: string;
  readonly note?: string;
}

export async function decideOrder(req: DecisionRequest, now = new Date()): Promise<ChangeOrder> {
  const orders = await listOrders(req.projectKey);
  const order = orders.find((o) => o.id === req.orderId);
  if (!order) throw new Error(`Change order ${req.orderId} was not found.`);

  let decided = decideChangeOrder(order, req.decision, req.actor, now, req.note);
  if (decided.status === "APPROVED") {
    const loaded = await loadContract(req.projectKey);
    if (loaded.sowPage) {
      try {
        const issue = await getIssue(order.issueKey);
        const page = await createChildPage(loaded.sowPage, `${decided.id}: ${decided.title}`, renderChangeOrderPage(decided, loaded.contract.client, issue.url));
        decided = { ...decided, confluencePageUrl: page.url };
      } catch (error) {
        // The approval still stands; the Jira comment records it even if Confluence is unavailable.
        console.error(`[ScopeGuard] Change order page for ${decided.id} not created`, error);
      }
    }
  }
  await putOrder(decided);
  await addComment(decided.issueKey, decisionComment(decided));
  return decided;
}

/** Called from the issue-created trigger: label and comment when a new ticket looks like scope creep. */
export async function autoFlag(issueKey: string, now = new Date()): Promise<ScopeResult | null> {
  const issue = await getIssue(issueKey);
  const settings = await getSettings(issue.projectKey);
  if (!settings || !settings.autoFlag) return null;

  const check = evaluateIssue(issue, await loadContract(issue.projectKey), now);
  await saveVerdict(issue.key, { ...check.scope, checkedAt: now.toISOString() });
  if (check.scope.verdict === "OUT_OF_SCOPE") {
    await setLabel(issue.key, SCOPE_LABEL, true);
    await addComment(
      issue.key,
      `ScopeGuard: this request looks out of scope for ${check.client.replace(/\.$/, "")}. ${check.scope.reason} Open the ScopeGuard panel to draft a change order before work starts.`,
    );
  }
  return check.scope;
}
