import {
  Badge,
  Button,
  FlowGraph,
  Layer,
  layoutFlowGraph,
  Row,
  Stack,
  Text,
  WorldStage,
  useCanvasFile,
} from "pier/canvas";
import { host, useHostSnapshot } from "pier/host";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FALLBACK_EDGES,
  FALLBACK_NODES,
  fetchLoopbackGraph,
  isTerminalRunStatus,
  LOOPBACK_MISS_LIMIT,
  LOOPBACK_POLL_MS,
  parseGraph,
  parsePositions,
  type Positions,
  textFromRunOutput,
} from "./graph.ts";

export const canvas = {
  description:
    "Read-only DAG viewer: FlowGraph, loopback poll, sibling watch, run.output.",
  kind: "composition" as const,
  title: "DAG viewer",
};

/**
 * Gold for recipe=orchestration. Loopback poll (http://127.0.0.1:8787/graph, stops after misses) then
 * graph.json. Refresh is instance.json `refresh` → run.output. Positions
 * stay in state/positions.json. Status ownership stays outside.
 */
export default function DagViewer() {
  const file = useCanvasFile();
  const runsChanged = useHostSnapshot("pier://tasks:runs-changed");
  const [nodes, setNodes] = useState(FALLBACK_NODES);
  const [edges, setEdges] = useState(FALLBACK_EDGES);
  const [positions, setPositions] = useState<Positions>({});
  const [revision, setRevision] = useState<string | null>(null);
  const revisionRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const loadPositions = useCallback(async () => {
    if (!file.available) {
      return;
    }
    const placed = await file.read("state/positions.json");
    setPositions(parsePositions(placed.contents));
    revisionRef.current = placed.revision;
    setRevision(placed.revision);
  }, [file]);

  const applyGraphFile = useCallback(async () => {
    if (!file.available) {
      return;
    }
    const graph = await file.read("graph.json");
    const parsed = parseGraph(graph.contents);
    if (parsed) {
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
    }
  }, [file]);

  const loadGraph = useCallback(async () => {
    const live = await fetchLoopbackGraph();
    if (live) {
      setNodes(live.nodes);
      setEdges(live.edges);
      return;
    }
    await applyGraphFile();
  }, [applyGraphFile]);

  useEffect(() => {
    let cancelled = false;
    let misses = 0;
    let intervalId: number | undefined;
    const tick = async () => {
      const live = await fetchLoopbackGraph();
      if (cancelled) {
        return;
      }
      if (live) {
        misses = 0;
        setNodes(live.nodes);
        setEdges(live.edges);
        return;
      }
      misses += 1;
      if (misses === 1) {
        await applyGraphFile();
      }
      if (misses >= LOOPBACK_MISS_LIMIT && intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    void tick();
    intervalId = window.setInterval(() => {
      void tick();
    }, LOOPBACK_POLL_MS);
    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [applyGraphFile, pollEpoch]);

  useEffect(() => {
    if (!file.available) {
      return;
    }
    void loadPositions();
    const stopGraph = file.watch("graph.json", () => {
      void loadGraph();
    });
    const stopPositions = file.watch("state/positions.json", () => {
      void loadPositions();
    });
    return () => {
      stopGraph();
      stopPositions();
    };
  }, [file, loadGraph, loadPositions]);

  useEffect(() => {
    if (!runId) {
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const raw = await host.invoke({ runId, type: "run.output" });
        if (cancelled) {
          return;
        }
        const text = textFromRunOutput(raw);
        setLog(text.length > 0 ? text : null);
        const parsed = parseGraph(text);
        if (parsed) {
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
        }
      } catch {
        // Host stub / run not ready yet — Refresh already started the run.
      }
      try {
        const status = await host.invoke({ runId, type: "run.status" });
        if (cancelled) {
          return;
        }
        if (isTerminalRunStatus(status)) {
          setBusy(false);
          setRunId(null);
          await loadGraph();
        }
      } catch {
        setBusy(false);
      }
    };
    void pull();
    return () => {
      cancelled = true;
    };
  }, [loadGraph, runId, runsChanged.data]);

  async function persistPositions(next: Positions) {
    setPositions(next);
    if (!file.available) {
      return;
    }
    const sentRevision = revisionRef.current;
    const outcome = await file.write(
      "state/positions.json",
      `${JSON.stringify({ positions: next, schemaVersion: 1 }, null, 2)}\n`,
      sentRevision
    );
    if (outcome.kind === "written") {
      revisionRef.current = outcome.revision;
      setRevision(outcome.revision);
      setNotice(null);
      return;
    }
    if (outcome.kind === "conflict") {
      await loadPositions();
      setNotice("Positions changed elsewhere. Reloaded the saved layout.");
      return;
    }
    setNotice(outcome.message);
  }

  async function refresh() {
    setBusy(true);
    setNotice(null);
    setLog(null);
    setPollEpoch((value) => value + 1);
    const outcome = await file.invokeCommand("refresh");
    if (outcome.kind === "cancelled") {
      setBusy(false);
      return;
    }
    if (outcome.kind === "failed") {
      setBusy(false);
      setNotice(outcome.message);
      return;
    }
    setRunId(outcome.runId);
  }

  function relayout() {
    const laid = layoutFlowGraph({ edges, nodes });
    void persistPositions(laid.positions);
  }

  return (
    <WorldStage padding={32}>
      <Layer x={32} y={32}>
        <Stack gap={16}>
          <Row align="center" gap={12}>
            <Text as="h3">Pipeline</Text>
            <Badge variant="outline">Live</Badge>
            <Button
              disabled={!file.available || busy}
              onClick={() => {
                void refresh();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Refresh
            </Button>
            <Button
              onClick={relayout}
              size="sm"
              type="button"
              variant="outline"
            >
              Relayout
            </Button>
            {notice ? (
              <Text className="text-xs text-destructive">
                {notice}
              </Text>
            ) : null}
            {log ? (
              <Text className="max-w-md truncate font-mono text-xs" tone="secondary">
                Output: {log}
              </Text>
            ) : null}
          </Row>
          <Row align="start" gap={24}>
            <FlowGraph
              aria-label="Example pipeline"
              edges={edges}
              nodes={nodes}
              onNodePositionsChange={(next) => {
                void persistPositions(next);
              }}
              onSelectNode={setSelectedId}
              presentation="plain"
              positions={positions}
              renderOverlay={({ positions: laid }) => {
                const gate = laid.review;
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
              selectedId={selectedId ?? undefined}
            />
            {selected ? (
              <div className="w-60 rounded-xl border border-border bg-card p-4 shadow-sm">
                <Stack gap={8}>
                  <Row align="center" justify="between">
                    <Text as="h3">{selected.label}</Text>
                    {selected.status ? (
                      <Badge
                        variant={
                          selected.status === "success"
                            ? "success"
                            : selected.status === "running"
                              ? "info"
                              : selected.status === "failed"
                                ? "danger"
                                : "outline"
                        }
                      >
                        {selected.status}
                      </Badge>
                    ) : null}
                  </Row>
                  {selected.badge ? (
                    <Text className="text-xs" tone="secondary">
                      Role: {selected.badge}
                    </Text>
                  ) : null}
                  {selected.meta ? (
                    <Text className="text-xs" tone="secondary">
                      Meta: {selected.meta}
                    </Text>
                  ) : null}
                </Stack>
              </div>
            ) : null}
          </Row>
        </Stack>
      </Layer>
    </WorldStage>
  );
}
