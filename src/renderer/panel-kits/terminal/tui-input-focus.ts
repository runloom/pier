import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import { useEffect, useState } from "react";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

/**
 * TUI 输入聚焦：cursor-visible 探针 +（可选）catalog 恢复键。
 *
 * 发送门禁与自动恢复键职责拆分：
 * - **门禁**：凡 agent 面板都探针；光标 hidden → 未聚焦输入框 → 硬拦发送。
 *   不认 FA waiting；busy 也探（思考中无光标时同样不可发）。
 * - **恢复键**：仅 catalog 声明了 `inputFocusKey` 的 agent（crush=Tab 等）
 *   在 ensure 路径注入；未声明的只探针、不注键。
 * - unknown 不当作失焦（不拦、不注键当失败）。
 */

/** 恢复键确认轮询：TUI 处理按键 → 发 ?25h → 模式位更新是异步回路。 */
const CONFIRM_POLL_INTERVAL_MS = 40;
const CONFIRM_TIMEOUT_MS = 400;

const inflight = new Map<string, Promise<boolean>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function agentInputFocusKey(agentId: string | undefined) {
  if (agentId === undefined) {
    return;
  }
  return AGENT_CATALOG.find((candidate) => candidate.id === agentId)
    ?.inputFocusKey;
}

async function doEnsureTuiInputFocus(panelId: string): Promise<boolean> {
  const activity = useForegroundActivityStore.getState().activities[panelId];
  if (activity?.kind !== "agent") {
    return false;
  }

  const visibility = await window.pier.terminal.cursorVisible(panelId);
  if (visibility === "visible") {
    return true;
  }
  if (visibility === "unknown") {
    // 读不到：不把「读不到」当失焦，也不注键。
    return false;
  }

  // hidden：仅白名单可确定性恢复；其余 agent 无恢复键 → 明确失败。
  const focusKey = agentInputFocusKey(activity.agentId);
  if (!focusKey) {
    return false;
  }

  const sendResult = await window.pier.terminal.sendKeyPress({
    keycode: focusKey.keycode,
    panelId,
    ...(focusKey.mods === undefined ? {} : { mods: focusKey.mods }),
    ...(focusKey.text === undefined ? {} : { text: focusKey.text }),
  });
  if (!sendResult.ok) {
    return false;
  }

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CONFIRM_POLL_INTERVAL_MS);
    const confirmed = await window.pier.terminal.cursorVisible(panelId);
    if (confirmed === "visible") {
      return true;
    }
    if (confirmed === "unknown") {
      return false;
    }
  }
  return false;
}

export function ensureTuiInputFocus(panelId: string): Promise<boolean> {
  const existing = inflight.get(panelId);
  if (existing) {
    return existing;
  }
  const pending = doEnsureTuiInputFocus(panelId).finally(() => {
    if (inflight.get(panelId) === pending) {
      inflight.delete(panelId);
    }
  });
  inflight.set(panelId, pending);
  return pending;
}

/** 测试专用：清空 in-flight 状态。 */
export function resetTuiInputFocusForTests(): void {
  inflight.clear();
}

// ---------------------------------------------------------------------------
// 发送阻断态（增强输入 UI：仅光标探针，全 agent）
// ---------------------------------------------------------------------------

/** 唯一阻断原因：TUI 输入光标不可见（未聚焦输入框）。 */
export type TuiSendBlockReason = "unfocused";

/** 阻断态探针轮询间隔（仅增强输入挂载期间运行）。 */
const SEND_BLOCK_POLL_INTERVAL_MS = 500;

/** 点终端后立刻重探：用户点输入区复原焦点，不必干等 500ms 轮询。 */
type CursorProbeListener = (panelId: string) => void;
const cursorProbeListeners = new Set<CursorProbeListener>();

/**
 * 请求对指定面板立刻刷新发送门禁探针（例如用户点了终端内容区）。
 * 鼠标已把 TUI 焦点点回输入框时，用于尽快解除「未聚焦输入框」。
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
 * 增强输入发送阻断原因（null = 可发送）。
 *
 * **只**认 cursor-visible：
 * - hidden → `unfocused`（硬禁用发送 + 提示 + 截空 Enter）
 * - unknown → 不阻断（禁止把「读不到」当「失焦」）
 * - 全 agent、含 busy（思考中无光标也应拦）
 * - 后台 tab 停轮询；点终端会 `requestComposerCursorProbe` 立刻再探
 *
 * 用户复原路径：点终端里的输入框 → TUI 聚焦 → 探针 visible → 可发送。
 */
export function useTuiSendBlock(
  panelId: string,
  isPanelActive: boolean
): TuiSendBlockReason | null {
  const kind = useForegroundActivityStore(
    (state) => state.activities[panelId]?.kind
  );
  const isAgent = kind === "agent";
  const probeable = isAgent && isPanelActive;
  const [probeHidden, setProbeHidden] = useState(false);

  useEffect(() => {
    if (!probeable) {
      setProbeHidden(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const visibility = await window.pier.terminal.cursorVisible(panelId);
        if (!cancelled) {
          setProbeHidden(visibility === "hidden");
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
    }, SEND_BLOCK_POLL_INTERVAL_MS);

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
  }, [panelId, probeable]);

  if (!probeable) {
    return null;
  }
  return probeHidden ? "unfocused" : null;
}
