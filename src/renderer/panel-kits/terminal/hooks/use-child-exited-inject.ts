import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TerminalChildExitedEvent } from "@shared/contracts/ghostty-host-copy.ts";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  exitPresentationFromParams,
  formatGhosttyChildExitedBufferText,
  inferTerminalExitRole,
  resolveChildExitedActivityKind,
} from "@/panel-kits/terminal/format-ghostty-host-copy.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  terminalEndStateForPanel,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const SILENT_INJECT_ERRORS = new Set([
  "terminal closing",
  "terminal process changed",
  "window not found",
]);

function isSilentInjectFailure(error: unknown): boolean {
  if (typeof error === "string") return SILENT_INJECT_ERRORS.has(error);
  return error instanceof Error && SILENT_INJECT_ERRORS.has(error.message);
}

function isPanelStillOpen(panelId: string): boolean {
  const api = useWorkspaceStore.getState().api;
  return !api || api.panels.some((panel) => panel.id === panelId);
}

/**
 * End-state process-exit path:
 * 1. Ghostty SHOW_CHILD_EXITED → host returns true (no English printString)
 * 2. Event → renderer
 * 3. Upsert TerminalEndState（agent / task / taskOutput）
 * 4. Renderer resolves fully localized text
 * 5. injectDisplayText once on success only（bufferInjected 门闩）
 */
export function useTerminalChildExitedInject(
  panelId: string,
  params: unknown,
  options?: {
    agentIdHint?: AgentKind | undefined;
    titleHint?: string | null | undefined;
  }
): void {
  const t = useT();
  const activityKind = useForegroundActivityStore(
    (s) => s.activities[panelId]?.kind
  );
  const activityAgentId = useForegroundActivityStore((s) => {
    const a = s.activities[panelId];
    return a?.kind === "agent" ? a.agentId : undefined;
  });
  const latchedKindRef = useRef<string | undefined>(undefined);
  const latchedAgentIdRef = useRef<AgentKind | undefined>(undefined);
  const activityKindRef = useRef(activityKind);
  activityKindRef.current = activityKind;
  const agentIdHintRef = useRef(options?.agentIdHint);
  agentIdHintRef.current = options?.agentIdHint;
  const titleHintRef = useRef(options?.titleHint);
  titleHintRef.current = options?.titleHint;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (activityKind === "agent" || activityKind === "task") {
      latchedKindRef.current = activityKind;
    }
    if (activityAgentId) {
      latchedAgentIdRef.current = activityAgentId;
    }
  }, [activityAgentId, activityKind]);

  useEffect(() => {
    latchedKindRef.current = undefined;
    latchedAgentIdRef.current = undefined;

    async function handleChildExited(
      event: TerminalChildExitedEvent
    ): Promise<void> {
      if (event.panelId !== panelId) {
        return;
      }
      const floor = useTerminalEndStateStore.getState().generations[panelId];
      if (floor !== undefined && (event.generation ?? 0) < floor) return;
      const live = useForegroundActivityStore.getState().activities[panelId];
      const agentId: AgentKind | undefined =
        (live?.kind === "agent" ? live.agentId : undefined) ??
        latchedAgentIdRef.current ??
        agentIdHintRef.current;
      const kind = resolveChildExitedActivityKind({
        agentId,
        current: activityKindRef.current,
        latched: latchedKindRef.current,
      });

      const role = inferTerminalExitRole({
        activityKind: kind,
        exitPresentation: exitPresentationFromParams(params),
        params,
      });

      if (role === "agent" && agentId) {
        useTerminalEndStateStore.getState().upsertAgentEnd({
          agentId,
          exitCode: event.exitCode,
          generation: event.generation,
          lifecycleId: event.lifecycleId,
          endReason: event.endReason,
          panelId,
          runtimeMs: event.runtimeMs,
          title: titleHintRef.current,
        });
      } else if (role === "task" || role === "taskOutput") {
        useTerminalEndStateStore.getState().upsertTaskEnd({
          exitCode: event.exitCode,
          generation: event.generation,
          lifecycleId: event.lifecycleId,
          endReason: event.endReason,
          panelId,
          role,
          runtimeMs: event.runtimeMs,
          title: titleHintRef.current,
        });
      }

      const end = terminalEndStateForPanel(panelId);
      if (end?.bufferInjected) {
        return;
      }

      const text = formatGhosttyChildExitedBufferText({
        activityKind: kind,
        endReason: event.endReason,
        exitCode: event.exitCode,
        params,
        runtimeMs: event.runtimeMs,
      });
      try {
        const result = await window.pier.terminal.injectDisplayText(
          panelId,
          text,
          event.lifecycleId
        );
        if (result.ok) {
          useTerminalEndStateStore
            .getState()
            .markBufferInjected(panelId, event.generation);
          return;
        }
        if (
          useTerminalEndStateStore.getState().generations[panelId] !== floor &&
          event.generation !==
            useTerminalEndStateStore.getState().generations[panelId]
        )
          return;
        console.error(
          "[terminal] injectDisplayText failed:",
          result.error ?? "unknown"
        );
        if (isSilentInjectFailure(result.error)) return;
      } catch (err) {
        console.error("[terminal] injectDisplayText failed:", err);
        if (isSilentInjectFailure(err)) return;
      }
      if (
        (role === "agent" || role === "task" || role === "taskOutput") &&
        isPanelStillOpen(panelId)
      ) {
        toast.error(tRef.current("terminal.ghosttyHost.injectExitFailed"));
      }
    }

    return window.pier.terminal.onChildExited((event) => {
      handleChildExited(event).catch((err) => {
        console.error("[terminal] child-exited handler failed:", err);
      });
    });
  }, [panelId, params]);
}
