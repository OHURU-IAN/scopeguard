import React from "react";
import { Lozenge, SectionMessage, Text } from "@forge/react";
import { invoke } from "@forge/bridge";

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; notConfigured?: boolean };

export async function call<T>(name: string, payload: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    return (await invoke<Envelope<T>>(name, payload)) as Envelope<T>; // no metadata requested, so the body is returned directly
  } catch {
    return { ok: false, error: "ScopeGuard could not reach its backend. Refresh the page and try again." };
  }
}

const VERDICT: Record<string, { label: string; appearance: "success" | "removed" | "moved" }> = {
  IN_SCOPE: { label: "In scope", appearance: "success" },
  OUT_OF_SCOPE: { label: "Out of scope", appearance: "removed" },
  NEEDS_REVIEW: { label: "Needs review", appearance: "moved" },
};

export const VerdictLozenge = ({ verdict }: { verdict: string }) => {
  const v = VERDICT[verdict] ?? VERDICT.NEEDS_REVIEW;
  return <Lozenge appearance={v.appearance} isBold>{v.label}</Lozenge>;
};

const SLA: Record<string, { label: string; appearance: "success" | "removed" | "moved" | "default" | "inprogress" }> = {
  ON_TRACK: { label: "SLA on track", appearance: "inprogress" },
  AT_RISK: { label: "SLA at risk", appearance: "moved" },
  BREACHED: { label: "SLA breached", appearance: "removed" },
  MET: { label: "SLA met", appearance: "success" },
  NO_TARGET: { label: "No SLA", appearance: "default" },
};

export const SlaLozenge = ({ state }: { state: string }) => {
  const s = SLA[state] ?? SLA.NO_TARGET;
  return <Lozenge appearance={s.appearance}>{s.label}</Lozenge>;
};

const ORDER: Record<string, "moved" | "success" | "removed"> = { PENDING: "moved", APPROVED: "success", REJECTED: "removed" };

export const OrderLozenge = ({ status }: { status: string }) => <Lozenge appearance={ORDER[status] ?? "moved"}>{status.toLowerCase()}</Lozenge>;

export const ErrorBox = ({ message }: { message: string }) => (
  <SectionMessage appearance="error" title="ScopeGuard">
    <Text>{message}</Text>
  </SectionMessage>
);

export function hoursLabel(hours: number | null): string {
  if (hours === null) return "-";
  const abs = Math.abs(hours);
  const text = abs >= 48 ? `${Math.round(abs / 24)} d` : `${abs} h`;
  return hours < 0 ? `${text} over` : `${text} left`;
}
