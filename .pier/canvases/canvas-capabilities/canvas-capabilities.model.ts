export type Surface =
  | "boundary"
  | "overview"
  | "playground"
  | "route"
  | "verification";
export type BoundaryView = "freedom" | "skill" | "technology";
export type ChartType = "area" | "bar" | "donut" | "line";
export type EvidenceState =
  | "demonstrated"
  | "implemented"
  | "planned"
  | "verified";
export type InteractionLevel = "local" | "scoped" | "privileged";
export type MermaidExample = "flowchart" | "gantt" | "sequence";
export type TaskId = `T${number}`;
export type ViewportMode = "document" | "full-bleed" | "workspace";

export type CapabilityEvidence = {
  coverage: string;
  gap: string;
  id: string;
  proof: string;
  source: string;
  state: EvidenceState;
  title: string;
};

export type RouteTask = {
  deps: TaskId[];
  evidence: string[];
  id: TaskId;
  output: string;
  phase: number;
  short: string;
  title: string;
};

type TaskDependency = {
  readonly deps: readonly TaskId[];
  readonly id: TaskId;
};
type TaskStatus = "blocked" | "done" | "ready";

type TaskGraphDiagnostic = {
  cycleTaskIds: TaskId[];
  unknownDependencies: Array<{ dependencyId: TaskId; taskId: TaskId }>;
};

export const SURFACES: Array<{
  id: Surface;
  label: string;
  question: string;
  tail: string;
}> = [
  {
    id: "overview",
    label: "概览",
    question: "现在已经能做什么，下一处缺口在哪里？",
    tail: "状态来自证据模型",
  },
  {
    id: "playground",
    label: "试用",
    question: "真实系统能力是否可以直接操作？",
    tail: "源码 · 图表 · 节点",
  },
  {
    id: "boundary",
    label: "边界",
    question: "哪些由宿主固定，哪些交给内容自由生成？",
    tail: "固定壳 · 自由内容 · 受控能力",
  },
  {
    id: "verification",
    label: "验证",
    question: "每一个状态由什么自动证据支持？",
    tail: "实现 ≠ 演示 ≠ 验证",
  },
  {
    id: "route",
    label: "路线",
    question: "剩余任务如何按依赖真正推进？",
    tail: "DAG · 任务 · 完成证据",
  },
];

export const BOUNDARY_VIEWS: Array<{ id: BoundaryView; label: string }> = [
  { id: "freedom", label: "自由度" },
  { id: "technology", label: "技术设计" },
  { id: "skill", label: "Skill 设计" },
];

export const EVIDENCE_STATE_META = {
  demonstrated: {
    label: "已演示",
    variant: "info" as const,
  },
  implemented: {
    label: "已接入",
    variant: "done" as const,
  },
  planned: {
    label: "规划中",
    variant: "warning" as const,
  },
  verified: {
    label: "已验证",
    variant: "success" as const,
  },
} satisfies Record<
  EvidenceState,
  {
    label: string;
    variant: "done" | "info" | "success" | "warning";
  }
>;

