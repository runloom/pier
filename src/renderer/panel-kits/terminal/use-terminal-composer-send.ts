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
 * - sendBlock（仅 unfocused / 光标探针）与 in-flight 双重闸门。
 * - 发送前 ensureTuiInputFocus：白名单 agent 可透传恢复键；确认失败 toast。
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
          toast.error(t("terminal.composer.sendStateUnknown"));
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
