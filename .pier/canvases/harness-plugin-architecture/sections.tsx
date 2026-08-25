import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Mermaid,
  Row,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import type { ComparisonData, SystemCard } from "./model.ts";

const SHRINK_HINT = "图表已缩小，点击查看全屏";

function H2({ children }: { children: string }) {
  return (
    <Text as="h2" className="text-base font-medium tracking-tight">
      {children}
    </Text>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <Row align="start" gap={8}>
      <Text className="mt-px shrink-0 text-sm leading-relaxed" tone="tertiary">
        ·
      </Text>
      <Text className="text-sm leading-relaxed">{children}</Text>
    </Row>
  );
}

function MonoList({ items }: { items: readonly string[] }) {
  return (
    <Stack gap={4}>
      {items.map((item) => (
        <Text
          className="font-mono text-xs leading-relaxed"
          key={item}
          tone="tertiary"
        >
          {item}
        </Text>
      ))}
    </Stack>
  );
}

export function OverviewPage({ d }: { d: ComparisonData }) {
  return (
    <Stack gap={14}>
      <Card className="border-status-info/30 bg-status-info/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">结论（BLUF）</CardTitle>
          <CardDescription>先读这一段：四家的取舍与共同底线。</CardDescription>
        </CardHeader>
        <CardContent>
          <Text className="text-sm leading-relaxed">{d.bluf}</Text>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="destructive">问题</Badge>
            <CardTitle className="mt-2 text-base">内核稳定 vs 生态扩展</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              表达力、供应链、进程边界、内核耦合四重张力；每家都在同一组约束下做取舍。
            </Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="info">设计</Badge>
            <CardTitle className="mt-2 text-base">四条机制链 + 12 维对比</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              每家一张架构图，统一维度表逐项并排；论断全部落到源码路径。
            </Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="success">落地</Badge>
            <CardTitle className="mt-2 text-base">对 Pier 的启示</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              四条可执行启示：克制插件面、打印即所装、信任门、诚实标注边界。
            </Text>
          </CardContent>
        </Card>
      </div>

      <Stack gap={6}>
        <H2>共同骨架：插件生命周期主环</H2>
        <Text className="text-sm leading-relaxed" tone="secondary">
          四家共享同一条链，差异在每个环节的「填法」——细节见「设计」页各系统卡片。
        </Text>
        <Mermaid
          aria-label="插件生命周期主环：声明到校验到装载到授权到运行到回收，变更可从回收重新进入校验"
          direction="top-to-bottom"
          edges={d.design.loopDiagram.edges}
          nodes={d.design.loopDiagram.nodes}
          shrinkHint={SHRINK_HINT}
        />
      </Stack>
    </Stack>
  );
}