export const CAPABILITY_EVIDENCE: CapabilityEvidence[] = [
  {
    coverage: "流程图、序列图、甘特图；安全 SVG",
    gap: "其余官方图型尚未形成逐型回归矩阵",
    id: "mermaid",
    proof: "三类代表图型通过官方 Mermaid 渲染，并检查输出不含 script。",
    source: "tests/unit/renderer/pier-canvas-visualizations.test.tsx",
    state: "verified",
    title: "Mermaid 通用预览",
  },
  {
    coverage: "XYFlow 渲染、ELK 布局、节点选择与上下游高亮",
    gap: "尚未展示节点新增、连线修改和撤销",
    id: "dag",
    proof: "组件测试点击真实 XYFlow 节点并收到稳定的节点标识。",
    source: "tests/unit/renderer/pier-canvas-visualizations.test.tsx",
    state: "verified",
    title: "节点关系图",
  },
  {
    coverage: "稳定图表外观与无数据空态；当前说明稿可切换四类外观",
    gap: "四种外观逐型交互、大数据量和键盘数据点导航仍需专项验证",
    id: "data-chart",
    proof: "组件测试验证柱状图稳定外观、折线图无数据空态和调用方不接触 Recharts。",
    source: "tests/unit/renderer/pier-canvas-visualizations.test.tsx",
    state: "verified",
    title: "数据图表",
  },
  {
    coverage: "React、Vue、Solid、Svelte 可编译并引用同一入口",
    gap: "Vue、Solid、Svelte 尚缺真实 mount/update/event/dispose 行为测试",
    id: "frameworks",
    proof: "四种框架编译产物均包含共享 visualizations 运行入口。",
    source: "tests/unit/main/live-modules-frameworks.test.ts",
    state: "implemented",
    title: "多框架图表入口",
  },
  {
    coverage: "当前说明稿已组合导航、图表、局部状态和任务联动",
    gap: "这是可信项目内与宿主共享运行环境，不是不可信内容沙箱",
    id: "free-ui",
    proof: "本 Canvas 由真实 React 内容组件组成，并通过项目 Canvas 挂载测试。",
    source: "tests/component/project-canvas-scenarios.test.tsx",
    state: "demonstrated",
    title: "自由内容 UI",
  },
  {
    coverage: "文档、工作区、全幅三种概念模式",
    gap: "当前只改变内部预览，尚未改变真实 CanvasHost 视口",
    id: "viewport",
    proof: "产品模型和交互预览已经存在，宿主协议尚未接入。",
    source: ".pier/canvases/canvas-capabilities/canvas-capabilities.model.ts",
    state: "planned",
    title: "有限视口",
  },
  {
    coverage: "加载、诊断、重载、可信提示和滚动所有权",
    gap: "尚未由统一 CanvasHost 按视口协议提供",
    id: "host",
    proof: "T11 已定义产出与完成证据，等待 T10。",
    source: ".pier/canvases/canvas-capabilities/canvas-capabilities.model.ts",
    state: "planned",
    title: "固定运行壳",
  },
  {
    coverage: "同目录读写、版本冲突和越界拒绝",
    gap: "尚未形成四框架共享的 pier/files 入口",
    id: "files",
    proof: "T12 已定义产出与完成证据，等待多框架运行闭环。",
    source: ".pier/canvases/canvas-capabilities/canvas-capabilities.model.ts",
    state: "planned",
    title: "受限文件能力",
  },
];

export const VIEWPORT_MODES: Array<{
  detail: string;
  id: ViewportMode;
  label: string;
  owner: string;
}> = [
  {
    detail: "限制阅读宽度，由宿主管理滚动。",
    id: "document",
    label: "文档",
    owner: "docs 默认",
  },
  {
    detail: "宽内容区与标准内边距，适合面板组合。",
    id: "workspace",
    label: "工作区",
    owner: "kit 默认",
  },
  {
    detail: "填满面板，Canvas 自己管理视口和滚动。",
    id: "full-bleed",
    label: "全幅",
    owner: "composition 默认",
  },
];

export const FIXED_SHELL_CAPABILITIES = [
  ["生命周期", "编译、挂载、热更新、卸载"],
  ["运行反馈", "加载、诊断、重试、可信状态"],
  ["产品基线", "主题令牌、字体、密度、可访问性"],
  ["边界", "视口模式、路径围栏、能力声明"],
] as const;

export const FREE_CANVAS_CAPABILITIES = [
  ["内容", "文案、表格、图表、表单与业务组件"],
  ["布局", "标签页、侧栏、网格、响应式与全屏工作台"],
  ["视觉", "作用域内 CSS、动画和项目设计语言"],
  ["交互", "局部状态、筛选、拖拽、选择与业务事件"],
] as const;

export const CONTROLLED_BRIDGE_CAPABILITIES = [
  ["图表", "pier/visualizations", "已接入"],
  ["组件", "pier/canvas", "React 已接入"],
  ["文件", "pier/files", "待同构"],
  ["宿主动作", "声明式 capability", "后续版本"],
] as const;

export const PRODUCT_STEPS = [
  {
    detail: "用户描述目标，智能体判断是 Mermaid 图、结构化节点图、数据图表还是组合界面。",
    index: "01",
    title: "识别图型",
  },
  {
    detail: "所有 Mermaid 图先获得源码编辑和实时预览；不要求坐标或框架组件。",
    index: "02",
    title: "编辑源码",
  },
  {
    detail: "流程、依赖、状态等节点图进入 XYFlow，先获得选择、缩放和上下游检查。",
    index: "03",
    title: "检查节点",
  },
  {
    detail: "任务依赖图与面板共用数据真源，选择和完成证据形成可验证闭环。",
    index: "04",
    title: "推进工作",
  },
] as const;

