import { useRef } from "react";
import { toast } from "sonner";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { reportComposerSendFailure } from "./terminal-composer-helpers.ts";
import {
  ensureTuiInputFocus,
  type TuiSendBlockReason,
} from "./tui-input-focus.ts";

/**
 * 增强输入发送编排（从 terminal-composer.tsx 抽出，守 file-size 硬顶）。
 *
 * - 阻断态（sendBlock）与 in-flight（sendingRef）双重闸门：按钮禁用与回车
 *   同口径；settle 窗口内双击/键重复不得触发第二次提交（防两条消息揉成
 *   一团，main 侧另有按 panel 的发送队列兜底）。
 * - 发送前最终确认：UI 阻断态是轮询值（≤500ms 陈旧），crush 等失焦可恢复
 *   的 agent 在此透传恢复键后送达；确认失败且 UI 无法自解释
 *   （sendBlock 为 null，如探针 unknown）时必须反馈，禁止静默失败。
 */
export function useTerminalComposerSend(opts: {
  buildPayloadOrReport: (value: string) => string | null;
  disabled: boolean;
  onSent: () => void;
  panelId: string;
  sendBlock: TuiSendBlockReason | null;
  t: (key: string) => string;
  value: string;
}): { send: () => void } {
  const {
    buildPayloadOrReport,
    disabled,
    onSent,
    panelId,
    sendBlock,
    t,
    value,
  } = opts;
  /** in-flight 发送守卫：settle 窗口内双击/键重复不得触发第二次提交。 */
  const sendingRef = useRef(false);

  const send = () => {
    if (disabled || sendBlock !== null || sendingRef.current) {
      return;
    }
    const payload = buildPayloadOrReport(value);
    if (payload == null) {
      return;
    }
    sendingRef.current = true;
    (async () => {
      const activity =
        useForegroundActivityStore.getState().activities[panelId];
      if (activity?.kind === "agent") {
        const ready = await ensureTuiInputFocus(panelId).catch(() => false);
        if (!ready) {
          if (sendBlock === null) {
            toast.error(t("terminal.composer.sendStateUnknown"));
          }
          return;
        }
      }
      const result = await window.pier.terminal.sendText({
        panelId,
        submit: true,
        text: payload,
      });
      if (result.ok || result.textDelivered) {
        onSent();
        if (!result.ok) {
          reportComposerSendFailure(t, result.error ?? "");
        }
        return;
      }
      reportComposerSendFailure(t, result.error ?? "");
    })()
      .catch((err: unknown) => {
        reportComposerSendFailure(
          t,
          err instanceof Error ? err.message : String(err)
        );
      })
      .finally(() => {
        sendingRef.current = false;
      });
  };

  return { send };
}
