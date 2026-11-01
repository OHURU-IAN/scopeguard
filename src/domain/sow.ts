import { PRIORITIES, type Contract, type Priority } from "./types";

type Section = "inScope" | "outOfScope" | "sla" | "other";

const SECTION_PATTERNS: readonly [RegExp, Section][] = [
  [/^(out[\s-]*of[\s-]*scope|exclusions?|not included)/i, "outOfScope"],
  [/^(in[\s-]*scope|scope of work|deliverables|included)/i, "inScope"],
  [/^(sla|service levels?|response times?)/i, "sla"],
];

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Convert Confluence storage format (XHTML) into the plain-text SOW format parseSow reads. */
export function storageToText(storage: string): string {
  return storage
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/li|\/tr|\/div)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function classifyHeading(line: string): Section | null {
  const match = /^#{1,6}\s*(.+)$/.exec(line);
  if (!match) return null;
  const title = match[1].trim();
  const found = SECTION_PATTERNS.find(([pattern]) => pattern.test(title));
  return found ? found[1] : "other";
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function readField(lines: readonly string[], label: RegExp): string | null {
  for (const line of lines) {
    const match = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${label.source})\\s*[:=-]\\s*(.+)$`, "i").exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

function parseRate(raw: string | null): { rate: number; currency: string } {
  if (!raw) return { rate: 0, currency: "USD" };
  const currencyMatch = /\b([A-Z]{3})\b|([$€£])/.exec(raw);
  const symbolMap: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
  const currency = currencyMatch?.[1] ?? symbolMap[currencyMatch?.[2] ?? ""] ?? "USD";
  const amount = /(\d[\d,]*(?:\.\d+)?)/.exec(raw);
  return { rate: amount ? parseNumber(amount[1]) : 0, currency };
}

function parseSlaLine(line: string): [Priority, number] | null {
  const match = /^(highest|high|medium|low|lowest|p[1-5])\b\D*(\d+(?:\.\d+)?)\s*(h|hours?|d|days?)?/i.exec(line);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const priority = key.startsWith("p")
    ? PRIORITIES[Number(key.slice(1)) - 1]
    : PRIORITIES.find((p) => p.toLowerCase() === key);
  if (!priority) return null;
  const value = Number(match[2]);
  const isDays = /^d/i.test(match[3] ?? "");
  return [priority, isDays ? value * 24 : value];
}

/**
 * Parse a statement of work written with simple headings and bullets:
 *
 *   Client: Savanna Coffee Co.
 *   Retainer: 40 hours / month
 *   Rate: KES 6,500 / hour
 *   ## In scope        (- bullet per deliverable)
 *   ## Out of scope    (- bullet per exclusion)
 *   ## SLA             (- High: 8 hours)
 */
export function parseSow(text: string): Contract {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const buckets: Record<Section, string[]> = { inScope: [], outOfScope: [], sla: [], other: [] };
  let current: Section = "other";
  for (const line of lines) {
    const heading = classifyHeading(line);
    if (heading) {
      current = heading;
      continue;
    }
    const item = line.replace(/^[-*•]\s*|^\d+[.)]\s*/, "").trim();
    if (item) buckets[current].push(item);
  }

  const retainerRaw = readField(lines, /retainer|monthly hours|hours per month/);
  const retainerMatch = retainerRaw ? /(\d[\d,]*(?:\.\d+)?)/.exec(retainerRaw) : null;
  const { rate, currency } = parseRate(readField(lines, /rate|hourly rate|change order rate/));
  const slaHours = Object.fromEntries(
    buckets.sla.map(parseSlaLine).filter((entry): entry is [Priority, number] => entry !== null),
  );

  const warnings = [
    buckets.inScope.length === 0 && "No 'In scope' section found.",
    buckets.outOfScope.length === 0 && "No 'Out of scope' section found.",
    !retainerMatch && "No retainer hours found (expected 'Retainer: 40 hours / month').",
    rate === 0 && "No hourly rate found (expected 'Rate: USD 50 / hour').",
    Object.keys(slaHours).length === 0 && "No SLA targets found (expected '- High: 8 hours' under 'SLA').",
  ].filter((w): w is string => typeof w === "string");

  return {
    client: readField(lines, /client|customer/) ?? "Unnamed client",
    inScope: buckets.inScope,
    outOfScope: buckets.outOfScope,
    retainerHours: retainerMatch ? parseNumber(retainerMatch[1]) : 0,
    rate,
    currency,
    slaHours,
    warnings,
  };
}