export const SYSTEM_CAPABILITIES = [
  {
    detail: "使用官方 Mermaid 渲染入口；三类代表图型与安全 SVG 已验证，其余图型待逐型回归。",
    label: "MermaidDiagram",
    state: "代表图型已验证",
    variant: "success" as const,
  },
  {
    detail: "节点、边、平移、缩放、选择与键盘由 XYFlow 提供；ELK 负责自动布局，结构编辑待补。",
    label: "NodeGraph",
    state: "检查模式已验证",
    variant: "success" as const,
  },
  {
    detail: "折线、柱状、面积、环形继续使用 Recharts；不把统计图塞进节点画布。",
    label: "DataChart",
    state: "保留",
    variant: "success" as const,
  },
  {
    detail: "四框架已能编译并引用同一入口；Vue、Solid、Svelte 仍需补齐真实运行与卸载验证。",
    label: "pier/visualizations",
    state: "编译入口已验证",
    variant: "done" as const,
  },
  {
    detail: "固定生命周期、反馈和有限视口模式；不规定 Canvas 内部页面结构。",
    label: "CanvasHost",
    state: "待实现",
    variant: "warning" as const,
  },
  {
    detail: "将同目录读写与版本冲突能力做成框架无关入口，不扩大任意文件访问。",
    label: "pier/files",
    state: "待同构",
    variant: "warning" as const,
  },
] as const;

export const CHART_DATA = [
  { capability: "Mermaid 通用预览", evidenceLevel: 3 },
  { capability: "数据图表", evidenceLevel: 3 },
  { capability: "节点关系图", evidenceLevel: 3 },
  { capability: "多框架入口", evidenceLevel: 2 },
] as const;

export const MERMAID_EXAMPLES: Record<
  MermaidExample,
  { label: string; source: string }
> = {
  flowchart: {
    label: "流程图",
    source: `flowchart LR
  A[Mermaid 源码] --> B{是否为节点图}
  B -- 是 --> C[XYFlow 交互]
  B -- 否 --> D[专用预览与编辑]
  C --> E[统一 Diagram 能力]
  D --> E`,
  },
  sequence: {
    label: "序列图",
    source: `sequenceDiagram
  participant U as 用户
  participant C as Canvas
  participant P as Pier
  U->>C: 修改 Mermaid 源码
  C->>P: 校验并渲染
  P-->>C: 安全 SVG 或明确错误
  C-->>U: 即时预览`,
  },
  gantt: {
    label: "甘特图",
    source: `gantt
  title 图表能力首版
  dateFormat YYYY-MM-DD
  section 通用预览
  Mermaid 代表图型 :done, m1, 2026-07-28, 2d
  section 节点检查
  XYFlow 与 ELK :active, m2, after m1, 3d
  section 验收
  Canvas 内部验证 :m3, after m2, 2d`,
  },
};

export const DIAGRAM_FAMILIES = [
  {
    edit: "源码 + 实时预览",
    examples: "序列图、甘特图、时间线、Git 图",
    family: "时序与规划",
    renderer: "Mermaid",
  },
  {
    edit: "源码 + 节点检查；结构编辑逐步补齐",
    examples: "流程图、DAG、状态图、架构图",
    family: "节点关系",
    renderer: "XYFlow + ELK",
  },
  {
    edit: "数据与配置面板",
    examples: "折线、柱状、饼图、雷达图",
    family: "数据图表",
    renderer: "Recharts / Mermaid",
  },
  {
    edit: "专用编辑器逐步补齐",
    examples: "Sankey、数据包、用户旅程",
    family: "专业图型",
    renderer: "Mermaid",
  },
] as const;

export const INTERACTION_LEVELS = [
  {
    badge: "success" as const,
    decision: "第一版必须",
    examples: ["自由内容 UI", "局部状态", "图表交互", "三种有限视口"],
    id: "local" as const,
    index: "L1",
    title: "本地交互",
  },
  {
    badge: "warning" as const,
    decision: "第一版受限",
    examples: ["同目录读写", "版本冲突", "能力声明", "明确失败反馈"],
    id: "scoped" as const,
    index: "L2",
    title: "受限数据闭环",
  },
  {
    badge: "neutral" as const,
    decision: "后续版本",
    examples: ["宿主命令", "协作编辑", "不可信共享 Canvas", "可视化搭建器"],
    id: "privileged" as const,
    index: "L3",
    title: "宿主高权限动作",
  },
] satisfies Array<{
  badge: "neutral" | "success" | "warning";
  decision: string;
  examples: string[];
  id: InteractionLevel;
  index: string;
  title: string;
}>;

