import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  flushTerminalDraft,
  useTerminalDraftStore,
  writeTerminalDraftText,
} from "@/stores/terminal-drafts.store.ts";
import {
  acquireComposerSend,
  commitComposerSend,
  isComposerSending,
  releaseComposerSend,
  subscribeComposerSession,
  type TerminalComposerSession,
} from "../composer/session.ts";
import { flushPendingComposerEdits } from "../composer-bridge.ts";
import { reportComposerSendFailure } from "../composer-helpers.ts";
import { ensureTuiInputFocus } from "../tui-input-focus.ts";

/**
 * Hold text-only pasteboard after PTY paste so Grok's async attachment-probe
 * gate does not see a leftover screenshot (matches main SUBMIT_ENTER settle).
 */
const AGENT_CLIPBOARD_SUPPRESS_HOLD_MS = 200;

/**
 * 增强输入发送编排（从 terminal-composer.tsx 抽出，守 file-size 硬顶）。
 *
 * - 光标轮询只负责提示；发送动作始终在这里实时确认，避免陈旧探针禁用功能。
 * - in-flight 守卫防止确认弹窗或终端发送期间重复提交。
 * - 发送前 ensureTuiInputFocus：仅对声明 `inputFocusProbe` 且本会话见过
 *   visible 的 agent 读探针，其中白名单可透传恢复键。未声明探针 / 读不到 /
 *   会话内证据不足一律放行。
 * - 恢复失败不再谎报「读不到状态」：提示输入框可能未聚焦，并给「仍然发送」
 *   逃生舱（草稿保留，用户可自行决定），避免探针误判时功能彻底不可用。
 * - agent 发送期间 suppress 系统剪贴板图，避免短 bracketed paste 被 Grok
 *   误挂成 `[Image #N]`（例如只输入「你好」）。
 * - 草稿从编辑器现场读取，避免 IME compositionend 尚未灌进 React state
 *   时把未提交的汉字漏掉或拆成 UTF-8 字节。
 */
export function useTerminalComposerSend(opts: {
  buildPayloadOrReport: (value: string) => string | null;
  disabled: boolean;
  getDraft: () => string;
  isComposing: () => boolean;
  onSent: () => void;
  session: TerminalComposerSession;
  t: (key: string) => string;
}): { send: () => void; sending: boolean } {
  const {
    buildPayloadOrReport,
    disabled,
    getDraft,
    isComposing,
    onSent,
    session,
    t,
  } = opts;
  const { panelId, signal } = session;
  const mountRef = useRef<{ session: TerminalComposerSession } | null>(null);
  useLayoutEffect(() => {
    const mount = { session };
    mountRef.current = mount;
    return () => {
      if (mountRef.current === mount) {
        mountRef.current = null;
      }
    };
  }, [session]);
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerSession(session, listener),
    [session]
  );
  const getSending = useCallback(() => isComposerSending(session), [session]);
  const sending = useSyncExternalStore(subscribe, getSending, getSending);

  const send = () => {
    if (
      disabled ||
      signal.aborted ||
      !mountRef.current ||
      isComposerSending(session) ||
      isComposing()
    ) {
      return;
    }
    flushPendingComposerEdits(session);
    if (signal.aborted || isComposerSending(session)) {
      return;
    }
    const draft = getDraft();
    const payload = buildPayloadOrReport(draft);
    if (payload == null) {
      return;
    }
    const lease = acquireComposerSend(session, draft);
    if (!lease) {
      return;
    }
    const mount = mountRef.current;
    (async () => {
      if (
        useTerminalDraftStore.getState().drafts[panelId]?.durable.status ===
        "unconfirmed"
      ) {
        const proceed = await showAppConfirm({
          title: t("terminal.composer.unconfirmedTitle"),
          body: t("terminal.composer.unconfirmedBody"),
          confirmLabel: t("terminal.composer.sendAgain"),
          intent: "default",
        });
        if (!proceed || signal.aborted) {
          return;
        }
      }
      writeTerminalDraftText(panelId, draft);
      await flushTerminalDraft(panelId);
      if (signal.aborted) {
        return;
      }
      const activity =
        useForegroundActivityStore.getState().activities[panelId];
      const isAgent = activity?.kind === "agent";
      if (isAgent) {
        const ready = await ensureTuiInputFocus(panelId).catch(() => false);
        if (signal.aborted) {
          return;
        }
        if (!ready) {
          // 探针提示风险：给用户原因和继续入口，而不是静默放弃。
          const proceed = await showAppConfirm({
            body: t("terminal.composer.blockedUnfocusedBody"),
            confirmLabel: t("terminal.composer.sendAnyway"),
            intent: "default",
            title: t("terminal.composer.blockedUnfocusedTitle"),
          });
          if (!proceed || signal.aborted) {
            return;
          }
        }
        await window.pier.clipboard.beginImageSuppress();
      }
      try {
        if (signal.aborted) {
          return;
        }
        const result = await window.pier.terminal.sendText({
          panelId,
          draftText: draft,
          submit: true,
          text: payload,
        });
        if (signal.aborted) {
          return;
        }

        if (result.ok) {
          if (
            commitComposerSend(session, lease) &&
            mount !== null &&
            mountRef.current === mount
          ) {
            onSent();
          }
          return;
        }
        let message = result.error ?? "";
        if (result.errorCode === "unconfirmed" || result.textDelivered)
          message = t("terminal.composer.unconfirmedHint");
        if (result.errorCode === "needs-input")
          message = t("terminal.composer.needsInput");
        reportComposerSendFailure(t, message);
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
        if (signal.aborted) {
          return;
        }
        reportComposerSendFailure(
          t,
          err instanceof Error ? err.message : String(err)
        );
      })
      .finally(() => {
        releaseComposerSend(session, lease);
        flushPendingComposerEdits(session);
      });
  };

  return { send, sending };
}
