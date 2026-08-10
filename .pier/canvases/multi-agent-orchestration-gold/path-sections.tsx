import {
  Alert,
  AlertDescription,
  AlertTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MermaidDiagram,
  Stack,
  Text,
} from "pier/canvas";
import { buildDeliveryDiagram } from "./note-presentation.ts";
import type { SchemeData } from "./model.ts";
import {
  BulletList,
  CodeBlock,
  DataTable,
  DayStepCards,
  ExpandableNoteList,
  ReferenceAccordion,
  SectionLead,
  SectionTitle,
  StatusBadge,
  SubTitle,
} from "./shared.tsx";

type DesignData = SchemeData["data"];

export function PathPage({ d }: { d: DesignData }) {
  return (
    <Stack className="min-w-0" gap={20}>
      <Stack gap={6}>
        <SectionTitle>日路径：四步最短调用</SectionTitle>
        <SectionLead>
          协调智能体先自述身份，再一次性 invoke；需要多轮时 start 持久子运行，并用 turn +
          当前画面继续。完整可恢复配方见下方查阅区。
        </SectionLead>
        <Text className="font-mono text-sm font-semibold">{d.cli.namespace}</Text>
        <Text className="text-sm leading-relaxed text-muted-foreground">{d.cli.decision}</Text>
      </Stack>

      <DayStepCards steps={d.day1Commands} />

      <Stack gap={8}>
        <SectionTitle>五条智能体协作闭环（摘要）</SectionTitle>
        <ItemGroup className="grid gap-2">
          {d.journeys.map((row) => (
            <Item className="min-w-0" key={row.id} size="xs" variant="muted">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                  {row.name}
                </ItemTitle>
                <ItemDescription className="leading-relaxed">
                  触发：{row.trigger}
                </ItemDescription>
                <Text tone="tertiary" className="mt-1 text-xs leading-relaxed">
                  调用方看到：{row.userSees}
                </Text>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </Stack>

      <ReferenceAccordion
        items={[
          {
            value: "journeys-table",
            title: "协作路径全表与界面状态",
            content: (
              <Stack gap={10}>
                <DataTable
                  caption="智能体协作路径"
                  headers={["路径", "触发", "Pier 行为", "调用方看到", "失败出口"]}
                  rows={d.journeys.map((row) => [
                    `${row.id} · ${row.name}`,
                    row.trigger,
                    row.system,
                    row.userSees,
                    row.failure,
                  ])}
                />
                <Stack gap={4}>
                  <SubTitle>协作界面状态必须完整</SubTitle>
                  <BulletList items={d.runtimeUi.states} />
                </Stack>
              </Stack>
            ),
          },
          {
            value: "day1-recipe",
            title: "完整日路径配方（可保存为脚本）",
            content: <CodeBlock>{d.day1Recipe}</CodeBlock>,
          },
          {
            value: "cli-tree",
            title: "完整 CLI 命令树与操作闭环",
            content: (
              <Stack gap={12}>
                <DataTable
                  caption="完整 CLI 命令树"
                  headers={["资源", "命令", "职责", "安全语义"]}
                  rows={d.cli.commandGroups.map((row) => [
                    row.group,
                    <span className="font-mono text-xs" key={row.group}>
                      {row.commands}
                    </span>,
                    row.responsibility,
                    row.safety,
                  ])}
                  monoFirst
                />
                <DataTable
                  caption="CLI 运行操作闭环"
                  headers={["阶段", "命令", "提交点", "失败恢复"]}
                  rows={d.cli.lifecycle.map((row) => [
                    row.stage,
                    row.commands,
                    row.commit,
                    row.recovery,
                  ])}
                  monoFirst
                />
              </Stack>
            ),
          },
          {
            value: "cli-rules",
            title: "规则、主体、传输、错误与信封",
            content: (
              <Stack gap={12}>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Stack className="min-w-0" gap={6}>
                    <SubTitle>公共调用规则</SubTitle>
                    <ExpandableNoteList items={d.cli.commonRules} />
                  </Stack>
                  <Stack className="min-w-0" gap={6}>
                    <SubTitle>传输与等待</SubTitle>
                    <DataTable
                      caption="CLI 传输规则"
                      headers={["部分", "规则"]}
                      rows={d.cli.transport.map((row) => [row.part, row.rule])}
                    />
                  </Stack>
                </div>
                <DataTable
                  caption="CLI 调用主体"
                  headers={["主体", "范围", "允许", "禁止"]}
                  rows={d.cli.principals.map((row) => [
                    row.principal,
                    row.scope,
                    row.allowed,
                    row.forbidden,
                  ])}
                  monoFirst
                />
                <DataTable
                  caption="CLI 错误族"
                  headers={["错误族", "代码", "退出码", "恢复动作"]}
                  rows={d.cli.errors.map((row) => [
                    row.family,
                    row.codes,
                    row.exit,
                    row.next,
                  ])}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Stack className="min-w-0" gap={4}>
                    <SubTitle>单次 JSON</SubTitle>
                    <CodeBlock>{d.cli.jsonEnvelope}</CodeBlock>
                  </Stack>
                  <Stack className="min-w-0" gap={4}>
                    <SubTitle>JSONL 事件流</SubTitle>
                    <CodeBlock>{d.cli.streamEnvelope}</CodeBlock>
                  </Stack>
                </div>
              </Stack>
            ),
          },
        ]}
      />

      <SectionLead>
        持久协作台静态原型已放在「速览」；本页专注命令顺序与查阅契约。
      </SectionLead>
    </Stack>
  );
}

export function LandingPage({ d }: { d: DesignData }) {
  const verified = d.acceptance.filter((row) => row.status === "verified").length;
  const planned = d.acceptance.filter((row) => row.status === "planned").length;
  const blocked = d.acceptance.filter(
    (row) => row.status === "blocked" || row.status === "待实现",
  ).length;
  const deliveryDiagram = buildDeliveryDiagram(d.phases);

  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <SectionTitle>落地摘要</SectionTitle>
        <SectionLead>
          默认从人工监督切到智能体协作；按波次交付调用身份到完整协作面，并用证据矩阵收口。下图是
          <span className="font-medium text-foreground">实施交付依赖</span>
          ，不是多智能体任务 DAG。
        </SectionLead>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={`验收已核对 ${verified}`} tone="success" />
          <StatusBadge label={`待实现 ${planned}`} tone="warning" />
          {blocked > 0 ? <StatusBadge label={`阻塞 ${blocked}`} tone="warning" /> : null}
          <StatusBadge label={`共 ${d.phases.length} 个交付波次`} tone="outline" />
        </div>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>交付波次依赖</SectionTitle>
        <MermaidDiagram
          aria-label="从调用边界到外部发布的交付波次依赖"
          previewTitle="实施交付路径 W0–W6"
          source={deliveryDiagram}
        />
        <SectionLead>
          W1 身份就绪后，一次性 invoke（W2）与持久运行（W3）可并行推进，再汇入定位与协作面。
        </SectionLead>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>各波次结果</SectionTitle>
        <ol className="grid max-w-full min-w-0 gap-3">
          {d.phases.map((phase) => (
            <li
              className="min-w-0 rounded-lg border border-border/70 bg-muted/10 px-3 py-3"
              key={phase.wave}
            >
              <Stack gap={4}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <Text className="text-sm font-semibold tracking-tight">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      W{phase.wave}
                    </span>
                    {phase.name}
                  </Text>
                  <StatusBadge label="planned" />
                </div>
                <Text className="text-sm leading-relaxed text-muted-foreground">
                  {phase.outcome}
                </Text>
                <Text tone="tertiary" className="text-xs leading-relaxed break-words">
                  {phase.slices.length} 个切片
                  {phase.slices[0]
                    ? ` · 起手：${phase.slices[0].id} ${phase.slices[0].title}`
                    : ""}
                </Text>
              </Stack>
            </li>
          ))}
        </ol>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>验收状态一览</SectionTitle>
        <ItemGroup className="grid gap-2">
          {d.acceptance.map((row) => (
            <Item className="min-w-0" key={row.id} size="xs" variant="muted">
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                  {row.text}
                </ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0 self-start">
                <StatusBadge label={row.status} />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Stack>

      <ReferenceAccordion
        items={[
          {
            value: "phase-slices",
            title: "各波次切片明细",
            content: (
              <ItemGroup className="grid max-w-full min-w-0 gap-3 overflow-hidden">
                {d.phases.map((phase) => (
                  <Item
                    className="max-w-full min-w-0"
                    key={phase.wave}
                    size="sm"
                    variant="outline"
                  >
                    <ItemContent className="min-w-0">
                      <ItemTitle>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          W{phase.wave}
                        </span>
                        {phase.name}
                      </ItemTitle>
                      <ItemDescription className="leading-relaxed">
                        {phase.outcome}
                      </ItemDescription>
                      <ul className="mt-2 grid gap-1.5">
                        {phase.slices.map((slice) => (
                          <li
                            className="flex min-w-0 gap-2 text-xs leading-relaxed"
                            key={slice.id}
                          >
                            <span className="shrink-0 font-mono text-muted-foreground">
                              {slice.id}
                            </span>
                            <span className="min-w-0 break-words">{slice.title}</span>
                          </li>
                        ))}
                      </ul>
                    </ItemContent>
                    <ItemActions className="shrink-0 self-start">
                      <StatusBadge label="planned" />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            ),
          },
          {
            value: "acceptance-matrix",
            title: "需求到证据的完整验收矩阵",
            content: (
              <DataTable
                caption="需求证据矩阵"
                headers={["ID", "要求", "必须提供的证据", "当前状态"]}
                rows={d.acceptance.map((row) => [
                  row.id,
                  row.text,
                  row.evidence,
                  <StatusBadge key={row.id} label={row.status} />,
                ])}
                monoFirst
              />
            ),
          },
          {
            value: "defaults",
            title: "默认值迁移表",
            content: (
              <DataTable
                caption="默认值迁移"
                headers={["表面", "当前/旧方案", "目标方案"]}
                rows={d.defaults.map((row) => [row.surface, row.before, row.after])}
              />
            ),
          },
          {
            value: "anti-patterns",
            title: "明确禁止的实现捷径",
            content: <ExpandableNoteList items={d.antiPatterns} />,
          },
        ]}
      />
    </Stack>
  );
}
