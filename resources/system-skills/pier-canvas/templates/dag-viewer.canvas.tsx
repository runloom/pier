import {
  Badge,
  Button,
  FlowGraph,
  Layer,
  Row,
  Stack,
  Text,
  WorldStage,
  useCanvasFile,
} from "pier/canvas";

/**
 * Starter for recipe=orchestration: live DAG viewer.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Root WorldStage. FlowGraph uses presentation="plain". Status lives outside
 * Pier. Declare commands in instance.json; call useCanvasFile().invokeCommand(key).
 * When the result is `{ kind: "started" }`, pull stdout with
 * `host.invoke({ type: "run.output", runId })` and
 * `useHostSnapshot("pier://tasks:runs-changed")`. Persist positions in
 * state/positions.json. Relayout with layoutFlowGraph (or write `{}`).
 * Inspect with onSelectNode + a Stack beside the graph — not a host panel.
 * Closed loop: this template + references/host-data.md (loopback fetch,
 * invokeCommand, run.output).
 */
export const canvas = {
  description: "Read-only DAG viewer on a world stage.",
  kind: "composition" as const,
  title: "DAG viewer",
};

const NODES = [
  {
    badge: "lead",
    id: "plan",
    label: "Plan",
    meta: "signed off",
    status: "success" as const,
  },
  { id: "run", label: "Run", meta: "worker-2", status: "running" as const },
  {
    badge: "gate",
    id: "review",
    label: "Review",
    meta: "needs sign-off",
    status: "blocked" as const,
  },
  { id: "ship", label: "Ship", status: "ready" as const },
];

const EDGES = [
  { label: "ok", source: "plan", target: "run" },
  { source: "run", target: "review" },
  { source: "review", target: "ship" },
];

export default function DagViewerCanvas() {
  const file = useCanvasFile();

  return (
    <WorldStage padding={32}>
      <Layer x={32} y={32}>
        <Stack gap={16}>
          <Row align="center" gap={12}>
            <Text as="h3">Pipeline</Text>
            <Badge variant="outline">Live</Badge>
            <Button
              disabled={!file.available}
              onClick={() => {
                void file.invokeCommand("refresh");
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Refresh
            </Button>
          </Row>
          <FlowGraph
            aria-label="Example pipeline"
            edges={EDGES}
            nodes={NODES}
            presentation="plain"
            renderOverlay={({ positions }) => {
              const gate = positions.review;
              if (!gate) {
                return null;
              }
              return (
                <div
                  className="absolute rounded-md border border-border bg-card px-2 py-1 text-muted-foreground text-xs"
                  style={{ left: gate.x, top: Math.max(0, gate.y - 28) }}
                >
                  Gate
                </div>
              );
            }}
          />
        </Stack>
      </Layer>
    </WorldStage>
  );
}
