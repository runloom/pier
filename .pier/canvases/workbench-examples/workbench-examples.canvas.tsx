import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataChart,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Frame,
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
  Progress,
  Separator,
  Skeleton,
  Stack,
  Text,
} from "pier/canvas";
import { useActivityOverview } from "pier/canvas";
import { useCostOverview } from "pier/canvas";
import { useSystemResources } from "pier/canvas";

/**
 * 工作台常用组件示例 —— 旧工作台四类卡片的画布组装范式。
 * 视觉语言：仪表台。发丝线分区、大号 tabular 数字、微型标签、
 * 语义 token 着色；数据全部来自 pier/canvas 三个 hook。
 * 组件边界遵循 shadcn 规范：列表项用 Item、空态用 Empty、
 * 卡片用完整 CardHeader/CardContent 组合。
 */
export const canvas = {
  description: "活动总览、系统资源、成本概览与自定义区块的组装示例。",
  kind: "composition" as const,
  title: "工作台组件示例",
};

const MICROUSD_PER_USD = 1_000_000;

function fmtUsd(microusd: number | null | undefined): string {
  if (microusd === null || microusd === undefined) {
    return "—";
  }
  const usd = microusd / MICROUSD_PER_USD;
  return usd >= 100
    ? `$${Math.round(usd).toLocaleString()}`
    : `$${usd.toFixed(2)}`;
}

function fmtTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) {
    return "—";
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return "—";
  }
  const gib = bytes / 2 ** 30;
  if (gib >= 1) {
    return `${gib.toFixed(1)} GiB`;
  }
  return `${(bytes / 2 ** 20).toFixed(0)} MiB`;
}

function fmtClock(ts: number): string {
  const date = new Date(ts);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** 微型段落标签：仪表台的统一行头。 */
function MicroLabel({ children }: { children: string }) {
  return (
    <Text className="text-xs font-medium tracking-wide" tone="secondary">
      {children}
    </Text>
  );
}

function EmptyHint({ note }: { note: string }) {
  return (
    <Empty className="border p-4">
      <EmptyTitle className="text-sm">{note}</EmptyTitle>
      <EmptyDescription className="text-xs">
        数据到达后会自动出现。
      </EmptyDescription>
    </Empty>
  );
}

function StatSegment({
  accent = false,
  hint,
  label,
  value,
}: {
  accent?: boolean;
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 px-5 py-4">
      <MicroLabel>{label}</MicroLabel>
      <Text
        className={`tabular-nums text-3xl font-semibold leading-none ${accent ? "text-destructive" : ""}`}
      >
        {value}
      </Text>
      <Text className="text-xs" tone="secondary">
        {hint}
      </Text>
    </div>
  );
}

function MeterRow({
  label,
  max = 100,
  value,
  valueText,
}: {
  label: string;
  max?: number;
  value: number;
  valueText: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <MicroLabel>{label}</MicroLabel>
        <Text className="tabular-nums text-sm">{valueText}</Text>
      </div>
      <Progress className="h-1.5" max={max} value={value} />
    </div>
  );
}

function TrendChart({ points }: { points: { cpu: number; time: string }[] }) {
  if (points.length === 0) {
    return <EmptyHint note="CPU 序列采集中" />;
  }
  return (
    <DataChart
      aria-label="CPU 趋势"
      categoryKey="time"
      data={points}
      height={96}
      series={[{ key: "cpu", label: "CPU %" }]}
      showLegend={false}
      type="line"
    />
  );
}

/** 顶部状态带：四段发丝线分区，整页的视觉锚点。 */
function HeroStrip() {
  const overview = useActivityOverview();
  const resources = useSystemResources();
  const cost = useCostOverview();
  const cpu = resources.snapshot?.summary.totalRelatedCpuPercent ?? null;
  const today = cost.snapshot?.overall.summary.todayEstimatedCostMicrousd;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap divide-x divide-border">
        <StatSegment
          accent={overview.counts.needsYou > 0}
          hint="等待或出错的会话"
          label="需要你处理"
          value={String(overview.counts.needsYou)}
        />
        <StatSegment
          hint="智能体与活跃任务"
          label="运行中"
          value={String(overview.counts.running)}
        />
        <StatSegment
          hint={`进行中 ${overview.counts.inProgress} 项`}
          label="相关 CPU"
          value={cpu === null ? "—" : `${cpu.toFixed(1)}%`}
        />
        <StatSegment
          hint="跨插件聚合估算"
          label="今日成本"
          value={fmtUsd(today)}
        />
      </div>
    </Card>
  );
}

