/** 长规范句 → 可扫读摘要/细则；呈现层拆分与交付图。 */

export type NoteParts = {
  summary: string;
  detail: string | null;
};

export type GroupedNotes = {
  topic: string;
  notes: NoteParts[];
};

/** 更具体的规则优先；用命中权重避免宽规则（如 invoke）抢桶。 */
const TOPIC_RULES: Array<{ topic: string; pattern: RegExp; weight: number }> = [
  {
    topic: "委派与并发",
    pattern: /maxActiveChildren|递归|sibling|sibling-read|委派|子运行|派生到|并发预算|depth/u,
    weight: 5,
  },
  {
    topic: "人类与外部接入",
    pattern: /人类 CLI|外部控制|Ed25519|key-window|宿主确认|本机 socket|OS 用户|AccessConsentQueue/u,
    weight: 5,
  },
  {
    topic: "授权与凭证",
    pattern:
      /CapabilityAuthority|AccessGrant|AccessConsent|AgentCallerCredential|AgentCallerService|Credential|mint\/revoke|mint|revoke|authorize|safeStorage|userData 原子|授权|凭证/u,
    weight: 4,
  },
  {
    topic: "持久路径与内容",
    pattern: /turn 只|screen 只|wait\/watch|canonicalPath|完整 WorktreeRef|持久路径|当前画面|viewport/u,
    weight: 4,
  },
  {
    topic: "一次性调用",
    pattern:
      /InvocationReply|execution-deadline|observation_timeout|advisory-read-only|maxOutputBytes|沙箱|provider auth|一次调用只产生/u,
    weight: 4,
  },
  {
    topic: "工作树与本机协议",
    pattern: /WorktreeIdentity|worktree list|marker|fsync|Files UI|socket\/pipe|事件缓冲/u,
    weight: 3,
  },
  {
    // 宽规则：仅作兜底，权重低
    topic: "一次性调用",
    pattern: /\binvoke\b/u,
    weight: 1,
  },
];

export function splitNote(text: string): NoteParts {
  const trimmed = text.trim();
  const semi = trimmed.indexOf("；");
  // 至少 2 个字符结论，避免空摘要；不设过长下限，短结论也应可拆
  if (semi >= 2) {
    const summary = trimmed.slice(0, semi).trim();
    const detail = trimmed.slice(semi + 1).trim();
    if (summary.length > 0 && detail.length > 0) {
      return { summary, detail };
    }
  }
  const period = trimmed.indexOf("。");
  if (period >= 2 && period < trimmed.length - 1) {
    const summary = trimmed.slice(0, period + 1).trim();
    const detail = trimmed.slice(period + 1).trim();
    if (summary.length > 0 && detail.length > 0) {
      return { summary, detail };
    }
  }
  return { summary: trimmed, detail: null };
}

export function topicForNote(text: string): string {
  let bestTopic = "架构要点";
  let bestScore = 0;
  for (const rule of TOPIC_RULES) {
    const matches = text.match(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`));
    if (!matches || matches.length === 0) {
      continue;
    }
    const score = matches.length * rule.weight;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = rule.topic;
    }
  }
  return bestTopic;
}

export function groupNotes(items: string[]): GroupedNotes[] {
  const buckets = new Map<string, NoteParts[]>();
  const order: string[] = [];
  for (const item of items) {
    const topic = topicForNote(item);
    if (!buckets.has(topic)) {
      buckets.set(topic, []);
      order.push(topic);
    }
    buckets.get(topic)?.push(splitNote(item));
  }
  return order.map((topic) => ({
    topic,
    notes: buckets.get(topic) ?? [],
  }));
}

export const SCOPE_LABELS: Record<string, string> = {
  "agent-caller-identity": "调用身份",
  "one-shot-agent-invocation": "一次性调用",
  "bounded-agent-screen": "有界画面",
  "agent-runtime-observation": "运行观察",
  "terminal-control": "终端控制",
  "panel-focus": "面板聚焦",
  "worktree-guard": "工作树守卫",
  "shell-task-runs": "Shell 任务",
  "attention-routing": "提醒路由",
  "local-control-transport": "本机传输",
  "local-control-authorization": "本机授权",
  "goal-and-work-decomposition": "目标拆分",
  "call-selection-and-delegation-policy": "委派策略",
  "retry-and-completion-policy": "重试与结束",
  "result-acceptance-and-synthesis": "结果验收",
  "caller-memory-or-external-ledger": "调用方台账",
};

/** 映射为中文短标签；未知 slug 原样全文，永不截断。 */
export function scopeItemLabel(value: string): string {
  return SCOPE_LABELS[value] ?? value;
}

export function presentCompletionAuthority(value: string): string {
  if (value === "caller-agent-or-external-controller") {
    return "完成权在调用方（协调智能体或外部控制器）";
  }
  return `完成权威：${value}`;
}

export function presentScopeModel(value: string): string {
  if (value === "agent-facing-runtime-control") {
    return "范围模型：智能体运行控制";
  }
  return `范围模型：${value}`;
}

const PREFERRED_DELIVERY_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 4],
  [4, 5],
  [5, 6],
];

/** 交付波次依赖图：实施路径，不是产品任务 DAG。 */
export function buildDeliveryDiagram(
  phases: Array<{ wave: number; name: string }>,
): string {
  const sorted = [...phases].sort((a, b) => a.wave - b.wave);
  const nodes = sorted
    .map((phase) => {
      const id = `W${phase.wave}`;
      const label = `W${phase.wave} ${phase.name}`.replace(/["\n]/gu, " ");
      return `  ${id}["${label}"]`;
    })
    .join("\n");

  const waves = new Set(sorted.map((phase) => phase.wave));
  const edgeKeys = new Set<string>();
  const edges: string[] = [];

  const addEdge = (from: number, to: number) => {
    if (!waves.has(from) || !waves.has(to) || from === to) {
      return;
    }
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push(`  W${from} --> W${to}`);
  };

  for (const [from, to] of PREFERRED_DELIVERY_EDGES) {
    addEdge(from, to);
  }

  // 补全仍无入边的节点（除最小 wave），避免部分 preferred 匹配后出现孤立波次
  const hasIncoming = new Set<number>();
  for (const key of edgeKeys) {
    const to = Number(key.split("->")[1]);
    hasIncoming.add(to);
  }
  const minWave = sorted[0]?.wave;
  for (let i = 0; i < sorted.length; i += 1) {
    const wave = sorted[i]?.wave;
    if (wave === undefined || wave === minWave || hasIncoming.has(wave)) {
      continue;
    }
    // 接到前一个已存在的波次
    const prev = sorted[i - 1]?.wave;
    if (prev !== undefined) {
      addEdge(prev, wave);
      hasIncoming.add(wave);
    }
  }

  // 仍无任何边时退化为全链
  if (edges.length === 0) {
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const from = sorted[i]?.wave;
      const to = sorted[i + 1]?.wave;
      if (from !== undefined && to !== undefined) {
        addEdge(from, to);
      }
    }
  }

  return ["flowchart TB", nodes, ...edges].join("\n");
}

/** 测试与契约用：期望的 preferred 边集合（字符串形式）。 */
export function preferredDeliveryEdgeLabels(): string[] {
  return PREFERRED_DELIVERY_EDGES.map(([from, to]) => `W${from} --> W${to}`);
}
