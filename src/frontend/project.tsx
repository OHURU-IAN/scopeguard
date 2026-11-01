import React, { useEffect, useState } from "react";
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Heading,
  Inline,
  Label,
  Link,
  Lozenge,
  ProgressBar,
  RadioGroup,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  TextArea,
  Textfield,
  Toggle,
  xcss,
} from "@forge/react";
import { call, ErrorBox, hoursLabel, OrderLozenge, SlaLozenge, VerdictLozenge, type Envelope } from "./shared";

interface Check {
  issue: { key: string; summary: string; url: string };
  scope: { verdict: string; matchedClause: string | null };
  sla: { state: string; remainingHours: number | null };
}
interface Overview {
  projectKey: string;
  settings: { sowSource: "confluence" | "text"; confluencePage?: string; sowText?: string; autoFlag: boolean } | null;
  contract: { client: string; inScope: string[]; outOfScope: string[]; retainerHours: number; rate: number; currency: string; warnings: string[] } | null;
  sowUrl?: string | null;
  burn: { usedHours: number; retainerHours: number; percentUsed: number; projectedHours: number; overageHours: number; overageCost: number; currency: string; status: string; month: string } | null;
  review: { flagged: Check[]; slaRisks: Check[]; scanned: number } | null;
  orders: { id: string; issueKey: string; title: string; estimateHours: number; amount: number; currency: string; status: string }[];
}

const tile = xcss({ padding: "space.200", borderRadius: "radius.medium", backgroundColor: "color.background.neutral.subtle", minWidth: "220px" });

const BURN_LOZENGE: Record<string, "success" | "moved" | "removed" | "default"> = { HEALTHY: "success", WATCH: "moved", OVER: "removed", NO_RETAINER: "default" };

const SAMPLE = `Client: Savanna Coffee Co.
Retainer: 40 hours / month
Rate: KES 6,500 / hour

## In scope
- Bug fixes on the existing Next.js storefront
- M-Pesa checkout maintenance and payment failures

## Out of scope
- Mobile app development (Android or iOS)
- New payment provider integrations such as Stripe or PayPal

## SLA
- Highest: 4 hours
- High: 8 hours
- Medium: 2 days`;

const Settings = ({ initial, onSaved }: { initial: Overview["settings"]; onSaved: () => void }) => {
  const [source, setSource] = useState<"confluence" | "text">(initial?.sowSource ?? "confluence");
  const [page, setPage] = useState(initial?.confluencePage ?? "");
  const [text, setText] = useState(initial?.sowText ?? SAMPLE);
  const [autoFlag, setAutoFlag] = useState(initial?.autoFlag ?? true);
  const [result, setResult] = useState<Envelope<{ contract: { warnings: string[] } }> | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const r = await call<{ contract: { warnings: string[] } }>("updateSettings", { sowSource: source, confluencePage: page || undefined, sowText: text || undefined, autoFlag });
    setResult(r);
    setBusy(false);
    if (r.ok) onSaved();
  };

  return (
    <Stack space="space.150">
      <Heading size="small">Statement of work</Heading>
      <RadioGroup
        name="source"
        value={source}
        onChange={(e) => setSource(e.target.value as "confluence" | "text")}
        options={[
          { name: "source", value: "confluence", label: "Read it from a Confluence page (change orders are published under it)" },
          { name: "source", value: "text", label: "Paste the SOW text" },
        ]}
      />
      {source === "confluence" ? (
        <Stack space="space.050">
          <Label labelFor="sg-page">Confluence SOW page URL or ID</Label>
          <Textfield id="sg-page" name="page" defaultValue={page} onChange={(e) => setPage(e.target.value)} placeholder="https://your-site.atlassian.net/wiki/spaces/AG/pages/123456/Savanna+SOW" />
        </Stack>
      ) : (
        <Stack space="space.050">
          <Label labelFor="sg-text">SOW text (headings: In scope, Out of scope, SLA)</Label>
          <TextArea id="sg-text" name="text" defaultValue={text} onChange={(e) => setText(e.target.value)} />
        </Stack>
      )}
      <Inline space="space.100" alignBlock="center">
        <Toggle id="sg-auto" isChecked={autoFlag} onChange={() => setAutoFlag(!autoFlag)} />
        <Label labelFor="sg-auto">Label and comment on new issues that look out of scope</Label>
      </Inline>
      <Button appearance="primary" onClick={save} isDisabled={busy}>
        Save and parse SOW
      </Button>
      {result && !result.ok && <ErrorBox message={result.error} />}
      {result?.ok && result.data.contract.warnings.length > 0 && (
        <SectionMessage appearance="warning" title="Saved, but the SOW is missing some details">
          {result.data.contract.warnings.map((w) => (
            <Text key={w}>{w}</Text>
          ))}
        </SectionMessage>
      )}
    </Stack>
  );
};

const issueRows = (checks: Check[], kind: "scope" | "sla") =>
  checks.map((c) => ({
    key: `${kind}-${c.issue.key}`,
    cells: [
      { key: "k", content: <Link href={c.issue.url}>{c.issue.key}</Link> },
      { key: "s", content: c.issue.summary },
      { key: "v", content: kind === "scope" ? <VerdictLozenge verdict={c.scope.verdict} /> : <SlaLozenge state={c.sla.state} /> },
      { key: "d", content: kind === "scope" ? c.scope.matchedClause ?? "No matching clause" : hoursLabel(c.sla.remainingHours) },
    ],
  }));

