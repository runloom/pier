/**
 * Tab 右键「复制地址」路径解析：
 * - files 磁盘文件 panel → 文件绝对路径
 * - 其它持有 PanelContext 的 panel → 持有的目录路径
 * - 无路径 → null（菜单项不展示）
 */

import type { PanelContext } from "@shared/contracts/panel.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const LEADING_SLASHES = /^\/+/;
const TRAILING_SLASHES = /\/+$/;

function joinAbsolutePath(root: string, relativePath: string): string {
  const rootTrimmed = root.replace(TRAILING_SLASHES, "") || "/";
  const pathTrimmed = relativePath
    .replace(LEADING_SLASHES, "")
    .replace(TRAILING_SLASHES, "");
  if (!pathTrimmed) {
    return rootTrimmed;
  }
  if (rootTrimmed === "/") {
    return `/${pathTrimmed}`;
  }
  return `${rootTrimmed}/${pathTrimmed}`;
}

/** files 磁盘文档：params.source = { kind: "disk", root, path }。 */
function absolutePathFromFilesPanelParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("source" in params)) {
    return;
  }
  const source = (params as { source?: unknown }).source;
  if (!source || typeof source !== "object") {
    return;
  }
  const record = source as {
    kind?: unknown;
    path?: unknown;
    root?: unknown;
  };
  if (
    record.kind !== "disk" ||
    typeof record.root !== "string" ||
    record.root.length === 0 ||
    typeof record.path !== "string" ||
    record.path.length === 0
  ) {
    return;
  }
  return joinAbsolutePath(record.root, record.path);
}

/** panel 持有的目录：cwd 最贴近运行态，其次工作树/项目根。 */
export function directoryPathFromContext(
  context: PanelContext | null | undefined
): string | undefined {
  return (
    context?.cwd ??
    context?.worktreeRoot ??
    context?.projectRootPath ??
    context?.gitRoot ??
    context?.openedPath
  );
}

function panelRecord(panelId: string | undefined):
  | {
      params?: unknown;
    }
  | undefined {
  if (!panelId) {
    return;
  }
  return useWorkspaceStore
    .getState()
    .api?.panels.find((panel) => panel.id === panelId) as
    | { params?: unknown }
    | undefined;
}

function panelContextForInvocation(
  invocation?: ActionInvocation
): PanelContext | undefined {
  if (invocation?.sourcePanelContext) {
    return invocation.sourcePanelContext;
  }
  const panelId =
    invocation?.sourcePanelId ??
    useWorkspaceStore.getState().api?.activePanel?.id;
  if (!panelId) {
    return;
  }
  return usePanelDescriptorStore.getState().descriptors[panelId]?.context;
}

/**
 * 解析 tab 右键可复制的地址。无地址返回 undefined。
 */
export function resolvePanelCopyPath(
  invocation?: ActionInvocation
): string | undefined {
  const panelId =
    invocation?.sourcePanelId ??
    useWorkspaceStore.getState().api?.activePanel?.id;
  const panel = panelRecord(panelId);
  const filePath = absolutePathFromFilesPanelParams(panel?.params);
  if (filePath) {
    return filePath;
  }
  return directoryPathFromContext(panelContextForInvocation(invocation));
}
