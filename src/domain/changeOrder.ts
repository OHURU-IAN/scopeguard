import type { ChangeOrder, Contract } from "./types";

export interface DraftInput {
  readonly projectKey: string;
  readonly issueKey: string;
  readonly title: string;
  readonly justification: string;
  readonly estimateHours: number;
  readonly sequence: number;
  readonly createdBy: string;
  readonly now: Date;
}

export class ChangeOrderError extends Error {}

export function changeOrderId(projectKey: string, sequence: number): string {
  return `CO-${projectKey}-${String(sequence).padStart(3, "0")}`;
}

export function draftChangeOrder(input: DraftInput, contract: Pick<Contract, "rate" | "currency">): ChangeOrder {
  if (!(input.estimateHours > 0) || input.estimateHours > 1000) {
    throw new ChangeOrderError("Estimate must be between 0 and 1000 hours.");
  }
  const estimateHours = Math.round(input.estimateHours * 4) / 4; // quarter-hour billing
  return {
    id: changeOrderId(input.projectKey, input.sequence),
    projectKey: input.projectKey,
    issueKey: input.issueKey,
    title: input.title.trim().slice(0, 200),
    justification: input.justification.trim().slice(0, 2000),
    estimateHours,
    rate: contract.rate,
    currency: contract.currency,
    amount: Math.round(estimateHours * contract.rate * 100) / 100,
    status: "PENDING",
    createdAt: input.now.toISOString(),
    createdBy: input.createdBy,
  };
}

export type Decision = "APPROVE" | "REJECT";

/** Human-in-the-loop gate: only a PENDING order can be decided, and only once. */
export function decideChangeOrder(order: ChangeOrder, decision: Decision, actor: string, now: Date, note = ""): ChangeOrder {
  if (order.status !== "PENDING") {
    throw new ChangeOrderError(`${order.id} is already ${order.status.toLowerCase()}.`);
  }
  if (!actor) throw new ChangeOrderError("A signed-in user must make the decision.");
  return {
    ...order,
    status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
    decidedAt: now.toISOString(),
    decidedBy: actor,
    decisionNote: note.trim().slice(0, 500),
  };
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Confluence storage-format body for an approved change order page. */
export function renderChangeOrderPage(order: ChangeOrder, client: string, issueUrl: string): string {
  const row = (label: string, value: string): string => `<tr><th>${label}</th><td>${value}</td></tr>`;
  return [
    `<p>Change order for <strong>${escapeXml(client)}</strong>, raised by ScopeGuard.</p>`,
    "<table><tbody>",
    row("Change order", escapeXml(order.id)),
    row("Jira issue", `<a href="${escapeXml(issueUrl)}">${escapeXml(order.issueKey)}</a>`),
    row("Work", escapeXml(order.title)),
    row("Estimate", `${order.estimateHours} hours`),
    row("Rate", escapeXml(formatMoney(order.rate, order.currency))),
    row("Amount", `<strong>${escapeXml(formatMoney(order.amount, order.currency))}</strong>`),
    row("Status", escapeXml(order.status)),
    row("Approved", escapeXml(order.decidedAt ?? "")),
    "</tbody></table>",
    "<h2>Why this is outside the agreed scope</h2>",
    `<p>${escapeXml(order.justification)}</p>`,
    "<h2>Client sign-off</h2>",
    "<p>Approved by: ____________________ Date: __________</p>",
  ].join("");
}

/** Plain-text Jira comment that records a decision on the issue. */
export function decisionComment(order: ChangeOrder): string {
  const verb = order.status === "APPROVED" ? "approved" : "rejected";
  const link = order.confluencePageUrl ? ` Change order page: ${order.confluencePageUrl}` : "";
  const note = order.decisionNote ? ` Note: ${order.decisionNote}` : "";
  return `ScopeGuard: ${order.id} was ${verb} (${order.estimateHours} h, ${formatMoney(order.amount, order.currency)}).${note}${link}`;
}
