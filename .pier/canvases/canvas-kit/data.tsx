import { Text } from "pier/canvas";
import {
  useActivityOverview,
  useCostOverview,
  useSystemResources,
} from "pier/canvas";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

function ActivitySample() {
  const overview = useActivityOverview();
  return (
    <Text className="text-sm" tone="secondary">
      进行中 {overview.counts.inProgress} · 运行 {overview.counts.running} · 需要你处理{" "}
      {overview.counts.needsYou}
    </Text>
  );
}

function CostSample() {
  const overview = useCostOverview();
  return (
    <Text className="text-sm" tone="secondary">
      状态 {overview.status}；refresh() 手动重扫全部用量来源
    </Text>
  );
}

function ResourcesSample() {
  const resources = useSystemResources();
  return (
    <Text className="text-sm" tone="secondary">
      状态 {resources.status}；CPU 序列 {resources.cpuHistory.length} 点
    </Text>
  );
}

export function DataPage() {
  return (
    <KitSection
      hint="宿主单例数据 hook：返回结构化数据，格式化与排版由画布自行组合。"
      title="数据"
    >
      <KitGrid>
        <MaterialCard
          install='import { useActivityOverview } from "pier/canvas"'
          lead="本窗活动总览：计数与活跃行"
          name="useActivityOverview"
        >
          <ActivitySample />
        </MaterialCard>
        <MaterialCard
          install='import { useCostOverview } from "pier/canvas"'
          lead="跨插件成本聚合，可手动刷新"
          name="useCostOverview"
        >
          <CostSample />
        </MaterialCard>
        <MaterialCard
          install='import { useSystemResources } from "pier/canvas"'
          lead="相关进程 CPU 趋势与最新快照"
          name="useSystemResources"
        >
          <ResourcesSample />
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
