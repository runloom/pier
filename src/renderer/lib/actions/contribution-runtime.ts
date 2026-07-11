import i18next from "i18next";
import type {
  ActionContribution,
  ActionContributionRuntime,
  ActionWhenContext,
} from "./contribution-types.ts";
import { actionRegistry } from "./registry.ts";
import type {
  Action,
  ActionCategoryKey,
  ActionInvocation,
  ActionMetadata,
} from "./types.ts";

/** 用 i18n 解析 category 显示名，key 同时用作 locale 无关的分组键 */
export function getCategory(key: ActionCategoryKey): string {
  return i18next.t(`commandPalette.category.${key}`, { defaultValue: key });
}

const BOOLEAN_WHEN_FIELDS = new Set(["hasActivePanel", "hasApi"]);
const TERMINAL_BOOLEAN_WHEN_FIELDS = new Set([
  "activeIsTaskPanel",
  "hasActivePanel",
]);
const NUMBER_WHEN_FIELDS = new Set([
  "activeGroupPanelCount",
  "groupCount",
  "panelCount",
]);
const BOOLEAN_CLAUSE_RE = /^workspace\.([A-Za-z]+)$/;
const TERMINAL_BOOLEAN_CLAUSE_RE = /^terminal\.([A-Za-z]+)$/;
const NUMBER_CLAUSE_RE = /^workspace\.([A-Za-z]+)\s*>\s*(\d+)$/;
const WHEN_CONJUNCTION_RE = /\s*&&\s*/;
const NEGATION_PREFIX_RE = /^!\s*/;

export function evaluateActionWhen(
  expression: string | undefined,
  context: ActionWhenContext
): boolean {
  if (!expression) {
    return true;
  }
  return expression
    .split(WHEN_CONJUNCTION_RE)
    .every((clause) => evaluateActionWhenClause(clause.trim(), context));
}

function evaluateActionWhenClause(
  clause: string,
  context: ActionWhenContext
): boolean {
  if (NEGATION_PREFIX_RE.test(clause)) {
    return !evaluateActionWhenClause(
      clause.replace(NEGATION_PREFIX_RE, ""),
      context
    );
  }
  const booleanMatch = BOOLEAN_CLAUSE_RE.exec(clause);
  if (booleanMatch) {
    const field = booleanMatch[1];
    if (field && BOOLEAN_WHEN_FIELDS.has(field)) {
      return booleanWorkspaceValue(field, context);
    }
  }

  const terminalBooleanMatch = TERMINAL_BOOLEAN_CLAUSE_RE.exec(clause);
  if (terminalBooleanMatch) {
    const field = terminalBooleanMatch[1];
    if (field && TERMINAL_BOOLEAN_WHEN_FIELDS.has(field)) {
      return booleanTerminalValue(field, context);
    }
  }

  const numberMatch = NUMBER_CLAUSE_RE.exec(clause);
  if (numberMatch) {
    const field = numberMatch[1];
    const thresholdText = numberMatch[2];
    if (field && thresholdText && NUMBER_WHEN_FIELDS.has(field)) {
      return numberWorkspaceValue(field, context) > Number(thresholdText);
    }
  }

  throw new Error(`Unsupported action contribution condition: ${clause}`);
}

function booleanTerminalValue(
  field: string,
  context: ActionWhenContext
): boolean {
  switch (field) {
    case "activeIsTaskPanel":
      return context.terminal.activeIsTaskPanel;
    case "hasActivePanel":
      return context.terminal.hasActivePanel;
    default:
      throw new Error(`Unsupported boolean terminal field: ${field}`);
  }
}

function booleanWorkspaceValue(
  field: string,
  context: ActionWhenContext
): boolean {
  switch (field) {
    case "hasActivePanel":
      return context.workspace.hasActivePanel;
    case "hasApi":
      return context.workspace.hasApi;
    default:
      throw new Error(`Unsupported boolean workspace field: ${field}`);
  }
}

function numberWorkspaceValue(
  field: string,
  context: ActionWhenContext
): number {
  switch (field) {
    case "activeGroupPanelCount":
      return context.workspace.activeGroupPanelCount;
    case "groupCount":
      return context.workspace.groupCount;
    case "panelCount":
      return context.workspace.panelCount;
    default:
      throw new Error(`Unsupported numeric workspace field: ${field}`);
  }
}

export function createActionFromContribution(
  contribution: ActionContribution,
  runtime: ActionContributionRuntime
): Action {
  const metadata = createMetadata(contribution, runtime);
  const isEnabled = (invocation?: ActionInvocation) =>
    evaluateActionWhen(contribution.when, runtime.getContext(invocation)) &&
    (contribution.enabled?.(invocation) ?? true);

  return {
    category: contribution.categoryKey,
    enabled: isEnabled,
    handler: async (invocation) => {
      if (!isEnabled(invocation)) {
        return;
      }
      await contribution.handler(invocation);
    },
    id: contribution.id,
    metadata,
    surfaces: contribution.surfaces,
    title: (invocation) =>
      contribution.title?.(invocation) ??
      runtime.t(contribution.titleKey, contribution.titleParams),
  };
}

function createMetadata(
  contribution: ActionContribution,
  runtime: ActionContributionRuntime
): ActionMetadata {
  const metadata: ActionMetadata = {
    aliases: () => runtime.resolveAliases(contribution.id),
    categoryKey: contribution.categoryKey,
    titleKey: contribution.titleKey,
  };
  if (contribution.group) {
    metadata.group = contribution.group;
  }
  if (contribution.excludeFromMru === true) {
    metadata.excludeFromMru = true;
  }
  if (contribution.iconComponent) {
    metadata.iconComponent = contribution.iconComponent;
  }
  const menuHiddenWhen = contribution.menuHiddenWhen;
  const menuHidden = contribution.menuHidden;
  if (menuHiddenWhen || menuHidden) {
    metadata.menuHidden = (invocation) =>
      (menuHiddenWhen
        ? evaluateActionWhen(menuHiddenWhen, runtime.getContext(invocation))
        : false) ||
      (menuHidden?.(invocation) ?? false);
  }
  if (contribution.shortcutSourceId) {
    metadata.shortcutSourceId = contribution.shortcutSourceId;
  }
  if (contribution.sortOrder != null) {
    metadata.sortOrder = contribution.sortOrder;
  }
  const submenuKey = contribution.submenuKey;
  if (submenuKey) {
    metadata.submenu = () => runtime.t(submenuKey);
  }
  return metadata;
}

export function registerActionContributions(
  contributions: readonly ActionContribution[],
  runtime: ActionContributionRuntime
): Array<() => void> {
  return contributions.map((contribution) =>
    actionRegistry.register(createActionFromContribution(contribution, runtime))
  );
}
