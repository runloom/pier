import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import { LayoutDashboard } from "lucide-react";
import { BOARD_PANEL_ID, OPEN_BOARD_COMMAND_ID } from "../shared/constants.ts";
import { createTaskBoardPanel } from "./board-panel.tsx";
import { orchestrateStartWork, type StartWorkClaim } from "./orchestrate.ts";
import rendererStyles from "./styles.css?inline";

function isStartWorkClaim(value: unknown): value is StartWorkClaim {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.itemKey === "string" && typeof record.number === "number"
  );
}

function claimIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.claimId === "string" && record.claimId.length > 0
    ? record.claimId
    : null;
}

export const plugin: ExternalRendererPluginModule = {
  icon: LayoutDashboard,
  id: "pier.tasks",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.tasks";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposePanel = context.panels.register({
      component: createTaskBoardPanel(context),
      icon: LayoutDashboard,
      id: BOARD_PANEL_ID,
      title: () =>
        context.i18n.t("pier.tasks.connection.title", "Task tracker"),
    });
    const disposeOpenBoard = context.actions.register({
      category: "panel",
      id: OPEN_BOARD_COMMAND_ID,
      invoke: (invocation) => {
        context.panels.open(BOARD_PANEL_ID, {
          ...(invocation?.sourcePanelContext
            ? { sourcePanelContext: invocation.sourcePanelContext }
            : {}),
          ...(invocation?.sourcePanelGroupId
            ? { targetGroupId: invocation.sourcePanelGroupId }
            : {}),
        });
      },
      surfaces: ["command-palette", "create-menu"],
      title: () =>
        context.i18n.t("pier.tasks.connection.title", "Task tracker"),
    });
    // 插件事件广播到所有窗口；建树/删树/通知必须单窗执行。聚焦窗立即抢占，
    // 其余窗让 250ms 再抢（无聚焦窗时兜底），main 侧先到先得。
    const claimEvent = async (payload: unknown): Promise<boolean> => {
      const claimId = claimIdOf(payload);
      if (!claimId) {
        return document.hasFocus();
      }
      if (!document.hasFocus()) {
        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });
      }
      try {
        const result = await context.rpc.invoke<{ granted?: boolean }>(
          "work.claim",
          { claimId }
        );
        return result?.granted === true;
      } catch {
        return false;
      }
    };

    const disposeFocus = () => {
      const onFocus = () => {
        context.rpc
          .invoke("poller.setFocused", { focused: true })
          .catch(() => undefined);
      };
      const onBlur = () => {
        context.rpc
          .invoke("poller.setFocused", { focused: false })
          .catch(() => undefined);
      };
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
      };
    };
    const stopFocus = disposeFocus();

    const stopOrchestrate = context.rpc.on("work.orchestrate", (payload) => {
      if (!isStartWorkClaim(payload)) {
        return;
      }
      claimEvent(payload)
        .then((granted) => {
          if (!granted) {
            return;
          }
          return orchestrateStartWork(
            {
              check: (request) => context.worktrees.check(request),
              create: (request) => context.worktrees.create(request),
              openTerminal: (request) =>
                context.worktrees.openTerminal(request),
              recordOverlay: (overlay) =>
                context.rpc.invoke("overlay.record", overlay),
              remove: (request) => context.worktrees.remove(request),
            },
            payload
          ).then(() => undefined);
        })
        .catch((error: unknown) => {
          context.notifications.error(
            error instanceof Error ? error.message : String(error)
          );
        });
    });

    const stopUnlocked = context.rpc.on(
      "board.unlocked",
      (payload: { kind?: string; keys?: readonly string[] }) => {
        claimEvent(payload)
          .then((granted) => {
            if (!granted) {
              return;
            }
            const keys = payload.keys?.join(", ") ?? "";
            const title =
              payload.kind === "pr-merged"
                ? context.i18n.t(
                    "pier.tasks.notify.prMerged",
                    "A linked pull request merged"
                  )
                : context.i18n.t(
                    "pier.tasks.notify.newlyReady",
                    "A blocked task is ready"
                  );
            context.notifications.info(keys ? `${title}: ${keys}` : title, {
              systemEvent: true,
            });
          })
          .catch(() => undefined);
      }
    );

    const stopPrune = context.rpc.on(
      "work.prune",
      (payload: { worktreePath?: string }) => {
        const worktreePath = payload.worktreePath;
        if (!worktreePath) {
          return;
        }
        claimEvent(payload)
          .then((granted) => {
            if (!granted) {
              return;
            }
            return context.worktrees
              .remove({ path: worktreePath })
              .then(() => undefined);
          })
          .catch((error: unknown) => {
            context.notifications.error(
              error instanceof Error ? error.message : String(error)
            );
          });
      }
    );

    return () => {
      stopPrune();
      stopUnlocked();
      stopOrchestrate();
      stopFocus();
      disposeOpenBoard();
      disposePanel();
      styleElement.remove();
    };
  },
};
