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
import type { CompanionData } from "./model.ts";
import { WireframeStage } from "./wireframes.tsx";

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

export function OverviewPage({ d }: { d: CompanionData }) {
  return (
    <Stack gap={14}>
      <Card className="border-status-info/30 bg-status-info/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">结论（BLUF）</CardTitle>
          <CardDescription>状态投影与受控闭环。线框不定视觉。</CardDescription>
        </CardHeader>
        <CardContent>
          <Text className="text-sm leading-relaxed">{d.bluf}</Text>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="destructive">问题</Badge>
            <CardTitle className="mt-2 text-base">信号锁在桌面</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              审批、回合结束、等待真空、确认变更都无法在移动端上完成。
            </Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="info">设计</Badge>
            <CardTitle className="mt-2 text-base">先主机、后投影</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              根面是已配对宿主。会话、变更、文件挂在当前主机下。
            </Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Badge variant="success">落地</Badge>
            <CardTitle className="mt-2 text-base">切片不等于产品</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              同网切片供内部开发。可对外的第一条线是会合加叫醒。
            </Text>
          </CardContent>
        </Card>
      </div>

      <H2>目标</H2>
      <Stack gap={4}>
        {d.goals.map((goal) => (
          <Bullet key={goal}>{goal}</Bullet>
        ))}
      </Stack>
    </Stack>
  );
}

export function ProblemPage({ d }: { d: CompanionData }) {
  return (
    <Stack gap={14}>
      <H2>背景</H2>
      <Text className="text-sm leading-relaxed">{d.context}</Text>

      <H2>痛点</H2>
      <Stack gap={4}>
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

      <H2>闭环</H2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>环节</TableHead>
            <TableHead>使用者感知</TableHead>
            <TableHead>缺了会长什么样</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.coreLoop.map((row) => (
            <TableRow key={row.step}>
              <TableCell className="align-top whitespace-nowrap text-sm">
                {row.step}
              </TableCell>
              <TableCell className="align-top text-sm leading-relaxed">
                {row.sense}
              </TableCell>
              <TableCell className="align-top text-sm leading-relaxed">
                {row.broken}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <H2>不做</H2>
      <Stack gap={4}>
        {d.nonGoals.map((item) => (
          <Bullet key={item}>{item}</Bullet>
        ))}
      </Stack>
    </Stack>
  );
}

export function DesignPage({ d }: { d: CompanionData }) {
  return (
    <Stack gap={14}>
      <H2>交互顺序</H2>
      <Mermaid
        aria-label="首次配对与之后重连"
        expandLabel="全屏查看连接时序"
        source={d.design.connectSequence}
      />

      <H2>信息架构线框</H2>
      <WireframeStage frames={d.wireframes} />

      <H2>分层</H2>
      <Stack gap={4}>
        {d.design.layers.map((layer) => (
          <Bullet key={layer}>{layer}</Bullet>
        ))}
      </Stack>

      <H2>协议主环</H2>
      <Mermaid
        aria-label="宿主事实源与三壳移动端的主环"
        direction="left-to-right"
        edges={d.design.loopDiagram.edges}
        expandLabel="全屏查看主环"
        nodes={d.design.loopDiagram.nodes}
      />

      <H2>否决的替代</H2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>选项</TableHead>
            <TableHead>为何不做</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.alternatives.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="align-top text-sm">{row.name}</TableCell>
              <TableCell className="text-sm leading-relaxed">
                {row.rejectReason}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

export function LandingPage({ d }: { d: CompanionData }) {
  return (
    <Stack gap={14}>
      <H2>里程碑</H2>
      <Text className="text-sm leading-relaxed">{d.landingLead}</Text>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>阶段</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>交付</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.milestones.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="align-top whitespace-nowrap text-sm">
                {row.id} {row.title}
              </TableCell>
              <TableCell className="align-top whitespace-nowrap text-sm">
                {row.kind}
              </TableCell>
              <TableCell className="text-sm leading-relaxed">
                {row.deliver}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <H2>验收</H2>
      <Stack gap={4}>
        {d.acceptance.map((item) => (
          <Bullet key={item}>{item}</Bullet>
        ))}
      </Stack>

      <H2>风险</H2>
      <Stack gap={4}>
        {d.risks.map((item) => (
          <Bullet key={item}>{item}</Bullet>
        ))}
      </Stack>

      <H2>仍开放</H2>
      <Stack gap={4}>
        {d.openQuestions.map((item) => (
          <Bullet key={item}>{item}</Bullet>
        ))}
      </Stack>
    </Stack>
  );
}
