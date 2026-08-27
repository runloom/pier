import {
  DataChart,
  FlowGraph,
  Mermaid,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "pier/canvas";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

const CHART_ROWS = [
  { day: "一", value: 12 },
  { day: "二", value: 28 },
  { day: "三", value: 18 },
  { day: "四", value: 32 },
];

function Chart({
  label,
  type,
}: {
  label: string;
  type: "area" | "bar" | "donut" | "line";
}) {
  return (
    <DataChart
      aria-label={label}
      categoryKey="day"
      data={CHART_ROWS}
      height={140}
      series={[{ key: "value", label: "数值" }]}
      showLegend={false}
      type={type}
    />
  );
}

export function VizPage() {
  return (
    <KitSection hint="表、图、流程图。时序和类图走 Mermaid 的 source。" title="图示">
      <KitGrid>
        <MaterialCard
          install='import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "pier/canvas"'
          lead="行列对照"
          name="Table"
        >
          <Table>
            <TableCaption className="sr-only">示例表</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Table</TableCell>
                <TableCell>对照</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>DataChart</TableCell>
                <TableCell>趋势</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </MaterialCard>
        <MaterialCard
          install='import { DataChart } from "pier/canvas"'
          lead="数值趋势与对比：面积、柱状、环形、折线"
          name="DataChart"
        >
          <Tabs className="w-full" defaultValue="bar">
            <TabsList>
              <TabsTrigger value="bar">柱状</TabsTrigger>
              <TabsTrigger value="line">折线</TabsTrigger>
              <TabsTrigger value="area">面积</TabsTrigger>
              <TabsTrigger value="donut">环形</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-3" value="bar">
              <Chart label="柱状图示例" type="bar" />
            </TabsContent>
            <TabsContent className="mt-3" value="line">
              <Chart label="折线图示例" type="line" />
            </TabsContent>
            <TabsContent className="mt-3" value="area">
              <Chart label="面积图示例" type="area" />
            </TabsContent>
            <TabsContent className="mt-3" value="donut">
              <Chart label="环形图示例" type="donut" />
            </TabsContent>
          </Tabs>
        </MaterialCard>
        <MaterialCard
          install='import { Mermaid } from "pier/canvas"'
          lead="节点流程图，以及原生 mermaid 时序、状态、类图"
          name="Mermaid"
        >
          <Tabs className="w-full" defaultValue="flow">
            <TabsList>
              <TabsTrigger value="flow">流程</TabsTrigger>
              <TabsTrigger value="sequence">时序</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-3" value="flow">
              <Mermaid
                aria-label="示例流程"
                edges={[{ source: "start", target: "done" }]}
                expandable={false}
                nodes={[
                  { id: "start", kind: "actor", title: "开始" },
                  { id: "done", kind: "artifact", title: "完成" },
                ]}
              />
            </TabsContent>
            <TabsContent className="mt-3" value="sequence">
              <Mermaid
                aria-label="示例时序"
                expandable={false}
                source={[
                  "sequenceDiagram",
                  "  User->>Canvas: open",
                  "  Canvas-->>User: preview",
                ].join("\n")}
              />
            </TabsContent>
          </Tabs>
        </MaterialCard>
        <MaterialCard
          install='import { FlowGraph } from "pier/canvas"'
          lead="带状态着色的活图。节点可带次要说明，边会跟跑。"
          name="FlowGraph"
        >
          <FlowGraph
            aria-label="示例图"
            edges={[{ label: "ok", source: "compile", target: "publish" }]}
            expandable={false}
            nodes={[
              {
                badge: "build",
                id: "compile",
                label: "编译",
                meta: "worker-1",
                status: "running",
              },
              { id: "publish", label: "发布", status: "ready" },
            ]}
          />
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
