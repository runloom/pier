import type { LucideIcon } from "lucide-react";
import type { ActionCategoryKey, ActionInvocation } from "./types.ts";

export type WorkspaceWhenField =
  | "activeGroupPanelCount"
  | "groupCount"
  | "hasActivePanel"
  | "hasApi"
  | "panelCount";
export type TerminalWhenField = "activeIsTaskPanel" | "hasActivePanel";

export type ActionWhenClause =
  | `workspace.${WorkspaceWhenField}`
  | `!workspace.${WorkspaceWhenField}`
  | `workspace.${WorkspaceWhenField} > ${number}`
  | `terminal.${TerminalWhenField}`
  | `!terminal.${TerminalWhenField}`;

type ActionWhenAnd = "&&" | "&& " | " &&" | " && ";

export type ActionWhenExpression =
  | ActionWhenClause
  | `${ActionWhenClause}${ActionWhenAnd}${string}`;

export interface ActionContribution {
  categoryKey: ActionCategoryKey;
  excludeFromMru?: boolean;
  group?: string;
  handler: (invocation?: ActionInvocation) => void | Promise<void>;
  iconComponent?: LucideIcon;
  id: string;
  /**
   * 为 true 时该 action 从右键菜单整行移除 (非置灰)。只影响 context menu
   * surface;命令面板/快捷键不受影响 (那两处仍走 when → enabled 置灰/拦截)。
   */
  menuHiddenWhen?: ActionWhenExpression;
  shortcutSourceId?: string;
  sortOrder?: number;
  submenuKey?: string;
  surfaces: readonly (string & {})[];
  titleKey: string;
  titleParams?: Record<string, number | string>;
  when?: ActionWhenExpression;
}

export interface ActionWhenContext {
  terminal: {
    /** 当前 active panel 是任务面板 (terminal + 合法 params.task)。 */
    activeIsTaskPanel: boolean;
    hasActivePanel: boolean;
  };
  workspace: {
    activeGroupPanelCount: number;
    groupCount: number;
    hasActivePanel: boolean;
    hasApi: boolean;
    panelCount: number;
  };
}

export interface ActionContributionRuntime {
  getContext: () => ActionWhenContext;
  resolveAliases: (actionId: string) => readonly string[];
  t: (key: string, params?: Record<string, number | string>) => string;
}
