import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  NodeGraph,
  Progress,
  Separator,
} from "pier/canvas";
import { useMemo, useState } from "react";
import {
  CAPABILITY_EVIDENCE,
  EVIDENCE_STATE_META,
  INTERACTION_LEVELS,
  TASKS,
  type InteractionLevel,
  type RouteTask,
  type TaskId,
  taskGraphEdges,
  taskGraphNodes,
  taskLineageIds,
  taskStatus,
  taskStatusLabel,
  validateTaskDependencies,
} from "./canvas-capabilities.model.ts";
import { Owner } from "./canvas-capabilities.primitives.tsx";

const ROUTE_GRAPH_EDGES = taskGraphEdges();
const ROUTE_GRAPH_DIAGNOSTIC = validateTaskDependencies();
const ROUTE_GRAPH_INVALID_COUNT =
  ROUTE_GRAPH_DIAGNOSTIC.cycleTaskIds.length +
  ROUTE_GRAPH_DIAGNOSTIC.unknownDependencies.length;

export function VerificationSurface({
  selected,
  selectedId,
  setSelectedId,
}: {
  selected: (typeof INTERACTION_LEVELS)[number];
  selectedId: InteractionLevel;
  setSelectedId: (id: InteractionLevel) => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({
    freedom: false,
    graph: false,
    conflict: false,
    mermaid: false,
    isolation: false,
    shell: false,
  });
  const observed = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;
  const verified = CAPABILITY_EVIDENCE.filter(
    (item) => item.state === "verified"
  ).length;

  return (
    <main className="cc-surface">
      <Card className="cc-panel cc-verification-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>正式能力证据</span>
            <Badge variant="success">
              {verified} / {CAPABILITY_EVIDENCE.length} 已验证
            </Badge>
          </div>
          <CardTitle>状态只由实现、真实演示和自动测试决定</CardTitle>
          <CardDescription>
            “已接入”不等于“已验证”；每项状态同时展示覆盖范围、未覆盖缺口和证据文件。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-verification-grid">
            {CAPABILITY_EVIDENCE.map((item) => {
              const state = EVIDENCE_STATE_META[item.state];
              return (
                <article key={item.id}>
                  <div className="cc-verification-item__header">
                    <strong>{item.title}</strong>
                    <Badge size="xs" variant={state.variant}>
                      {state.label}
                    </Badge>
                  </div>
                  <p>{item.proof}</p>
                  <dl>
                    <div>
                      <dt>覆盖</dt>
                      <dd>{item.coverage}</dd>
                    </div>
                    <div>
                      <dt>缺口</dt>
                      <dd>{item.gap}</dd>
                    </div>
                  </dl>
                  <code>{item.source}</code>
                </article>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="cc-interaction-grid">
        <section className="cc-levels" aria-label="交互能力层级">
          {INTERACTION_LEVELS.map((level) => (
            <button
              key={level.id}
              aria-pressed={selectedId === level.id}
              className="cc-level"
              onClick={() => setSelectedId(level.id)}
              type="button"
            >
              <span className="cc-level__index">{level.index}</span>
              <span className="cc-level__copy">
                <span>
                  <strong>{level.title}</strong>
                  <Badge size="xs" variant={level.badge}>
                    {level.decision}
                  </Badge>
                </span>
                <small>{level.examples.join(" · ")}</small>
              </span>
              <span className="cc-level__arrow">→</span>
            </button>
          ))}
        </section>

        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>{selected.index} 交互边界</span>
              <Badge variant={selected.badge}>{selected.decision}</Badge>
            </div>
            <CardTitle>{selected.title}</CardTitle>
            <CardDescription>
              {selected.id === "local"
                ? "Canvas 拥有内容结构、局部状态和业务事件；宿主只提供视口、反馈、主题与受控能力。"
                : selected.id === "scoped"
                  ? "宿主只注入声明过的同目录读写和系统能力，并保留版本冲突与用户可见失败。"
                  : "共享给不可信来源前必须建立独立运行环境和按主体授权，不能直接扩大 window.pier。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-owner-grid">
              <Owner label="内容与数据" value="Canvas / 同目录文件" />
              <Owner label="视口与反馈" value="CanvasHost" />
              <Owner label="能力策略" value="共享协议 + main 围栏" />
              <Owner label="执行" value="框架挂载适配器" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="cc-panel cc-check-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>本次体验检查 · 不计入正式状态</span>
            <Badge variant="neutral">
              {observed} / {totalChecks}
            </Badge>
          </div>
          <CardTitle>记录观察结果，不模拟自动验收</CardTitle>
          <CardDescription>
            点击只记录本次人工体验，刷新后重置；正式能力状态仍只读取上方证据模型。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-checks">
            {(
              [
                ["freedom", "自由内容 UI", "导航、布局、视觉和局部状态由 Canvas 决定"],
                ["mermaid", "全图型预览", "流程、序列和甘特使用同一系统入口"],
                ["graph", "节点图联动", "XYFlow 节点选择更新任务详情和上下游"],
                ["shell", "有限视口", "文档、工作区和全幅拥有明确宽度与滚动"],
                ["conflict", "受限写入", "版本不一致时不静默覆盖"],
                ["isolation", "卸载隔离", "关闭后无 DOM、监听和观察器残留"],
              ] as const
            ).map(([id, title, detail]) => (
              <button
                key={id}
                aria-pressed={checks[id]}
                className="cc-check"
                onClick={() =>
                  setChecks((current) => ({
                    ...current,
                    [id]: !current[id],
                  }))
                }
                type="button"
              >
                <span className="cc-check__box">{checks[id] ? "✓" : ""}</span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="cc-progress">
            <Progress value={(observed / totalChecks) * 100} />
            <span>
              {observed === totalChecks
                ? "本次体验检查已记录完整，但不会自动提升能力状态。"
                : "人工检查用于发现问题，不能替代自动测试证据。"}
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function RouteSurface({
  completed,
  selected,
  selectedId,
  setCompleted,
  setSelectedId,
}: {
  completed: ReadonlySet<TaskId>;
  selected: RouteTask;
  selectedId: TaskId;
  setCompleted: (id: TaskId, checked: boolean) => void;
  setSelectedId: (id: TaskId) => void;
}) {
  const graphNodes = useMemo(() => taskGraphNodes(completed), [completed]);
  const highlightedIds = useMemo(
    () => taskLineageIds(TASKS, selectedId),
    [selectedId]
  );
  const selectedStatus = taskStatus(selected, completed);
  const progress = Math.round((completed.size / TASKS.length) * 100);

  return (
    <main className="cc-surface">
      <div className="cc-route-grid">
        <Card className="cc-panel cc-graph-card">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>XYFlow + ELK 内部验证</span>
              <Badge variant="info">NodeGraph 通用能力</Badge>
            </div>
            <CardTitle>Canvas 能力与自由度实施依赖图</CardTitle>
            <CardDescription>
              图表底层完成后继续推进视口协议、固定运行壳、文件能力桥、可信治理与生成 Skill。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-task-graph">
              <NodeGraph
                aria-label="Canvas 能力与自由度实施依赖图"
                className="h-full"
                edges={ROUTE_GRAPH_EDGES}
                highlightedIds={highlightedIds}
                nodes={graphNodes}
                onSelectNode={(id) => {
                  const task = TASKS.find((candidate) => candidate.id === id);
                  if (task) {
                    setSelectedId(task.id);
                  }
                }}
                selectedId={selectedId}
              />
              {ROUTE_GRAPH_INVALID_COUNT > 0 ? (
                <p className="cc-task-graph__diagnostic" role="status">
                  任务依赖中有 {ROUTE_GRAPH_INVALID_COUNT} 处循环或缺失引用。
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="cc-panel cc-task-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>任务面板</span>
              <Badge
                variant={
                  selectedStatus === "done"
                    ? "done"
                    : selectedStatus === "ready"
                      ? "success"
                      : "warning"
                }
              >
                {taskStatusLabel(selectedStatus)}
              </Badge>
            </div>
            <CardTitle>
              {selected.id} · {selected.title}
            </CardTitle>
            <CardDescription>
              前置：{selected.deps.length > 0 ? selected.deps.join("、") : "无"} ·
              产出：{selected.output}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-evidence">
              <span>完成证据</span>
              <ol>
                {selected.evidence.map((item) => (
                  <li key={item}>
                    <span>{selected.id}</span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>
            <Separator />
            <div className="cc-todo-header">
              <span>实施待办</span>
              <strong>{completed.size} / {TASKS.length}</strong>
            </div>
            <div className="cc-todos">
              {TASKS.map((task) => {
                const status = taskStatus(task, completed);
                return (
                  <div
                    className="cc-todo-row"
                    data-selected={selectedId === task.id}
                    key={task.id}
                  >
                    <Checkbox
                      aria-label={`完成 ${task.id} ${task.title}`}
                      checked={status === "done"}
                      disabled={status === "blocked"}
                      onCheckedChange={(checked) =>
                        setCompleted(task.id, checked === true)
                      }
                    />
                    <button
                      onClick={() => setSelectedId(task.id)}
                      type="button"
                    >
                      <code>{task.id}</code>
                      <span>{task.short}</span>
                    </button>
                    <small>{taskStatusLabel(status)}</small>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="cc-route-footer">
        <Progress value={progress} />
        <span>整体完成 {progress}%</span>
        <strong>
          下一步：
          {TASKS.find((task) => taskStatus(task, completed) === "ready")?.id ??
            "全部完成"}
        </strong>
      </div>
    </main>
  );
}