export const TASKS: RouteTask[] = [
  {
    deps: [],
    evidence: ["Mermaid 是兼容格式", "XYFlow 仅负责节点图", "禁止图引擎类型泄漏"],
    id: "T0",
    output: "图表能力架构说明",
    phase: 0,
    short: "能力边界",
    title: "锁定 Mermaid 与节点图边界",
  },
  {
    deps: ["T0"],
    evidence: ["官方图型测试语料", "类型检测和语法诊断", "安全 SVG 与主题"],
    id: "T1",
    output: "MermaidDiagram",
    phase: 1,
    short: "全图预览",
    title: "接入官方 Mermaid 通用预览",
  },
  {
    deps: ["T1"],
    evidence: ["源码与预览同屏", "错误可定位", "修改和恢复即时可见"],
    id: "T2",
    output: "Mermaid 源码编辑体验",
    phase: 1,
    short: "源码编辑",
    title: "完成 Mermaid 源码编辑闭环",
  },
  {
    deps: ["T0"],
    evidence: ["XYFlow 不暴露给调用方", "节点与边协议稳定", "检查与编辑模式分离"],
    id: "T3",
    output: "NodeGraph 协议与适配器",
    phase: 2,
    short: "节点图引擎",
    title: "接入 XYFlow 节点图底座",
  },
  {
    deps: ["T3"],
    evidence: ["调用方不提供坐标", "ELK 分层坐标与方向", "循环与缺失依赖诊断"],
    id: "T4",
    output: "ELK 布局适配器",
    phase: 2,
    short: "自动布局",
    title: "用 ELK 替换自研 DAG 布局",
  },
  {
    deps: ["T2", "T4"],
    evidence: ["进入 pier/canvas 白名单", "编译期桩同步", "真实 Canvas 挂载"],
    id: "T5",
    output: "Canvas 图表系统入口",
    phase: 3,
    short: "系统导出",
    title: "接入 Canvas 系统能力入口",
  },
  {
    deps: ["T5"],
    evidence: ["Mermaid 三种图型内部使用", "XYFlow 任务图内部使用", "任务面板双向联动"],
    id: "T6",
    output: "能力 Canvas 内部验证稿",
    phase: 3,
    short: "内部验证",
    title: "用本 Canvas 验证新图能力",
  },
  {
    deps: ["T5"],
    evidence: ["mount/update/dispose", "四框架同输入同事件", "卸载无 DOM 和监听残留"],
    id: "T7",
    output: "pier/visualizations",
    phase: 4,
    short: "多框架桥",
    title: "补齐框架无关挂载能力",
  },
  {
    deps: ["T6", "T7"],
    evidence: [
      "元数据只接受三种模式",
      "kind 提供明确默认值",
      "未知模式编译诊断",
    ],
    id: "T10",
    output: "Canvas 视口协议",
    phase: 5,
    short: "视口协议",
    title: "定义文档、工作区与全幅视口",
  },
  {
    deps: ["T10"],
    evidence: [
      "三种示例宽度符合协议",
      "滚动所有权可观察",
      "窗口缩放不溢出",
    ],
    id: "T11",
    output: "CanvasHost 固定运行壳",
    phase: 6,
    short: "固定运行壳",
    title: "按视口协议渲染宿主运行壳",
  },
  {
    deps: ["T10"],
    evidence: [
      "样式自动限制在 Canvas 根节点",
      "热更新替换旧样式",
      "50 次卸载无残留 style",
    ],
    id: "T14",
    output: "React Canvas 样式产物协议",
    phase: 6,
    short: "样式隔离",
    title: "建立可清理的作用域样式管线",
  },
  {
    deps: ["T7"],
    evidence: [
      "四框架完成同目录读写",
      "版本冲突不静默覆盖",
      "越界路径稳定拒绝",
    ],
    id: "T12",
    output: "pier/files",
    phase: 5,
    short: "文件能力桥",
    title: "补齐框架无关文件能力",
  },
  {
    deps: ["T11", "T12", "T14"],
    evidence: [
      "可信项目提示明确",
      "Node 与 Electron 访问被拒绝",
      "卸载后无根节点与监听残留",
    ],
    id: "T13",
    output: "Canvas 可信与生命周期治理",
    phase: 7,
    short: "可信治理",
    title: "锁定生成式 Canvas 的可信边界",
  },
  {
    deps: ["T11", "T13"],
    evidence: [
      "意图识别内容与系统能力",
      "选择有限视口模式",
      "自动验证并打开结果",
    ],
    id: "T8",
    output: "/canvas Skill",
    phase: 8,
    short: "生成 Skill",
    title: "更新 Canvas 生成 Skill",
  },
  {
    deps: ["T8", "T13"],
    evidence: [
      "三种视口截图",
      "四框架自由 UI 样例",
      "500 节点性能",
      "50 次挂载卸载",
    ],
    id: "T9",
    output: "端到端质量报告",
    phase: 9,
    short: "质量验收",
    title: "完成兼容性、性能与生命周期验收",
  },
];

