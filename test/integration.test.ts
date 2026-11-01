import { beforeEach, describe, expect, it, vi } from "vitest";
import { addIssue, fake, forgeApiMock, forgeKvsMock, resetFake, SOW_PAGE_ID } from "./fakeAtlassian";
import { SAMPLE_SOW } from "./fixtures";

vi.mock("@forge/api", () => forgeApiMock());
vi.mock("@forge/kvs", () => forgeKvsMock());
vi.mock("@forge/resolver", () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.spyOn(console, "error").mockImplementation(() => {});

const { checkScope, draftChangeOrderAction, getContract, getRetainer, scanProject, resolveIssueKey, resolveProjectKey } = await import("../src/actions");
const { getPanel, draft, decide, getOverview, updateSettings, contextKeys } = await import("../src/resolvers");
const { onIssueCreated } = await import("../src/triggers/issueCreated");
const { saveSettings } = await import("../src/services/store");
const { adfToText, assertIssueKey } = await import("../src/services/jira");
const { parsePageId } = await import("../src/services/confluence");

const issueCtx = (key: string, accountId = "acc-ian") => ({ context: { accountId, extension: { issue: { key }, project: { key: key.split("-")[0] } } } });
const projectCtx = (accountId = "acc-ian") => ({ context: { accountId, extension: { project: { key: "SAV" } } } });

beforeEach(async () => {
  resetFake();
  addIssue({ key: "SAV-1", summary: "M-Pesa checkout failing", description: "Payment failures at checkout since Friday", priority: "High", created: new Date(Date.now() - 7 * 3600_000).toISOString(), worklogs: [{ started: new Date().toISOString(), timeSpentSeconds: 5 * 3600 }] });
  addIssue({ key: "SAV-2", summary: "Build an Android app for ordering", description: "Customers want a mobile app", priority: "Medium" });
  addIssue({ key: "SAV-3", summary: "Fix typo on about page", description: "Bug fix", priority: "Low", resolutiondate: "2026-11-02T09:00:00Z" });
});

describe("before setup", () => {
  it("tells users and the agent how to set ScopeGuard up", async () => {
    expect(await getPanel(issueCtx("SAV-1"))).toMatchObject({ ok: false, notConfigured: true });
    expect(await getContract({ projectKey: "SAV" })).toEqual({ error: expect.stringContaining("not set up for project SAV") });
    expect(await getOverview(projectCtx())).toMatchObject({ ok: true, data: { settings: null, orders: [] } });
  });
});

describe("with a Confluence SOW", () => {
  beforeEach(async () => {
    await saveSettings("SAV", { sowSource: "confluence", confluencePage: `https://agency.atlassian.net/wiki/spaces/AG/pages/${SOW_PAGE_ID}/Savanna+SOW` });
  });

  it("Rovo actions read the contract, scope, retainer and project scan", async () => {
    expect(await getContract({ context: { jira: { projectKey: "SAV" } } })).toMatchObject({ client: "Savanna Coffee Co.", retainerHours: 40, sowSource: "confluence" });

    const scope = await checkScope({ issueKey: "sav-2" });
    expect(scope).toMatchObject({ issueKey: "SAV-2", verdict: "OUT_OF_SCOPE", client: "Savanna Coffee Co." });

    expect(await getRetainer({ issueKey: "SAV-1" })).toMatchObject({ usedHours: 5, retainerHours: 40, overageCostFormatted: "KES 0.00" });

    const scan = (await scanProject({ projectKey: "SAV" })) as unknown as { scannedOpenIssues: number; possibleScopeCreep: { issueKey: string }[]; slaAtRiskOrBreached: { issueKey: string }[] };
    expect(scan.scannedOpenIssues).toBe(2);
    expect(scan.possibleScopeCreep.map((i) => i.issueKey)).toEqual(["SAV-2"]);
    expect(scan.slaAtRiskOrBreached.map((i) => i.issueKey)).toEqual(["SAV-1"]);
  });

  it("the agent drafts a PENDING order; a human approves it, publishing to Confluence and commenting in Jira", async () => {
    const drafted = (await draftChangeOrderAction({ context: { jira: { issueKey: "SAV-2" } }, estimateHours: "24" }, { principal: { accountId: "acc-rovo-user" } })) as unknown as { id: string; status: string; amount: number; nextStep: string };
    expect(drafted).toMatchObject({ id: "CO-SAV-001", status: "PENDING", amount: 156000 });
    expect(drafted.nextStep).toContain("must approve");

    // Drafting again returns the same pending order instead of duplicating it.
    expect(await draftChangeOrderAction({ issueKey: "SAV-2", estimateHours: 10 })).toMatchObject({ id: "CO-SAV-001" });

    const panel = await getPanel(issueCtx("SAV-2"));
    expect(panel).toMatchObject({ ok: true, data: { order: { id: "CO-SAV-001" }, amountFormatted: "KES 156,000.00" } });

    const approved = await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-001", decision: "APPROVE", note: "Agreed on call" } });
    expect(approved).toMatchObject({ ok: true, data: { status: "APPROVED", decidedBy: "acc-ian", confluencePageUrl: "https://agency.atlassian.net/wiki/spaces/AG/pages/555" } });
    expect(fake.pages[0]).toMatchObject({ title: "CO-SAV-001: Build an Android app for ordering", parentId: SOW_PAGE_ID });
    expect(fake.comments.at(-1)?.text).toContain("CO-SAV-001 was approved");

    expect(await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-001", decision: "REJECT" } })).toEqual({ ok: false, error: "CO-SAV-001 is already approved." });
  });

  it("keeps an approval even when Confluence page creation fails", async () => {
    fake.failConfluenceCreate = true;
    await draft({ ...issueCtx("SAV-2"), payload: { estimateHours: 8, justification: "Mobile apps are excluded." } });
    const result = await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-001", decision: "APPROVE" } });
    expect(result).toMatchObject({ ok: true, data: { status: "APPROVED" } });
    expect((result as { data: { confluencePageUrl?: string } }).data.confluencePageUrl).toBeUndefined();
  });

  it("blocks decisions and settings changes without Jira permission", async () => {
    await draft({ ...issueCtx("SAV-2"), payload: { estimateHours: 8 } });
    fake.permissions.EDIT_ISSUES = false;
    fake.permissions.ADMINISTER_PROJECTS = false;
    expect(await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-001", decision: "APPROVE" } })).toMatchObject({ ok: false, error: expect.stringContaining("Only people who can edit") });
    expect(await updateSettings({ ...projectCtx(), payload: { sowSource: "text", sowText: "x" } })).toMatchObject({ ok: false, error: expect.stringContaining("project admins") });
  });

  it("validates resolver input", async () => {
    expect(await draft({ ...issueCtx("SAV-2"), payload: { estimateHours: "-3" } })).toEqual({ ok: false, error: "Estimate must be more than 0 hours." });
    expect(await decide({ ...issueCtx("SAV-2"), payload: { orderId: "DROP TABLE", decision: "APPROVE" } })).toMatchObject({ ok: false });
    expect(await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-404", decision: "APPROVE" } })).toEqual({ ok: false, error: "Change order CO-SAV-404 was not found." });
    expect(await draft({ context: { accountId: "a", extension: { project: { key: "SAV" } } } })).toEqual({ ok: false, error: "Open ScopeGuard from a Jira issue." });
    expect(await draft({ ...issueCtx("SAV-2", ""), payload: { estimateHours: 2 } })).toEqual({ ok: false, error: "You need to be signed in to do that." });
  });

  it("builds the project dashboard", async () => {
    const overview = await getOverview(projectCtx());
    expect(overview).toMatchObject({ ok: true, data: { contract: { client: "Savanna Coffee Co." }, burn: { usedHours: 5 }, review: { scanned: 2 } } });
  });

  it("auto-flags new out-of-scope issues and leaves in-scope ones alone", async () => {
    await onIssueCreated({ issue: { key: "SAV-2" } });
    expect(fake.issues.get("SAV-2")?.labels).toContain("scope-creep");
    expect(fake.comments[0]).toMatchObject({ key: "SAV-2", text: expect.stringContaining("looks out of scope for Savanna Coffee Co. Matches") });

    await onIssueCreated({ issue: { key: "SAV-1" } });
    expect(fake.issues.get("SAV-1")?.labels).toEqual([]);
    expect(fake.comments).toHaveLength(1);
  });
});

describe("with pasted SOW text", () => {
  it("saves settings, returns parser warnings, and respects autoFlag=false", async () => {
    const saved = await updateSettings({ ...projectCtx(), payload: { sowSource: "text", sowText: SAMPLE_SOW, autoFlag: false } });
    expect(saved).toMatchObject({ ok: true, data: { settings: { autoFlag: false }, contract: { warnings: [] } } });
    await onIssueCreated({ issue: { key: "SAV-2" } });
    expect(fake.comments).toHaveLength(0);

    await draft({ ...issueCtx("SAV-2"), payload: { estimateHours: 3 } });
    const approved = await decide({ ...issueCtx("SAV-2"), payload: { orderId: "CO-SAV-001", decision: "APPROVE" } });
    expect(fake.pages).toHaveLength(0); // no Confluence page without a Confluence SOW
    expect(approved).toMatchObject({ ok: true });
  });

  it("rejects settings without an SOW", async () => {
    expect(await updateSettings({ ...projectCtx(), payload: { sowSource: "confluence" } })).toEqual({ ok: false, error: "Link a Confluence SOW page or paste the SOW text." });
  });
});

describe("errors and edge cases", () => {
  it("surfaces Jira failures as readable messages", async () => {
    await saveSettings("SAV", { sowSource: "text", sowText: SAMPLE_SOW });
    fake.failPath = /issue\/SAV-1/;
    expect(await checkScope({ issueKey: "SAV-1" })).toEqual({ error: "Could not load issue SAV-1 (HTTP 500)." });
    expect(await checkScope({ issueKey: "SAV-99" })).toEqual({ error: "Could not load issue SAV-99 (HTTP 404)." });
    await expect(onIssueCreated({ issue: { key: "SAV-1" } })).resolves.toBeUndefined();
    await expect(onIssueCreated({})).resolves.toBeUndefined();
  });

  it("asks for keys when the agent has none", async () => {
    expect(await checkScope({})).toEqual({ error: "Tell me which Jira issue to check, for example SAV-12." });
    expect(await getRetainer({})).toEqual({ error: "Tell me which Jira project (client) you mean, for example SAV." });
    expect(await draftChangeOrderAction({ issueKey: "SAV-2" })).toMatchObject({ error: expect.any(String) });
    expect(resolveIssueKey({ issueKey: "nonsense", context: { jira: { issueKey: "SAV-7" } } })).toBe("SAV-7");
    expect(resolveProjectKey({ projectKey: "sav" })).toBe("SAV");
    expect(() => contextKeys({ context: {} })).toThrow("Open ScopeGuard");
  });

  it("validates keys, page IDs and ADF text", () => {
    expect(() => assertIssueKey("SAV")).toThrow("not a valid Jira issue key");
    expect(parsePageId("https://x.atlassian.net/wiki/pages/viewpage.action?pageId=123")).toBe("123");
    expect(() => parsePageId("javascript:alert(1)")).toThrow("Confluence page URL");
    expect(adfToText(null)).toBe("");
    expect(adfToText({ content: [{ text: "a" }, { content: [{ text: "b" }] }] })).toBe("a b");
  });
});
