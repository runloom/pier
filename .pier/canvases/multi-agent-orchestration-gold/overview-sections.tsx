import {
  Alert,
  AlertDescription,
  AlertTitle,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MermaidDiagram,
  Row,
  Stack,
  Text,
} from "pier/canvas";
import { AgentCollaborationPrototype } from "./collaboration-ui.tsx";
import type { SchemeData } from "./model.ts";
import {
  BulletList,
  DataTable,
  DualPathCards,
  ExpandableNoteList,
  GroupedNoteCards,
  IdConstraintList,
  MetricStrips,
  OwnershipBlocks,
  ReferenceAccordion,
  SectionLead,
  SectionTitle,
  StatusBadge,
  SubTitle,
} from "./shared.tsx";

type DesignData = SchemeData["data"];

export function OverviewPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      {/* L1 · 30 秒 */}
      <Stack gap={8}>
        <Text className="max-w-3xl text-base font-medium leading-relaxed tracking-tight">
          一次性用原生 agent；需要活体会话时经 Pier 做 start/turn/screen。调用方持有拆分与结束判断，Pier
          不拥有任务生命周期。
        </Text>
        <SectionLead>{d.meta.subtitle}</SectionLead>
      </Stack>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
        <Stack className="min-w-0" gap={8}>
          <SectionTitle>唯一主回路</SectionTitle>
          <MermaidDiagram
            aria-label="协调智能体通过 Pier 智能体 CLI 调用工作智能体并读取内容"
            previewTitle="协调智能体调用工作智能体"
            source={d.mainLoop.diagram}
          />
          <Text tone="secondary" className="text-sm leading-relaxed">
            {d.mainLoop.caption}
          </Text>
        </Stack>
        <aside className="min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <Stack gap={10}>
            <Stack gap={4}>
              <SubTitle>谁在调用</SubTitle>
              <BulletList
                items={[
                  "主调用者：协调智能体",
                  "一次性：直接原生 agent CLI",
                  "Pier：发现、持久运行、画面与运行事实",
                ]}
              />
            </Stack>
            <Stack gap={4}>
              <SubTitle>Pier 明确不做</SubTitle>
              <BulletList
                items={[
                  "封装 agents invoke / 统一 one-shot 回复",
                  "任务台账 / 看板 / 自动调度 / 完成权",
                  "公共 transcript / 历史回放",
                ]}
              />
            </Stack>
          </Stack>
        </aside>
      </div>

      <Stack gap={8}>
        <SectionTitle>两条内容路径</SectionTitle>
        <DualPathCards />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>所有权一眼可见</SectionTitle>
        <OwnershipBlocks
          callerOwns={d.scope.callerOwns}
          completionAuthority={d.scope.completionAuthority}
          forbiddenInPier={d.scope.forbiddenInPier}
          pierOwns={d.scope.pierOwns}
          scopeModel={d.scope.model}
        />
      </Stack>

      {/* L2 */}
      <Stack gap={8}>
        <Stack gap={4}>
          <SectionTitle>协作台：持久现场</SectionTitle>
          <SectionLead>
            一次性原生 agent 输出不进 Pier。此台只呈现持久会话的画面、工作树定位与运行事实。
          </SectionLead>
        </Stack>
        <AgentCollaborationPrototype ui={d.runtimeUi} />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>成功怎么算</SectionTitle>
        <MetricStrips items={d.successMeasures} />
      </Stack>

      {/* L3 */}
      <ReferenceAccordion
        items={[
          {
            value: "decision-goals",
            title: "完整决策说明与目标 / 非目标",
            content: (
              <Stack gap={10}>
                <Text className="text-sm leading-relaxed">{d.bluf}</Text>
                <div className="grid gap-8 lg:grid-cols-2">
                  <Stack gap={6}>
                    <SubTitle>目标</SubTitle>
                    <BulletList items={d.goals} />
                  </Stack>
                  <Stack gap={6}>
                    <SubTitle>明确不做</SubTitle>
                    <BulletList items={d.productNonGoals} />
                  </Stack>
                </div>
              </Stack>
            ),
          },
          {
            value: "success-proof",
            title: "成功衡量的验证证据",
            content: (
              <DataTable
                caption="成功衡量"
                headers={["衡量", "目标", "验证证据"]}
                rows={d.successMeasures.map((row) => [row.metric, row.target, row.proof])}
              />
            ),
          },
        ]}
      />
    </Stack>
  );
}

