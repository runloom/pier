import { Button } from "@pier/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@pier/ui/select.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { ChevronDown } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { panelKindOf } from "./panel-registry.ts";
import { panelTabKind } from "./panel-tab-layout.ts";
import { PanelTabLeadingIcon } from "./panel-tab-leading-icon.tsx";
import { tabStatusIndicator } from "./panel-tab-tooltip.tsx";
import { PanelTabTrailingView } from "./panel-tab-trailing.tsx";

const CLIP_EPSILON_PX = 1;
const OVERFLOW_ANCHOR_CLASS = "h-full w-0 shrink-0 overflow-hidden";
const OVERFLOW_MENU_CLASS =
  "flex h-full shrink-0 items-center justify-center px-1";

interface OverflowPanelLike {
  id: string;
}

type HeaderPanel = IDockviewHeaderActionsProps["panels"][number];

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function closestTabsContainer(element: HTMLElement | null): HTMLElement | null {
  const headerElement = element?.closest<HTMLElement>(
    ".dv-tabs-and-actions-container"
  );
  const directTabsContainer = Array.from(headerElement?.children ?? []).find(
    (child) => child.classList.contains("dv-tabs-container")
  ) as HTMLElement | undefined;
  return (
    directTabsContainer ??
    headerElement?.querySelector<HTMLElement>(".dv-tabs-container") ??
    null
  );
}

function isClippedByVisibleTabStrip(tabRect: DOMRect, containerRect: DOMRect) {
  return (
    tabRect.left < containerRect.left - CLIP_EPSILON_PX ||
    tabRect.right > containerRect.right + CLIP_EPSILON_PX
  );
}

export function getOverflowPanelIds(
  tabsContainer: HTMLElement,
  panels: readonly OverflowPanelLike[]
): string[] {
  const containerRect = tabsContainer.getBoundingClientRect();
  const knownPanelIds = new Set(panels.map((panel) => panel.id));
  const orderedTabEntries: Array<{
    element: HTMLElement;
    panelId: string;
  }> = [];

  for (const contentElement of tabsContainer.querySelectorAll<HTMLElement>(
    "[data-panel-tab-id]"
  )) {
    const panelId = contentElement.dataset.panelTabId;
    if (!(panelId && knownPanelIds.has(panelId))) {
      continue;
    }
    orderedTabEntries.push({
      element: contentElement.closest<HTMLElement>(".dv-tab") ?? contentElement,
      panelId,
    });
  }

  if (containerRect.width <= 0) {
    return orderedTabEntries.length > 0
      ? orderedTabEntries.map(({ panelId }) => panelId)
      : panels.map((panel) => panel.id);
  }

  return orderedTabEntries
    .filter(({ element: tabElement }) => {
      const tabRect = tabElement.getBoundingClientRect();
      return isClippedByVisibleTabStrip(tabRect, containerRect);
    })
    .map(({ panelId }) => panelId);
}

function useOverflowPanelIds(
  rootRef: RefObject<HTMLDivElement | null>,
  panels: readonly HeaderPanel[]
): string[] {
  const [overflowPanelIds, setOverflowPanelIds] = useState<string[]>([]);

  const updateOverflowPanels = useCallback(() => {
    const tabsContainer = closestTabsContainer(rootRef.current);
    const nextIds = tabsContainer
      ? getOverflowPanelIds(tabsContainer, panels)
      : [];
    setOverflowPanelIds((currentIds) =>
      sameIds(currentIds, nextIds) ? currentIds : nextIds
    );
  }, [panels, rootRef]);

  useLayoutEffect(() => {
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        updateOverflowPanels();
      });
    };

    scheduleUpdate();
    const tabsContainer = closestTabsContainer(rootRef.current);
    if (!tabsContainer) {
      return () => {
        if (frame !== null) {
          cancelAnimationFrame(frame);
        }
      };
    }

    tabsContainer.addEventListener("scroll", scheduleUpdate, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(tabsContainer);
    const headerElement = tabsContainer.closest<HTMLElement>(
      ".dv-tabs-and-actions-container"
    );
    if (headerElement) {
      resizeObserver?.observe(headerElement);
    }

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(tabsContainer, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      tabsContainer.removeEventListener("scroll", scheduleUpdate);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [rootRef, updateOverflowPanels]);

  useEffect(() => {
    const disposables = panels.map((panel) =>
      panel.api.onDidTitleChange(updateOverflowPanels)
    );
    return () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    };
  }, [panels, updateOverflowPanels]);

  return overflowPanelIds;
}

