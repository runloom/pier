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
} from "pier/canvas";
import { useState } from "react";

/**
 * methodology / primary_nav_5 实心起手稿：
 * 速览 → 问题 → 设计 → 日路径 → 落地。
 *
 * - 默认静态表达（见 references/methodology.md「Expression selection」）
 * - 真实方案请绑定相邻 data.json（useCanvasFile），不要硬套 Play/Step 演示
 */
export const canvas = {
  description:
    "产品方案总览：结论优先、五段结构、静态图与表。无强制交互演示。",
  kind: "composition" as const,
  title: "方案总览",
};

function H2({ children }: { children: string }) {
  return (
    <Text as="h2" className="text-base font-medium tracking-tight">
      {children}
    </Text>
  );
}

export default function OverviewCanvasTemplate() {
  const [tab, setTab] = useState("overview");

  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">产品设计方案</Badge>
            <Badge variant="outline">primary_nav_5</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            方案标题
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            副标题：一句话说明这是什么系统的什么决策。
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

          {/* 0 · 速览 — 30 秒内：洞察 + 决策 + 三卡 */}
          <TabsContent className="mt-4" value="overview">
            <Stack gap={14}>
              <Card className="border-status-info/30 bg-status-info/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">洞察</CardTitle>
                  <CardDescription>
                    为什么必须做成这样（机制边界，不是功能清单）。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Text className="text-sm leading-relaxed">
                    在此写 insight：分层、真相源、默认封装等「不可见」的关键取舍。
                  </Text>
                </CardContent>
              </Card>

              <Card className="border-status-info/30 bg-status-info/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">决策（BLUF）</CardTitle>
                  <CardDescription>
                    做什么、不做什么、用户默认路径。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Text className="text-sm leading-relaxed">
                    在此写 decision：例如只教四条命令、默认 wait settled、禁止
                    quiet 当完成。
                  </Text>
                </CardContent>
              </Card>

              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="destructive">问题</Badge>
                    <CardTitle className="mt-2 text-base">痛点摘要</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      用户今天卡在哪（一句）。
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="info">设计</Badge>
                    <CardTitle className="mt-2 text-base">关键机制</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      分层 / 状态出口 / 身份规则各用一短语。
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="success">形态</Badge>
                    <CardTitle className="mt-2 text-base">默认路径</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      用户首日怎么走完一圈。
                    </Text>
                  </CardContent>
                </Card>
              </div>
            </Stack>
          </TabsContent>

          {/* 1 · 问题 */}
          <TabsContent className="mt-4" value="problem">
            <Stack gap={14}>
              <H2>问题</H2>
              <Text className="text-sm leading-relaxed">
                用 2–4 句描述可对号入座的失败路径。不要先列 backlog。
              </Text>
              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P1</Badge>
                    <CardTitle className="mt-2 text-base">痛点一</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      现象 + 错误归因（例如完成信号错位）。
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P2</Badge>
                    <CardTitle className="mt-2 text-base">痛点二</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      现象 + 代价（例如学习陡、胶水脚本）。
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P3</Badge>
                    <CardTitle className="mt-2 text-base">痛点三</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      现象 + 风险（例如误命中、不可见卡点）。
                    </Text>
                  </CardContent>
                </Card>
              </div>
              <Stack gap={4}>
                <H2>明确不做</H2>
                <Text className="text-sm leading-relaxed">
                  · 非目标一（产品边界）
                </Text>
                <Text className="text-sm leading-relaxed">
                  · 非目标二
                </Text>
              </Stack>
            </Stack>
          </TabsContent>

          {/* 2 · 设计 — 静态图与规则，无 Play/Step */}
          <TabsContent className="mt-4" value="design">
            <Stack gap={14}>
              <H2>设计</H2>
              <Stack gap={6}>
                <H2>分层</H2>
                <MermaidDiagram
                  aria-label="分层"
                  source={`flowchart TB
  U[用户 / 外部编排] --> A[产品语义层]
  A --> S[状态真相源]
  U -.进阶.-> T[底层 I/O]
  T -.->|禁止当完成信号| X[误用]`}
                />
                <Text className="text-sm leading-relaxed">
                  · 日路径只走语义层。
                </Text>
                <Text className="text-sm leading-relaxed">
                  · 底层 I/O 可存在，但不是完成协议。
                </Text>
              </Stack>

              <Stack gap={6}>
                <H2>状态出口</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>态</TableHead>
                        <TableHead>表示</TableHead>
                        <TableHead>不是</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          ready
                        </TableCell>
                        <TableCell className="text-sm">可继续</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          不是业务成功
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          waiting
                        </TableCell>
                        <TableCell className="text-sm">要你处理</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          不是完成
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={6}>
                <H2>硬约束</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">ID</TableHead>
                        <TableHead>决策</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">H1</TableCell>
                        <TableCell className="text-sm">
                          不可违反的边界
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">H2</TableCell>
                        <TableCell className="text-sm">
                          学习/效率目标
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>
            </Stack>
          </TabsContent>

          {/* 3 · 日路径 — 形态与配方，不是交互演示 */}
          <TabsContent className="mt-4" value="path">
            <Stack gap={14}>
              <H2>日路径</H2>
              <MermaidDiagram
                aria-label="日路径主环"
                source={`flowchart LR
  A[发现] --> B[启动]
  B --> C{可行动出口}
  C -->|继续| D[下一轮]
  D --> C
  C -->|需人| E[注意力列表]
  E --> C
  C -->|失败| F[停 + next]`}
              />
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>命令 / 动作</TableHead>
                      <TableHead>用途</TableHead>
                      <TableHead>用户看到</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        command list
                      </TableCell>
                      <TableCell className="text-sm">发现</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        可选集合
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        command start …
                      </TableCell>
                      <TableCell className="text-sm">开干</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        句柄 + 默认闭环结果
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <Stack gap={4}>
                <H2>配方</H2>
                <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {`# 人手最短路径
step1
step2

# 脚本同构（如适用）
step1 --json
step2 --json`}
                </pre>
              </Stack>
              <Stack gap={4}>
                <H2>首日不要教</H2>
                <Text className="text-sm leading-relaxed">
                  · 进阶面细节（不要塞进首页）
                </Text>
              </Stack>
            </Stack>
          </TabsContent>

          {/* 4 · 落地 — 默认对照、分期、验收（非首页） */}
          <TabsContent className="mt-4" value="landing">
            <Stack gap={14}>
              <H2>落地</H2>
              <Text tone="secondary" className="text-sm leading-relaxed">
                实现者读完应能改默认与排期。验收表放这里，不要放进速览。
              </Text>

              <Stack gap={6}>
                <H2>默认对照</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>面</TableHead>
                        <TableHead>现在</TableHead>
                        <TableHead>目标</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-sm">完成信号</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          易误用的旧信号
                        </TableCell>
                        <TableCell className="text-sm">产品定义的出口态</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm">主路径动作</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          需自拼步骤
                        </TableCell>
                        <TableCell className="text-sm">默认封装</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={6}>
                <H2>分期</H2>
                <Card>
                  <CardHeader className="pb-2">
                    <Row gap={8} wrap>
                      <Badge variant="info">波次 1</Badge>
                      <CardTitle className="text-base">契约</CardTitle>
                    </Row>
                    <CardDescription>
                      用户可感知结果（不是只有工单号）
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      · L0 —— 切片标题
                    </Text>
                  </CardContent>
                </Card>
              </Stack>

              <Stack gap={6}>
                <H2>验收</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">ID</TableHead>
                        <TableHead>条件</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">C0</TableCell>
                        <TableCell className="text-sm">
                          用户场景句式：不学进阶面能否完成主路径
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={4}>
                <H2>附录位（可选）</H2>
                <Text tone="secondary" className="text-sm leading-relaxed">
                  竞品对照、过程考古放文末；不要变成默认首页。
                </Text>
              </Stack>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
