import {
  Badge,
  Button,
  Checkbox,
  Frame,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "pier/canvas";
import { type ReactNode, useMemo, useState } from "react";
import {
  edgesFromNodes,
  layeredLayout,
  type PlanDocument,
  type PlanNode,
  type PlanNodeStatus,
  readPlanDocument,
  withNodeDeps,
  withNodeStatus,
} from "../lib/plan-model.ts";
import planJson from "./plan.json" with { type: "json" };

/**
 * One plan · one canvas.
 * Tabs: 需求 → 依赖图 → 任务（默认打开需求）。
 * Data: plan.json · helpers: ../lib/plan-model.ts
 *
 * Open: `.pier/plans/canvas-capabilities-v1/plan.canvas.tsx`
 */
export const canvas = {
  description:
    "Plan hub: requirements, dependency graph, and standard todo list.",
  kind: "composition" as const,
  title: "Canvas capabilities v1",
};

const NODE_W = 200;
const NODE_H = 72;

const STATUS_BADGE: Record<
  PlanNodeStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  todo: "neutral",
  in_progress: "info",
  blocked: "warning",
  done: "success",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<PlanNodeStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  blocked: "阻塞",
  done: "完成",
  cancelled: "取消",
};

const ALL_STATUSES: PlanNodeStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

function loadInitialPlan(): {
  plan: PlanDocument | null;
  error: string | null;
} {
  try {
    return { error: null, plan: readPlanDocument(planJson) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      plan: null,
    };
  }
}

