import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import {
  FilePanelLayout,
  FilePanelSidebarToggleButton,
  filePanelTreeToggleShortcutLabel,
  FilePanelSearchButton as SharedFilePanelSearchButton,
} from "@pier/ui/file/panel-layout.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileQuestion, FileX, MousePointerClick } from "lucide-react";
import { type ReactNode, useCallback } from "react";
import type { FilesTranslate } from "../i18n.ts";

export {
  FilePanelBreadcrumb,
  FilePanelHeader as FilePanelChrome,
} from "@pier/ui/file/panel-layout.tsx";

/**
 * Slim info strip above the editor content: the active disk document lives
 * outside the panel's project root. Content stays fully readable/editable;
 * the tree below only shows the panel's own root (VS Code
 * ResourceNotInWorkspaceElement / JetBrains infobar analogue).
 */
export function OutsideWorkspaceBanner({
  context,
  path,
  root,
  t,
}: {
  context: RendererPluginContext | undefined;
  path: string;
  root: string;
  t: FilesTranslate;
}) {
  const onReveal = useCallback(async () => {
    if (!context) {
      return;
    }
    try {
      await context.files.reveal({ path, root });
    } catch (error) {
      await context.dialogs.alert({
        body: error instanceof Error ? error.message : String(error),
        title: t("filePanel.tree.revealFailed", "Unable to reveal item"),
      });
    }
  }, [context, path, root, t]);
  return (
    <Alert
      className="shrink-0 rounded-none border-x-0 border-t-0"
      variant="info"
    >
      <AlertTitle>
        {t(
          "filePanel.banner.outsideWorkspace",
          "This file is outside the current workspace"
        )}
      </AlertTitle>
      <AlertDescription className="truncate font-mono">{root}</AlertDescription>
      {context ? (
        <AlertAction>
          <Button onClick={onReveal} variant="outline">
            {t("filePanel.tree.action.reveal", "Reveal in Finder")}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function ReadOnlyErrorState({
  message,
  title,
  t,
}: {
  message: string;
  title: string;
  t: FilesTranslate;
}) {
  return (
    <div className="flex h-full flex-col gap-3 bg-background p-4">
      <h1 className="font-semibold text-foreground text-sm">{title}</h1>
      <ErrorEmpty
        description={message}
        title={t(
          "filePanel.errors.restore.title",
          "Unable to restore file tab"
        )}
      />
    </div>
  );
}

/** Full-region Empty when disk read failed and there is no body to show. */
export function FileReadErrorEmpty({
  message,
  onReload,
  t,
  title,
}: {
  message: string | null;
  onReload?: (() => void) | undefined;
  t: FilesTranslate;
  title: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <h1 className="sr-only">{title}</h1>
      <ErrorEmpty
        description={
          message?.trim()
            ? message
            : t(
                "filePanel.errors.read.fallback",
                "Unable to read file contents."
              )
        }
        retryAction={
          onReload
            ? {
                label: t("filePanel.errors.reload", "Reload"),
                onClick: onReload,
              }
            : undefined
        }
        title={t("filePanel.errors.read.title", "Unable to read file")}
      />
    </div>
  );
}

/** Soft banner when save failed but editor body remains visible. */
export function FileSaveErrorBanner({
  message,
  t,
}: {
  message: string;
  t: FilesTranslate;
}) {
  return (
    <div className="shrink-0 px-4 py-3">
      <Alert variant="destructive">
        <AlertTitle>
          {t("filePanel.errors.save.title", "Unable to save file")}
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

export function UnsupportedFileState({
  actions,
  details,
  message,
  title,
}: {
  actions?: ReactNode;
  details?: ReactNode;
  message: string;
  title: string;
}) {
  return (
    <Empty>
      <h1 className="sr-only">{title}</h1>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      {details || actions ? (
        <EmptyContent>
          {details}
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function MissingTemporaryState({
  name,
  t,
}: {
  name: string;
  t: FilesTranslate;
}) {
  return (
    <Empty>
      <h1 className="sr-only">{name}</h1>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileX />
        </EmptyMedia>
        <EmptyTitle>
          {t(
            "filePanel.temporary.missing.title",
            "Temporary file cannot be restored"
          )}
        </EmptyTitle>
        <EmptyDescription>
          {t(
            "filePanel.temporary.missing.description",
            "Temporary document contents are restored from the local draft cache when possible, and are released when the file panel closes."
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function EmptyFileState({
  hasProjectTree,
  t,
}: {
  hasProjectTree: boolean;
  t: FilesTranslate;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MousePointerClick />
        </EmptyMedia>
        <EmptyTitle>
          {t("filePanel.empty.title", "No file selected")}
        </EmptyTitle>
        <EmptyDescription>
          {hasProjectTree
            ? t(
                "filePanel.empty.withTree.description",
                "Select a file from the project tree to open it in this tab."
              )
            : t(
                "filePanel.empty.noTree.description",
                "Open a file to start editing."
              )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const TREE_WIDTH_STORAGE_KEY = "pier.files.filePanel.treeWidthPx";

export function FilePanelShell({
  children,
  header,
  onSidebarAutoCollapse,
  sidebar,
}: {
  children: ReactNode;
  header: ReactNode;
  onSidebarAutoCollapse: () => void;
  sidebar: ReactNode;
}) {
  return (
    <FilePanelLayout
      contentPanelId="files-content"
      header={header}
      onSidebarAutoCollapse={onSidebarAutoCollapse}
      sidebar={sidebar}
      sidebarPanelId="files-tree"
      sidebarWidthStorageKey={TREE_WIDTH_STORAGE_KEY}
    >
      {children}
    </FilePanelLayout>
  );
}

export function SidebarToggleButton({
  collapsed,
  hidden,
  onToggle,
  t,
}: {
  collapsed: boolean;
  hidden: boolean;
  onToggle: () => void;
  t: FilesTranslate;
}) {
  return (
    <FilePanelSidebarToggleButton
      collapsed={collapsed}
      collapseLabel={t("filePanel.tree.collapse", "Hide file tree")}
      expandLabel={t("filePanel.tree.expand", "Show file tree")}
      hidden={hidden}
      onToggle={onToggle}
      shortcut={filePanelTreeToggleShortcutLabel()}
    />
  );
}

// Cursor 参考:顶部 chrome 里 sidebar-toggle 旁的 Search 图标。点击一次
// bump 外层 searchRequest 计数,CodeMirror 侧的 useEffect 打开搜索面板。
// CM 内嵌 Cmd/Ctrl+F 已支持,此按钮补上鼠标入口。
export function FilePanelSearchButton({
  label,
  onOpenSearch,
  t,
}: {
  /** 覆盖默认 tooltip（树可用时为「在目录树中查找」）。 */
  label?: string;
  onOpenSearch: () => void;
  t: FilesTranslate;
}) {
  const resolvedLabel = label ?? t("filePanel.search", "Find in file");
  return (
    <SharedFilePanelSearchButton
      label={resolvedLabel}
      onOpenSearch={onOpenSearch}
    />
  );
}
