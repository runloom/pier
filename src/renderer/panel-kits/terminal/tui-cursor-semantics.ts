import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TerminalCursorVisibility } from "@shared/contracts/terminal.ts";

/**
 * 光标语义的会话内观察。
 *
 * catalog 的 `inputFocusProbe` 只是**先验**：说明我们人工核实过「硬件光标可见
 * ⇔ TUI 输入框聚焦」。但上游改一版渲染就能翻转这个语义，而静态白名单无法察觉，
 * 失效方向可能是恒 hidden（2026-07-27 claude 回归即此形状）。
 *
 * 因此风险提示再加一道运行时条件：同一 agent 活动会话内必须观察到过 `visible`，
 * 此后 `hidden` 才作为输入风险提示。从未见过 `visible` 的会话一律放行。
 * `armed` 只是内部状态名，不表示程序已经自动证明语义正确。
 *
 * 失效退化因此变成安全方向：
 * - 语义翻转成恒 hidden → 永不 arm → 不提示（最坏是漏掉一次风险提醒）
 * - 语义正常 → 首次聚焦即 arm → 恢复原有保护
 *
 * 面板复用、同面板重启同一种 agent 时结论都必须作废。会话身份使用
 * foreground activity 的 `spawnedAt`，不能只看 panelId + agentId。
 */
interface SemanticsEntry {
  /** foreground activity 会话建立时间；同 agent 重启时会变化。 */
  activitySpawnedAt: number;
  agentId: AgentKind;
  /** 本会话是否观察到过 visible（arming 条件）。 */
  armed: boolean;
  last: TerminalCursorVisibility;
}

/**
 * 面板 id 每面板唯一，关闭后条目只是残留（每条几十字节）。无面板销毁钩子可挂，
 * 故做上限淘汰避免长会话无界增长。
 *
 * 淘汰必须是 **LRU**：`Map.set` 对已存在 key 不刷新插入序，若直接按插入序淘汰，
 * 长期活跃面板会被后开的 64 个面板挤掉，导致风险提示静默解除。写入路径统一先
 * `delete` 再 `set` 把访问序做成插入序。
 */
const MAX_TRACKED_PANELS = 64;

const semanticsByPanel = new Map<string, SemanticsEntry>();

function touch(panelId: string, entry: SemanticsEntry): void {
  semanticsByPanel.delete(panelId);
  semanticsByPanel.set(panelId, entry);
  while (semanticsByPanel.size > MAX_TRACKED_PANELS) {
    const oldest = semanticsByPanel.keys().next();
    if (oldest.done) {
      return;
    }
    semanticsByPanel.delete(oldest.value);
  }
}

/**
 * 记录一次探针读数，返回该面板是否已经观察到过 `visible`（armed）。
 * 只有 armed 面板才允许把 `hidden` 当作输入聚焦风险。
 */
export function recordCursorVisibility(input: {
  activitySpawnedAt: number;
  agentId: AgentKind;
  panelId: string;
  visibility: TerminalCursorVisibility;
}): boolean {
  const { activitySpawnedAt, agentId, panelId, visibility } = input;
  const existing = semanticsByPanel.get(panelId);
  // 换 agent 或同 agent 开始新活动会话 → 旧观察结论作废。
  const armed =
    existing !== undefined &&
    existing.agentId === agentId &&
    existing.activitySpawnedAt === activitySpawnedAt
      ? existing.armed || visibility === "visible"
      : visibility === "visible";
  touch(panelId, {
    activitySpawnedAt,
    agentId,
    armed,
    last: visibility,
  });
  return armed;
}

/** 该面板是否已经观察到过 visible。 */
export function hasObservedVisibleCursor(input: {
  activitySpawnedAt: number;
  agentId: AgentKind;
  panelId: string;
}): boolean {
  const entry = semanticsByPanel.get(input.panelId);
  return (
    entry?.agentId === input.agentId &&
    entry.activitySpawnedAt === input.activitySpawnedAt &&
    entry.armed
  );
}

/**
 * 丢弃某面板的会话观察状态。
 *
 * 正确性不依赖销毁钩子：`activitySpawnedAt` 会隔离新会话；本方法用于已知关闭
 * 路径的主动回收，LRU 上限继续负责兜底。
 */
export function forgetCursorSemantics(panelId: string): void {
  semanticsByPanel.delete(panelId);
}

/** 诊断用快照（排障时回答「探针读到了什么、是否见过 visible」）。 */
export function describeCursorSemantics(
  panelId: string
): Readonly<SemanticsEntry> | undefined {
  return semanticsByPanel.get(panelId);
}

/** 测试专用：清空会话观察状态。 */
export function resetTuiCursorSemanticsForTests(): void {
  semanticsByPanel.clear();
}
