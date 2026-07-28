import { useEffect, useState } from "react";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { agentUsesCursorProbe, probeCursor } from "./tui-input-focus.ts";

/** 当前唯一风险：TUI 输入光标不可见，输入框可能没有聚焦。 */
export type TuiInputFocusRisk = "unfocused";

/** 风险探针轮询间隔（仅增强输入挂载期间运行）。 */
const INPUT_FOCUS_RISK_POLL_INTERVAL_MS = 500;

/** 点终端后立刻重探：用户点输入区复原焦点，不必干等 500ms 轮询。 */
type CursorProbeListener = (panelId: string) => void;
const cursorProbeListeners = new Set<CursorProbeListener>();

/**
 * 请求对指定面板立刻刷新输入聚焦探针（例如用户点了终端内容区）。
 * 鼠标已把 TUI 焦点点回输入框时，用于尽快解除风险提示。
 */
export function requestComposerCursorProbe(panelId: string): void {
  for (const listener of cursorProbeListeners) {
    listener(panelId);
  }
}

/** 测试专用：清空探针订阅。 */
export function resetComposerCursorProbeListenersForTests(): void {
  cursorProbeListeners.clear();
}

/**
 * 增强输入风险提示（null = 未发现风险）。
 *
 * 与 `ensureTuiInputFocus` 共用判定不变量：先验（catalog 声明）+ 会话观察
 * （本会话见过 visible）都满足时，`hidden` 才提示；`unknown` 与未观察到 visible
 * 一律放行。
 * 后台 tab 停轮询；点终端会 `requestComposerCursorProbe` 立刻再探。
 *
 * 用户复原路径：点终端里的输入框 → TUI 聚焦 → 探针 visible → 提示解除；
 * 或在发送时选择「仍然发送」（见 `useTerminalComposerSend`）。
 */
export function useTuiInputFocusRisk(
  panelId: string,
  isPanelActive: boolean
): TuiInputFocusRisk | null {
  // 选派生值而非 activity 对象：避免每次活动快照更新都重渲染。
  const probeAgentId = useForegroundActivityStore((state) => {
    const activity = state.activities[panelId];
    if (activity?.kind !== "agent" || !agentUsesCursorProbe(activity.agentId)) {
      return;
    }
    return activity.agentId;
  });
  const probeActivitySpawnedAt = useForegroundActivityStore((state) => {
    const activity = state.activities[panelId];
    if (activity?.kind !== "agent" || !agentUsesCursorProbe(activity.agentId)) {
      return;
    }
    return activity.spawnedAt;
  });
  const probeable =
    probeAgentId !== undefined &&
    probeActivitySpawnedAt !== undefined &&
    isPanelActive;
  const [probeHidden, setProbeHidden] = useState(false);

  useEffect(() => {
    // `probeable` 已含同一判定，这里重复 undefined 检查只为收窄类型。
    if (
      !probeable ||
      probeAgentId === undefined ||
      probeActivitySpawnedAt === undefined
    ) {
      setProbeHidden(false);
      return;
    }
    // 换面板活动会话时先清掉旧提示，不能把上一进程的风险状态带进来。
    setProbeHidden(false);
    let cancelled = false;
    const poll = async () => {
      try {
        const { armed, visibility } = await probeCursor(
          panelId,
          probeAgentId,
          probeActivitySpawnedAt
        );
        if (!cancelled) {
          // 未观察到 visible 的会话不提示：语义可能已被上游改版翻转。
          setProbeHidden(armed && visibility === "hidden");
        }
      } catch {
        if (!cancelled) {
          setProbeHidden(false);
        }
      }
    };
    poll().catch(() => undefined);
    const timer = window.setInterval(() => {
      poll().catch(() => undefined);
    }, INPUT_FOCUS_RISK_POLL_INTERVAL_MS);

    const onDemand: CursorProbeListener = (targetPanelId) => {
      if (targetPanelId === panelId) {
        poll().catch(() => undefined);
      }
    };
    cursorProbeListeners.add(onDemand);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      cursorProbeListeners.delete(onDemand);
    };
  }, [panelId, probeable, probeActivitySpawnedAt, probeAgentId]);

  if (!probeable) {
    return null;
  }
  return probeHidden ? "unfocused" : null;
}
