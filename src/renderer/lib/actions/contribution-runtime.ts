import type {
  ActionContribution,
  ActionContributionRuntime,
  ActionWhenContext,
} from "./contribution-types.ts";
import { actionRegistry } from "./registry.ts";
import type { Action, ActionCategoryKey, ActionMetadata } from "./types.ts";

const CATEGORY_BY_KEY: Record<ActionCategoryKey, string> = {
  panel: "Panel",
  run: "Run",
  settings: "Settings",
  terminal: "Terminal",
  view: "View",
  window: "Window",
  workspace: "Workspace",
};

const BOOLEAN_WHEN_FIELDS = new Set(["hasActivePanel", "hasApi"]);
const NUMBER_WHEN_FIELDS = new Set([
  "activeGroupPanelCount",
  "groupCount",
  "panelCount",
]);
const BOOLEAN_CLAUSE_RE = /^workspace\.([A-Za-z]+)$/;
const NUMBER_CLAUSE_RE = /^workspace\.([A-Za-z]+)\s*>\s*(\d+)$/;
const WHEN_CONJUNCTION_RE = /\s*&&\s*/;

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
  const booleanMatch = BOOLEAN_CLAUSE_RE.exec(clause);
  if (booleanMatch) {
    const field = booleanMatch[1];
    if (field && BOOLEAN_WHEN_FIELDS.has(field)) {
      return booleanWorkspaceValue(field, context);
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
  const isEnabled = () =>
    evaluateActionWhen(contribution.when, runtime.getContext());

  return {
    category: CATEGORY_BY_KEY[contribution.categoryKey],
    enabled: isEnabled,
    handler: async () => {
      if (!isEnabled()) {
        return;
      }
      await contribution.handler();
    },
    id: contribution.id,
    metadata,
    surfaces: contribution.surfaces,
    title: () => runtime.t(contribution.titleKey),
  };
}

function createMetadata(
  contribution: ActionContribution,
  runtime: ActionContributionRuntime
): ActionMetadata {
  const metadata: ActionMetadata = {
    categoryKey: contribution.categoryKey,
    titleKey: contribution.titleKey,
  };
  const aliasesKey = contribution.aliasesKey;
  if (aliasesKey) {
    metadata.aliases = () => runtime.resolveAliases(aliasesKey);
  }
  if (contribution.group) {
    metadata.group = contribution.group;
  }
  if (contribution.excludeFromMru === true) {
    metadata.excludeFromMru = true;
  }
  if (contribution.iconComponent) {
    metadata.iconComponent = contribution.iconComponent;
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
