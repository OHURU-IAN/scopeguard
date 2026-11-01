import { vi } from "vitest";
import { SAMPLE_SOW } from "./fixtures";

/** In-memory Jira, Confluence and KVS used by vi.mock in the integration tests. */
export interface FakeIssue {
  key: string;
  summary: string;
  description: string;
  priority: string;
  created: string;
  resolutiondate?: string | null;
  labels: string[];
  worklogs: { started: string; timeSpentSeconds: number }[];
}

export const fake = {
  issues: new Map<string, FakeIssue>(),
  kv: new Map<string, unknown>(),
  comments: [] as { key: string; text: string }[],
  pages: [] as { title: string; parentId: string; value: string }[],
  permissions: { EDIT_ISSUES: true, ADMINISTER_PROJECTS: true } as Record<string, boolean>,
  failConfluenceCreate: false,
  failPath: null as RegExp | null,
};

export function resetFake(): void {
  fake.issues.clear();
  fake.kv.clear();
  fake.comments.length = 0;
  fake.pages.length = 0;
  fake.permissions = { EDIT_ISSUES: true, ADMINISTER_PROJECTS: true };
  fake.failConfluenceCreate = false;
  fake.failPath = null;
}

export function addIssue(issue: Partial<FakeIssue> & { key: string; summary: string }): void {
  fake.issues.set(issue.key, { description: "", priority: "Medium", created: "2026-11-02T08:00:00Z", labels: [], worklogs: [], ...issue });
}

export const SOW_PAGE_ID = "98765";

function response(status: number, body?: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body ?? "") };
}

function rawIssue(i: FakeIssue) {
  return {
    key: i.key,
    self: `https://agency.atlassian.net/rest/api/3/issue/${i.key}`,
    fields: {
      summary: i.summary,
      description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: i.description }] }] },
      priority: { name: i.priority },
      status: { name: i.resolutiondate ? "Done" : "To Do" },
      created: i.created,
      resolutiondate: i.resolutiondate ?? null,
      labels: i.labels,
      project: { key: i.key.split("-")[0] },
    },
  };
}

async function jira(path: string, init?: { method?: string; body?: string }) {
  if (fake.failPath?.test(path)) return response(500, { error: "boom" });
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : {};
  let m: RegExpExecArray | null;

  if ((m = /^\/rest\/api\/3\/mypermissions\?projectKey=\w+&permissions=([\w,]+)/.exec(path))) {
    const keys = m[1].split(",");
    return response(200, { permissions: Object.fromEntries(keys.map((k) => [k, { havePermission: fake.permissions[k] ?? false }])) });
  }
  if (path === "/rest/api/3/search/jql") {
    const project = /project = "(\w+)"/.exec(body.jql)?.[1];
    const all = [...fake.issues.values()].filter((i) => i.key.startsWith(`${project}-`));
    const picked = body.jql.includes("worklogDate") ? all.filter((i) => i.worklogs.length) : all.filter((i) => !i.resolutiondate);
    return response(200, { issues: picked.map(rawIssue) });
  }
  if ((m = /^\/rest\/api\/3\/issue\/([\w-]+)\/worklog/.exec(path))) {
    return response(200, { worklogs: fake.issues.get(m[1])?.worklogs ?? [] });
  }
  if ((m = /^\/rest\/api\/3\/issue\/([\w-]+)\/comment$/.exec(path))) {
    fake.comments.push({ key: m[1], text: body.body.content[0].content[0].text });
    return response(201, {});
  }
  if ((m = /^\/rest\/api\/3\/issue\/([\w-]+)/.exec(path))) {
    const issue = fake.issues.get(m[1]);
    if (!issue) return response(404, { errorMessages: ["Issue does not exist"] });
    if (method === "PUT") {
      for (const op of body.update.labels) {
        issue.labels = op.add ? [...issue.labels, op.add] : issue.labels.filter((l) => l !== op.remove);
      }
      return response(204);
    }
    return response(200, rawIssue(issue));
  }
  return response(404, {});
}

async function confluence(path: string, init?: { method?: string; body?: string }) {
  if (init?.method === "POST") {
    if (fake.failConfluenceCreate) return response(403, { message: "no" });
    const body = JSON.parse(init.body ?? "{}");
    fake.pages.push({ title: body.title, parentId: body.parentId, value: body.body.value });
    return response(200, { id: "555", title: body.title, spaceId: body.spaceId, _links: { base: "https://agency.atlassian.net/wiki", webui: "/spaces/AG/pages/555" } });
  }
  if (path.startsWith(`/wiki/api/v2/pages/${SOW_PAGE_ID}`)) {
    const storage = SAMPLE_SOW.split("\n").map((l) => (l.startsWith("## ") ? `<h2>${l.slice(3)}</h2>` : l.startsWith("- ") ? `<ul><li>${l.slice(2)}</li></ul>` : `<p>${l}</p>`)).join("");
    return response(200, { id: SOW_PAGE_ID, title: "Savanna SOW", spaceId: "42", body: { storage: { value: storage } }, _links: { webui: `/spaces/AG/pages/${SOW_PAGE_ID}` } });
  }
  return response(404, {});
}

export const forgeApiMock = () => {
  const route = (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), "");
  const client = { requestJira: vi.fn(jira), requestConfluence: vi.fn(confluence) };
  return { default: { asApp: () => client, asUser: () => client }, route };
};

export const forgeKvsMock = () => ({
  kvs: {
    get: vi.fn(async (k: string) => structuredClone(fake.kv.get(k))),
    set: vi.fn(async (k: string, v: unknown) => void fake.kv.set(k, structuredClone(v))),
  },
});
