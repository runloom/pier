import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import { useEffect, useState } from "react";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

/**
 * TUI 输入聚焦恢复原语（cursor-visible 探针 + catalog 白名单恢复键）。
 *
 * 背景：部分 agent TUI（crush 等）有内部聚焦模型，输入框失焦时会静默
 * 丢弃 paste 与 Enter。现代 TUI 输入失焦即隐藏硬件光标（DECTCEM ?25l），
 * 因此 ghostty 的 cursor-visible 探针可作为「输入框是否聚焦」的事实信号。
 *
 * 安全边界：
 * - 只对 catalog 声明了 inputFocusKey 的 agent 做自动恢复（白名单，
 *   逐一验证过光标语义）；未声明的 agent 行为完全不变。
 * - 探针三态：unknown（surface 不存在/addon 未加载）一律按失败处理，
 *   禁止当作「失焦」发键。
 * - status === "waiting"（权限确认等 dialog）不恢复——那本就该人来处理。
 * - per-panel in-flight 互斥：并发触发（tab 激活 + ⌘⇧I）只发一次恢复键，
 *   防止 toggle 类按键被发两次反而切走焦点。
 *
 * 返回 true = 输入框已聚焦（原本聚焦 / 恢复成功 / agent 无需恢复）；
 * false = 未能确认聚焦（unknown / 恢复失败 / waiting 跳过）。
 */

/** 恢复键确认轮询：TUI 处理按键 → 发 ?25h → 模式位更新是异步回路。 */
const CONFIRM_POLL_INTERVAL_MS = 40;
const CONFIRM_TIMEOUT_MS = 400;

const inflight = new Map<string, Promise<boolean>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doEnsureTuiInputFocus(panelId: string): Promise<boolean> {
  const activity = useForegroundActivityStore.getState().activities[panelId];
  if (activity?.kind !== "agent") {
    return false;
  }
  // 权限确认 / 提问等等待态：输入目标是 dialog，不做自动恢复。
  if (activity.status === "waiting") {
    return false;
  }
  // busy（processing/tool）态不探不注：各家运行态光标语义不一，避免向
  // 正在运行的会话注入恢复键。放行（返回 true）但不做任何动作。
  if (activity.status === "processing" || activity.status === "tool") {
    return true;
  }
  const entry = AGENT_CATALOG.find(
    (candidate) => candidate.id === activity.agentId
  );
  const focusKey = entry?.inputFocusKey;
  if (!focusKey) {
    // 未声明恢复键的 agent：假定输入恒聚焦（现状行为不变）。
    return true;
  }

  const visibility = await window.pier.terminal.cursorVisible(panelId);
  if (visibility === "visible") {
    return true;
  }
  if (visibility === "unknown") {
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
// 发送阻断态（增强输入 UI：禁用发送 + 常驻原因）
// ---------------------------------------------------------------------------

export type TuiSendBlockReason = "unfocused" | "waiting";

/** 阻断态探针轮询间隔（仅增强输入挂载期间运行）。 */
const SEND_BLOCK_POLL_INTERVAL_MS = 500;

/**
 * 增强输入的发送阻断原因（null = 可发送）。
 *
 * - `waiting`：activity store 响应式（权限确认等 dialog 态），全 agent 生效。
 * - `unfocused`：cursor-visible 探针轮询，TUI 输入框失焦（可输入但焦点不在
 *   输入区）。busy（processing/tool）态不探——各家运行态光标语义不一，
 *   避免误伤排队输入。unknown 一律不阻断（禁止把「读不到」当「失焦」）。
 */
export function useTuiSendBlock(
  panelId: string,
  isPanelActive: boolean
): TuiSendBlockReason | null {
  const kind = useForegroundActivityStore(
    (state) => state.activities[panelId]?.kind
  );
  const agentId = useForegroundActivityStore((state) => {
    const activity = state.activities[panelId];
    return activity?.kind === "agent" ? activity.agentId : undefined;
  });
  const status = useForegroundActivityStore((state) => {
    const activity = state.activities[panelId];
    return activity?.kind === "agent" ? activity.status : undefined;
  });
  const isAgent = kind === "agent";
  // unfocused 阻断与恢复原语同口径：只对声明了 inputFocusKey 的 agent 启用
  // 探针——未验证光标语义的 agent 不探不阻断，避免假阴性把可用会话锁死。
  // 面板在后台 tab 时停轮询（dockview 非激活 tab 保持挂载），激活后重启。
  const probeable =
    isAgent &&
    isPanelActive &&
    agentId !== undefined &&
    AGENT_CATALOG.find((candidate) => candidate.id === agentId)
      ?.inputFocusKey !== undefined &&
    status !== "waiting" &&
    status !== "processing" &&
    status !== "tool";
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
    // 首轮立即探（打开后尽快呈现阻断态）；act 警告为存量测试噪音，不为此
    // 牺牲阻断呈现时延。
    poll().catch(() => undefined);
    const timer = window.setInterval(() => {
      poll().catch(() => undefined);
    }, SEND_BLOCK_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [panelId, probeable]);

  if (!isAgent) {
    return null;
  }
  if (status === "waiting") {
    return "waiting";
  }
  if (!probeable) {
    return null;
  }
  return probeHidden ? "unfocused" : null;
}
