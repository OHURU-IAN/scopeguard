import { kvs } from "@forge/kvs";
import { z } from "zod";
import type { ChangeOrder, ScopeResult } from "../domain/types";

export const settingsSchema = z
  .object({
    sowSource: z.enum(["confluence", "text"]),
    confluencePage: z.string().trim().max(500).optional(),
    sowText: z.string().max(20_000).optional(),
    autoFlag: z.boolean().default(true),
  })
  .refine((s) => (s.sowSource === "confluence" ? !!s.confluencePage : !!s.sowText?.trim()), {
    message: "Link a Confluence SOW page or paste the SOW text.",
  });

export type ProjectSettings = z.infer<typeof settingsSchema>;

export interface StoredVerdict extends ScopeResult {
  readonly checkedAt: string;
}

const settingsKey = (projectKey: string): string => `settings:${projectKey}`;
const ordersKey = (projectKey: string): string => `orders:${projectKey}`;
const verdictKey = (issueKey: string): string => `verdict:${issueKey}`;

export const MAX_ORDERS = 200;

export async function getSettings(projectKey: string): Promise<ProjectSettings | null> {
  const raw = await kvs.get(settingsKey(projectKey));
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveSettings(projectKey: string, input: unknown): Promise<ProjectSettings> {
  const settings = settingsSchema.parse(input);
  await kvs.set(settingsKey(projectKey), settings);
  return settings;
}

export async function listOrders(projectKey: string): Promise<ChangeOrder[]> {
  return ((await kvs.get(ordersKey(projectKey))) as ChangeOrder[] | undefined) ?? [];
}

/** Insert or replace an order by id, keeping the newest MAX_ORDERS. */
export async function putOrder(order: ChangeOrder): Promise<ChangeOrder[]> {
  const existing = await listOrders(order.projectKey);
  const next = [order, ...existing.filter((o) => o.id !== order.id)].slice(0, MAX_ORDERS);
  await kvs.set(ordersKey(order.projectKey), next);
  return next;
}

export async function getVerdict(issueKey: string): Promise<StoredVerdict | null> {
  return ((await kvs.get(verdictKey(issueKey))) as StoredVerdict | undefined) ?? null;
}

export async function saveVerdict(issueKey: string, verdict: StoredVerdict): Promise<void> {
  await kvs.set(verdictKey(issueKey), verdict);
}
