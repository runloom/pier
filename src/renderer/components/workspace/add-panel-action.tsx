import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { GitBranchPlus, Play, Plus, Terminal } from "lucide-react";
import { useSyncExternalStore } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { openRunTaskQuickPick } from "@/lib/actions/run-actions.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const WORKTREE_CREATE_ACTION_ID = "pier.worktree.create";

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
  // 订阅 active panel 变化以便 New Worktree 菜单项 disabled 状态跟随 (值不使用,纯粹为重渲注册订阅)。
  usePanelDescriptorStore((s) => s.activeId);
  // 订阅 actionRegistry 版本变化:插件卸载/重装会替换 action, enabled()/handler 引用随之变化。
  useSyncExternalStore(
    (cb) => actionRegistry.subscribe(cb),
    () => actionRegistry.getVersion(),
    () => 0
  );

  const enabledAgents = detectedIds.filter(
    (id) => !disabledAgentIds.includes(id)
  );

  const worktreeCreateAction = actionRegistry.get(WORKTREE_CREATE_ACTION_ID);
  const worktreeCreateEnabled = Boolean(
    worktreeCreateAction && (worktreeCreateAction.enabled?.() ?? true)
  );

  return (
    <div className="flex h-full items-center justify-center px-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            ensureDetected().catch(() => undefined);
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
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={() => {
              useWorkspaceStore.getState().addTerminal({
                referenceGroup: props.group,
              });
            }}
          >
            <Terminal className="size-4" />
            <span>{t("workspace.addPanelMenu.newTerminal")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              openRunTaskQuickPick().catch(() => undefined);
            }}
          >
            <Play className="size-4" />
            <span>{t("workspace.addPanelMenu.newTask")}</span>
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
                  onClick={() => {
                    window.pier.agents
                      .prepareLaunch(agentId)
                      .then(({ launchId }) => {
                        if (!launchId) {
                          return;
                        }
                        useWorkspaceStore.getState().addTerminal({
                          launchId,
                          referenceGroup: props.group,
                        });
                      })
                      .catch(() => undefined);
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
