import i18next from "i18next";
import { handleNewAgent } from "@/lib/actions/new-agent-action.ts";
import { enrichAgentIndexEntriesWithLocalFa } from "@/lib/agent-runtime/agent-index-display-status.ts";
import {
  AGENT_INDEX_NEW_ID,
  buildAgentIndexQuickPick,
} from "@/lib/agent-runtime/agent-index-quickpick.ts";
import { AgentIndexQuickPickRow } from "@/lib/agent-runtime/agent-index-quickpick-row.tsx";
import { invokeAgentRuntimeFocus } from "@/lib/agent-runtime/focus-feedback.ts";
import { preferredAgentIndexSortOptions } from "@/lib/agent-runtime/preferred-sort-options.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type { QuickPick } from "@/lib/command-palette/types.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

function buildQuickPickSession(
  options: { limit?: number } | undefined,
  onDismiss: () => void
): QuickPick {
  const entries = enrichAgentIndexEntriesWithLocalFa(
    useAgentRuntimeIndexStore.getState().entries,
    useForegroundActivityStore.getState().activities
  );
  const sortOptions = preferredAgentIndexSortOptions();
  const model = buildAgentIndexQuickPick(entries, {
    emptyAction: "new-agent",
    now: Date.now(),
    ...sortOptions,
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  });

  return {
    title: i18next.t("agents.quickPick.title"),
    placeholder: i18next.t("agents.quickPick.placeholder"),
    renderItem: (item) => <AgentIndexQuickPickRow item={item} />,
    ...(model.sections
      ? { sections: model.sections }
      : { items: model.items ?? [] }),
    onDismiss,
    onAccept: async (item) => {
      if (item.id === AGENT_INDEX_NEW_ID) {
        await handleNewAgent();
        return;
      }
      if (item.disabled) {
        return;
      }
      const entry =
        model.entryByItemId.get(item.id) ??
        useAgentRuntimeIndexStore
          .getState()
          .entries.find((candidate) => candidate.agentRef === item.id);
      if (!entry) {
        return;
      }
      await invokeAgentRuntimeFocus(() =>
        window.pier.agentRuntimeIndex.focus(entry.agentRef)
      );
    },
  };
}

function isActiveAgentIndexSession(requestId: number): boolean {
  const state = useCommandPaletteController.getState();
  return (
    state.open && state.mode === "quick-pick" && state.requestId === requestId
  );
}

/**
 * 打开本机 Agent Index QuickPick（标题栏与命令面板共用）。
 * 先订阅再 list（避免竞态丢推送）；打开期间 Index + 本窗 FA 任一变化即
 * replaceQuickPick，使分组与行文案跟终端状态同源。
 */
export async function openAgentIndexQuickPick(options?: {
  limit?: number;
}): Promise<void> {
  let unsubscribe = (): void => undefined;
  const onDismiss = (): void => {
    unsubscribe();
  };

  // 先占位打开并挂订阅，再 list——对齐 Index bridge「订阅在先」约定。
  useCommandPaletteController
    .getState()
    .openQuickPick(buildQuickPickSession(options, onDismiss));
  const requestId = useCommandPaletteController.getState().requestId;

  const refresh = (): void => {
    if (!isActiveAgentIndexSession(requestId)) {
      return;
    }
    useCommandPaletteController
      .getState()
      .replaceQuickPick(buildQuickPickSession(options, onDismiss));
  };

  const unsubIndex = useAgentRuntimeIndexStore.subscribe(refresh);
  const unsubFa = useForegroundActivityStore.subscribe(refresh);
  unsubscribe = () => {
    unsubIndex();
    unsubFa();
  };

  try {
    const snapshot = await window.pier.agentRuntimeIndex.list();
    useAgentRuntimeIndexStore.getState().applySnapshot(snapshot);
    refresh();
  } catch (err) {
    unsubscribe();
    useCommandPaletteController.getState().close();
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: i18next.t("agents.indexListFailed"),
    });
  }
}