export function ProblemPage({ d }: { d: DesignData }) {
  const peakPains = d.problem.pains.slice(0, 3);
  const restPains = d.problem.pains.slice(3);

  return (
    <Stack gap={20}>
      <Alert variant="warning">
        <AlertTitle>研究收敛</AlertTitle>
        <AlertDescription className="text-sm leading-relaxed">
          共同结论：一次性用原生 agent；Pier CLI 串起持久 start、turn、screen 与
          wait。只借鉴运行面，不复制任务台账、one-shot 封装或完成判定。
        </AlertDescription>
      </Alert>

      <Stack gap={6}>
        <SectionTitle>{d.problem.title}</SectionTitle>
        <Text className="max-w-3xl text-sm leading-relaxed">{d.problem.thesis}</Text>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>主痛点（先看这三条）</SectionTitle>
        <ItemGroup className="grid gap-3">
          {peakPains.map((pain, index) => (
            <Item key={pain.id} size="sm" variant={index === 0 ? "outline" : "muted"}>
              <ItemContent>
                <ItemTitle>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{pain.id}</span>
                  {pain.title}
                </ItemTitle>
                <ItemDescription className="leading-relaxed">{pain.detail}</ItemDescription>
                <Text tone="secondary" className="mt-1 text-xs leading-relaxed">
                  后果：{pain.consequence}
                </Text>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
        {restPains.length > 0 ? (
          <ReferenceAccordion
            items={[
              {
                value: "more-pains",
                title: `另外 ${restPains.length} 条痛点`,
                content: (
                  <ItemGroup className="grid gap-2">
                    {restPains.map((pain) => (
                      <Item key={pain.id} size="xs" variant="muted">
                        <ItemContent>
                          <ItemTitle>
                            <span className="mr-2 font-mono text-xs text-muted-foreground">
                              {pain.id}
                            </span>
                            {pain.title}
                          </ItemTitle>
                          <ItemDescription className="leading-relaxed">{pain.detail}</ItemDescription>
                          <Text tone="tertiary" className="mt-1 text-xs leading-relaxed">
                            后果：{pain.consequence}
                          </Text>
                        </ItemContent>
                      </Item>
                    ))}
                  </ItemGroup>
                ),
              },
            ]}
            type="single"
          />
        ) : null}
      </Stack>

      <Stack gap={6}>
        <SectionTitle>源码调研摘要</SectionTitle>
        <SectionLead>{d.insight}</SectionLead>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {d.researchSources.map((source, index) => (
            <section
              className={
                index === 0
                  ? "min-w-0 rounded-lg border border-border/80 p-3 lg:row-span-1"
                  : "min-w-0 border-t pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4"
              }
              key={source.id}
            >
              <Stack gap={5}>
                <Row align="center" gap={8} wrap>
                  <SubTitle>{source.name}</SubTitle>
                  <StatusBadge label={source.status} />
                </Row>
                <Text className="text-sm leading-relaxed">{source.positioning}</Text>
                <Text tone="secondary" className="text-xs leading-relaxed">
                  <span className="font-medium text-foreground">采用：</span>
                  {source.adopt}
                </Text>
                <Text tone="secondary" className="text-xs leading-relaxed">
                  <span className="font-medium text-foreground">拒绝：</span>
                  {source.reject}
                </Text>
              </Stack>
            </section>
          ))}
        </div>
      </Stack>

      <ReferenceAccordion
        items={[
          {
            value: "research-evidence",
            title: "调研证据路径与 revision",
            content: (
              <div className="grid gap-3 sm:grid-cols-3">
                {d.researchSources.map((source) => (
                  <Stack className="min-w-0" gap={2} key={source.id}>
                    <Text className="text-xs font-semibold">{source.name}</Text>
                    <Text className="font-mono text-xs break-all text-muted-foreground">
                      {source.repository} · {source.revision.slice(0, 8)}
                    </Text>
                    <Text className="font-mono text-xs break-words text-muted-foreground">
                      {source.evidence}
                    </Text>
                  </Stack>
                ))}
              </div>
            ),
          },
          {
            value: "comparison-matrix",
            title: "横向能力矩阵",
            content: (
              <DataTable
                caption="业界能力矩阵"
                headers={["维度", "Orca", "cmux", "Agent Orchestrator", "Pier 决策"]}
                rows={d.comparison.map((row) => [
                  row.dimension,
                  row.orca,
                  row.cmux,
                  row.agentOrchestrator,
                  row.pierDecision,
                ])}
              />
            ),
          },
          {
            value: "current-state",
            title: "当前能力与需要补齐的智能体调用面",
            content: (
              <DataTable
                caption="Pier 当前能力"
                headers={["领域", "现有能力归属", "已有", "仍缺"]}
                rows={d.currentState.map((row) => [
                  row.area,
                  row.owner,
                  row.available,
                  row.missing,
                ])}
              />
            ),
          },
        ]}
      />
    </Stack>
  );
}

export function DesignPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <SectionTitle>目标形态</SectionTitle>
        <Text className="max-w-3xl text-sm leading-relaxed">{d.decision}</Text>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>调用所有权先于命令设计</SectionTitle>
        <MermaidDiagram
          aria-label="协调智能体、Pier 智能体 CLI 与工作智能体的数据和控制流"
          previewTitle="智能体调用与内容返回路径"
          source={d.architecture.diagram}
        />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>架构要点（可扫读）</SectionTitle>
        <SectionLead>
          默认只看每条结论；细则按需展开。完整原句均保留，不做省略号截断。
        </SectionLead>
        <GroupedNoteCards items={d.architecture.notes} />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>双内容路径（设计层）</SectionTitle>
        <DualPathCards />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>完成权与产品范围</SectionTitle>
        <OwnershipBlocks
          callerOwns={d.scope.callerOwns}
          completionAuthority={d.scope.completionAuthority}
          forbiddenInPier={d.scope.forbiddenInPier}
          pierOwns={d.scope.pierOwns}
          scopeModel={d.scope.model}
        />
      </Stack>

      <ReferenceAccordion
        items={[
          {
            value: "ownership-table",
            title: "分层所有权表",
            content: (
              <DataTable
                caption="目标所有权"
                headers={["层", "唯一所有者", "持有", "禁止持有"]}
                rows={d.ownership.map((row) => [
                  row.layer,
                  row.owner,
                  row.owns,
                  row.mustNotOwn,
                ])}
              />
            ),
          },
          {
            value: "entities",
            title: "调用身份、运行引用与内容实体",
            content: (
              <DataTable
                caption="调用身份、运行引用与内容实体"
                headers={["对象", "所有者", "精确身份", "语义"]}
                rows={d.entities.map((row) => [
                  row.name,
                  row.owner,
                  row.identity,
                  row.meaning,
                ])}
                monoFirst
              />
            ),
          },
          {
            value: "state-loops",
            title: "状态机、状态语义与调用闭环",
            content: (
              <Stack gap={12}>
                <DataTable
                  caption="实体状态机"
                  headers={["实体", "主路径", "迁移守卫", "终态规则"]}
                  rows={d.stateMachines.map((row) => [
                    row.entity,
                    row.path,
                    row.guard,
                    row.terminal,
                  ])}
                  monoFirst
                />
                <DataTable
                  caption="关键状态语义"
                  headers={["状态", "可信来源", "表示", "下一步"]}
                  rows={d.stateRules.map((row) => [
                    row.state,
                    row.source,
                    row.meaning,
                    row.next,
                  ])}
                  monoFirst
                />
                <DataTable
                  caption="智能体调用闭环"
                  headers={["闭环", "路径", "真正闭合于", "出口"]}
                  rows={d.closedLoops.map((loop) => [
                    `${loop.id} · ${loop.name}`,
                    loop.steps,
                    loop.closed,
                    loop.exitStates,
                  ])}
                />
              </Stack>
            ),
          },
          {
            value: "constraints-rails",
            title: "硬约束与安全护栏",
            content: (
              <div className="grid gap-8 lg:grid-cols-2">
                <Stack gap={6}>
                  <SubTitle>硬约束</SubTitle>
                  <IdConstraintList items={d.hardConstraints} />
                </Stack>
                <Stack gap={6}>
                  <SubTitle>安全护栏</SubTitle>
                  <ExpandableNoteList items={d.safetyRails} />
                </Stack>
              </div>
            ),
          },
        ]}
      />
    </Stack>
  );
}
