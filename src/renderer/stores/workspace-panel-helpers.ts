import type { TerminalExitPresentation } from "@shared/contracts/ghostty-host-copy.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";

export interface TerminalPanelParams {
  context?: PanelContext;
  exitPresentation?: TerminalExitPresentation;
  launchId?: string;
  tab?: PanelTabChrome;
  task?: TaskPanelMetadata;
}

export type WorkspaceGroupRef = NonNullable<DockviewApi["activeGroup"]>;
type WorkspacePanelRef = DockviewApi["panels"][number];

/**
 * 读 panel descriptor 上的路径锚点。命名历史来自终端，但任意 panel 只要
 * 经 `usePanelDescriptor` / plugin host boundary 注册了 `context` 即可读到。
 * 项目相关 panel 应自持 context；全局 panel（workbench / welcome 等）不写 context。
 */
export function terminalPanelContext(
  panelId: string | undefined
): PanelContext | undefined {
  if (!panelId) {
    return;
  }
  return usePanelDescriptorStore.getState().descriptors[panelId]?.context;
}

export function terminalPanelParams(args: {
  context: PanelContext | undefined;
  exitPresentation?: TerminalExitPresentation | undefined;
  launchId: string | undefined;
  tab: PanelTabChrome | undefined;
  task: TaskPanelMetadata | undefined;
}): TerminalPanelParams | undefined {
  if (
    !(
      args.context ||
      args.exitPresentation ||
      args.launchId ||
      args.tab ||
      args.task
    )
  ) {
    return;
  }
  return {
    ...(args.context && { context: args.context }),
    ...(args.exitPresentation && { exitPresentation: args.exitPresentation }),
    ...(args.launchId && { launchId: args.launchId }),
    ...(args.tab && { tab: args.tab }),
    ...(args.task && { task: args.task }),
  };
}

function panelInGroup(
  api: DockviewApi,
  panelId: string,
  groupId: string | undefined
): boolean {
  if (!groupId) {
    return false;
  }
  const group = findGroupById(api, groupId);
  return group?.panels.some((panel) => panel.id === panelId) ?? false;
}

/**
 * 新建终端默认 cwd：只读当前活动 panel 自身持有的路径，不再回落到同组
 * 兄弟终端。无路径时返回 undefined（调用方创建空 cwd 或禁用路径依赖操作）。
 */
export function inheritedActiveTerminalContext(
  api: DockviewApi
): PanelContext | undefined {
  return resolveWorkspaceAnchor({ api }).context;
}

