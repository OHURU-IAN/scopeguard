import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, ButtonGroup, Heading, Inline, Label, Link, SectionMessage, Spinner, Stack, Strong, Text, TextArea, Textfield, xcss } from "@forge/react";
import { call, ErrorBox, hoursLabel, OrderLozenge, SlaLozenge, VerdictLozenge, type Envelope } from "./shared";

interface Order {
  id: string;
  status: string;
  estimateHours: number;
  amount: number;
  currency: string;
  justification: string;
  confluencePageUrl?: string;
  decisionNote?: string;
}

interface PanelData {
  client: string;
  sowUrl: string | null;
  scope: { verdict: string; confidence: number; matchedClause: string | null; reason: string };
  sla: { state: string; targetHours: number | null; elapsedHours: number; remainingHours: number | null; priority: string };
  order: Order | null;
  amountFormatted: string | null;
}

const card = xcss({ padding: "space.150", borderRadius: "radius.medium", backgroundColor: "color.background.neutral.subtle", borderColor: "color.border", borderWidth: "border.width", borderStyle: "solid" });

const DraftForm = ({ onDone, suggested }: { onDone: (r: Envelope<Order>) => void; suggested: string }) => {
  const [hours, setHours] = useState("");
  const [why, setWhy] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    onDone(await call<Order>("draft", { estimateHours: hours, justification: why }));
    setBusy(false);
  };
  return (
    <Stack space="space.100">
      <Label labelFor="sg-hours">Estimated hours</Label>
      <Textfield id="sg-hours" name="hours" type="number" defaultValue={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 12" />
      <Label labelFor="sg-why">Why this is extra work</Label>
      <TextArea id="sg-why" name="why" defaultValue={why} onChange={(e) => setWhy(e.target.value)} />
      <Button appearance="primary" onClick={submit} isDisabled={busy || !hours}>
        Draft change order
      </Button>
    </Stack>
  );
};

const OrderCard = ({ order, amount, onDecide, busy }: { order: Order; amount: string | null; onDecide: (d: "APPROVE" | "REJECT") => void; busy: boolean }) => (
  <Box xcss={card}>
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Strong>{order.id}</Strong>
        <OrderLozenge status={order.status} />
      </Inline>
      <Text>
        {order.estimateHours} h at the contract rate = <Strong>{amount ?? ""}</Strong>
      </Text>
      <Text>{order.justification}</Text>
      {order.status === "PENDING" && (
        <ButtonGroup>
          <Button appearance="primary" onClick={() => onDecide("APPROVE")} isDisabled={busy}>
            Approve and publish
          </Button>
          <Button appearance="subtle" onClick={() => onDecide("REJECT")} isDisabled={busy}>
            Reject
          </Button>
        </ButtonGroup>
      )}
      {order.confluencePageUrl && <Link href={order.confluencePageUrl}>Open the change order in Confluence</Link>}
    </Stack>
  </Box>
);

const App = () => {
  const [state, setState] = useState<Envelope<PanelData> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setState(await call<PanelData>("getPanel"));
  useEffect(() => {
    load();
  }, []);

  if (!state) return <Spinner label="Checking this issue against the SOW" />;
  if (!state.ok) {
    return state.notConfigured ? (
      <SectionMessage appearance="information" title="Link this client's SOW">
        <Text>{state.error}</Text>
      </SectionMessage>
    ) : (
      <ErrorBox message={state.error} />
    );
  }

  const d = state.data;
  const handle = async (result: Envelope<Order>, success: string) => {
    setNotice(result.ok ? success : result.error);
    await load();
  };
  const decide = async (decision: "APPROVE" | "REJECT") => {
    if (!d.order) return;
    setBusy(true);
    await handle(await call<Order>("decide", { orderId: d.order.id, decision }), decision === "APPROVE" ? "Approved. The client record is updated." : "Rejected.");
    setBusy(false);
  };

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <VerdictLozenge verdict={d.scope.verdict} />
        <SlaLozenge state={d.sla.state} />
        <Text>{d.client}</Text>
      </Inline>
      <Text>{d.scope.reason}</Text>
      {d.scope.matchedClause && (
        <Text>
          SOW clause: <Strong>{d.scope.matchedClause}</Strong>
          {d.sowUrl ? " · " : ""}
          {d.sowUrl && <Link href={d.sowUrl}>view SOW</Link>}
        </Text>
      )}
      <Text>
        {d.sla.priority} priority · {d.sla.targetHours === null ? "no SLA target" : `target ${d.sla.targetHours} h · ${hoursLabel(d.sla.remainingHours)}`}
      </Text>
      {notice && <SectionMessage appearance="information"><Text>{notice}</Text></SectionMessage>}
      {d.order ? (
        <Stack space="space.100">
          <Heading size="xsmall">Change order</Heading>
          <OrderCard order={d.order} amount={d.amountFormatted} onDecide={decide} busy={busy} />
        </Stack>
      ) : (
        d.scope.verdict !== "IN_SCOPE" && (
          <Stack space="space.100">
            <Heading size="xsmall">Bill it before you build it</Heading>
            <DraftForm suggested={d.scope.reason} onDone={(r) => handle(r, "Change order drafted. Approve it to publish it for the client.")} />
          </Stack>
        )
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
