import { describe, expect, it } from "vitest";
import { ChangeOrderError, decideChangeOrder, decisionComment, draftChangeOrder, formatMoney, renderChangeOrderPage } from "../src/domain/changeOrder";

const contract = { rate: 6500, currency: "KES" };
const now = new Date("2026-11-02T12:00:00Z");
const input = {
  projectKey: "SAV",
  issueKey: "SAV-7",
  title: "  Android ordering app  ",
  justification: "Mobile apps are excluded in the SOW.",
  estimateHours: 11.1,
  sequence: 3,
  createdBy: "rovo",
  now,
};

describe("draftChangeOrder", () => {
  it("creates a pending order rounded to quarter hours and priced at the SOW rate", () => {
    const order = draftChangeOrder(input, contract);
    expect(order).toMatchObject({ id: "CO-SAV-003", title: "Android ordering app", estimateHours: 11, amount: 71500, status: "PENDING", createdAt: now.toISOString() });
  });

  it("rejects non-positive or absurd estimates", () => {
    expect(() => draftChangeOrder({ ...input, estimateHours: 0 }, contract)).toThrow(ChangeOrderError);
    expect(() => draftChangeOrder({ ...input, estimateHours: Number.NaN }, contract)).toThrow(ChangeOrderError);
    expect(() => draftChangeOrder({ ...input, estimateHours: 5000 }, contract)).toThrow(ChangeOrderError);
  });
});

describe("decideChangeOrder", () => {
  const pending = draftChangeOrder(input, contract);

  it("approves a pending order and records who decided", () => {
    const approved = decideChangeOrder(pending, "APPROVE", "acc-1", now, " ok ");
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: "acc-1", decisionNote: "ok" });
    expect(pending.status).toBe("PENDING"); // original untouched
  });

  it("cannot decide twice or without a user", () => {
    const rejected = decideChangeOrder(pending, "REJECT", "acc-1", now);
    expect(rejected.status).toBe("REJECTED");
    expect(() => decideChangeOrder(rejected, "APPROVE", "acc-1", now)).toThrow("already rejected");
    expect(() => decideChangeOrder(pending, "APPROVE", "", now)).toThrow("signed-in user");
  });
});

describe("rendering", () => {
  const approved = { ...decideChangeOrder(draftChangeOrder(input, contract), "APPROVE", "acc-1", now, "Client agreed on call"), title: "<script>" };

  it("escapes user text in the Confluence page", () => {
    const page = renderChangeOrderPage(approved, "Savanna & Co", "https://x.atlassian.net/browse/SAV-7");
    expect(page).toContain("Savanna &amp; Co");
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain("KES 71,500.00");
  });

  it("writes decision comments with optional note and link", () => {
    expect(decisionComment({ ...approved, confluencePageUrl: "https://wiki/p/1" })).toBe(
      "ScopeGuard: CO-SAV-003 was approved (11 h, KES 71,500.00). Note: Client agreed on call Change order page: https://wiki/p/1",
    );
    expect(decisionComment({ ...approved, status: "REJECTED", decisionNote: "" })).toBe("ScopeGuard: CO-SAV-003 was rejected (11 h, KES 71,500.00).");
  });

  it("renders a page even before a decision date exists", () => {
    expect(renderChangeOrderPage(draftChangeOrder(input, contract), "C", "u")).toContain("<th>Approved</th><td></td>");
    expect(formatMoney(5, "USD")).toBe("USD 5.00");
  });
});
