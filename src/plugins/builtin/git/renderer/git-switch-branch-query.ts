import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import { isValidGitBranchName } from "@shared/worktree-naming.ts";
import { pluginText } from "./git-plugin-text.ts";

export type SwitchBranchQueryKind =
  | "create"
  | "current"
  | "existing"
  | "invalid";

export interface SwitchBranchQueryItemData {
  kind: SwitchBranchQueryKind;
  name: string;
}

export function collectLocalBranchNames(
  branches: readonly { kind: "local" | "remote"; name: string }[],
  currentBranch: null | string
): Set<string> {
  const names = new Set(
    branches
      .filter((branch) => branch.kind === "local")
      .map((branch) => branch.name)
  );
  if (currentBranch) {
    names.add(currentBranch);
  }
  return names;
}

export function readSwitchBranchQueryItem(
  item: RendererPluginQuickPickItem
): SwitchBranchQueryItemData | null {
  const data = item.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("kind" in data) ||
    !("name" in data) ||
    (data.kind !== "create" &&
      data.kind !== "current" &&
      data.kind !== "existing" &&
      data.kind !== "invalid") ||
    typeof data.name !== "string"
  ) {
    return null;
  }
  return { kind: data.kind, name: data.name };
}

export function switchBranchQueryItem(
  context: RendererPluginContext,
  presentedLocalBranchNames: ReadonlySet<string>,
  allLocalBranchNames: ReadonlySet<string>,
  currentBranch: null | string,
  query: string
): RendererPluginQuickPickItem | null {
  const name = query.trim();
  if (!name) {
    return null;
  }
  if (name === currentBranch) {
    return {
      data: {
        kind: "current",
        name,
      } satisfies SwitchBranchQueryItemData,
      detail: pluginText(context, "gitBranchCurrent", "Current branch"),
      disabled: true,
      id: `branch-query:current:${name}`,
      label: name,
    };
  }
  if (presentedLocalBranchNames.has(name)) {
    return null;
  }
  if (allLocalBranchNames.has(name)) {
    return {
      data: {
        kind: "existing",
        name,
      } satisfies SwitchBranchQueryItemData,
      detail: pluginText(context, "gitBranchLocal", "Local branch"),
      id: `branch-query:existing:${name}`,
      label: name,
      searchTerms: [name],
    };
  }
  if (!isValidGitBranchName(name)) {
    return {
      data: {
        kind: "invalid",
        name,
      } satisfies SwitchBranchQueryItemData,
      detail: pluginText(
        context,
        "gitBranchNameInvalid",
        "Invalid Git branch name"
      ),
      disabled: true,
      id: `branch-query:invalid:${name}`,
      label: pluginText(
        context,
        "gitBranchCannotCreate",
        "Cannot create branch “{{branch}}”",
        { branch: name }
      ),
    };
  }
  return {
    data: {
      kind: "create",
      name,
    } satisfies SwitchBranchQueryItemData,
    detail: pluginText(
      context,
      "gitBranchCreateFromHead",
      "Create from the current HEAD"
    ),
    id: `branch-query:create:${name}`,
    label: pluginText(
      context,
      "gitBranchCreateAndSwitch",
      "Create branch “{{branch}}”",
      { branch: name }
    ),
    searchTerms: [name],
  };
}
