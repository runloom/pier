import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@pier/ui/resizable.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileQuestion,
  FileX,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import type { FilesTranslate } from "./files-i18n.ts";

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
      <Alert variant="destructive">
        <AlertTitle>
          {t("filePanel.errors.restore.title", "Unable to restore file panel")}
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
                "Open a file or a terminal Markdown preview to start editing."
              )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// 面板整体分为「顶部 chrome + 主体（sidebar + editor）」。sidebar 收缩按钮
// 上移到 chrome；sidebar 隐藏时仍保留面包屑、状态和视图切换，布局无缝。
const TREE_WIDTH_STORAGE_KEY = "pier.files.filePanel.treeWidthPx";
const TREE_DEFAULT_WIDTH_PX = 256;
const TREE_MIN_WIDTH_PX = 170;

function readTreeWidthPx(): number {
  try {
    const raw = globalThis.localStorage?.getItem(TREE_WIDTH_STORAGE_KEY);
    const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= TREE_MIN_WIDTH_PX) {
      return parsed;
    }
  } catch {
    // localStorage 不可用(测试环境)时用默认宽。
  }
  return TREE_DEFAULT_WIDTH_PX;
}

function writeTreeWidthPx(px: number): void {
  try {
    globalThis.localStorage?.setItem(
      TREE_WIDTH_STORAGE_KEY,
      String(Math.round(px))
    );
  } catch {
    // 忽略持久化失败。
  }
}

// 对齐目标布局:chrome 一条横跨整个面板(树 + 编辑器之上),树在 chrome 下方。
// 树列宽可拖拽(shadcn resizable),像素宽持久化,面板缩放时保持像素宽。
export function FilePanelShell({
  children,
  header,
  sidebar,
}: {
  children: ReactNode;
  header: ReactNode;
  sidebar: ReactNode;
}) {
  if (!sidebar) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {header}
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">{children}</section>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {header}
      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        <ResizablePanel
          className="min-h-0"
          defaultSize={`${readTreeWidthPx()}px`}
          groupResizeBehavior="preserve-pixel-size"
          id="files-tree"
          maxSize="50%"
          minSize={`${TREE_MIN_WIDTH_PX}px`}
          onResize={(panelSize) => {
            writeTreeWidthPx(panelSize.inPixels);
          }}
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle className="data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary/60" />
        <ResizablePanel className="min-h-0" id="files-content">
          <section className="flex h-full min-w-0 flex-col">{children}</section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// 顶部 chrome 左侧是 sidebar toggle、搜索/前进后退与 breadcrumb，右侧是状态、
// 语言/格式和视图切换。breadcrumb 用 flex-1 min-w-0 截断，右侧 shrink-0；
// chrome 横跨整个面板并与终端标题栏高度对齐（约 40px）。
export function FilePanelChrome({
  center,
  leading,
  trailing,
}: {
  center: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-border border-b bg-background px-2">
      {leading ? (
        <div className="flex shrink-0 items-center">{leading}</div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center">{center}</div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1">{trailing}</div>
      ) : null}
    </header>
  );
}

// Cursor 参考:面包屑用 chevron 分隔,末段(文件名)加粗,前段 muted 且悬停高亮。
// segments 数组由调用方按项目根拆分,不含 leading/trailing 空段。
export function FilePanelBreadcrumb({
  onSegmentClick,
  segments,
  status,
}: {
  /** 点击段(index 为 segments 下标)。未传 = 纯展示。 */
  onSegmentClick?: (index: number) => void;
  segments: readonly string[];
  status?: ReactNode;
}) {
  if (segments.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const last = segments.length - 1;
  return (
    <div className="flex min-w-0 items-center gap-1 font-mono text-xs">
      {segments.map((segment, index) => {
        const isLast = index === last;
        // 面包屑 key 用 index+segment:同级同名段极罕见,但前缀 index 保证唯一。
        const key = `${index}:${segment}`;
        if (onSegmentClick) {
          return (
            <span className="flex min-w-0 items-center gap-1" key={key}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground/60"
                />
              ) : null}
              <Button
                aria-current={isLast ? "page" : undefined}
                className="min-w-0 truncate"
                onClick={() => onSegmentClick(index)}
                size="xs"
                title={segment}
                type="button"
                variant="ghost"
              >
                {segment}
              </Button>
            </span>
          );
        }
        return (
          <span className="flex min-w-0 items-center gap-1" key={key}>
            {index > 0 ? (
              <ChevronRight
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground/60"
              />
            ) : null}
            <span
              className={cn(
                "truncate",
                isLast
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {segment}
            </span>
          </span>
        );
      })}
      {status ? <span className="ml-1 shrink-0">{status}</span> : null}
    </div>
  );
}

// Cursor 顶部 sidebar 折叠按钮。root=null 时(无项目上下文)不渲染。
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
  if (hidden) {
    return null;
  }
  const label = collapsed
    ? t("filePanel.tree.expand", "Expand file tree")
    : t("filePanel.tree.collapse", "Collapse file tree");
  return (
    <Button
      aria-label={label}
      onClick={onToggle}
      size="xs"
      type="button"
      variant="ghost"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" data-icon="inline-start" />
      ) : (
        <PanelLeftClose aria-hidden="true" data-icon="inline-start" />
      )}
      <span className="sr-only">{label}</span>
    </Button>
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
    <Button
      aria-label={resolvedLabel}
      onClick={onOpenSearch}
      size="xs"
      type="button"
      variant="ghost"
    >
      <Search aria-hidden="true" data-icon="inline-start" />
      <span className="sr-only">{resolvedLabel}</span>
    </Button>
  );
}