function PanelMenuItem({ panel }: { panel: HeaderPanel }) {
  const tab = usePanelDescriptorStore(
    (state) => state.descriptors[panel.id]?.tab
  );
  const component = panel.view.contentComponent;
  // 与 PanelTabHeader 共用 leading 图标 + 语义色 class，避免 overflow 菜单
  // 落到 Select 默认 foreground 而 tab 仍是 status / file-icon 色。
  const title = tab?.title ?? panel.title ?? "Panel";
  const kind = panelTabKind(component);
  const statusIndicator = tab?.state?.status
    ? tabStatusIndicator(tab.state.status, tab.state.label, {
        preserveSemanticColor: true,
      })
    : null;

  return (
    <SelectItem showIndicator={false} textValue={title} value={panel.id}>
      <PanelTabLeadingIcon component={component} tab={tab} />
      <span
        className={cn(
          "line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-left",
          kind === "file" && "font-mono font-normal"
        )}
        data-panel-overflow-title
        data-pier-tab-kind={kind}
      >
        {title}
      </span>
      <PanelTabTrailingView trailing={tab?.trailing} />
      {statusIndicator}
    </SelectItem>
  );
}

export function PanelOverflowMenu(props: IDockviewHeaderActionsProps) {
  const [open, setOpen] = useState(false);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const rootRef = useMemo(
    () => ({ current: rootElement }) satisfies RefObject<HTMLDivElement | null>,
    [rootElement]
  );
  const overflowPanelIds = useOverflowPanelIds(rootRef, props.panels);
  const overflowPanels = useMemo(
    () =>
      overflowPanelIds
        .map((id) => props.panels.find((panel) => panel.id === id))
        .filter((panel): panel is HeaderPanel => Boolean(panel)),
    [overflowPanelIds, props.panels]
  );
  const activatePanel = useCallback(
    (panelId: string) => {
      const revealRoot =
        rootRef.current?.closest<HTMLElement>(
          ".dv-tabs-and-actions-container"
        ) ?? undefined;
      activateWorkspacePanel({ panels: props.panels }, panelId, {
        kindOfComponent: panelKindOf,
        reveal: "always",
        ...(revealRoot && { root: revealRoot }),
      });
    },
    [props.panels, rootRef]
  );

  const hasOverflowPanels = overflowPanels.length > 0;

  if (!hasOverflowPanels) {
    return (
      <div
        aria-hidden={true}
        className={OVERFLOW_ANCHOR_CLASS}
        data-slot="panel-overflow"
        ref={setRootElement}
      />
    );
  }

  return (
    <div
      className={OVERFLOW_MENU_CLASS}
      data-slot="panel-overflow"
      ref={setRootElement}
    >
      <Select
        onOpenChange={setOpen}
        onValueChange={activatePanel}
        open={open}
        value=""
      >
        <SelectTrigger aria-label="Hidden tabs" asChild>
          <Button
            aria-label="Hidden tabs"
            size="sm"
            title="Hidden tabs"
            type="button"
            variant="secondary"
          >
            <ChevronDown data-icon="inline-start" />
            <span>{overflowPanels.length}</span>
          </Button>
        </SelectTrigger>
        <SelectContent
          align="end"
          className="w-48"
          position="popper"
          sideOffset={6}
        >
          <SelectGroup>
            {overflowPanels.map((panel) => (
              <PanelMenuItem key={panel.id} panel={panel} />
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
