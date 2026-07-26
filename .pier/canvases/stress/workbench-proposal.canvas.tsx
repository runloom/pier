import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Row,
  Separator,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "pier/canvas";
import { useMemo, useState } from "react";
import { DemoChip } from "../shared/demo-chip";
import { LineTable } from "./components/line-table";
import { MetricCard } from "./components/metric-card";
import { ProposalForm } from "./components/proposal-form";
import { StatusPill } from "./components/status-pill";
import {
  buildProposalLines,
  findPlan,
  formatUsd,
  sumLines,
  type PlanId,
} from "./lib/proposal-math.ts";

/**
 * Stress / quality demo (not a product template).
 * Open: `.pier/canvases/stress/workbench-proposal.canvas.tsx`
 *
 * Exercises:
 * - multi-file relative import graph (canvas → components → lib)
 * - shared DemoChip from `../shared`
 * - react hooks (useState / useMemo) against host React singleton
 * - richer pier/canvas surface (Select, Switch, Tabs, Table)
 *
 * Open: `.pier/canvases/demos/workbench-proposal.canvas.tsx`
 * Checklist: docs/superpowers/specs/2026-07-26-live-modules-verification-checklist.md
 */
export const canvas = {
  description:
    "Stress demo: multi-module graph + interactive pricing. Use for C-track quality checks.",
  kind: "composition" as const,
  title: "Workbench proposal · stress",
};

const DEFAULT_PLAN: PlanId = "pro";
const DEFAULT_SEATS = 8;

export default function WorkbenchProposalCanvas() {
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN);
  const [seats, setSeats] = useState(DEFAULT_SEATS);
  const [includeSupport, setIncludeSupport] = useState(true);
  const [tab, setTab] = useState("configure");

  const lines = useMemo(
    () => buildProposalLines({ includeSupport, planId, seats }),
    [includeSupport, planId, seats]
  );
  const total = useMemo(() => sumLines(lines), [lines]);
  const plan = findPlan(planId);
  let tone: "blocked" | "ready" | "draft" = "draft";
  if (seats < 1) {
    tone = "blocked";
  } else if (includeSupport && seats >= 5) {
    tone = "ready";
  }

  return (
    <Frame maxWidth={960}>
      <Stack gap={10}>
        <Row align="start" justify="space-between">
          <Stack gap={6}>
            <Text as="h1">Workbench seating proposal</Text>
            <Text tone="secondary" style={{ maxWidth: 520 }}>
              Stress canvas for Live Modules quality. Change plan or seats — totals
              must update without a full app reload. Prefer this over hello when
              validating multi-file compile and host React hooks.
            </Text>
          </Stack>
          <Row gap={8} wrap>
            <StatusPill tone={tone} />
            <Badge variant="info">stress demo</Badge>
            <DemoChip label="shared · DemoChip" />
          </Row>
        </Row>

        <Alert variant="info">
          <Text style={{ fontWeight: 600 }}>What this proves</Text>
          <Text tone="secondary">
            Relative multi-hop imports, pure lib modules in the graph, hooks on the
            host React singleton, and pier/canvas form controls. It does not pull
            host app stores or Electron APIs.
          </Text>
        </Alert>
      </Stack>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "var(--muted)",
            borderBottom: "1px solid var(--border)",
            padding: "12px 16px",
          }}
        >
          <Row justify="space-between">
            <Text style={{ fontWeight: 600 }}>
              pier.app / settings / seats · {plan.label}
            </Text>
            <Text tone="secondary" style={{ fontVariantNumeric: "tabular-nums" }}>
              due {formatUsd(total)} / mo
            </Text>
          </Row>
        </div>

        <div style={{ padding: 20 }}>
          <div
            style={{
              display: "grid",
              gap: 20,
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
            }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Configure</CardTitle>
                <CardDescription>
                  Interactive form — Select / Switch / counters
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProposalForm
                  includeSupport={includeSupport}
                  onPlanChange={setPlanId}
                  onReset={() => {
                    setPlanId(DEFAULT_PLAN);
                    setSeats(DEFAULT_SEATS);
                    setIncludeSupport(true);
                  }}
                  onSeatsChange={(next) => {
                    setSeats(Math.max(1, Math.min(50, next)));
                  }}
                  onSupportChange={setIncludeSupport}
                  planId={planId}
                  seats={seats}
                />
              </CardContent>
            </Card>

            <Stack gap={14}>
              <Row gap={12} style={{ alignItems: "stretch" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MetricCard
                    hint={`${plan.pricePerSeatMonthly}/seat · monthly`}
                    label="Plan rate"
                    value={formatUsd(plan.pricePerSeatMonthly)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MetricCard
                    hint={includeSupport ? "support on" : "support off"}
                    label="Estimated total"
                    value={formatUsd(total)}
                  />
                </div>
              </Row>

              <Tabs
                onValueChange={setTab}
                value={tab}
              >
                <TabsList>
                  <TabsTrigger value="configure">Breakdown</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="configure">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Line items</CardTitle>
                      <CardDescription>
                        Built by demos/lib/proposal-math.ts
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <LineTable lines={lines} />
                      <Separator />
                      <Row justify="space-between" style={{ marginTop: 12 }}>
                        <Text style={{ fontWeight: 600 }}>Total</Text>
                        <Text
                          style={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                          }}
                        >
                          {formatUsd(total)}
                        </Text>
                      </Row>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="notes">
                  <Card size="sm">
                    <CardContent>
                      <Stack gap={8}>
                        <Text style={{ fontWeight: 600 }}>Validation tips</Text>
                        <Text tone="secondary">
                          1. Change seats — MetricCard total must update.
                        </Text>
                        <Text tone="secondary">
                          2. Save a title edit, then Reload — cold path health.
                        </Text>
                        <Text tone="secondary">
                          3. Without Reload, auto-refresh is a known C4 gap.
                        </Text>
                      </Stack>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </Stack>
          </div>
        </div>
      </div>
    </Frame>
  );
}