const Dashboard = ({ data }: { data: Overview }) => {
  const { contract, burn, review, orders } = data;
  if (!contract || !burn || !review) return null;
  const money = (n: number) => `${burn.currency} ${n.toLocaleString("en-US")}`;
  const pendingValue = orders.filter((o) => o.status === "PENDING").reduce((s, o) => s + o.amount, 0);
  const approvedValue = orders.filter((o) => o.status === "APPROVED").reduce((s, o) => s + o.amount, 0);

  return (
    <Stack space="space.300">
      <Inline space="space.200" shouldWrap>
        <Box xcss={tile}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center">
              <Strong>Retainer {burn.month}</Strong>
              <Lozenge appearance={BURN_LOZENGE[burn.status]}>{burn.status.replace("_", " ").toLowerCase()}</Lozenge>
            </Inline>
            <Heading size="large">{`${burn.usedHours} / ${burn.retainerHours} h`}</Heading>
            <ProgressBar value={Math.min(burn.percentUsed / 100, 1)} appearance={burn.status === "OVER" ? "default" : "success"} ariaLabel="Retainer hours used" />
            <Text>{`Projected ${burn.projectedHours} h by month end${burn.overageHours > 0 ? ` · ${money(burn.overageCost)} overage` : ""}`}</Text>
          </Stack>
        </Box>
        <Box xcss={tile}>
          <Stack space="space.100">
            <Strong>Possible scope creep</Strong>
            <Heading size="large">{String(review.flagged.length)}</Heading>
            <Text>{`of ${review.scanned} open issues`}</Text>
          </Stack>
        </Box>
        <Box xcss={tile}>
          <Stack space="space.100">
            <Strong>Change orders</Strong>
            <Heading size="large">{money(approvedValue)}</Heading>
            <Text>{`approved · ${money(pendingValue)} awaiting approval`}</Text>
          </Stack>
        </Box>
        <Box xcss={tile}>
          <Stack space="space.100">
            <Strong>SLA risk</Strong>
            <Heading size="large">{String(review.slaRisks.length)}</Heading>
            <Text>issues at risk or breached</Text>
          </Stack>
        </Box>
      </Inline>

      <Stack space="space.100">
        <Heading size="small">Requests the SOW does not clearly cover</Heading>
        <DynamicTable
          head={{ cells: [{ key: "k", content: "Issue" }, { key: "s", content: "Summary" }, { key: "v", content: "Verdict" }, { key: "d", content: "Nearest SOW clause" }] }}
          rows={issueRows(review.flagged, "scope")}
          emptyView={<Text>Every open issue maps to an in-scope deliverable.</Text>}
        />
      </Stack>

      <Stack space="space.100">
        <Heading size="small">SLA watchlist</Heading>
        <DynamicTable
          head={{ cells: [{ key: "k", content: "Issue" }, { key: "s", content: "Summary" }, { key: "v", content: "SLA" }, { key: "d", content: "Time" }] }}
          rows={issueRows(review.slaRisks, "sla")}
          emptyView={<Text>No open issue is close to its SLA.</Text>}
        />
      </Stack>

      <Stack space="space.100">
        <Heading size="small">Change orders</Heading>
        <DynamicTable
          head={{ cells: [{ key: "i", content: "ID" }, { key: "k", content: "Issue" }, { key: "t", content: "Work" }, { key: "a", content: "Amount" }, { key: "s", content: "Status" }] }}
          rows={orders.map((o) => ({
            key: o.id,
            cells: [
              { key: "i", content: o.id },
              { key: "k", content: o.issueKey },
              { key: "t", content: o.title },
              { key: "a", content: `${o.currency} ${o.amount.toLocaleString("en-US")} (${o.estimateHours} h)` },
              { key: "s", content: <OrderLozenge status={o.status} /> },
            ],
          }))}
          emptyView={<Text>No change orders yet. Draft one from the ScopeGuard panel on an out-of-scope issue, or ask the ScopeGuard agent in Rovo.</Text>}
        />
      </Stack>
    </Stack>
  );
};

const App = () => {
  const [state, setState] = useState<Envelope<Overview> | null>(null);
  const [editing, setEditing] = useState(false);
  const load = async () => setState(await call<Overview>("getOverview"));
  useEffect(() => {
    load();
  }, []);

  if (!state) return <Spinner label="Loading ScopeGuard" />;
  if (!state.ok) return <ErrorBox message={state.error} />;
  const d = state.data;
  const showSettings = editing || !d.settings;

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          <Heading size="medium">{d.contract ? `ScopeGuard · ${d.contract.client}` : "ScopeGuard setup"}</Heading>
          {d.sowUrl && <Link href={d.sowUrl}>Open the SOW in Confluence</Link>}
        </Stack>
        {d.settings && (
          <Button appearance="subtle" onClick={() => setEditing(!editing)}>
            {editing ? "Back to dashboard" : "Edit SOW settings"}
          </Button>
        )}
      </Inline>
      {showSettings ? (
        <Settings
          initial={d.settings}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      ) : (
        <Dashboard data={d} />
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
