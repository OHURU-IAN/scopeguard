import type { Contract, ScopeResult } from "./types";

const STOPWORDS = new Set(
  ("a an and are as at be by can could do for from has have i in into is it its me my need needs of on or our " +
    "please so some that the their them this to up us we will with would you your should also just new add " +
    "make get want like all any via per when what which who how")
    .split(" "),
);

/** Words that usually signal net-new work rather than maintenance. */
const NEW_WORK_SIGNAL = /\b(build|creat|integrat|launch|develop|design|redesign|migrat|implement|set ?up)\w*/i;

const SYNONYMS: Record<string, string> = {
  android: "mobile",
  ios: "mobile",
  iphone: "mobile",
  app: "app",
  apps: "app",
  bug: "fix",
  bugs: "fix",
  broken: "fix",
  error: "fix",
  crash: "fix",
  repair: "fix",
  mpesa: "mpesa",
  "m-pesa": "mpesa",
  stk: "mpesa",
  checkout: "payment",
  payments: "payment",
  pay: "payment",
  website: "site",
  webpage: "site",
  storefront: "site",
  web: "site",
  seo: "seo",
  blog: "content",
  copy: "content",
  newsletter: "email",
  emails: "email",
};

export const IN_SCOPE_THRESHOLD = 0.34;
export const OUT_OF_SCOPE_THRESHOLD = 0.34;

function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(ing|ed|es|s)$/, "");
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/m-pesa/g, "mpesa")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words.map((w) => SYNONYMS[w] ?? stem(w)))];
}

interface ClauseMatch {
  readonly clause: string;
  readonly score: number;
  readonly terms: readonly string[];
}

function bestMatch(issueTokens: readonly string[], clauses: readonly string[]): ClauseMatch | null {
  const issueSet = new Set(issueTokens);
  let best: ClauseMatch | null = null;
  for (const clause of clauses) {
    const clauseTokens = tokenize(clause);
    if (clauseTokens.length === 0) continue;
    const terms = clauseTokens.filter((t) => issueSet.has(t));
    // Share of the clause covered by the issue, softened for very long clauses.
    const score = terms.length / Math.min(clauseTokens.length, 4);
    if (terms.length > 0 && (!best || score > best.score)) {
      best = { clause, score: Math.min(score, 1), terms };
    }
  }
  return best;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Deterministic first-pass scope check of a Jira issue against the SOW.
 * Exclusions win ties, because missing scope creep costs an agency money.
 * The Rovo agent uses this result as evidence, and a human makes the final call.
 */
export function classifyScope(issueText: string, contract: Pick<Contract, "inScope" | "outOfScope">): ScopeResult {
  const tokens = tokenize(issueText);
  if (tokens.length === 0) {
    return { verdict: "NEEDS_REVIEW", confidence: 0, matchedClause: null, matchedTerms: [], reason: "The issue has no descriptive text to compare against the SOW." };
  }

  const out = bestMatch(tokens, contract.outOfScope);
  const inside = bestMatch(tokens, contract.inScope);
  const outScore = out?.score ?? 0;
  const inScore = inside?.score ?? 0;

  if (out && outScore >= OUT_OF_SCOPE_THRESHOLD && outScore >= inScore) {
    return {
      verdict: "OUT_OF_SCOPE",
      confidence: round2(outScore),
      matchedClause: out.clause,
      matchedTerms: out.terms,
      reason: `Matches the SOW exclusion "${out.clause}".`,
    };
  }

  const signalsNewWork = NEW_WORK_SIGNAL.test(issueText);
  if (inside && inScore >= IN_SCOPE_THRESHOLD && !(signalsNewWork && inScore < 0.67)) {
    return {
      verdict: "IN_SCOPE",
      confidence: round2(inScore),
      matchedClause: inside.clause,
      matchedTerms: inside.terms,
      reason: `Covered by the SOW deliverable "${inside.clause}".`,
    };
  }

  const nearest = inScore >= outScore ? inside : out;
  return {
    verdict: "NEEDS_REVIEW",
    confidence: round2(Math.max(inScore, outScore)),
    matchedClause: nearest?.clause ?? null,
    matchedTerms: nearest?.terms ?? [],
    reason: signalsNewWork
      ? "Looks like net-new work that the SOW does not clearly cover. Confirm with the client before starting."
      : "No SOW clause clearly covers this request.",
  };
}
