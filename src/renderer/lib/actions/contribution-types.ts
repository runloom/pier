import type { LucideIcon } from "lucide-react";
import type { ActionCategoryKey } from "./types.ts";

export type WorkspaceWhenField =
  | "activeGroupPanelCount"
  | "groupCount"
  | "hasActivePanel"
  | "hasApi"
  | "panelCount";
export type TerminalWhenField = "hasActivePanel";

export type ActionWhenClause =
  | `workspace.${WorkspaceWhenField}`
  | `workspace.${WorkspaceWhenField} > ${number}`
  | `terminal.${TerminalWhenField}`;

type ActionWhenAnd = "&&" | "&& " | " &&" | " && ";

export type ActionWhenExpression =
  | ActionWhenClause
  | `${ActionWhenClause}${ActionWhenAnd}${string}`;

export interface ActionContribution {
  aliasesKey?: string;
  categoryKey: ActionCategoryKey;
  excludeFromMru?: boolean;
  group?: string;
  handler: () => void | Promise<void>;
  iconComponent?: LucideIcon;
  id: string;
  sortOrder?: number;
  submenuKey?: string;
  surfaces: readonly (string & {})[];
  titleKey: string;
  titleParams?: Record<string, number | string>;
  when?: ActionWhenExpression;
}

export interface ActionWhenContext {
  terminal: {
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
  resolveAliases: (key: string) => readonly string[];
  t: (key: string, params?: Record<string, number | string>) => string;
}
