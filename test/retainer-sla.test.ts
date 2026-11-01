import { describe, expect, it } from "vitest";
import { computeBurn, monthKey } from "../src/domain/retainer";
import { slaStatus } from "../src/domain/sla";

const contract = { retainerHours: 40, rate: 6500, currency: "KES" };
const hours = (h: number): number => h * 3600;

describe("computeBurn", () => {
  const now = new Date("2026-11-16T00:00:00Z"); // half-way through November

  it("sums this month's worklogs per issue and ignores other months", () => {
    const burn = computeBurn(
      [
        { issueKey: "SAV-1", started: "2026-11-02T09:00:00Z", timeSpentSeconds: hours(6) },
        { issueKey: "SAV-2", started: "2026-11-03T09:00:00Z", timeSpentSeconds: hours(4) },
        { issueKey: "SAV-1", started: "2026-11-10T09:00:00Z", timeSpentSeconds: hours(2) },
        { issueKey: "SAV-9", started: "2026-10-30T09:00:00Z", timeSpentSeconds: hours(30) },
      ],
      contract,
      now,
    );
    expect(burn).toMatchObject({ month: "2026-11", usedHours: 12, remainingHours: 28, percentUsed: 30, status: "HEALTHY", overageHours: 0 });
    expect(burn.topIssues).toEqual([{ issueKey: "SAV-1", hours: 8 }, { issueKey: "SAV-2", hours: 4 }]);
    expect(burn.projectedHours).toBe(24);
  });

  it("warns when the projection will exceed the retainer", () => {
    const burn = computeBurn([{ issueKey: "SAV-1", started: "2026-11-05T09:00:00Z", timeSpentSeconds: hours(25) }], contract, now);
    expect(burn.status).toBe("WATCH");
  });

  it("prices overage hours at the contract rate", () => {
    const burn = computeBurn([{ issueKey: "SAV-1", started: "2026-11-05T09:00:00Z", timeSpentSeconds: hours(42.5) }], contract, now);
    expect(burn).toMatchObject({ status: "OVER", overageHours: 2.5, overageCost: 16250, remainingHours: 0, percentUsed: 106 });
  });

  it("does not extrapolate during the first quarter of the month", () => {
    const burn = computeBurn([{ issueKey: "SAV-1", started: "2026-11-01T06:00:00Z", timeSpentSeconds: hours(10.5) }], contract, new Date("2026-11-01T09:00:00Z"));
    expect(burn).toMatchObject({ projectedHours: 10.5, status: "HEALTHY" });
  });

  it("reports NO_RETAINER when the SOW has no retainer", () => {
    const burn = computeBurn([], { ...contract, retainerHours: 0 }, new Date("2026-11-01T00:00:00Z"));
    expect(burn).toMatchObject({ status: "NO_RETAINER", usedHours: 0, projectedHours: 0 });
  });

  it("formats month keys in UTC", () => {
    expect(monthKey(new Date("2026-01-31T23:00:00Z"))).toBe("2026-01");
  });
});

describe("slaStatus", () => {
  const sla = { slaHours: { High: 8 } };
  const now = new Date("2026-11-02T12:00:00Z");

  it("is on track early, at risk past 75%, and breached past the target", () => {
    expect(slaStatus({ priority: "High", created: "2026-11-02T10:00:00Z" }, sla, now).state).toBe("ON_TRACK");
    expect(slaStatus({ priority: "High", created: "2026-11-02T05:30:00Z" }, sla, now)).toMatchObject({ state: "AT_RISK", remainingHours: 1.5 });
    expect(slaStatus({ priority: "High", created: "2026-11-01T12:00:00Z" }, sla, now)).toMatchObject({ state: "BREACHED", remainingHours: -16 });
  });

  it("marks resolved issues as met or breached", () => {
    expect(slaStatus({ priority: "High", created: "2026-11-01T00:00:00Z", resolved: "2026-11-01T07:00:00Z" }, sla, now).state).toBe("MET");
    expect(slaStatus({ priority: "High", created: "2026-11-01T00:00:00Z", resolved: "2026-11-01T09:00:00Z" }, sla, now).state).toBe("BREACHED");
  });

  it("has no target for priorities the SOW does not cover", () => {
    expect(slaStatus({ priority: "Low", created: "2026-11-02T10:00:00Z" }, sla, now)).toMatchObject({ state: "NO_TARGET", targetHours: null });
  });
});
