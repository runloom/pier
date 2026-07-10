import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import {
  GitBranchPlus,
  LayoutDashboard,
  Play,
  Plus,
  Terminal,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { openRunTaskQuickPick } from "@/lib/actions/run-actions.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const NEW_TERMINAL_ACTION_ID = "pier.panel.newTerminal";
const RUN_TASK_ACTION_ID = "pier.run.task";
const WORKTREE_CREATE_ACTION_ID = "pier.worktree.create";

function shortcutLabel(commandId: string): string | null {
  const binding = keybindingRegistry.getBindingsFor(commandId)[0];
  return binding ? formatChord(binding.chord) : null;
}

function resolveAvailableAgentIds({
  detectedIds,
  disabledAgentIds,
  rankedAgentIds,
}: {
  detectedIds: AgentKind[];
  disabledAgentIds: AgentKind[];
  rankedAgentIds: AgentKind[] | null;
}): AgentKind[] {
  const disabled = new Set(disabledAgentIds);
  const available = detectedIds.filter((id) => !disabled.has(id));
  if (!rankedAgentIds) {
    return available;
  }

  const availableSet = new Set(available);
  const seen = new Set<AgentKind>();
  const ordered: AgentKind[] = [];
  for (const id of [...rankedAgentIds, ...available]) {
    if (availableSet.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Tab 栏 add 按钮 — dockview leftHeaderActionsComponent 模式.
 *
 * 点击 "+" 弹出下拉菜单:
 *   1. 新终端 (在当前 group 内创建 terminal panel)
 *   2. 新任务 (打开任务 quick pick)
 *   3. --- 分隔线 ---
 *   4. 已检测到的 agent 列表 (点击创建对应 agent 终端)
 *
 * dockview header DOM 顺序: preActions → tabs → leftActions → void → rightActions.
 * leftHeaderActionsComponent 渲染在 tabs 之后 (tab 后), 用 direction:"within"
 * 把新 panel 作为当前 group 的新 tab 插入, 而非新建 group.
 */
export function AddPanelAction(props: IDockviewHeaderActionsProps) {
  const t = useT();
  const detectedIds = useAgentDetectStore((s) => s.detectedIds);
  const ensureDetected = useAgentDetectStore((s) => s.ensureDetected);
  const disabledAgentIds = useAgentPreferencesStore((s) => s.disabledAgentIds);
  const [rankedAgentIds, setRankedAgentIds] = useState<AgentKind[] | null>(
    null
  );
  useEffect(() => {
    const loadSelection = window.pier.agents.selection;
    if (typeof loadSelection !== "function") {
      return;
    }
    let disposed = false;
    loadSelection()
      .then((selection) => {
        if (!disposed) {
          setRankedAgentIds(selection.rankedIds);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);
  // 订阅 active panel descriptor 变化以便 New Worktree 菜单项 disabled 状态跟随 (值不使用,纯粹为重渲注册订阅)。
  usePanelDescriptorStore((s) =>
    s.activeId ? s.descriptors[s.activeId] : undefined
  );
  // 订阅 actionRegistry 版本变化:插件卸载/重装会替换 action, enabled()/handler 引用随之变化。
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );
  // 订阅 keybindingRegistry 版本变化:用户在设置里改快捷键后菜单提示要跟着刷新。
  useSyncExternalStore(
    (cb) => keybindingRegistry.subscribe(cb),
    () => keybindingRegistry.getVersion(),
    () => 0
  );

  // main 返回的排名只决定顺序；renderer 的实时探测与禁用快照决定当前可用性。
  // 刷新中新出现、尚未进入缓存排名的 agent 追加在已排名项之后。
  const enabledAgents = resolveAvailableAgentIds({
    detectedIds,
    disabledAgentIds,
    rankedAgentIds,
  });

  const worktreeCreateAction = actionRegistry.get(WORKTREE_CREATE_ACTION_ID);
  const worktreeCreateEnabled = Boolean(
    worktreeCreateAction && (worktreeCreateAction.enabled?.() ?? true)
  );

  const newTerminalShortcut = shortcutLabel(NEW_TERMINAL_ACTION_ID);
  const runTaskShortcut = shortcutLabel(RUN_TASK_ACTION_ID);
  const worktreeCreateShortcut = shortcutLabel(WORKTREE_CREATE_ACTION_ID);

  return (
    <div className="flex h-full items-center justify-center px-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            ensureDetected().catch(() => undefined);
            const loadSelection = window.pier.agents.selection;
            if (typeof loadSelection !== "function") {
              return;
            }
            loadSelection()
              .then((selection) => {
                setRankedAgentIds(selection.rankedIds);
              })
              .catch(() => {
                setRankedAgentIds(null);
              });
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("workspace.addPanelMenu.trigger")}
            className="bg-transparent"
            size="icon-xs"
            title={t("workspace.addPanelMenu.trigger")}
            type="button"
            variant="secondary"
          >
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[min(var(--radix-dropdown-menu-content-available-height),480px)] w-56"
          data-scrollbar="none"
        >
          <DropdownMenuItem
            onClick={() => {
              useWorkspaceStore.getState().addMissionControl({
                referenceGroup: props.group,
              });
            }}
          >
            <LayoutDashboard className="size-4" />
            <span>{t("workspace.addPanelMenu.newMissionControl")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              useWorkspaceStore.getState().addTerminal({
                referenceGroup: props.group,
              });
            }}
          >
            <Terminal className="size-4" />
            <span>{t("workspace.addPanelMenu.newTerminal")}</span>
            {newTerminalShortcut ? (
              <DropdownMenuShortcut>{newTerminalShortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              openRunTaskQuickPick().catch(() => undefined);
            }}
          >
            <Play className="size-4" />
            <span>{t("workspace.addPanelMenu.newTask")}</span>
            {runTaskShortcut ? (
              <DropdownMenuShortcut>{runTaskShortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!worktreeCreateEnabled}
            onClick={() => {
              const action = actionRegistry.get(WORKTREE_CREATE_ACTION_ID);
              if (!action) {
                return;
              }
              Promise.resolve(action.handler()).catch((err) => {
                console.error(
                  `[add-panel-action] action ${action.id} failed:`,
                  err
                );
              });
            }}
          >
            <GitBranchPlus className="size-4" />
            <span>{t("workspace.addPanelMenu.newWorktree")}</span>
            {worktreeCreateShortcut ? (
              <DropdownMenuShortcut>
                {worktreeCreateShortcut}
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {t("workspace.addPanelMenu.agentSection")}
          </DropdownMenuLabel>
          {enabledAgents.length > 0 ? (
            enabledAgents.map((agentId) => {
              const entry = getAgentCatalogEntry(agentId);
              return (
                <DropdownMenuItem
                  key={agentId}
                  onClick={async () => {
                    try {
                      const { launchId } =
                        await window.pier.agents.prepareLaunch(agentId);
                      if (!launchId) {
                        toast.error(
                          t("workspace.addPanelMenu.agentUnavailable")
                        );
                        return;
                      }
                      useWorkspaceStore.getState().addTerminal({
                        launchId,
                        referenceGroup: props.group,
                      });
                    } catch (err) {
                      await showAppAlert({
                        body: err instanceof Error ? err.message : String(err),
                        title: t("workspace.addPanelMenu.agentLaunchFailed"),
                      });
                    }
                  }}
                >
                  <AgentIcon agentId={agentId} size={16} />
                  <span>{entry?.label ?? agentId}</span>
                </DropdownMenuItem>
              );
            })
          ) : (
            <DropdownMenuItem disabled>
              {t("workspace.addPanelMenu.noAgentDetected")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
