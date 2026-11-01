import { describe, expect, it } from "vitest";
import { parseSow, storageToText } from "../src/domain/sow";
import { SAMPLE_SOW, SAMPLE_STORAGE } from "./fixtures";

describe("parseSow", () => {
  it("reads client, retainer, rate, scope lists and SLA targets", () => {
    const contract = parseSow(SAMPLE_SOW);

    expect(contract.client).toBe("Savanna Coffee Co.");
    expect(contract.retainerHours).toBe(40);
    expect(contract.rate).toBe(6500);
    expect(contract.currency).toBe("KES");
    expect(contract.inScope).toHaveLength(4);
    expect(contract.outOfScope[0]).toBe("Mobile app development (Android or iOS)");
    expect(contract.slaHours).toEqual({ Highest: 4, High: 8, Medium: 48, Low: 72 });
    expect(contract.warnings).toEqual([]);
  });

  it("maps P1-P5 priorities and currency symbols", () => {
    const contract = parseSow("Hourly rate: $45.50\n## SLA\n- P1: 2 hours\n- P3 24h\n- unknown: 5");
    expect(contract.rate).toBe(45.5);
    expect(contract.currency).toBe("USD");
    expect(contract.slaHours).toEqual({ Highest: 2, Medium: 24 });
  });

  it("warns about every missing section on an empty document", () => {
    const contract = parseSow("");
    expect(contract.client).toBe("Unnamed client");
    expect(contract.retainerHours).toBe(0);
    expect(contract.currency).toBe("USD");
    expect(contract.warnings).toHaveLength(5);
  });

  it("treats unknown headings as neutral and numbered lists as items", () => {
    const contract = parseSow("## Deliverables\n1. Landing page fixes\n## Payment terms\n- Net 14\n## Exclusions\n2) Hosting costs");
    expect(contract.inScope).toEqual(["Landing page fixes"]);
    expect(contract.outOfScope).toEqual(["Hosting costs"]);
  });

  it("defaults to USD when a rate has no currency", () => {
    expect(parseSow("Rate: 30 per hour").currency).toBe("USD");
    expect(parseSow("Rate: €30").currency).toBe("EUR");
  });
});

describe("storageToText", () => {
  it("turns Confluence storage XHTML into headings and bullets parseSow understands", () => {
    const text = storageToText(SAMPLE_STORAGE);
    expect(text).toContain("## In scope");
    expect(text).toContain("- M-Pesa checkout maintenance & payment failures");

    const contract = parseSow(text);
    expect(contract.inScope).toHaveLength(2);
    expect(contract.outOfScope).toEqual(["Mobile app development (Android or iOS)"]);
    expect(contract.slaHours).toEqual({ High: 8 });
    expect(contract.retainerHours).toBe(40);
  });

  it("decodes unknown entities to spaces and drops table markup", () => {
    expect(storageToText("<table><tr><td>A&hellip;</td><td>B</td></tr></table>")).toBe("A B");
  });
});
