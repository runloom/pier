import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  MermaidDiagram,
  Row,
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
import { useEffect, useState } from "react";

/**
 * closed-loop × primary_nav_5 × pier-default
 * 五段静态产品方案：速览 → 问题 → 设计 → 日路径 → 落地
 * （methodology Expression selection：默认无 Play/Step）
 */
export const canvas = {
  description:
    "多智能体 harness 金标准：闭环日路径产品设计方案。静态图与表，无强制演示。",
  kind: "composition" as const,
  title: "多智能体编排 · 金标准方案",
};

type Pain = { id: string; title: string; detail: string };
type Constraint = { id: string; text: string };
type State = { id: string; means: string; not: string };
type Cmd = { cmd: string; why: string; userSees: string };
type Loop = {
  id: string;
  name: string;
  steps: string;
  closed: string;
  exitStates: string;
};
type DefaultRow = { surface: string; before: string; after: string };
type Phase = {
  wave: number;
  name: string;
  outcome: string;
  slices: { id: string; title: string }[];
};
type Item = { id: string; text: string };
type Competitor = { name: string; take: string };

type GoldData = {
  schemaVersion: number;
  data: {
    title: string;
    subtitle: string;
    insight: string;
    decision: string;
    bluf: string;
    goals: string[];
    problem: {
      title: string;
      thesis: string;
      pains: Pain[];
      antiGoals: string[];
    };
    hardConstraints: Constraint[];
    layers: { title: string; diagram: string; notes: string[] };
    settled: { title: string; rule: string; states: State[] };
    identity: { title: string; rule: string; why: string };
    closedLoops: Loop[];
    dayPath: { title: string; diagram: string; summary: string };
    day1Commands: Cmd[];
    day1Recipe: string;
    mustNotTeach: string[];
    concepts: string[];
    safetyRails: string[];
    defaults: DefaultRow[];
    phases: Phase[];
    acceptance: Item[];
    competitors: Competitor[];
  };
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseGold(raw: string): GoldData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("data.json 不是合法 JSON");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.data)) {
    throw new Error("需要 schemaVersion:1 与 data 对象");
  }
  const d = parsed.data;
  for (const key of [
    "title",
    "insight",
    "decision",
    "problem",
    "hardConstraints",
    "day1Commands",
    "acceptance",
    "safetyRails",
  ]) {
    if (!(key in d)) {
      throw new Error(`data 缺少字段：${key}`);
    }
  }
  const cmds = d.day1Commands;
  if (!Array.isArray(cmds) || cmds.length === 0 || cmds.length > 4) {
    throw new Error("day1Commands 须为 1–4 条");
  }
  return parsed as GoldData;
}

function H2({ children }: { children: string }) {
  return (
    <Text as="h2" className="text-base font-medium tracking-tight">
      {children}
    </Text>
  );
}

function Callout({
  title,
  children,
}: {
  title: string;
  children: string;
}) {
  return (
    <Card className="border-status-info/30 bg-status-info/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Text className="text-sm leading-relaxed">{children}</Text>
      </CardContent>
    </Card>
  );
}