export const INITIAL_COMPLETED: TaskId[] = [
  "T0",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
];
export const DEFAULT_LEVEL = INTERACTION_LEVELS[0]!;
export const DEFAULT_TASK = TASKS[0]!;

export function taskStatus(
  task: RouteTask,
  completed: ReadonlySet<TaskId>
): TaskStatus {
  if (completed.has(task.id)) {
    return "done";
  }
  return task.deps.every((id) => completed.has(id)) ? "ready" : "blocked";
}

export function taskStatusLabel(status: ReturnType<typeof taskStatus>): string {
  if (status === "done") {
    return "已完成";
  }
  return status === "ready" ? "可以开始" : "等待前置";
}

const TASK_GRAPH_TONE = {
  blocked: "warning",
  done: "done",
  ready: "success",
} as const satisfies Record<TaskStatus, "done" | "success" | "warning">;

export function taskGraphNodes(completed: ReadonlySet<TaskId>) {
  return TASKS.map((task) => ({
    id: task.id,
    meta: `L${task.phase}`,
    title: task.short,
    tone: TASK_GRAPH_TONE[taskStatus(task, completed)],
  }));
}

export function taskGraphEdges(
  tasks: readonly TaskDependency[] = TASKS
): Array<{ id: string; source: TaskId; target: TaskId }> {
  return tasks.flatMap((task) =>
    task.deps.map((source, index) => ({
      id: `${source}-${task.id}-${index}`,
      source,
      target: task.id,
    }))
  );
}

export function taskLineageIds(
  tasks: readonly TaskDependency[],
  selectedId: TaskId
): Set<TaskId> {
  const incoming = new Map<TaskId, TaskId[]>();
  const outgoing = new Map<TaskId, TaskId[]>();
  for (const task of tasks) {
    incoming.set(task.id, [...task.deps]);
    outgoing.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dependencyId of task.deps) {
      outgoing.get(dependencyId)?.push(task.id);
    }
  }

  const related = new Set<TaskId>();
  for (const graph of [incoming, outgoing]) {
    const pending = [selectedId];
    const visited = new Set<TaskId>();
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) {
        continue;
      }
      visited.add(id);
      related.add(id);
      pending.push(...(graph.get(id) ?? []));
    }
  }
  return related;
}

export function validateTaskDependencies(
  tasks: readonly TaskDependency[] = TASKS
): TaskGraphDiagnostic {
  const ids = new Set(tasks.map((task) => task.id));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map(tasks.map((task) => [task.id, [] as TaskId[]]));
  const unknownDependencies: TaskGraphDiagnostic["unknownDependencies"] = [];

  for (const task of tasks) {
    for (const dependencyId of task.deps) {
      if (!ids.has(dependencyId)) {
        unknownDependencies.push({ dependencyId, taskId: task.id });
        continue;
      }
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      outgoing.get(dependencyId)?.push(task.id);
    }
  }

  const ready = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id);
  const visited = new Set<TaskId>();
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) {
      break;
    }
    visited.add(id);
    for (const childId of outgoing.get(id) ?? []) {
      const next = (indegree.get(childId) ?? 1) - 1;
      indegree.set(childId, next);
      if (next === 0) {
        ready.push(childId);
      }
    }
  }

  return {
    cycleTaskIds: tasks
      .filter((task) => !visited.has(task.id))
      .map((task) => task.id),
    unknownDependencies,
  };
}

export function descendantsOf(id: TaskId): Set<TaskId> {
  const descendants = new Set<TaskId>();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    for (const task of TASKS) {
      if (task.deps.includes(current) && !descendants.has(task.id)) {
        descendants.add(task.id);
        pending.push(task.id);
      }
    }
  }
  return descendants;
}
