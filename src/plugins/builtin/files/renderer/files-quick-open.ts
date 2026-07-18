/**
 * `pier.files.quickOpen` — Cmd+P path quick open (design §6.1).
 *
 * Resolves project root from the active panel context, opens an async
 * command-palette quick pick driven by the shared path-query client, and
 * opens the accepted disk path in the current group using the same
 * openInstance pattern as the file tree.
 */
import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_QUICK_OPEN_COMMAND_ID,
} from "../manifest.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
} from "../settings.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import { sourceTitle } from "./file-panel-source.ts";
import { basename } from "./file-tree-action-utils.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  createFilesPathQueryClient,
  type PathQuerySnapshot,
} from "./files-path-query-client.ts";
import { recordFilesPathMru } from "./files-quick-open-mru.ts";

let sessionCounter = 0;

function nextOwner(): string {
  sessionCounter += 1;
  return `quick-open:${sessionCounter}`;
}

function snapshotToItems(
  snap: PathQuerySnapshot
): readonly RendererPluginQuickPickItem[] {
  return snap.items.map((item) => ({
    data: item.path,
    description: item.path,
    id: item.path,
    label: basename(item.path),
  }));
}

function resolveActiveGroupId(
  context: RendererPluginContext
): string | undefined {
  const instances = context.panels.listInstances(FILES_FILE_PANEL_ID);
  const activePanelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  if (activePanelId) {
    return (
      instances.find((instance) => instance.id === activePanelId)?.groupId ??
      undefined
    );
  }
  // 非 files 面板聚焦时不猜 group；新建落到 dockview 当前 active group。
  // 同源 tab 复用见 openDiskPathInGroup（可跨 group 查找已打开实例）。
  return;
}

function openDiskPathInGroup(input: {
  context: RendererPluginContext;
  groupId: string | undefined;
  panelContext: PanelContext | null;
  path: string;
  root: string;
}): void {
  const source = {
    kind: "disk" as const,
    path: input.path,
    root: input.root,
  };
  // Prefer same group when known; otherwise reuse any same-source files tab so
  // Cmd+P from a terminal still activates an already-open file.
  const existingInstance = input.context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .find((instance) => {
      if (input.groupId !== undefined && instance.groupId !== input.groupId) {
        return false;
      }
      return sameFilesDocumentPanelSource(
        parseFilesDocumentPanelSource(instance.params),
        source
      );
    });
  const existingSource = parseFilesDocumentPanelSource(
    existingInstance?.params
  );
  const existingParams = existingInstance?.params
    ? { ...existingInstance.params }
    : null;
  const params = existingParams ?? {
    pinned: false,
    source,
  };

  input.context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(!existingInstance && input.panelContext
      ? { context: input.panelContext }
      : {}),
    dropUnpinnedInstances: !existingInstance,
    instanceId: existingInstance?.id ?? createFileFilePanelInstanceId(source),
    params,
    ...(input.groupId ? { targetGroupId: input.groupId } : {}),
    title: sourceTitle(existingSource ?? source),
  });
}

function openNoProjectQuickPick(context: RendererPluginContext): void {
  const t = createFilesTranslate(context);
  context.commandPalette.openQuickPick({
    items: [
      {
        disabled: true,
        id: "files.quickOpen.noProject",
        label: t(
          "filePanel.quickOpen.noProject",
          "Open a project to search files."
        ),
      },
    ],
    onAccept: () => undefined,
    placeholder: t("filePanel.quickOpen.placeholder", "Search files by path"),
    title: t("filePanel.quickOpen.title", "Go to File"),
  });
}

function openAsyncQuickPick(
  context: RendererPluginContext,
  root: string,
  panelContext: PanelContext | null
): void {
  const t = createFilesTranslate(context);
  const client = createFilesPathQueryClient(context.files);
  const owner = nextOwner();
  const groupId = resolveActiveGroupId(context);
  let disposeSearch: (() => void) | null = null;

  const excludePatterns = (() => {
    const value = context.configuration?.get?.<unknown>(
      FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY
    );
    return typeof value === "string"
      ? value
      : FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
  })();

  const applySnapshot = (snap: PathQuerySnapshot): void => {
    if (snap.status === "error") {
      context.commandPalette.updateQuickPick({
        errorText:
          snap.errorMessage ??
          t("filePanel.quickOpen.queryFailed", "Unable to search files"),
        items: [],
        loading: false,
      });
      return;
    }

    const items = snapshotToItems(snap);
    const truncatedHint =
      snap.truncated && snap.status === "done"
        ? t("filePanel.quickOpen.truncated", "Results truncated to top matches")
        : null;

    context.commandPalette.updateQuickPick({
      errorText: truncatedHint ?? "",
      items,
      loading: snap.status === "loading",
    });
  };

  context.commandPalette.openQuickPick({
    items: [],
    loading: true,
    onAccept: (item) => {
      disposeSearch?.();
      disposeSearch = null;
      let path = "";
      if (typeof item.data === "string") {
        path = item.data;
      } else if (typeof item.id === "string") {
        path = item.id;
      }
      if (path.length === 0) {
        return;
      }
      openDiskPathInGroup({
        context,
        groupId,
        panelContext,
        path,
        root,
      });
      recordFilesPathMru(root, path);
    },
    onDismiss: () => {
      disposeSearch?.();
      disposeSearch = null;
    },
    onQueryChange: (query, signal) => {
      disposeSearch?.();
      disposeSearch = client.search({
        excludePatterns,
        onUpdate: applySnapshot,
        owner,
        query,
        root,
      });
      const abort = (): void => {
        disposeSearch?.();
        disposeSearch = null;
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    },
    placeholder: t("filePanel.quickOpen.placeholder", "Search files by path"),
    // Main already ranks top-K; do not re-sort with quickPickResults.
    preserveItemOrder: true,
    title: t("filePanel.quickOpen.title", "Go to File"),
  });
}

export function createFilesQuickOpenAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = createFilesTranslate(context);
  return {
    category: "file",
    handler: () => {
      const panelContext = context.panels.getActiveContext();
      const root = filePanelProjectRoot(panelContext);
      if (!root) {
        openNoProjectQuickPick(context);
        return;
      }
      openAsyncQuickPick(context, root, panelContext);
    },
    id: FILES_QUICK_OPEN_COMMAND_ID,
    metadata: { group: "2_view", sortOrder: 0 },
    surfaces: ["command-palette"],
    title: () => t("filePanel.quickOpen.title", "Go to File"),
  };
}
