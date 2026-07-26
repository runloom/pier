import { useRef } from "react";
import { toast } from "sonner";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { reportComposerSendFailure } from "./terminal-composer-helpers.ts";
import {
  ensureTuiInputFocus,
  type TuiSendBlockReason,
} from "./tui-input-focus.ts";

/**
 * Hold text-only pasteboard after PTY paste so Grok's async attachment-probe
 * gate does not see a leftover screenshot (matches main SUBMIT_ENTER settle).
 */
const AGENT_CLIPBOARD_SUPPRESS_HOLD_MS = 200;

/**
 * 增强输入发送编排（从 terminal-composer.tsx 抽出，守 file-size 硬顶）。
 *
 * - sendBlock（仅 unfocused / 光标探针）与 in-flight 双重闸门。
 * - 发送前 ensureTuiInputFocus：白名单 agent 可透传恢复键；确认失败 toast。
 * - agent 发送期间 suppress 系统剪贴板图，避免短 bracketed paste 被 Grok
 *   误挂成 `[Image #N]`（例如只输入「你好」）。
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
      const isAgent = activity?.kind === "agent";
      if (isAgent) {
        const ready = await ensureTuiInputFocus(panelId).catch(() => false);
        if (!ready) {
          toast.error(t("terminal.composer.sendStateUnknown"));
          return;
        }
        await window.pier.clipboard.beginImageSuppress();
      }
      try {
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
      } finally {
        if (isAgent) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, AGENT_CLIPBOARD_SUPPRESS_HOLD_MS);
          });
          await window.pier.clipboard.endImageSuppress();
        }
      }
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