export default function PlanCanvas() {
  const initial = useMemo(() => loadInitialPlan(), []);
  const [plan, setPlan] = useState<PlanDocument | null>(initial.plan);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  if (initial.error || !plan) {
    return (
      <Frame maxWidth={720}>
        <Stack gap={8}>
          <Text as="h1">Plan</Text>
          <Text tone="secondary">无法读取 plan.json：{initial.error}</Text>
        </Stack>
      </Frame>
    );
  }

  const selected = plan.nodes.find((n) => n.id === selectedId) ?? null;
  const openCount = plan.nodes.filter(
    (n) => n.status !== "done" && n.status !== "cancelled"
  ).length;

  const setStatus = (nodeId: string, status: PlanNodeStatus) => {
    setPlan((current) =>
      current ? withNodeStatus(current, nodeId, status) : current
    );
    setDirty(true);
    setEditError(null);
  };

  const toggleDone = (node: PlanNode, checked: boolean) => {
    setStatus(node.id, checked ? "done" : "todo");
  };

  const toggleDep = (nodeId: string, depId: string, on: boolean) => {
    setPlan((current) => {
      if (!current) {
        return current;
      }
      const node = current.nodes.find((n) => n.id === nodeId);
      if (!node) {
        return current;
      }
      const nextDeps = on
        ? node.deps.includes(depId)
          ? node.deps
          : [...node.deps, depId]
        : node.deps.filter((d) => d !== depId);
      try {
        const next = withNodeDeps(current, nodeId, nextDeps);
        setDirty(true);
        setEditError(null);
        return next;
      } catch (err) {
        setEditError(
          err instanceof Error
            ? err.message
            : "无法更新依赖（可能成环或节点无效）"
        );
        return current;
      }
    });
  };

  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={6}>
          <div
            style={{
              alignItems: "flex-start",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <Stack gap={6}>
              <Text as="h1">{plan.title}</Text>
              {plan.description ? (
                <Text style={{ maxWidth: 640 }} tone="secondary">
                  {plan.description}
                </Text>
              ) : null}
            </Stack>
            {dirty ? (
              <Badge variant="warning">会话内已改 · 尚未写回 plan.json</Badge>
            ) : (
              <Badge variant="neutral">与 plan.json 同步</Badge>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Badge size="xs" variant="info">
              nodes · {plan.nodes.length}
            </Badge>
            <Badge size="xs" variant="neutral">
              open · {openCount}
            </Badge>
          </div>
        </Stack>

        <Tabs defaultValue="requirements">
          <TabsList>
            <TabsTrigger value="requirements">需求</TabsTrigger>
            <TabsTrigger value="dag">依赖图</TabsTrigger>
            <TabsTrigger value="tasks">任务</TabsTrigger>
          </TabsList>

          <TabsContent value="requirements">
            <RequirementsPanel plan={plan} />
          </TabsContent>

          <TabsContent value="dag">
            <DagPanel
              editError={editError}
              nodes={plan.nodes}
              onSelect={setSelectedId}
              onStatusChange={setStatus}
              onToggleDep={toggleDep}
              selected={selected}
              selectedId={selectedId}
            />
          </TabsContent>

          <TabsContent value="tasks">
            <TodoPanel
              nodes={plan.nodes}
              onSelect={setSelectedId}
              onToggleDone={toggleDone}
            />
          </TabsContent>
        </Tabs>

        {dirty ? (
          <Text style={{ fontSize: 12 }} tone="secondary">
            当前编辑仅保存在预览会话中。持久化写回 plan.json 见节点
            w1-write；在此之前可用 Git 对照或手动改 JSON。
          </Text>
        ) : null}
      </Stack>
    </Frame>
  );
}

function RequirementsPanel(props: { plan: PlanDocument }) {
  const brief = props.plan.brief;
  return (
    <Stack gap={18}>
      <Section title="问题">
        <Paragraph>
          {brief?.problem ?? "（在 plan.json 的 brief.problem 中补充）"}
        </Paragraph>
      </Section>

      <Section title="产品设计">
        {(brief?.product ?? "").split("\n\n").map((block) => (
          <Paragraph key={block.slice(0, 24)}>{block}</Paragraph>
        ))}
      </Section>

      <Section title="技术设计">
        {(brief?.tech ?? "").split("\n\n").map((block) => (
          <Paragraph key={block.slice(0, 24)}>{block}</Paragraph>
        ))}
      </Section>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
        }}
      >
        <BulletCard items={brief?.goals ?? []} title="目标" tone="good" />
        <BulletCard items={brief?.nonGoals ?? []} title="非目标" tone="muted" />
        <BulletCard items={brief?.success ?? []} title="成功标准" tone="info" />
      </div>

      <Section title="交付切片（对应任务节点）">
        <Stack gap={6}>
          {props.plan.nodes.map((node) => (
            <Text key={node.id} style={{ fontSize: 13 }} tone="secondary">
              · <span style={{ fontWeight: 600 }}>{node.id}</span> —{" "}
              {node.title} （{STATUS_LABEL[node.status]}）
            </Text>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

function TodoPanel(props: {
  nodes: readonly PlanNode[];
  onSelect: (id: string) => void;
  onToggleDone: (node: PlanNode, checked: boolean) => void;
}) {
  const remaining = props.nodes.filter(
    (n) => n.status !== "done" && n.status !== "cancelled"
  ).length;

  return (
    <Stack gap={12}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 13 }} tone="secondary">
          {remaining} 项未完成 · 共 {props.nodes.length} 项
        </Text>
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {props.nodes.map((node, index) => {
          const done = node.status === "done" || node.status === "cancelled";
          return (
            <div
              key={node.id}
              style={{
                alignItems: "flex-start",
                borderTop: index === 0 ? undefined : "1px solid var(--border)",
                display: "flex",
                gap: 12,
                padding: "12px 14px",
              }}
            >
              <div style={{ paddingTop: 2 }}>
                <Checkbox
                  aria-label={`完成 ${node.title}`}
                  checked={done}
                  onCheckedChange={(value) => {
                    props.onToggleDone(node, value === true);
                  }}
                />
              </div>
              <button
                onClick={() => {
                  props.onSelect(node.id);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  flex: 1,
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 0,
                  padding: 0,
                  textAlign: "left",
                }}
                type="button"
              >
                <Text
                  style={{
                    fontWeight: 600,
                    textDecoration: done ? "line-through" : undefined,
                    opacity: done ? 0.65 : 1,
                  }}
                >
                  {node.title}
                </Text>
                <Text style={{ fontSize: 12 }} tone="secondary">
                  {node.id}
                  {node.deps.length > 0
                    ? ` · 依赖 ${node.deps.join(", ")}`
                    : ""}
                  {node.status !== "todo" && node.status !== "done"
                    ? ` · ${STATUS_LABEL[node.status]}`
                    : ""}
                </Text>
                {node.notes ? (
                  <Text style={{ fontSize: 12 }} tone="secondary">
                    {node.notes}
                  </Text>
                ) : null}
              </button>
              <Badge size="xs" variant={STATUS_BADGE[node.status]}>
                {STATUS_LABEL[node.status]}
              </Badge>
            </div>
          );
        })}
      </div>
    </Stack>
  );
}

function DagPanel(props: {
  editError: string | null;
  nodes: readonly PlanNode[];
  selected: PlanNode | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatusChange: (id: string, status: PlanNodeStatus) => void;
  onToggleDep: (nodeId: string, depId: string, on: boolean) => void;
}) {
  const layout = layeredLayout(props.nodes, {
    gapX: 28,
    gapY: 48,
    nodeHeight: NODE_H,
    nodeWidth: NODE_W,
    paddingX: 20,
    paddingY: 20,
  });
  const byId = new Map(layout.nodes.map((item) => [item.id, item]));
  const edges = edgesFromNodes(props.nodes);

  return (
    <Stack gap={12}>
      <Text style={{ fontSize: 12 }} tone="secondary">
        点击节点选中后可改状态与前置依赖。D0
        自绘；拖拽连线与缩放待通用节点图库（D1）。
      </Text>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "auto",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            height: layout.height,
            position: "relative",
            width: layout.width,
          }}
        >
          <svg
            aria-hidden="true"
            height={layout.height}
            style={{
              left: 0,
              overflow: "visible",
              pointerEvents: "none",
              position: "absolute",
              top: 0,
            }}
            width={layout.width}
          >
            {edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!(from && to)) {
                return null;
              }
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y;
              const midY = (y1 + y2) / 2;
              const active =
                props.selectedId === edge.from || props.selectedId === edge.to;
              return (
                <path
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  key={`${edge.from}->${edge.to}`}
                  stroke={
                    active
                      ? "var(--action-accent, var(--primary))"
                      : "var(--border)"
                  }
                  strokeWidth={active ? 2 : 1.5}
                />
              );
            })}
          </svg>

          {layout.nodes.map((item) => {
            const selected = props.selectedId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  props.onSelect(selected ? null : item.id);
                }}
                style={{
                  background: "var(--background)",
                  border: selected
                    ? "2px solid var(--action-accent, var(--primary))"
                    : "1px solid var(--border)",
                  borderRadius: 10,
                  boxSizing: "border-box",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  height: NODE_H,
                  justifyContent: "center",
                  left: item.x,
                  padding: "8px 10px",
                  position: "absolute",
                  textAlign: "left",
                  top: item.y,
                  width: NODE_W,
                }}
                type="button"
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: 6,
                    justifyContent: "space-between",
                    minWidth: 0,
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      color: "var(--foreground)",
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.node.title}
                  </span>
                  <Badge size="xs" variant={STATUS_BADGE[item.node.status]}>
                    {STATUS_LABEL[item.node.status]}
                  </Badge>
                </div>
                <span
                  style={{
                    color: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                >
                  {item.node.deps.length > 0
                    ? `依赖 ${item.node.deps.join(", ")}`
                    : "无前置"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {props.selected ? (
        <NodeEditor
          allNodes={props.nodes}
          editError={props.editError}
          node={props.selected}
          onClose={() => {
            props.onSelect(null);
          }}
          onStatusChange={props.onStatusChange}
          onToggleDep={props.onToggleDep}
        />
      ) : (
        <Text style={{ fontSize: 12 }} tone="secondary">
          选中一个节点以编辑状态与依赖。
        </Text>
      )}
    </Stack>
  );
}

function NodeEditor(props: {
  allNodes: readonly PlanNode[];
  editError: string | null;
  node: PlanNode;
  onClose: () => void;
  onStatusChange: (id: string, status: PlanNodeStatus) => void;
  onToggleDep: (nodeId: string, depId: string, on: boolean) => void;
}) {
  const candidates = props.allNodes.filter((n) => n.id !== props.node.id);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Stack gap={2}>
          <Text style={{ fontWeight: 600 }}>{props.node.title}</Text>
          <Text style={{ fontSize: 12 }} tone="secondary">
            {props.node.id}
          </Text>
        </Stack>
        <Button onClick={props.onClose} size="xs" type="button" variant="ghost">
          关闭
        </Button>
      </div>

      <Stack gap={6}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>状态</Text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ALL_STATUSES.map((status) => (
            <Button
              key={status}
              onClick={() => {
                props.onStatusChange(props.node.id, status);
              }}
              size="xs"
              type="button"
              variant={props.node.status === status ? "default" : "outline"}
            >
              {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
      </Stack>

      <Stack gap={6}>
        <Text style={{ fontSize: 12, fontWeight: 600 }}>前置依赖</Text>
        {candidates.length === 0 ? (
          <Text style={{ fontSize: 12 }} tone="secondary">
            无可选依赖
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((candidate) => {
              const checked = props.node.deps.includes(candidate.id);
              return (
                <label
                  key={candidate.id}
                  style={{
                    alignItems: "center",
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      props.onToggleDep(
                        props.node.id,
                        candidate.id,
                        value === true
                      );
                    }}
                  />
                  <Text style={{ fontSize: 13 }}>
                    {candidate.title}{" "}
                    <span style={{ color: "var(--muted-foreground)" }}>
                      ({candidate.id})
                    </span>
                  </Text>
                </label>
              );
            })}
          </div>
        )}
        {props.editError ? (
          <Text style={{ fontSize: 12 }} tone="secondary">
            <span
              style={{ color: "var(--status-danger-fg, var(--destructive))" }}
            >
              {props.editError}
            </span>
          </Text>
        ) : null}
      </Stack>

      {props.node.acceptance && props.node.acceptance.length > 0 ? (
        <Stack gap={4}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>验收</Text>
          <ul
            style={{
              color: "var(--muted-foreground)",
              fontSize: 12,
              margin: 0,
              paddingLeft: 18,
            }}
          >
            {props.node.acceptance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Stack>
      ) : null}
    </div>
  );
}

function Section(props: { children: ReactNode; title: string }) {
  return (
    <Stack gap={8}>
      <Text as="h2">{props.title}</Text>
      {props.children}
    </Stack>
  );
}

function Paragraph(props: { children: string }) {
  if (!props.children.trim()) {
    return null;
  }
  return (
    <Text style={{ fontSize: 14, lineHeight: 1.65 }} tone="secondary">
      {props.children}
    </Text>
  );
}

function BulletCard(props: {
  items: string[];
  title: string;
  tone: "good" | "muted" | "info";
}) {
  const border =
    props.tone === "good"
      ? "var(--status-success-border, var(--border))"
      : props.tone === "info"
        ? "var(--status-info-border, var(--border))"
        : "var(--border)";
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
      }}
    >
      <Text style={{ fontWeight: 600 }}>{props.title}</Text>
      {props.items.length === 0 ? (
        <Text style={{ fontSize: 12 }} tone="secondary">
          （未填写）
        </Text>
      ) : (
        <ul
          style={{
            color: "var(--muted-foreground)",
            fontSize: 13,
            lineHeight: 1.5,
            margin: 0,
            paddingLeft: 18,
          }}
        >
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
