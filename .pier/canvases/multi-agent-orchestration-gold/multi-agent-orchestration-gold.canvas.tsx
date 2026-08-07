// biome-ignore lint/correctness/useImportExtensions: pier/canvas is a host virtual module
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Frame,
  MermaidDiagram,
  NodeGraph,
  Row,
  Separator,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useEffect, useMemo, useState } from "react";

export const canvas = {
  description:
    "多 agent 编排金标准 v2：运行时原语 + 输出总政策 + 双 wait 语义 + Codex 收敛后的 U1–U8 可验证任务。",
  kind: "composition" as const,
  title: "多 Agent 编排 · 金标准方案",
};

type Severity = "critical" | "high" | "medium";

type Competitor = {
  id: string;
  name: string;
  positioning: string;
  layers: { name: string; detail: string }[];
  take: string;
};

type DriftItem = {
  id: string;
  severity: Severity;
  title: string;
  evidence: string;
  gold: string;
};

type CliRow = { cmd: string; cap: string; role: string };

type DagNode = {
  id: string;
  wave: number;
  title: string;
  deps: string[];
  verify: string;
};

type DagMilestone = {
  id: string;
  name: string;
  goal: string;
  verify: string;
};

type UxFinding = {
  id: string;
  severity: Severity;
  title: string;
  fix: string;
};

type UxAcceptance = {
  id: string;
  text: string;
};

type UxTask = {
  id: string;
  wave: number;
  title: string;
  ux: string;
  deps: string[];
  status: string;
  files: string;
  verify: string;
  doneWhen: string;
};

type CodexReview = {
  reviewedAt: string;
  model: string;
  verdict: string;
  summary: string;
  keep: string[];
  blockers: string[];
  majors: string[];
  uTaskVerdicts: Record<string, string>;
  top3Roi: string[];
  doNot: string[];
  appliedInScheme?: string;
};

type UxPatch = {
  version?: number;
  planPath: string;
  workspace: string;
  scope: string;
  nonGoals: string[];
  criticalPath: string;
  parallelNote: string;
  findings: UxFinding[];
  acceptance: UxAcceptance[];
  tasks: UxTask[];
  codexReview?: CodexReview;
};

type OutputPolicyRule = {
  kind: string;
  label: string;
  commands: string;
  human: string;
  json: string;
};

type WaitSemanticsRow = {
  cmd: string;
  means: string;
  not: string;
  next: string;
};

type CanvasData = {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  data: {
    thesis: { title: string; bullets: string[] };
    competitors: Competitor[];
    drift: {
      baseline: string;
      worktree: string;
      remediationStatus: Record<string, string>;
      items: DriftItem[];
    };
    cliInventory: {
      existingReuse: string[];
      p0Agents: CliRow[];
      p0Terminal: CliRow[];
      p0Not: string[];
      p1Optional: string[];
    };
    dag: {
      milestones: DagMilestone[];
      nodes: DagNode[];
      criticalPath: string;
      parallelNative: string;
    };
    redLines: string[];
    outputPolicy?: {
      title: string;
      rules: OutputPolicyRule[];
    };
    waitSemantics?: {
      title: string;
      rows: WaitSemanticsRow[];
    };
    uxPatch: UxPatch;
  };
};

const SEVERITY_BADGE: Record<
  Severity,
  "destructive" | "warning" | "secondary"
> = {
  critical: "destructive",
  high: "warning",
  medium: "secondary",
};

function isSeverity(value: string): value is Severity {
  return value === "critical" || value === "high" || value === "medium";
}

function severityLabel(s: Severity): string {
  if (s === "critical") {
    return "阻断";
  }
  if (s === "high") {
    return "高";
  }
  return "中";
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text as="h2" className="text-lg font-semibold tracking-tight">
      {children}
    </Text>
  );
}

function MetaLine({ children }: { children: string }) {
  return (
    <Text tone="tertiary" className="text-xs font-mono break-all">
      {children}
    </Text>
  );
}