export function uniquePanelId(api: DockviewApi, prefix: string): string {
  const base = `${prefix}-${Date.now()}`;
  const existing = new Set(api.panels.map((panel) => panel.id));
  if (!existing.has(base)) {
    return base;
  }
  let suffix = 1;
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function panelsInSameGroup(
  api: DockviewApi,
  panelId: string
): readonly WorkspacePanelRef[] {
  const group = api.groups?.find((candidate) =>
    candidate.panels?.some((panel) => panel.id === panelId)
  );
  if (group?.panels) {
    return group.panels;
  }
  const activeGroupPanels = api.activeGroup?.panels;
  if (activeGroupPanels?.some((panel) => panel.id === panelId)) {
    return activeGroupPanels;
  }
  return api.panels ?? [];
}

/** Resolve a dockview group by its stable ID. */
export function findGroupById(
  api: DockviewApi | null,
  groupId: string | undefined
): WorkspaceGroupRef | undefined {
  if (!(groupId && api)) {
    return;
  }
  return api.groups.find((group) => group.id === groupId);
}

/**
 * Build a `{ referenceGroup }` opts object for the requested group ID.
 * Returns `{}` when the group can't be resolved, so callers can spread it into
 * addTerminal/addWorkbench opts without tripping exactOptionalPropertyTypes.
 */
export function referenceGroupById(
  api: DockviewApi | null,
  groupId: string | undefined
): { referenceGroup?: WorkspaceGroupRef } {
  const group = findGroupById(api, groupId);
  return group ? { referenceGroup: group } : {};
}

export interface WorkspaceSourceInvocation {
  sourcePanelContext?: PanelContext;
  sourcePanelGroupId?: string;
  sourcePanelId?: string;
}

export interface WorkspaceAnchor {
  context?: PanelContext;
  groupId?: string;
}

/**
 * 解析 source/active panel 自身持有的路径锚点（忽略 terminalNewCwdPolicy）。
 * 项目相关 panel 必须自持路径；无 context 时不向同组兄弟 panel 回退。
 */
export function resolvePanelPathAnchor(input: {
  api: DockviewApi | null;
  sourcePanelContext?: PanelContext | undefined;
  sourcePanelGroupId?: string | undefined;
  sourcePanelId?: string | undefined;
}): WorkspaceAnchor {
  const groupId =
    input.sourcePanelGroupId ?? input.api?.activeGroup?.id ?? undefined;
  if (input.sourcePanelContext) {
    return {
      context: input.sourcePanelContext,
      ...(groupId ? { groupId } : {}),
    };
  }

  let sourcePanelId = input.sourcePanelId;
  if (!sourcePanelId && input.api?.activePanel) {
    const activeId = input.api.activePanel.id;
    // When the caller pinned a group, never pull context from a foreign
    // active panel that lives outside that group.
    if (
      !input.sourcePanelGroupId ||
      panelInGroup(input.api, activeId, input.sourcePanelGroupId)
    ) {
      sourcePanelId = activeId;
    }
  }

  const directContext = terminalPanelContext(sourcePanelId);
  return {
    ...(directContext ? { context: directContext } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

/**
 * Resolve the workspace directory/project anchor for terminal create/open.
 *
 * `shellDefault` 抑制 cwd 继承（新建终端用壳默认目录）。
 * 其余情况等同 {@link resolvePanelPathAnchor}。
 */
export function resolveWorkspaceAnchor(input: {
  api: DockviewApi | null;
  sourcePanelContext?: PanelContext | undefined;
  sourcePanelGroupId?: string | undefined;
  sourcePanelId?: string | undefined;
}): WorkspaceAnchor {
  const groupId =
    input.sourcePanelGroupId ?? input.api?.activeGroup?.id ?? undefined;
  if (
    useTerminalPreferencesStore.getState().terminalNewCwdPolicy !==
    "activeTerminal"
  ) {
    return {
      ...(groupId ? { groupId } : {}),
    };
  }
  return resolvePanelPathAnchor(input);
}

/**
 * 当前（或 invocation 指定）panel 是否持有项目路径锚点。
 * 路径依赖操作（新建终端/任务/智能体/工作台等）用此判定 enabled。
 * 不读 terminalNewCwdPolicy——那是「新建终端 cwd 继承」，不是「panel 有无路径」。
 */
export function hasProjectPathAnchor(input: {
  api: DockviewApi | null;
  sourcePanelContext?: PanelContext | undefined;
  sourcePanelGroupId?: string | undefined;
  sourcePanelId?: string | undefined;
}): boolean {
  return Boolean(projectPathFromContext(resolvePanelPathAnchor(input).context));
}

/** 从 PanelContext 取项目路径锚点（projectRootPath 优先）。 */
export function projectPathFromContext(
  context: PanelContext | null | undefined
): string | undefined {
  return (
    context?.projectRootPath ??
    context?.gitRoot ??
    context?.worktreeRoot ??
    context?.cwd
  );
}

export interface AnchoredTerminalTarget {
  /**
   * `null` = intentionally no project cwd (empty terminal / shellDefault).
   * Must stay sticky across async prepareLaunch — do not re-inherit later.
   */
  readonly context?: PanelContext | null;
  readonly groupId?: string;
}

/** Capture terminal placement and context before an asynchronous launch starts. */
export function captureAnchoredTerminalTarget(
  api: DockviewApi | null,
  invocation?: WorkspaceSourceInvocation
): AnchoredTerminalTarget {
  const anchor = resolveWorkspaceAnchor({
    api,
    sourcePanelContext: invocation?.sourcePanelContext,
    sourcePanelGroupId: invocation?.sourcePanelGroupId,
    sourcePanelId: invocation?.sourcePanelId,
  });
  return {
    // Always pin: missing context is an intentional empty cwd, not "inherit later".
    context: anchor.context ?? null,
    ...(anchor.groupId ? { groupId: anchor.groupId } : {}),
  };
}

/**
 * Resolve a previously captured target. A missing captured group is an error:
 * falling back to the current active group would launch in the wrong project.
 */
export function resolveAnchoredTerminalOptions(
  api: DockviewApi | null,
  target: AnchoredTerminalTarget
): {
  context?: PanelContext | null;
  referenceGroup?: WorkspaceGroupRef;
} | null {
  const referenceGroup = findGroupById(api, target.groupId);
  if (target.groupId && !referenceGroup) {
    return null;
  }
  return {
    // Forward pinned null/value so addTerminal does not re-inherit after await.
    context: target.context ?? null,
    ...(referenceGroup ? { referenceGroup } : {}),
  };
}

export async function clearCurrentWindowLayout(): Promise<void> {
  const context = await window.pier.window.getContext();
  await window.pier.workspace.clearLayout(context.recordId);
}
