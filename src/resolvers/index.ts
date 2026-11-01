import Resolver from "@forge/resolver";
import { z } from "zod";
import { formatMoney } from "../domain/changeOrder";
import { checkIssue, decideOrder, draftOrder, loadContract, NotConfiguredError, retainerStatus, reviewProject } from "../services/core";
import { userHasPermission } from "../services/jira";
import { getSettings, listOrders, saveSettings } from "../services/store";

export interface ResolverRequest {
  readonly payload?: Record<string, unknown>;
  readonly context: {
    readonly accountId?: string;
    readonly extension?: { issue?: { key?: string }; project?: { key?: string } };
  };
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; notConfigured?: boolean };

/** Keys come from the Forge extension context, never from the client payload. */
export function contextKeys(req: ResolverRequest): { issueKey?: string; projectKey: string } {
  const issueKey = req.context.extension?.issue?.key;
  const projectKey = req.context.extension?.project?.key ?? issueKey?.split("-")[0];
  if (!projectKey) throw new Error("Open ScopeGuard from a Jira issue or project.");
  return { issueKey, projectKey };
}

function requireIssue(req: ResolverRequest): { issueKey: string; projectKey: string } {
  const { issueKey, projectKey } = contextKeys(req);
  if (!issueKey) throw new Error("Open ScopeGuard from a Jira issue.");
  return { issueKey, projectKey };
}

function requireUser(req: ResolverRequest): string {
  if (!req.context.accountId) throw new Error("You need to be signed in to do that.");
  return req.context.accountId;
}

export async function wrap<T>(run: () => Promise<T>): Promise<Envelope<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof NotConfiguredError) return { ok: false, error: error.message, notConfigured: true };
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join(" ") };
    console.error("[ScopeGuard] resolver failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export const getPanel = (req: ResolverRequest) =>
  wrap(async () => {
    const { issueKey, projectKey } = requireIssue(req);
    const [check, orders] = await Promise.all([checkIssue(issueKey), listOrders(projectKey)]);
    const order = orders.find((o) => o.issueKey === check.issue.key) ?? null;
    return { ...check, order, amountFormatted: order ? formatMoney(order.amount, order.currency) : null };
  });

const draftSchema = z.object({
  estimateHours: z.coerce.number({ error: "Estimate must be a number of hours." }).positive("Estimate must be more than 0 hours.").max(1000),
  justification: z.string().max(2000).optional(),
});

export const draft = (req: ResolverRequest) =>
  wrap(async () => {
    const { issueKey } = requireIssue(req);
    const input = draftSchema.parse(req.payload ?? {});
    return draftOrder({ issueKey, ...input, createdBy: requireUser(req) });
  });

const decideSchema = z.object({
  orderId: z.string().regex(/^CO-[A-Z0-9_]+-\d{3,}$/),
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(500).optional(),
});

export const decide = (req: ResolverRequest) =>
  wrap(async () => {
    const { projectKey } = contextKeys(req);
    const actor = requireUser(req);
    const input = decideSchema.parse(req.payload ?? {});
    if (!(await userHasPermission(projectKey, "EDIT_ISSUES"))) {
      throw new Error("Only people who can edit issues in this project can approve or reject change orders.");
    }
    return decideOrder({ projectKey, actor, ...input });
  });

export const getOverview = (req: ResolverRequest) =>
  wrap(async () => {
    const { projectKey } = contextKeys(req);
    const settings = await getSettings(projectKey);
    if (!settings) return { projectKey, settings: null, contract: null, burn: null, review: null, orders: [] };
    const [loaded, burn, review, orders] = await Promise.all([loadContract(projectKey), retainerStatus(projectKey), reviewProject(projectKey), listOrders(projectKey)]);
    return { projectKey, settings, contract: loaded.contract, sowUrl: loaded.sowPage?.url ?? null, burn, review, orders };
  });

export const updateSettings = (req: ResolverRequest) =>
  wrap(async () => {
    const { projectKey } = contextKeys(req);
    requireUser(req);
    if (!(await userHasPermission(projectKey, "ADMINISTER_PROJECTS", "ADMINISTER"))) {
      throw new Error("Only project admins can change the ScopeGuard SOW settings.");
    }
    const settings = await saveSettings(projectKey, req.payload ?? {});
    const { contract } = await loadContract(projectKey); // fail fast if the SOW page cannot be read
    return { settings, contract };
  });

const resolver = new Resolver();
resolver.define("getPanel", getPanel);
resolver.define("draft", draft);
resolver.define("decide", decide);
resolver.define("getOverview", getOverview);
resolver.define("updateSettings", updateSettings);

export const handler = resolver.getDefinitions();
