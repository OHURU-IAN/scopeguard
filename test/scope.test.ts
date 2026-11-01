import { describe, expect, it } from "vitest";
import { classifyScope, tokenize } from "../src/domain/scope";
import { parseSow } from "../src/domain/sow";
import { SAMPLE_SOW } from "./fixtures";

const contract = parseSow(SAMPLE_SOW);

describe("tokenize", () => {
  it("drops stopwords, normalises synonyms and stems plurals", () => {
    expect(tokenize("Please fix the broken M-Pesa checkouts on Android")).toEqual(["fix", "mpesa", "checkout", "mobile"]);
  });
});

describe("classifyScope", () => {
  it("flags a mobile app request as out of scope", () => {
    const result = classifyScope("Build an Android app so customers can order coffee", contract);
    expect(result.verdict).toBe("OUT_OF_SCOPE");
    expect(result.matchedClause).toBe("Mobile app development (Android or iOS)");
    expect(result.matchedTerms).toContain("mobile");
  });

  it("flags a new payment provider as out of scope", () => {
    const result = classifyScope("Add Stripe as a payment option for international customers", contract);
    expect(result.verdict).toBe("OUT_OF_SCOPE");
    expect(result.reason).toContain("New payment provider integrations");
  });

  it("accepts maintenance work covered by a deliverable", () => {
    const result = classifyScope("M-Pesa STK push failing at checkout, payment failures since Friday", contract);
    expect(result.verdict).toBe("IN_SCOPE");
    expect(result.matchedClause).toBe("M-Pesa checkout maintenance and payment failures");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("asks for review when net-new work only loosely matches a deliverable", () => {
    const result = classifyScope("Create a loyalty points program for blog readers", contract);
    expect(result.verdict).toBe("NEEDS_REVIEW");
    expect(result.reason).toContain("net-new work");
  });

  it("asks for review when nothing matches", () => {
    const result = classifyScope("Quarterly tax filing", contract);
    expect(result).toMatchObject({ verdict: "NEEDS_REVIEW", matchedClause: null, confidence: 0 });
    expect(result.reason).toBe("No SOW clause clearly covers this request.");
  });

  it("handles empty issue text and empty clauses", () => {
    expect(classifyScope("   ", contract).verdict).toBe("NEEDS_REVIEW");
    expect(classifyScope("fix site", { inScope: ["the of"], outOfScope: [] }).matchedClause).toBeNull();
  });
});
