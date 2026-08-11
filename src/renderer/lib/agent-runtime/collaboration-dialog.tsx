/**
 * W5-S1：持久智能体协作 surface（content dialog）。
 * 数据：Runtime Index + FA + NCS 注意力指针；无 one-shot 回复墙。
 */
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import i18next from "i18next";
import { useMemo, useState } from "react";
import { ContentDialogFooterActions } from "@/components/common/dialogs/footer-actions.tsx";
import { useContentDialogFooter } from "@/components/common/dialogs/use-footer.ts";
import {
  buildCollaborationViewModel,
  type CollaborationSessionVm,
  type CollaborationViewModel,
} from "@/lib/agent-runtime/collab-view-model.ts";
import { currentElectronWindowId } from "@/lib/agent-runtime/current-window-id.ts";
import { reportAgentRuntimeFocusResult } from "@/lib/agent-runtime/focus-feedback.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";

const COLLAB_DIALOG_ID = "agent-collaboration";

function t(key: string, params?: Record<string, string | number>): string {
  if (params === undefined) {
    return i18next.t(key);
  }
  return i18next.t(key, params);
}

function SessionCard({
  selected,
  session,
  onSelect,
}: {
  onSelect: (agentRef: string) => void;
  selected: boolean;
  session: CollaborationSessionVm;
}) {
  return (
    <Item
      asChild
      className={cn("min-w-0", selected && "ring-1 ring-ring/40")}
      data-testid={`collab-session-${session.panelId}`}
      size="xs"
      variant={selected ? "outline" : "muted"}
    >
      <button
        aria-pressed={selected}
        className="w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => {
          onSelect(session.agentRef);
        }}
        type="button"
      >
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{session.title}</ItemTitle>
          <ItemDescription className="truncate">
            {session.agentId}
          </ItemDescription>
          <div className="grid gap-0.5 text-muted-foreground text-xs">
            <span className="truncate">
              {t(session.locationKey, session.locationParams)}
            </span>
            {(session.worktreeKey || session.cwd) && (
              <span className="truncate">
                {session.worktreeKey ?? session.cwd}
              </span>
            )}
          </div>
        </ItemContent>
        <ItemActions>
          <span className="text-muted-foreground text-xs">
            {t(session.statusKey)}
          </span>
        </ItemActions>
      </button>
    </Item>
  );
}

async function focusAgentAndMaybeClose(
  agentRef: string,
  closeOnOk: (() => void) | null
): Promise<void> {
  try {
    const result = await window.pier.agentRuntimeIndex.focus(agentRef);
    reportAgentRuntimeFocusResult(result);
    if (result.status === "ok") {
      closeOnOk?.();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportAgentRuntimeFocusResult({ status: "error", message });
  }
}

function CollaborationBody({
  close,
  setFooter,
  initialSelectedRef,
}: AppContentDialogRenderProps & {
  initialSelectedRef?: string | null;
}) {
  const entries = useAgentRuntimeIndexStore((s) => s.entries);
  const activityRecord = useForegroundActivityStore((s) => s.activities);
  const notifications = useNotificationCenterStore((s) => s.items);
  const [selectedAgentRef, setSelectedAgentRef] = useState<string | null>(
    initialSelectedRef ?? null
  );
  const windowId = currentElectronWindowId() ?? null;
  // store is panelId→activity Record; VM expects array for .find
  const activities = useMemo(
    () => Object.values(activityRecord),
    [activityRecord]
  );

  const vm: CollaborationViewModel = useMemo(
    () =>
      buildCollaborationViewModel({
        entries,
        activities,
        notifications,
        currentWindowId: windowId,
        selectedAgentRef,
      }),
    [activities, entries, notifications, selectedAgentRef, windowId]
  );

  const footer = useMemo(
    () => (
      <ContentDialogFooterActions
        cancelLabel={t("dialog.cancel", { defaultValue: "Cancel" })}
        confirmLabel={
          vm.selected
            ? t("agents.collab.focusSelected")
            : t("dialog.close", { defaultValue: "Close" })
        }
        onCancel={() => {
          close(null);
        }}
        onConfirm={() => {
          if (!vm.selected) {
            close(null);
            return;
          }
          focusAgentAndMaybeClose(vm.selected.agentRef, () => {
            close(true);
          }).catch(() => undefined);
        }}
      />
    ),
    [close, vm.selected]
  );
  useContentDialogFooter(setFooter, footer);

  if (vm.empty) {
    return (
      <div className="flex flex-col gap-3 p-1" data-testid="collab-empty">
        <p className="text-muted-foreground text-sm">
          {t("agents.collab.empty")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("agents.collab.emptyNext")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4" data-testid="collab-body">
      <p className="text-muted-foreground text-xs">
        {t(vm.metaKey, vm.metaParams)}
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(vm.contentBoundaryKey)}
      </p>

      {vm.attention ? (
        <Alert data-testid="collab-attention" variant="warning">
          <AlertTitle>{t(vm.attention.titleKey)}</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {vm.attention.reason
              ? `${vm.attention.reason} ${t(vm.attention.nextKey)}`
              : t(vm.attention.nextKey)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="font-medium text-sm">{t("agents.collab.selected")}</h3>
          {vm.selected ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="font-medium text-sm">{vm.selected.title}</div>
              <div className="grid gap-1 text-muted-foreground text-xs">
                <span>{t(vm.selected.statusKey)}</span>
                <span>
                  {t(vm.selected.locationKey, vm.selected.locationParams)}
                </span>
                {(vm.selected.worktreeKey || vm.selected.cwd) && (
                  <span className="break-all">
                    {vm.selected.worktreeKey ?? vm.selected.cwd}
                  </span>
                )}
              </div>
              {/* 主聚焦动作在 sticky footer（成功后关窗）；body 不重复主按钮 */}
            </div>
          ) : null}

          <h3 className="pt-2 font-medium text-sm">
            {t("agents.collab.facts")}
          </h3>
          <ItemGroup className="grid gap-2">
            {vm.facts.map((fact) => (
              <Item key={fact.factKey} size="xs" variant="muted">
                <ItemContent>
                  <ItemTitle>{t(fact.factKey)}</ItemTitle>
                  <ItemDescription>
                    {t(fact.sourceKey)}
                    {(() => {
                      if (fact.detailKey) {
                        return ` · ${t(fact.detailKey)}`;
                      }
                      if (fact.detail) {
                        return ` · ${fact.detail}`;
                      }
                      return "";
                    })()}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="font-medium text-sm">{t("agents.collab.sessions")}</h3>
          <ScrollArea className="max-h-72" viewportFade="vertical">
            <ItemGroup className="grid gap-2 pr-2">
              {vm.sessions.map((session) => (
                <SessionCard
                  key={session.agentRef}
                  onSelect={setSelectedAgentRef}
                  selected={vm.selected?.agentRef === session.agentRef}
                  session={session}
                />
              ))}
            </ItemGroup>
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}

/** 打开协作 surface；可选预选 agentRef。 */
export function openCollaborationView(options?: {
  selectedAgentRef?: string | null;
}): void {
  const initialSelectedRef = options?.selectedAgentRef ?? null;
  openAppContentDialog({
    id: COLLAB_DIALOG_ID,
    title: i18next.t("agents.collab.title"),
    description: i18next.t("agents.collab.subtitle"),
    size: "lg",
    content: (props) => (
      <CollaborationBody {...props} initialSelectedRef={initialSelectedRef} />
    ),
  });
}