function SimpleTable({
  headers,
  rows,
  monoFirst = true,
}: {
  headers: string[];
  rows: string[][];
  monoFirst?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`${index}:${row[0] ?? ""}`}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  className={
                    monoFirst && cellIndex === 0
                      ? "font-mono text-xs"
                      : cellIndex > 0 && headers[cellIndex] === "不是"
                        ? "text-sm text-muted-foreground"
                        : "text-sm"
                  }
                  key={`${index}-${cellIndex}`}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function MultiAgentOrchestrationGoldCanvas() {
  const fileApi = useCanvasFile();
  const [tab, setTab] = useState("overview");
  const [payload, setPayload] = useState<GoldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const available = fileApi.available;
  const readSibling = fileApi.read;

  useEffect(() => {
    let cancelled = false;
    if (!available) {
      setLoading(false);
      setError(
        "无相邻文件作用域。请在 Pier 预览中打开本 Canvas（与 data.json 同目录）。"
      );
      return;
    }
    setLoading(true);
    void readSibling("data.json")
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPayload(parseGold(result.contents));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setError(
          `${detail}\n\n下一步：确认 data.json 含 insight / decision / problem / day1Commands。`
        );
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
  }, [available, readSibling]);

  if (loading) {
    return (
      <Frame maxWidth={960}>
        <Text tone="secondary" className="text-sm">
          加载中…
        </Text>
      </Frame>
    );
  }

  if (error || !payload) {
    return (
      <Frame maxWidth={960}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">无法加载方案</CardTitle>
            <CardDescription className="whitespace-pre-wrap">
              {error ?? "data.json 无效"}
            </CardDescription>
          </CardHeader>
        </Card>
      </Frame>
    );
  }

  const d = payload.data;

  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">closed-loop</Badge>
            <Badge variant="outline">primary_nav_5</Badge>
            <Badge variant="outline">静态方案</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            {d.title}
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            {d.subtitle}
          </Text>
        </Stack>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="overview">速览</TabsTrigger>
            <TabsTrigger value="problem">问题</TabsTrigger>
            <TabsTrigger value="design">设计</TabsTrigger>
            <TabsTrigger value="path">日路径</TabsTrigger>
            <TabsTrigger value="landing">落地</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="overview">
            <Stack gap={14}>
              <Callout title="洞察">{d.insight}</Callout>
              <Callout title="决策（BLUF）">{d.decision}</Callout>

              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="destructive">问题</Badge>
                    <CardTitle className="mt-2 text-base">断环</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      {d.problem.thesis}
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="info">设计</Badge>
                    <CardTitle className="mt-2 text-base">
                      分层 · 四态 · pin
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      语义层与 terminal 分离；默认等 settled；handle 防误命中。
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="success">形态</Badge>
                    <CardTitle className="mt-2 text-base">四命令</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      catalog → start → turn* → list；配方见「日路径」。
                    </Text>
                  </CardContent>
                </Card>
              </div>

              <Stack gap={4}>
                <H2>目标</H2>
                {d.goals.map((g, i) => (
                  <Text
                    className="text-sm leading-relaxed"
                    key={`${i}:${g.slice(0, 16)}`}
                  >
                    · {g}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="problem">
            <Stack gap={14}>
              <H2>{d.problem.title}</H2>
              <Callout title="总述">{d.problem.thesis}</Callout>
              <div className="grid gap-3 md:grid-cols-3">
                {d.problem.pains.map((p) => (
                  <Card key={p.id}>
                    <CardHeader className="pb-2">
                      <Badge variant="outline">{p.id}</Badge>
                      <CardTitle className="mt-2 text-base">{p.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Text className="text-sm leading-relaxed">{p.detail}</Text>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Stack gap={4}>
                <H2>明确不做</H2>
                {d.problem.antiGoals.map((t, i) => (
                  <Text
                    className="text-sm leading-relaxed"
                    key={`${i}:${t.slice(0, 16)}`}
                  >
                    · {t}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="design">
            <Stack gap={16}>
              <Stack gap={8}>
                <H2>{d.layers.title}</H2>
                <MermaidDiagram
                  aria-label="语义层与终端层"
                  source={d.layers.diagram}
                />
                {d.layers.notes.map((n, i) => (
                  <Text
                    className="text-sm leading-relaxed"
                    key={`${i}:${n.slice(0, 20)}`}
                  >
                    · {n}
                  </Text>
                ))}
              </Stack>

              <Stack gap={8}>
                <H2>{d.settled.title}</H2>
                <Callout title="规则">{d.settled.rule}</Callout>
                <SimpleTable
                  headers={["态", "表示", "不是"]}
                  rows={d.settled.states.map((s) => [
                    s.id,
                    s.means,
                    s.not,
                  ])}
                />
              </Stack>

              <Stack gap={6}>
                <H2>{d.identity.title}</H2>
                <Text className="text-sm leading-relaxed">{d.identity.rule}</Text>
                <Text tone="secondary" className="text-sm leading-relaxed">
                  {d.identity.why}
                </Text>
              </Stack>

              <Stack gap={6}>
                <H2>硬约束</H2>
                <SimpleTable
                  headers={["ID", "决策"]}
                  rows={d.hardConstraints.map((c) => [c.id, c.text])}
                />
              </Stack>

              <Stack gap={4}>
                <H2>安全护栏</H2>
                {d.safetyRails.map((t, i) => (
                  <Text
                    className="text-sm leading-relaxed"
                    key={`${i}:${t.slice(0, 12)}`}
                  >
                    · {t}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="path">
            <Stack gap={14}>
              <H2>{d.dayPath.title}</H2>
              <Text tone="secondary" className="text-sm leading-relaxed">
                {d.dayPath.summary}
              </Text>
              <MermaidDiagram
                aria-label="日路径主环"
                source={d.dayPath.diagram}
              />

              <Stack gap={6}>
                <H2>四命令（≤4）</H2>
                <SimpleTable
                  headers={["命令", "用途", "用户看到"]}
                  rows={d.day1Commands.map((c) => [
                    c.cmd,
                    c.why,
                    c.userSees,
                  ])}
                />
              </Stack>

              <Stack gap={4}>
                <H2>首日三概念</H2>
                <Row gap={8} wrap>
                  {d.concepts.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </Row>
              </Stack>

              <Stack gap={4}>
                <H2>配方</H2>
                <pre
                  aria-label="配方"
                  className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                >
                  {d.day1Recipe}
                </pre>
              </Stack>

              <Stack gap={6}>
                <H2>闭环环路（摘要）</H2>
                <SimpleTable
                  headers={["环", "名称", "闭环完成当", "出口"]}
                  rows={d.closedLoops.map((l) => [
                    l.id,
                    l.name,
                    l.closed,
                    l.exitStates,
                  ])}
                />
              </Stack>

              <Stack gap={4}>
                <H2>首日不要教</H2>
                {d.mustNotTeach.map((t, i) => (
                  <Text
                    className="text-sm leading-relaxed"
                    key={`${i}:${t.slice(0, 16)}`}
                  >
                    · {t}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="landing">
            <Stack gap={14}>
              <H2>落地</H2>
              <Text tone="secondary" className="text-sm leading-relaxed">
                实现对照：默认怎么改、分几期、怎样算过。验收不进速览。
              </Text>

              <Stack gap={6}>
                <H2>默认对照</H2>
                <SimpleTable
                  headers={["面", "现在", "目标"]}
                  monoFirst={false}
                  rows={d.defaults.map((r) => [
                    r.surface,
                    r.before,
                    r.after,
                  ])}
                />
              </Stack>

              <Stack gap={6}>
                <H2>三期交付</H2>
                {d.phases.map((phase) => (
                  <Card key={phase.wave}>
                    <CardHeader className="pb-2">
                      <Row gap={8} wrap>
                        <Badge variant="info">波次 {phase.wave}</Badge>
                        <CardTitle className="text-base">{phase.name}</CardTitle>
                      </Row>
                      <CardDescription>{phase.outcome}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Stack gap={2}>
                        {phase.slices.map((s) => (
                          <Text className="text-sm" key={s.id}>
                            <span className="font-mono text-xs">{s.id}</span>{" "}
                            {s.title}
                          </Text>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              <Stack gap={6}>
                <H2>验收 C0–C10</H2>
                <SimpleTable
                  headers={["ID", "条件"]}
                  rows={d.acceptance.map((a) => [a.id, a.text])}
                />
              </Stack>

              <Stack gap={6}>
                <H2>业界对照</H2>
                {d.competitors.map((c) => (
                  <Card key={c.name}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{c.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Text className="text-sm leading-relaxed">{c.take}</Text>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
