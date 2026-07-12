import { Badge } from "@pier/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import type { MissionControlWidgetCategory } from "@shared/contracts/mission-control.ts";
import {
  Blocks,
  Bot,
  ChartColumn,
  Check,
  Cpu,
  FolderGit2,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Plus,
  Puzzle,
  Search,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/primitives/sidebar.tsx";
import { useT } from "@/i18n/use-t.ts";
import {
  collectLibraryFilters,
  filterLibraryItems,
  type MissionControlLibraryFilter,
  type MissionControlLibraryItem,
} from "./mission-control-library.ts";

// 与设置弹窗同款侧栏参数（settings-dialog.tsx）：窄导航 + 透明底。
const SIDEBAR_STYLE: CSSProperties = {
  "--sidebar-width": "10rem",
  "--sidebar": "none",
} as CSSProperties;

const CATEGORY_ICONS: Record<MissionControlWidgetCategory, LucideIcon> = {
  agent: Bot,
  analytics: ChartColumn,
  custom: Blocks,
  system: Cpu,
  vcs: FolderGit2,
};

interface MissionControlLibraryDialogProps {
  items: readonly MissionControlLibraryItem[];
  onAdd: (widgetId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function filterIcon(filter: MissionControlLibraryFilter): LucideIcon {
  if (filter === "all") {
    return LayoutGrid;
  }
  if (filter.startsWith("cat:")) {
    const category = filter.slice(
      "cat:".length
    ) as MissionControlWidgetCategory;
    return CATEGORY_ICONS[category] ?? LayoutGrid;
  }
  return Puzzle;
}

function filterLabel(
  filter: MissionControlLibraryFilter,
  items: readonly MissionControlLibraryItem[],
  t: (key: string) => string
): string {
  if (filter === "all") {
    return t("missionControl.library.filterAll");
  }
  if (filter.startsWith("cat:")) {
    return t(`missionControl.library.category.${filter.slice("cat:".length)}`);
  }
  const pluginId = filter.slice("plugin:".length);
  const item = items.find(
    (i) => i.source.kind === "plugin" && i.source.pluginId === pluginId
  );
  return item?.source.kind === "plugin" ? item.source.pluginName : pluginId;
}

function FilterNavButton({
  active,
  filter,
  items,
  onSelect,
  t,
}: {
  active: boolean;
  filter: MissionControlLibraryFilter;
  items: readonly MissionControlLibraryItem[];
  onSelect: () => void;
  t: (key: string) => string;
}) {
  const Icon = filterIcon(filter);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-current={active ? "true" : undefined}
        data-testid={`mission-control-library-filter-${filter}`}
        isActive={active}
        onClick={onSelect}
        type="button"
      >
        <Icon />
        <span>{filterLabel(filter, items, t)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LibraryItemCard({
  item,
  onAdd,
  t,
}: {
  item: MissionControlLibraryItem;
  onAdd: (widgetId: string) => void;
  t: (key: string) => string;
}) {
  const Icon = item.icon;
  const Preview = item.previewComponent;
  return (
    <button
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-colors hover:border-border hover:bg-accent/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-55"
      data-testid={`mission-control-widget-picker-item-${item.id}`}
      disabled={item.disabled}
      onClick={() => onAdd(item.id)}
      type="button"
    >
      {/* 预览区：物料自带 previewComponent（样例数据静态渲染），缺省回退图标示意 */}
      <div className="pointer-events-none relative h-28 w-full select-none overflow-hidden border-border/50 border-b bg-muted/20">
        {Preview ? (
          <div className="absolute inset-0">
            <Preview />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            {Icon ? (
              <Icon className="size-7 text-muted-foreground/50" />
            ) : (
              <LayoutDashboard className="size-7 text-muted-foreground/50" />
            )}
          </div>
        )}
        {/* hover 添加暗示：与整卡点击同语义，纯视觉引导 */}
        {item.disabled ? null : (
          <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Plus className="size-3.5" />
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5">
          {Icon ? (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate font-medium text-sm">{item.title}</span>
        </div>
        {item.description ? (
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {item.description}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <Badge variant="secondary">
            {item.source.kind === "core"
              ? t("missionControl.library.core")
              : item.source.pluginName}
          </Badge>
          {item.addedCount > 0 ? (
            <Badge variant="outline">
              <Check />
              {item.multiInstance
                ? t("missionControl.library.addedCount").replace(
                    "{{count}}",
                    String(item.addedCount)
                  )
                : t("missionControl.library.added")}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/**
 * 物料库对话框：结构对齐设置弹窗（settings-dialog.tsx）——标准 DialogHeader、
 * Sidebar primitives 分类导航、主区负滚动边距。点击物料卡 = 添加并关闭
 * （由调用方在 onAdd 中收口）。
 */
export function MissionControlLibraryDialog({
  items,
  onAdd,
  onOpenChange,
  open,
}: MissionControlLibraryDialogProps) {
  const t = useT();
  const searchRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<MissionControlLibraryFilter>("all");
  const [query, setQuery] = useState("");

  // 重新打开时清空上次搜索词（分类保留——它是稳定的浏览上下文）
  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  const filters = useMemo(() => collectLibraryFilters(items), [items]);
  // 选中的插件分类可能随插件禁用消失 → 回退"全部"（对齐设置弹窗的 fallback）
  const activeFilter = filters.includes(filter) ? filter : "all";
  const categoryFilters = filters.filter((f) => !f.startsWith("plugin:"));
  const pluginFilters = filters.filter((f) => f.startsWith("plugin:"));

  const visibleItems = useMemo(
    () => filterLibraryItems(items, activeFilter, query),
    [items, activeFilter, query]
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-[1200px] flex-col sm:max-w-[1200px]"
        closeLabel={t("dialog.close")}
        data-testid="mission-control-library"
        onOpenAutoFocus={(event) => {
          // 搜索是物料库的首要动作：打开即聚焦搜索框（对齐 quick pick 直觉）
          event.preventDefault();
          searchRef.current?.focus();
        }}
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t("missionControl.library.title")}</DialogTitle>
          <DialogDescription>
            {t("missionControl.library.description")}
          </DialogDescription>
        </DialogHeader>
        <SidebarProvider
          className="min-h-0 flex-1 items-start gap-3"
          style={SIDEBAR_STYLE}
        >
          <Sidebar className="hidden md:flex" collapsible="none">
            <SidebarContent className="overflow-visible">
              <SidebarGroupContent>
                <SidebarMenu>
                  {categoryFilters.map((f) => (
                    <FilterNavButton
                      active={activeFilter === f}
                      filter={f}
                      items={items}
                      key={f}
                      onSelect={() => setFilter(f)}
                      t={t}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
              {pluginFilters.length > 0 ? (
                <SidebarGroup className="p-0">
                  <SidebarGroupLabel>
                    {t("missionControl.library.pluginGroup")}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {pluginFilters.map((f) => (
                        <FilterNavButton
                          active={activeFilter === f}
                          filter={f}
                          items={items}
                          key={f}
                          onSelect={() => setFilter(f)}
                          t={t}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : null}
            </SidebarContent>
          </Sidebar>

          <main className="flex h-full min-h-0 flex-1 flex-col gap-3">
            <InputGroup className="shrink-0">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                data-testid="mission-control-library-search"
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("missionControl.library.searchPlaceholder")}
                ref={searchRef}
                value={query}
              />
            </InputGroup>
            <div
              className="-mr-6 min-h-0 flex-1 overflow-y-auto pr-6"
              data-scrollbar="stable"
            >
              {visibleItems.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleItems.map((item) => (
                    <LibraryItemCard
                      item={item}
                      key={item.id}
                      onAdd={onAdd}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="h-full border-0 py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t("missionControl.library.noResults")}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t("missionControl.library.noResultsHint")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