function CliTable({ rows }: { rows: CliRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[280px]">命令</TableHead>
            <TableHead className="min-w-[140px]">capability</TableHead>
            <TableHead>职责</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.cmd}>
              <TableCell className="align-top font-mono text-xs whitespace-pre-wrap">
                {row.cmd}
              </TableCell>
              <TableCell className="align-top font-mono text-xs">
                {row.cap}
              </TableCell>
              <TableCell className="align-top text-sm">{row.role}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function parseCanvasData(raw: string): CanvasData {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("data" in parsed) ||
    !("schemaVersion" in parsed)
  ) {
    throw new Error("data.json 缺少 schemaVersion 或 data 字段");
  }
  return parsed as CanvasData;
}

export default function MultiAgentOrchestrationGoldCanvas() {
  const fileApi = useCanvasFile();
  const [payload, setPayload] = useState<CanvasData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("ux");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("G1");
  const [selectedUxId, setSelectedUxId] = useState<string | null>("U2");
  const [competitorId, setCompetitorId] = useState("orca");

  const fileAvailable = fileApi.available;
  const readSibling = fileApi.read;

  useEffect(() => {
    let cancelled = false;
    if (!fileAvailable) {
      setLoading(false);
      setLoadError("当前 Canvas 无相邻文件作用域，无法读取 data.json");
      return;
    }
    setLoading(true);
    void readSibling("data.json")
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPayload(parseCanvasData(result.contents));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(err instanceof Error ? err.message : String(err));
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileAvailable, readSibling]);

  const d = payload?.data;

  const selectedCompetitor = useMemo(() => {
    if (!d) {
      return undefined;
    }
    return (
      d.competitors.find((c) => c.id === competitorId) ?? d.competitors[0]
    );
  }, [competitorId, d]);

  const graph = useMemo(() => {
    if (!d) {
      return {
        nodes: [] as {
          id: string;
          title: string;
          meta: string;
          tone: "success" | "info" | "muted";
        }[],
        edges: [] as { id: string; source: string; target: string }[],
      };
    }
    const nodes = d.dag.nodes.map((n) => ({
      id: n.id,
      title: `${n.id} · ${n.title}`,
      meta: `波次 ${n.wave}`,
      tone:
        n.id === "G1" || n.id === "G2"
          ? ("success" as const)
          : n.id.startsWith("D")
            ? ("info" as const)
            : ("muted" as const),
    }));
    const edges = d.dag.nodes.flatMap((n) =>
      n.deps.map((dep) => ({
        source: dep,
        target: n.id,
        id: `${dep}->${n.id}`,
      }))
    );
    return { nodes, edges };
  }, [d]);

  const selectedNode = d?.dag.nodes.find((n) => n.id === selectedNodeId);

  const uxGraph = useMemo(() => {
    const ux = d?.uxPatch;
    if (!ux) {
      return {
        nodes: [] as {
          id: string;
          title: string;
          meta: string;
          tone: "success" | "info" | "muted" | "warning";
        }[],
        edges: [] as { id: string; source: string; target: string }[],
      };
    }
    const nodes = ux.tasks.map((t) => ({
      id: t.id,
      title: `${t.id} · ${t.title}`,
      meta: `波次 ${t.wave} · ${t.status}`,
      tone:
        t.status === "done"
          ? ("success" as const)
          : t.id === "U8"
            ? ("info" as const)
            : t.wave === 1
              ? ("muted" as const)
              : ("warning" as const),
    }));
    const edges = ux.tasks.flatMap((t) =>
      t.deps.map((dep) => ({
        source: dep,
        target: t.id,
        id: `${dep}->${t.id}`,
      }))
    );
    return { nodes, edges };
  }, [d]);

  const selectedUxTask = d?.uxPatch?.tasks.find((t) => t.id === selectedUxId);

  if (loading) {
    return (
      <Frame maxWidth={1100}>
        <Text tone="secondary">加载方案数据…</Text>
      </Frame>
    );
  }

  if (loadError || !payload || !d) {
    return (
      <Frame maxWidth={1100}>
        <Stack gap={8}>
          <Text as="h1">无法加载 data.json</Text>
          <Text tone="secondary">
            {loadError ?? "请确认相邻 data.json 存在且 JSON 合法。"}
          </Text>
        </Stack>
      </Frame>
    );
  }

  return (
    <Frame maxWidth={1100}>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">composition</Badge>
            <Badge variant="outline">CLI 优先</Badge>
            <Badge variant="warning">非内建编排器</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            多 Agent 编排 · 金标准方案
          </Text>
          <Text tone="secondary">
            当前 worktree 内金标准方案：CLI 运行时原语 + 体验补丁 U1–U8。计划文件{" "}
            <span className="font-mono text-xs">
              docs/superpowers/plans/2026-08-07-cli-multi-agent-ux-patch.md
            </span>
            ；任务板以本页「CLI 体验」为准。
          </Text>
          <MetaLine>
            {`来源：${payload.source} · 生成 ${payload.generatedAt}`}
          </MetaLine>
        </Stack>

        <Card className="border-status-info/30 bg-status-info/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{d.thesis.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={6}>
              {d.thesis.bullets.map((b) => (
                <Text key={b} className="text-sm leading-relaxed">
                  · {b}
                </Text>
              ))}
            </Stack>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="ux">CLI 体验</TabsTrigger>
            <TabsTrigger value="thesis">结论</TabsTrigger>
            <TabsTrigger value="research">业界调研</TabsTrigger>
            <TabsTrigger value="drift">漂移诊断</TabsTrigger>
            <TabsTrigger value="cli">CLI 清单</TabsTrigger>
            <TabsTrigger value="dag">运行时 DAG</TabsTrigger>
            <TabsTrigger value="flow">黄金路径</TabsTrigger>
          </TabsList>

          <TabsContent value="ux" className="mt-4">
            {d.uxPatch ? (
              <Stack gap={16}>
                <Stack gap={6}>
                  <Row gap={8} wrap>
                    <SectionTitle>范围</SectionTitle>
                    {d.uxPatch.version ? (
                      <Badge variant="info">方案 v{d.uxPatch.version}</Badge>
                    ) : null}
                    {d.uxPatch.codexReview?.appliedInScheme ? (
                      <Badge variant="success">
                        Codex → {d.uxPatch.codexReview.appliedInScheme}
                      </Badge>
                    ) : null}
                  </Row>
                  <Text className="text-sm leading-relaxed">
                    {d.uxPatch.scope}
                  </Text>
                  <MetaLine>{`工作区 ${d.uxPatch.workspace}`}</MetaLine>
                  <MetaLine>{`计划 ${d.uxPatch.planPath}`}</MetaLine>
                  <Text className="text-sm">
                    <span className="font-medium">关键路径：</span>
                    <span className="font-mono text-xs">
                      {d.uxPatch.criticalPath}
                    </span>
                  </Text>
                  <Text tone="secondary" className="text-sm">
                    {d.uxPatch.parallelNote}
                  </Text>
                </Stack>

                {d.outputPolicy ? (
                  <Stack gap={8}>
                    <SectionTitle>{d.outputPolicy.title}</SectionTitle>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>类型</TableHead>
                            <TableHead>命令</TableHead>
                            <TableHead>人类模式</TableHead>
                            <TableHead>--json</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.outputPolicy.rules.map((r) => (
                            <TableRow key={r.kind}>
                              <TableCell className="text-sm font-medium">
                                {r.label}
                              </TableCell>
                              <TableCell className="font-mono text-xs leading-relaxed">
                                {r.commands}
                              </TableCell>
                              <TableCell className="text-xs leading-relaxed">
                                {r.human}
                              </TableCell>
                              <TableCell className="text-xs leading-relaxed">
                                {r.json}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Stack>
                ) : null}

                {d.waitSemantics ? (
                  <Stack gap={8}>
                    <SectionTitle>{d.waitSemantics.title}</SectionTitle>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>命令</TableHead>
                            <TableHead>含义</TableHead>
                            <TableHead>不是</TableHead>
                            <TableHead>下一步</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.waitSemantics.rows.map((r) => (
                            <TableRow key={r.cmd}>
                              <TableCell className="font-mono text-xs whitespace-pre-wrap">
                                {r.cmd}
                              </TableCell>
                              <TableCell className="text-xs leading-relaxed">
                                {r.means}
                              </TableCell>
                              <TableCell className="text-xs leading-relaxed">
                                {r.not}
                              </TableCell>
                              <TableCell className="text-xs leading-relaxed">
                                {r.next}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Stack>
                ) : null}

                <SectionTitle>体验问题 → 修复</SectionTitle>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>严重度</TableHead>
                        <TableHead>问题</TableHead>
                        <TableHead>修复</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.uxPatch.findings.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="font-mono text-xs">
                            {f.id}
                          </TableCell>
                          <TableCell>
                            <Badge variant={SEVERITY_BADGE[f.severity]}>
                              {severityLabel(f.severity)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{f.title}</TableCell>
                          <TableCell className="text-xs leading-relaxed">
                            {f.fix}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <SectionTitle>不做</SectionTitle>
                <Stack gap={4}>
                  {d.uxPatch.nonGoals.map((line) => (
                    <Text key={line} className="text-sm">
                      · {line}
                    </Text>
                  ))}
                </Stack>

                <SectionTitle>任务 DAG（点击查看验证）</SectionTitle>
                <NodeGraph
                  aria-label="CLI 体验补丁任务 DAG"
                  collapseLabel="退出展开"
                  direction="left-to-right"
                  edges={uxGraph.edges}
                  expandLabel="展开关系图"
                  nodes={uxGraph.nodes}
                  selectedId={selectedUxId ?? undefined}
                  onSelectNode={(id) => setSelectedUxId(id)}
                />
                {selectedUxTask ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <Row gap={8} align="center" wrap>
                        <CardTitle className="text-sm">
                          {selectedUxTask.id} · {selectedUxTask.title}
                        </CardTitle>
                        <Badge variant="outline">{selectedUxTask.status}</Badge>
                        <Badge variant="secondary">{selectedUxTask.ux}</Badge>
                      </Row>
                    </CardHeader>
                    <CardContent>
                      <Stack gap={6}>
                        <Text className="text-sm">
                          波次 {selectedUxTask.wave}
                          {selectedUxTask.deps.length > 0
                            ? ` · 依赖 ${selectedUxTask.deps.join(", ")}`
                            : " · 无依赖"}
                        </Text>
                        <Text className="text-sm">
                          <span className="font-medium">触点：</span>
                          {selectedUxTask.files}
                        </Text>
                        <Text className="text-sm font-mono text-xs leading-relaxed">
                          {selectedUxTask.verify}
                        </Text>
                        <Text className="text-sm">
                          <span className="font-medium">完成判据：</span>
                          {selectedUxTask.doneWhen}
                        </Text>
                      </Stack>
                    </CardContent>
                  </Card>
                ) : null}

                <SectionTitle>任务清单</SectionTitle>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>波次</TableHead>
                        <TableHead>标题</TableHead>
                        <TableHead>UX</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>完成判据</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.uxPatch.tasks.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-xs">
                            <button
                              type="button"
                              className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                              onClick={() => setSelectedUxId(t.id)}
                            >
                              {t.id}
                            </button>
                          </TableCell>
                          <TableCell className="text-xs">{t.wave}</TableCell>
                          <TableCell className="text-sm">{t.title}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {t.ux}
                          </TableCell>
                          <TableCell className="text-xs">{t.status}</TableCell>
                          <TableCell className="text-xs leading-relaxed">
                            {t.doneWhen}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <SectionTitle>整包验收（C0–C10）</SectionTitle>
                <Stack gap={4}>
                  {d.uxPatch.acceptance.map((c) => (
                    <Text key={c.id} className="text-sm">
                      <span className="font-mono text-xs font-medium">
                        {c.id}
                      </span>{" "}
                      {c.text}
                    </Text>
                  ))}
                </Stack>

                {d.uxPatch.codexReview ? (
                  <Stack gap={12}>
                    <SectionTitle>Codex 审查（人体工程学 / 最佳实践）</SectionTitle>
                    <Row gap={8} wrap>
                      <Badge
                        variant={
                          d.uxPatch.codexReview.verdict.includes("有条件")
                            ? "warning"
                            : "success"
                        }
                      >
                        {d.uxPatch.codexReview.verdict}
                      </Badge>
                      <Badge variant="outline">
                        {d.uxPatch.codexReview.model}
                      </Badge>
                      <Badge variant="secondary">
                        {d.uxPatch.codexReview.reviewedAt}
                      </Badge>
                    </Row>
                    <Text className="text-sm leading-relaxed">
                      {d.uxPatch.codexReview.summary}
                    </Text>
                    <Text className="text-sm font-medium">应坚持</Text>
                    <Stack gap={4}>
                      {d.uxPatch.codexReview.keep.map((line) => (
                        <Text key={line} className="text-sm">
                          · {line}
                        </Text>
                      ))}
                    </Stack>
                    <Text className="text-sm font-medium">Blocker</Text>
                    <Stack gap={4}>
                      {d.uxPatch.codexReview.blockers.map((line) => (
                        <Text key={line} className="text-sm">
                          · {line}
                        </Text>
                      ))}
                    </Stack>
                    <Text className="text-sm font-medium">Major</Text>
                    <Stack gap={4}>
                      {d.uxPatch.codexReview.majors.map((line) => (
                        <Text key={line} className="text-sm">
                          · {line}
                        </Text>
                      ))}
                    </Stack>
                    <Text className="text-sm font-medium">
                      U1–U8 裁决（Codex）
                    </Text>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>任务</TableHead>
                            <TableHead>裁决</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(
                            d.uxPatch.codexReview.uTaskVerdicts
                          ).map(([id, v]) => (
                            <TableRow key={id}>
                              <TableCell className="font-mono text-xs">
                                {id}
                              </TableCell>
                              <TableCell className="text-sm">{v}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Text className="text-sm font-medium">ROI Top 3</Text>
                    <Stack gap={4}>
                      {d.uxPatch.codexReview.top3Roi.map((line, i) => (
                        <Text key={line} className="text-sm">
                          {i + 1}. {line}
                        </Text>
                      ))}
                    </Stack>
                    <Text className="text-sm font-medium">明确不要做</Text>
                    <Stack gap={4}>
                      {d.uxPatch.codexReview.doNot.map((line) => (
                        <Text key={line} className="text-sm">
                          · {line}
                        </Text>
                      ))}
                    </Stack>
                  </Stack>
                ) : null}

                <MermaidDiagram
                  aria-label="CLI 体验补丁波次"
                  source={`flowchart LR
  U1[U1 摘要框架]
  U4[U4 默认 cwd]
  U2[U2 start 摘要]
  U3[U3 wait hint]
  U5[U5 list 空态]
  U6[U6 show hint]
  U7[U7 心跳]
  U8[U8 docs 回归]
  U1 --> U2
  U1 --> U3
  U1 --> U5
  U1 --> U6
  U1 --> U7
  U2 --> U8
  U3 --> U8
  U4 --> U8
  U5 --> U8
  U6 --> U8
  U7 --> U8`}
                />
              </Stack>
            ) : (
              <Text tone="secondary">data.json 缺少 uxPatch 段。</Text>
            )}
          </TabsContent>

          <TabsContent value="thesis" className="mt-4">
            <Stack gap={14}>
              <SectionTitle>分层模型</SectionTitle>
              <MermaidDiagram
                aria-label="Pier 多智能体 CLI 分层"
                source={`flowchart TB
  EXT["外部脚本 / 协调 agent / MCP"]
  AG["pier agents\\n语义：发现 / 启动 / 状态 / 等待 / 聚焦"]
  TM["pier terminal\\n内容：screen / read / send / key / wait"]
  FA["Foreground Activity\\n状态唯一来源"]
  ARI["Agent Runtime Index"]
  TRI["TerminalRuntimeIndex\\nchildExited 权威"]
  GH["Ghostty 核心\\n有界 screen + 行事件历史"]
  EXT --> AG
  EXT --> TM
  AG --> ARI --> FA
  TM --> TRI
  TM --> GH
  TRI --> GH`}
              />
              <SectionTitle>语义红线</SectionTitle>
              <Stack gap={6}>
                {d.redLines.map((line) => (
                  <Text key={line} className="text-sm">
                    · {line}
                  </Text>
                ))}
              </Stack>
              <SectionTitle>与 Orca / Omnigent 的取舍</SectionTitle>
              <Text className="text-sm leading-relaxed">
                Orca 的{" "}
                <span className="font-mono text-xs">orchestration.*</span>{" "}
                与 Omnigent polly 的会话 inbox/spawn
                都是完整编排产品。Pier 产品定位明确不做任务生命周期与台账——因此只交付可被编排的原语，编排
                DAG 留在外部脚本或上层 agent（可用 Orca skill / polly /
                自写 bash 调度）。
              </Text>
            </Stack>
          </TabsContent>

          <TabsContent value="research" className="mt-4">
            <Stack gap={14}>
              <SectionTitle>对照选择</SectionTitle>
              <Row gap={8} wrap>
                {d.competitors.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={
                      selectedCompetitor?.id === c.id ? "default" : "outline"
                    }
                    onClick={() => setCompetitorId(c.id)}
                  >
                    {c.name}
                  </Button>
                ))}
              </Row>
              {selectedCompetitor ? (
                <Card>
                  <CardHeader className="pb-2">
                    <Row gap={8} align="center" wrap>
                      <CardTitle className="text-base">
                        {selectedCompetitor.name}
                      </CardTitle>
                      <Badge variant="secondary">
                        {selectedCompetitor.positioning}
                      </Badge>
                    </Row>
                  </CardHeader>
                  <CardContent>
                    <Stack gap={12}>
                      {selectedCompetitor.layers.map((layer) => (
                        <Stack key={layer.name} gap={4}>
                          <Text className="text-sm font-medium">
                            {layer.name}
                          </Text>
                          <Text tone="secondary" className="text-sm">
                            {layer.detail}
                          </Text>
                        </Stack>
                      ))}
                      <Separator />
                      <Text className="text-sm leading-relaxed">
                        <span className="font-medium">对 Pier 的启示：</span>
                        {selectedCompetitor.take}
                      </Text>
                    </Stack>
                  </CardContent>
                </Card>
              ) : null}

              <SectionTitle>横向摘要</SectionTitle>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>维度</TableHead>
                      <TableHead>Orca</TableHead>
                      <TableHead>cmux</TableHead>
                      <TableHead>Omnigent</TableHead>
                      <TableHead>Pier 金标准</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        [
                          "终端读/写",
                          "handle + read/send/wait",
                          "surface read-screen/send/key",
                          "native harness 终端，非通用 CLI 读屏",
                          "panelId + screen/read/send/key/wait",
                        ],
                        [
                          "智能体状态",
                          "hooks + tui-idle 启发式",
                          "hooks lifecycle 文件",
                          "会话平台 + harness 事件",
                          "FA 五态投影；禁止屏幕猜状态",
                        ],
                        [
                          "编排实体",
                          "task/mailbox/gate 内建",
                          "无（teams 启动集成）",
                          "polly YAML + inbox/spawn",
                          "无；外部组合",
                        ],
                        [
                          "协议深度",
                          "偏终端驱动",
                          "偏 hooks",
                          "native bridge 优先",
                          "P0 终端+FA；P1 capability",
                        ],
                      ] as const
                    ).map((row) => (
                      <TableRow key={row[0]}>
                        {row.map((cell) => (
                          <TableCell
                            key={cell}
                            className="align-top text-xs leading-relaxed"
                          >
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Stack>
          </TabsContent>

          <TabsContent value="drift" className="mt-4">
            <Stack gap={14}>
              <SectionTitle>当前分支状态</SectionTitle>
              <Stack gap={4}>
                <MetaLine>{`基线 ${d.drift.baseline}`}</MetaLine>
                <MetaLine>{d.drift.worktree}</MetaLine>
              </Stack>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(d.drift.remediationStatus).map(
                      ([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="font-mono text-xs">
                            {k}
                          </TableCell>
                          <TableCell className="text-sm">{v}</TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>

              <SectionTitle>漂移条目</SectionTitle>
              <Stack gap={10}>
                {d.drift.items.map((item) => {
                  const severity = isSeverity(item.severity)
                    ? item.severity
                    : "medium";
                  return (
                    <Card key={item.id}>
                      <CardHeader className="pb-2">
                        <Row gap={8} align="center" wrap>
                          <Badge variant={SEVERITY_BADGE[severity]}>
                            {severityLabel(severity)}
                          </Badge>
                          <CardTitle className="text-sm">
                            {item.id} · {item.title}
                          </CardTitle>
                        </Row>
                      </CardHeader>
                      <CardContent>
                        <Stack gap={6}>
                          <Text className="text-sm">
                            <span className="font-medium">现状证据：</span>
                            {item.evidence}
                          </Text>
                          <Text className="text-sm">
                            <span className="font-medium">金标准：</span>
                            {item.gold}
                          </Text>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>

              <Card className="border-status-warning/30">
                <CardContent className="pt-4">
                  <Text className="text-sm leading-relaxed">
                    根因不是「命令名不够多」，而是真相源错位：用 main
                    侧猜行、用 agent session 猜退出、用整屏截取冒充有界
                    screen，再叠加 panel-transfer 正确性工程，导致 task3
                    无法冻结、后续 M1–M3 全部悬空。金标准要求：先交付最小
                    TerminalRuntimeIndex + native screen，用真实证据过
                    M1，再解耦膨胀。
                  </Text>
                </CardContent>
              </Card>
            </Stack>
          </TabsContent>

          <TabsContent value="cli" className="mt-4">
            <Stack gap={16}>
              <SectionTitle>复用既有资源面</SectionTitle>
              <Stack gap={4}>
                {d.cliInventory.existingReuse.map((line) => (
                  <Text key={line} className="font-mono text-xs">
                    {line}
                  </Text>
                ))}
              </Stack>

              <SectionTitle>P0 · agents（语义面）</SectionTitle>
              <CliTable rows={d.cliInventory.p0Agents} />

              <SectionTitle>P0 · terminal（控制面）</SectionTitle>
              <CliTable rows={d.cliInventory.p0Terminal} />

              <SectionTitle>P0 明确不做</SectionTitle>
              <Stack gap={4}>
                {d.cliInventory.p0Not.map((line) => (
                  <Text key={line} className="text-sm">
                    · {line}
                  </Text>
                ))}
              </Stack>

              <SectionTitle>P1（可选，独立设计）</SectionTitle>
              <Stack gap={4}>
                {d.cliInventory.p1Optional.map((line) => (
                  <Text key={line} className="font-mono text-xs">
                    {line}
                  </Text>
                ))}
              </Stack>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">黄金组合脚本</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                    {`wt=$(pier worktrees create --path "$repo" --name api --branch feat/api --json | jq -r '.data.path')
a=$(pier agents start --agent codex --cwd "$wt" --prompt "检查 API 兼容性" --json)
panel=$(jq -r '.data.agent.panelId' <<<"$a"); ts=$(jq -r '.data.ts' <<<"$a")
pier agents wait "$panel" --until ready,error --after "$ts" --timeout-ms 900000 --json
pier terminal screen "$panel" --json`}
                  </pre>
                </CardContent>
              </Card>
            </Stack>
          </TabsContent>

          <TabsContent value="dag" className="mt-4">
            <Stack gap={16}>
              <SectionTitle>里程碑（每步可验证）</SectionTitle>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>目标</TableHead>
                      <TableHead>验证命令 / 证据</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.dag.milestones.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">
                          {m.id}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {m.name}
                        </TableCell>
                        <TableCell className="text-sm">{m.goal}</TableCell>
                        <TableCell className="text-xs leading-relaxed">
                          {m.verify}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Stack gap={4}>
                <Text className="text-sm">
                  <span className="font-medium">关键路径：</span>
                  <span className="font-mono text-xs">
                    {d.dag.criticalPath}
                  </span>
                </Text>
                <Text className="text-sm">
                  <span className="font-medium">并行 native：</span>
                  {d.dag.parallelNative}
                </Text>
              </Stack>

              <SectionTitle>节点图（点击查看验证）</SectionTitle>
              <NodeGraph
                aria-label="实施 DAG 节点"
                collapseLabel="退出展开"
                direction="left-to-right"
                edges={graph.edges}
                expandLabel="展开关系图"
                nodes={graph.nodes}
                selectedId={selectedNodeId ?? undefined}
                onSelectNode={(id) => setSelectedNodeId(id)}
              />
              {selectedNode ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {selectedNode.id} · {selectedNode.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Stack gap={6}>
                      <Text className="text-sm">
                        波次 {selectedNode.wave}
                        {selectedNode.deps.length > 0
                          ? ` · 依赖 ${selectedNode.deps.join(", ")}`
                          : " · 无依赖"}
                      </Text>
                      <Text className="text-sm">
                        <span className="font-medium">完成判据：</span>
                        {selectedNode.verify}
                      </Text>
                    </Stack>
                  </CardContent>
                </Card>
              ) : (
                <Text tone="secondary" className="text-sm">
                  点击节点查看可验证完成判据。
                </Text>
              )}

              <SectionTitle>任务清单（按波次）</SectionTitle>
              {[1, 2, 3, 4, 5, 6, 7].map((wave) => {
                const nodes = d.dag.nodes.filter((n) => n.wave === wave);
                if (nodes.length === 0) {
                  return null;
                }
                return (
                  <Stack key={wave} gap={6}>
                    <Text className="text-sm font-medium">波次 {wave}</Text>
                    <Stack gap={4}>
                      {nodes.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          onClick={() => {
                            setSelectedNodeId(n.id);
                          }}
                        >
                          <Text className="text-sm font-medium">
                            {n.id} · {n.title}
                          </Text>
                          <Text tone="secondary" className="text-xs">
                            {n.verify}
                          </Text>
                        </button>
                      ))}
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          </TabsContent>

          <TabsContent value="flow" className="mt-4">
            <Stack gap={14}>
              <SectionTitle>控制闭环（M1）</SectionTitle>
              <MermaidDiagram
                aria-label="终端控制闭环"
                source={`sequenceDiagram
  participant S as 脚本
  participant C as pier CLI
  participant M as main
  participant N as Ghostty
  S->>C: terminal list / show
  C->>M: terminal.show
  M->>N: resolve surface
  N-->>M: running + outputCursor
  M-->>S: panelId, state
  S->>C: terminal send --submit
  C->>M: 唯一输入队列 paste→Return
  S->>C: terminal wait --until quiet|exit
  M->>N: screen hash / childExited
  S->>C: terminal screen
  N-->>S: 有界纯文本`}
              />
              <SectionTitle>语义闭环（M2）</SectionTitle>
              <MermaidDiagram
                aria-label="智能体语义闭环"
                source={`sequenceDiagram
  participant S as 脚本
  participant A as pier agents
  participant T as pier terminal
  participant FA as Foreground Activity
  S->>A: start --agent --prompt
  A-->>S: panelId + ts
  S->>A: wait --until ready --after ts
  FA-->>A: 新证据 ready|error|gone
  S->>T: screen
  Note over S,T: 读回答用 terminal，不用 agents.read`}
              />
              <SectionTitle>验收铁律</SectionTitle>
              <Stack gap={6}>
                <Text className="text-sm">
                  1. 节点完成 = 完成判据命令绿，不是「类型能编译」。
                </Text>
                <Text className="text-sm">
                  2. M1 不依赖 agents；M2 不依赖 read 行历史；M3 删除
                  output-ledger overlap。
                </Text>
                <Text className="text-sm">
                  3. task3 panel-transfer 深度正确性可并行工程，但不得成为 M1
                  的门闩——最小 T1 切片先满足 CLI。
                </Text>
                <Text className="text-sm">
                  4. e2e 默认{" "}
                  <span className="font-mono text-xs">
                    pnpm test:e2e:auto
                  </span>
                  ，不在主力机默认全量 Electron。
                </Text>
              </Stack>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
