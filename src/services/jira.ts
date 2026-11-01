import api, { route } from "@forge/api";
import type { Worklog } from "../domain/types";
import { readJson } from "./http";

export interface IssueSummary {
  readonly key: string;
  readonly projectKey: string;
  readonly summary: string;
  readonly description: string;
  readonly priority: string;
  readonly status: string;
  readonly created: string;
  readonly resolved: string | null;
  readonly labels: readonly string[];
  readonly url: string;
}

interface RawIssue {
  key: string;
  self?: string;
  fields: {
    summary?: string;
    description?: unknown;
    priority?: { name?: string } | null;
    status?: { name?: string } | null;
    created?: string;
    resolutiondate?: string | null;
    labels?: string[];
    project?: { key?: string };
  };
}

const ISSUE_FIELDS = "summary,description,priority,status,created,resolutiondate,labels,project";
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,19}$/;
export const SCOPE_LABEL = "scope-creep";

export function assertIssueKey(key: string): string {
  const normalised = key.trim().toUpperCase();
  if (!ISSUE_KEY.test(normalised)) throw new Error(`"${key}" is not a valid Jira issue key.`);
  return normalised;
}

export function assertProjectKey(key: string): string {
  const normalised = key.trim().toUpperCase();
  if (!PROJECT_KEY.test(normalised)) throw new Error(`"${key}" is not a valid Jira project key.`);
  return normalised;
}

/** Flatten Atlassian Document Format (or a plain string) into text. */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const { text, content } = node as { text?: string; content?: unknown[] };
  const own = typeof text === "string" ? text : "";
  const children = Array.isArray(content) ? content.map(adfToText).join(" ") : "";
  return `${own} ${children}`.replace(/\s+/g, " ").trim();
}

function toSummary(raw: RawIssue): IssueSummary {
  const base = raw.self ? raw.self.replace(/\/rest\/api\/.*$/, "") : "";
  return {
    key: raw.key,
    projectKey: raw.fields.project?.key ?? raw.key.split("-")[0],
    summary: raw.fields.summary ?? "",
    description: adfToText(raw.fields.description),
    priority: raw.fields.priority?.name ?? "Medium",
    status: raw.fields.status?.name ?? "Unknown",
    created: raw.fields.created ?? new Date().toISOString(),
    resolved: raw.fields.resolutiondate ?? null,
    labels: raw.fields.labels ?? [],
    url: base ? `${base}/browse/${raw.key}` : `/browse/${raw.key}`,
  };
}

export async function getIssue(issueKey: string): Promise<IssueSummary> {
  const key = assertIssueKey(issueKey);
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`);
  return toSummary(await readJson<RawIssue>(res, `load issue ${key}`));
}

/** Open issues in a project, newest first (capped for Forge's invocation time limit). */
export async function searchOpenIssues(projectKey: string, max = 50): Promise<IssueSummary[]> {
  const key = assertProjectKey(projectKey);
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jql: `project = "${key}" AND statusCategory != Done ORDER BY created DESC`, fields: ISSUE_FIELDS.split(","), maxResults: max }),
  });
  const body = await readJson<{ issues?: RawIssue[] }>(res, `search issues in ${key}`);
  return (body.issues ?? []).map(toSummary);
}

/** Worklogs on project issues that were logged this calendar month. */
export async function getMonthWorklogs(projectKey: string, maxIssues = 50): Promise<Worklog[]> {
  const key = assertProjectKey(projectKey);
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jql: `project = "${key}" AND worklogDate >= startOfMonth()`, fields: ["summary"], maxResults: maxIssues }),
  });
  const body = await readJson<{ issues?: { key: string }[] }>(res, `find logged work in ${key}`);
  const perIssue = await Promise.all(
    (body.issues ?? []).map(async ({ key: issueKey }) => {
      const wl = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/worklog?maxResults=1000`);
      const data = await readJson<{ worklogs?: { started: string; timeSpentSeconds: number }[] }>(wl, `load worklogs for ${issueKey}`);
      return (data.worklogs ?? []).map((w) => ({ issueKey, started: w.started, timeSpentSeconds: w.timeSpentSeconds }));
    }),
  );
  return perIssue.flat();
}

/**
 * True when the signed-in user (asUser) holds any of the given permissions in the project.
 * Pass ADMINISTER alongside ADMINISTER_PROJECTS: team-managed projects do not report the latter for Jira admins.
 */
export async function userHasPermission(projectKey: string, ...permissions: string[]): Promise<boolean> {
  const key = assertProjectKey(projectKey);
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?projectKey=${key}&permissions=${permissions.join(",")}`);
  const body = await readJson<{ permissions?: Record<string, { havePermission?: boolean }> }>(res, "check your Jira permissions");
  return permissions.some((p) => body.permissions?.[p]?.havePermission === true);
}

export async function addComment(issueKey: string, text: string): Promise<void> {
  const key = assertIssueKey(issueKey);
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] } }),
  });
  await readJson(res, `comment on ${key}`);
}

export async function setLabel(issueKey: string, label: string, present: boolean): Promise<void> {
  const key = assertIssueKey(issueKey);
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ update: { labels: [present ? { add: label } : { remove: label }] } }),
  });
  await readJson(res, `update labels on ${key}`);
}
