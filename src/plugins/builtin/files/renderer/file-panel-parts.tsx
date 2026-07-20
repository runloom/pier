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
  FilePanelSearchButton as SharedFilePanelSearchButton,
} from "@pier/ui/file-panel-layout.tsx";
import {
  ArrowLeft,
  ArrowRight,
  FileQuestion,
  FileX,
  MousePointerClick,
} from "lucide-react";
import type { ReactNode } from "react";
import type { FilesTranslate } from "./files-i18n.ts";

export {
  FilePanelBreadcrumb,
  FilePanelHeader as FilePanelChrome,
} from "@pier/ui/file-panel-layout.tsx";

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
                "Open a file or a terminal Markdown preview to start editing."
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
      collapseLabel={t("filePanel.tree.collapse", "Collapse file tree")}
      expandLabel={t("filePanel.tree.expand", "Expand file tree")}
      hidden={hidden}
      onToggle={onToggle}
    />
  );
}

// 目标布局参考:chrome 左侧 sidebar-toggle 与搜索之后的 ←/→ 文件导航。
// 历史由 files-nav-history 按 group 维护;无可去方向时禁用。
export function FilePanelNavButtons({
  canBack,
  canForward,
  onBack,
  onForward,
  t,
}: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  t: FilesTranslate;
}) {
  const backLabel = t("filePanel.nav.back", "Back");
  const forwardLabel = t("filePanel.nav.forward", "Forward");
  return (
    <>
      <Button
        aria-label={backLabel}
        disabled={!canBack}
        onClick={onBack}
        size="xs"
        type="button"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        <span className="sr-only">{backLabel}</span>
      </Button>
      <Button
        aria-label={forwardLabel}
        disabled={!canForward}
        onClick={onForward}
        size="xs"
        type="button"
        variant="ghost"
      >
        <ArrowRight aria-hidden="true" data-icon="inline-start" />
        <span className="sr-only">{forwardLabel}</span>
      </Button>
    </>
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
  /** 覆盖默认 tooltip(树可用时为「在文件树中查找」)。 */
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