export function ProblemPage({ d }: { d: ComparisonData }) {
  return (
    <Stack gap={14}>
      <Stack gap={6}>
        <H2>背景与动机</H2>
        <Text className="text-sm leading-relaxed">{d.context}</Text>
      </Stack>

      <Stack gap={6}>
        <H2>插件机制的四重张力</H2>
        <Stack gap={8}>
          {d.pains.map((pain, index) => (
            <Row align="start" gap={10} key={pain}>
              <Text
                className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs"
                tone="tertiary"
              >
                {index + 1}
              </Text>
              <Text className="text-sm leading-relaxed">{pain}</Text>
            </Row>
          ))}
        </Stack>
      </Stack>

      <Stack gap={6}>
        <H2>本画布不做的事</H2>
        <Stack gap={4}>
          {d.nonGoals.map((goal) => (
            <Bullet key={goal}>{goal}</Bullet>
          ))}
        </Stack>
      </Stack>

      <Stack gap={6}>
        <H2>被放弃的对比框架</H2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>候选框架</TableHead>
              <TableHead>弃用原因</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.alternatives.map((alt) => (
              <TableRow key={alt.name}>
                <TableCell className="text-sm">{alt.name}</TableCell>
                <TableCell className="text-sm">
                  <Text tone="secondary">{alt.rejectReason}</Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Stack>
  );
}

function SystemArchitectureCard({ system }: { system: SystemCard }) {
  const facts: Array<[string, string]> = [
    ["扩展单元", system.unit],
    ["宿主形态", system.domain],
    ["发现与分发", system.distribution],
    ["装载与生命周期", system.loading],
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <Row align="center" gap={8} wrap>
          <CardTitle className="text-base">{system.name}</CardTitle>
          <Badge variant="outline">{system.id}</Badge>
        </Row>
        <CardDescription>{system.tagline}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={10}>
          <Mermaid
            aria-label={`${system.name} 插件机制架构图`}
            direction="top-to-bottom"
            edges={system.diagram.edges}
            nodes={system.diagram.nodes}
            shrinkHint={SHRINK_HINT}
          />
          <Stack gap={4}>
            {facts.map(([label, value]) => (
              <Row align="start" gap={8} key={label}>
                <Text
                  className="w-24 shrink-0 text-xs leading-relaxed"
                  tone="secondary"
                >
                  {label}
                </Text>
                <Text className="flex-1 text-xs leading-relaxed">{value}</Text>
              </Row>
            ))}
          </Stack>
          <Stack gap={4}>
            <Text className="text-xs font-medium" tone="secondary">
              授予扩展的 API 面
            </Text>
            {system.api.map((line) => (
              <Bullet key={line}>{line}</Bullet>
            ))}
          </Stack>
          <Stack gap={4}>
            <Text className="text-xs font-medium" tone="secondary">
              信任与隔离
            </Text>
            {system.trust.map((line) => (
              <Bullet key={line}>{line}</Bullet>
            ))}
          </Stack>
          <Stack gap={4}>
            <Text className="text-xs font-medium" tone="secondary">
              源码证据
            </Text>
            <MonoList items={system.evidence} />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

const DIMENSION_COLUMN_LABELS = [
  ["pier", "Pier"],
  ["pi", "pi"],
  ["deepseek", "dsh"],
  ["herdr", "herdr"],
] as const;

export function DesignPage({ d }: { d: ComparisonData }) {
  return (
    <Stack gap={14}>
      <Stack gap={6}>
        <H2>四系统架构</H2>
        <Text className="text-sm leading-relaxed" tone="secondary">
          Pier 为当前实现（重点展开）；其余三家按同一结构拆解。节点着色只表达角色：
          绿=工具/机械步骤，紫=运行时代码，蓝=产物/登记面，黄虚线=产品外或风险点。
        </Text>
      </Stack>
      <Stack gap={12}>
        {d.design.systems.map((system) => (
          <SystemArchitectureCard key={system.id} system={system} />
        ))}
      </Stack>

      <Stack gap={6}>
        <H2>统一维度对比表</H2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>维度</TableHead>
                {DIMENSION_COLUMN_LABELS.map(([id, label]) => (
                  <TableHead key={id}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.design.dimensions.map((row) => (
                <TableRow key={row.dimension}>
                  <TableCell className="whitespace-nowrap text-xs font-medium">
                    {row.dimension}
                  </TableCell>
                  <TableCell className="text-xs">{row.pier}</TableCell>
                  <TableCell className="text-xs">{row.pi}</TableCell>
                  <TableCell className="text-xs">{row.deepseek}</TableCell>
                  <TableCell className="text-xs">{row.herdr}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Stack>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">共同收敛</CardTitle>
            <CardDescription>四家不约而同的选择。</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={6}>
              {d.design.convergence.map((line) => (
                <Bullet key={line}>{line}</Bullet>
              ))}
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">关键分歧</CardTitle>
            <CardDescription>真正拉开架构差距的四个坐标。</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={6}>
              {d.design.divergence.map((line) => (
                <Bullet key={line}>{line}</Bullet>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </div>
    </Stack>
  );
}

export function LandingPage({ d }: { d: ComparisonData }) {
  return (
    <Stack gap={14}>
      <Stack gap={6}>
        <H2>对 Pier 的启示</H2>
        <Stack gap={8}>
          {d.landing.takeaways.map((takeaway, index) => (
            <Row align="start" gap={10} key={takeaway}>
              <Text
                className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs"
                tone="tertiary"
              >
                {index + 1}
              </Text>
              <Text className="text-sm leading-relaxed">{takeaway}</Text>
            </Row>
          ))}
        </Stack>
      </Stack>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">证据边界与风险</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={6}>
              {d.risks.map((risk) => (
                <Bullet key={risk}>{risk}</Bullet>
              ))}
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">开放问题</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={6}>
              {d.openQuestions.map((question) => (
                <Bullet key={question}>{question}</Bullet>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </div>

      <Stack gap={4}>
        <H2>证据基线</H2>
        <MonoList items={[d.source, d.meta.baseline, `生成时间 ${d.generatedAt}`]} />
      </Stack>
    </Stack>
  );
}
