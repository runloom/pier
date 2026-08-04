import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
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
import { useT } from "@/i18n/use-t.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { panelKindOf } from "./panel-registry.ts";
import {
  type PanelTabFileParams,
  panelTabKind,
  panelTabParamsIsDirty,
  panelTabParamsIsPreview,
} from "./panel-tab-layout.ts";
import { PanelTabLeadingIcon } from "./panel-tab-leading-icon.tsx";
import { tabStatusIndicator } from "./panel-tab-tooltip.tsx";
import { PanelTabTrailingView } from "./panel-tab-trailing.tsx";

const CLIP_EPSILON_PX = 1;
const OVERFLOW_ANCHOR_CLASS = "h-full w-0 shrink-0 overflow-hidden";
const OVERFLOW_MENU_CLASS =
  "flex h-full shrink-0 items-center justify-center px-1";
/** Grow with titles; cap so long paths wrap instead of spanning the window. */
const OVERFLOW_CONTENT_CLASS =
  "min-w-56 w-max max-w-[min(28rem,var(--radix-popper-available-width,28rem))]";

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

/** Live file chrome (preview / dirty) so overflow mirrors the strip. */
function usePanelFileParams(
  panel: HeaderPanel
): PanelTabFileParams | undefined {
  const [params, setParams] = useState<PanelTabFileParams | undefined>(
    () => panel.params as PanelTabFileParams | undefined
  );

  useEffect(() => {
    setParams(panel.params as PanelTabFileParams | undefined);
    const disposable = panel.api.onDidParametersChange((next) => {
      setParams(next as PanelTabFileParams | undefined);
    });
    return () => {
      disposable.dispose();
    };
  }, [panel]);

  return params;
}

function PanelMenuItem({
  onSelect,
  panel,
}: {
  onSelect: (panelId: string) => void;
  panel: HeaderPanel;
}) {
  const t = useT();
  const tab = usePanelDescriptorStore(
    (state) => state.descriptors[panel.id]?.tab
  );
  const params = usePanelFileParams(panel);
  const component = panel.view.contentComponent;
  // Same label as the dockview tab strip — never swap in tooltip/long text.
  const title = tab?.title ?? panel.title ?? "Panel";
  const kind = panelTabKind(component);
  const isPreview = panelTabParamsIsPreview(component, params);
  const isDirty = panelTabParamsIsDirty(component, params);
  // Menu surface: compact status icon — never the tab-strip running shimmer.
  const statusIndicator = tab?.state?.status
    ? tabStatusIndicator(tab.state.status, tab.state.label, {
        surface: "menu",
      })
    : null;

  return (
    <DropdownMenuItem
      className="min-w-0 gap-2"
      data-pier-tab-preview={isPreview ? "true" : undefined}
      onSelect={() => {
        onSelect(panel.id);
      }}
    >
      <PanelTabLeadingIcon component={component} tab={tab} />
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-normal break-words text-left leading-5",
          kind === "file" && "font-mono font-normal",
          isPreview && "italic"
        )}
        data-panel-overflow-title
        data-pier-tab-kind={kind}
      >
        {title}
      </span>
      <PanelTabTrailingView trailing={tab?.trailing} />
      {isDirty ? (
        <span
          aria-label={t("workspace.tab.unsaved")}
          className="size-1.5 shrink-0 rounded-full bg-warning"
          data-pier-tab-dirty="true"
          role="status"
        />
      ) : null}
      {statusIndicator}
    </DropdownMenuItem>
  );
}

export function PanelOverflowMenu(props: IDockviewHeaderActionsProps) {
  const t = useT();
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
  const hiddenTabsLabel = t("workspace.tab.hiddenTabs");

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
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={hiddenTabsLabel}
            size="sm"
            type="button"
            variant="secondary"
          >
            <ChevronDown data-icon="inline-start" />
            <span>{overflowPanels.length}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={OVERFLOW_CONTENT_CLASS}
          data-slot="panel-overflow-content"
          sideOffset={6}
        >
          <DropdownMenuGroup>
            {overflowPanels.map((panel) => (
              <PanelMenuItem
                key={panel.id}
                onSelect={activatePanel}
                panel={panel}
              />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