function ActivityCard() {
  const overview = useActivityOverview();
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">活动总览</CardTitle>
        <CardDescription>本窗智能体与任务，实时推送。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {overview.rows.length === 0 ? (
          <EmptyHint note="当前没有活跃会话" />
        ) : (
          overview.rows.slice(0, 6).map((row) => {
            const attention =
              row.kind === "agent" &&
              (row.status === "waiting" || row.status === "error");
            return (
              <Item key={row.panelId} size="sm" variant="outline">
                <ItemMedia>
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${attention ? "bg-destructive" : "bg-primary"}`}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="truncate">{row.panelId}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Badge variant="outline">{row.kind}</Badge>
                  <Text className="tabular-nums text-xs" tone="secondary">
                    {fmtClock(row.updatedAt)}
                  </Text>
                </ItemActions>
              </Item>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function ResourcesCard() {
  const resources = useSystemResources();
  const snapshot = resources.snapshot;
  const summary = snapshot?.summary;
  const cpu = summary?.totalRelatedCpuPercent ?? null;
  const workloadMem = summary?.totalRelatedMemoryBytes ?? null;
  const hostMem = summary?.hostMemoryTotalBytes ?? null;
  const memPercent =
    workloadMem !== null && hostMem !== null && hostMem > 0
      ? Math.min(100, (workloadMem / hostMem) * 100)
      : 0;
  const trend = resources.cpuHistory.map((point) => ({
    cpu: Number(point.value.toFixed(1)),
    time: fmtClock(point.ts),
  }));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">系统资源</CardTitle>
        <CardDescription>
          相关进程合计；轮询共享宿主单例，挂载期自动启停。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resources.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <MeterRow
              label="相关 CPU"
              value={cpu ?? 0}
              valueText={cpu === null ? "—" : `${cpu.toFixed(1)}%`}
            />
            <MeterRow
              label="工作负载内存"
              value={memPercent}
              valueText={`${fmtBytes(workloadMem)}${hostMem ? ` / ${fmtBytes(hostMem)}` : ""}`}
            />
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>终端 {summary?.terminalCount ?? 0}</span>
              <span>热会话 {summary?.hotCount ?? 0}</span>
              <span className="ml-auto tabular-nums">
                采样 {resources.cpuHistory.length} 点
              </span>
            </div>
            <Separator />
            <TrendChart points={trend} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CostCard() {
  const overview = useCostOverview();
  const summary = overview.snapshot?.overall.summary ?? null;
  const models = [...(summary?.byModel ?? [])].sort(
    (a, b) => (b.estimatedCostMicrousd ?? 0) - (a.estimatedCostMicrousd ?? 0)
  );
  const topCost = models[0]?.estimatedCostMicrousd ?? 0;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">成本概览</CardTitle>
          <Button
            onClick={() => {
              void overview.refresh();
            }}
            variant="ghost"
          >
            刷新
          </Button>
        </div>
        <CardDescription>
          跨插件聚合；刷新走 store 方法，不经命令。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-3">
          <Text className="tabular-nums text-3xl font-semibold leading-none">
            {fmtUsd(summary?.todayEstimatedCostMicrousd)}
          </Text>
          <Text className="text-xs" tone="secondary">
            今日 · 周期 token {fmtTokens(summary?.periodTokens)}
          </Text>
        </div>
        {overview.status === "loading" ? (
          <Skeleton className="h-16 w-full" />
        ) : models.length === 0 ? (
          <EmptyHint note="暂无用量来源" />
        ) : (
          <div className="flex flex-col gap-3">
            {models.slice(0, 4).map((model) => (
              <div className="flex flex-col gap-1" key={model.modelId}>
                <div className="flex items-baseline justify-between gap-3">
                  <Text className="min-w-0 truncate text-sm">
                    {model.modelId}
                  </Text>
                  <Text className="tabular-nums text-xs" tone="secondary">
                    {fmtTokens(model.totalTokens)} tok ·{" "}
                    {fmtUsd(model.estimatedCostMicrousd)}
                  </Text>
                </div>
                <Progress
                  className="h-1"
                  max={topCost > 0 ? topCost : 1}
                  value={model.estimatedCostMicrousd ?? 0}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 自定义卡范式：kpi / gauge / trend / ranking 四种区块皆由原语 + hook 拼装。 */
function BlocksCard() {
  const overview = useActivityOverview();
  const resources = useSystemResources();
  const cpu = resources.snapshot?.summary.totalRelatedCpuPercent ?? null;
  const byKind = Object.entries(
    overview.rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.kind] = (acc[row.kind] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);
  const kindTotal = overview.rows.length;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">自定义区块范式</CardTitle>
        <CardDescription>
          kpi · gauge · trend · ranking——同一数据源，四种区块。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border py-3">
          {(
            [
              ["运行中", overview.counts.running],
              ["需要你处理", overview.counts.needsYou],
              ["进行中", overview.counts.inProgress],
            ] as const
          ).map(([label, count]) => (
            <div className="flex flex-col items-center gap-1 px-2" key={label}>
              <Text className="tabular-nums text-xl font-semibold">
                {count}
              </Text>
              <Text className="text-xs" tone="secondary">
                {label}
              </Text>
            </div>
          ))}
        </div>
        <MeterRow
          label="CPU 占比（gauge）"
          value={cpu ?? 0}
          valueText={cpu === null ? "—" : `${cpu.toFixed(1)}%`}
        />
        <div className="flex flex-col gap-1.5">
          <MicroLabel>CPU 序列（trend）</MicroLabel>
          <TrendChart
            points={resources.cpuHistory.map((point) => ({
              cpu: Number(point.value.toFixed(1)),
              time: fmtClock(point.ts),
            }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <MicroLabel>活动类型分布（ranking）</MicroLabel>
          {byKind.length === 0 ? (
            <Text className="text-xs" tone="secondary">
              暂无数据
            </Text>
          ) : (
            byKind.map(([kind, count]) => (
              <div className="flex flex-col gap-1" key={kind}>
                <div className="flex items-baseline justify-between">
                  <Text className="text-sm">{kind}</Text>
                  <Text className="tabular-nums text-xs" tone="secondary">
                    {count}
                  </Text>
                </div>
                <Progress className="h-1" max={kindTotal} value={count} />
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkbenchExamples() {
  return (
    <Frame maxWidth={1080}>
      <Stack gap={16}>
        <Stack gap={6}>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            工作台组件示例
          </Text>
          <Text className="max-w-3xl text-sm leading-relaxed" tone="secondary">
            旧工作台四类卡片的画布组装范式：数据来自 `pier/canvas` 的三个
            hook，排版与格式化由画布自行组合。复制到项目 `.pier/canvases/`
            后可自由改造。
          </Text>
        </Stack>
        <HeroStrip />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ActivityCard />
          <ResourcesCard />
          <CostCard />
          <BlocksCard />
        </div>
      </Stack>
    </Frame>
  );
}
