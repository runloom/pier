import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing-slice.ts";

/**
 * dockview chrome（分栏 sash + 浮组）的 web 浮层登记。
 *
 * native 洞遮罩（`TerminalHoleMask`）把 visible 终端 viewport 从 web 合成层硬裁，
 * 只有登记在 `webOverlayRects` 的几何能回填。Pier 的 `pierTheme.gap = 0`，sash 直接
 * 跨在相邻终端 viewport 上，不登记就会被裁掉——表现是分栏线消失。sash 是产品
 * chrome，必须常驻登记；同一份几何也参与终端输入命中（点分栏不落到终端）。
 *
 * 浮组（`.dv-resize-container`）整体是 web 面，悬在终端上时必须回填；但浮组
 * 内部可能含可见终端（Shift 拖终端 tab 出来），整块回填会把终端自己的洞抹掉，
 * 不透明 backing 下终端变空白。因此含可见终端时只登记 chrome 部件：浮组标题栏、
 * 组 tab 条、以及不承载终端的 content 区；终端 body 继续由 native 透出。
 *
 * 生命周期：workspace host 在 `onReady` 挂载，随 workspace runtime 一起 dispose。
 * 同步时机：dockview layout change、active panel change、元素 inline style 位移
 * （浮组拖动 / 缩放 / sash 移动）、DOM 增删。
 */

const SASH_SELECTOR = ".dv-sash";
const FLOATING_CONTAINER_SELECTOR = ".dv-resize-container";
const FLOATING_TITLEBAR_SELECTOR = ".dv-floating-titlebar";
const GROUP_TABS_SELECTOR = ".dv-tabs-and-actions-container";
const GROUP_CONTENT_SELECTOR = ".dv-content-container";
const TERMINAL_ROOT_SELECTOR = '[data-testid="terminal-panel-root"]';

interface LayoutChangeSubscription {
  dispose(): void;
}

interface WorkspaceLayoutChangeSource {
  onDidActivePanelChange?(listener: () => void): LayoutChangeSubscription;
  onDidLayoutChange(listener: () => void): LayoutChangeSubscription;
}

interface OverlayEntry {
  observer: MutationObserver;
  registration: ReturnType<typeof registerTerminalElementWebOverlay>;
}

function overlayIdPrefix(element: HTMLElement): string {
  if (element.classList.contains("dv-sash")) {
    return "dockview-sash";
  }
  if (element.classList.contains("dv-resize-container")) {
    return "dockview-floating-container";
  }
  if (element.classList.contains("dv-floating-titlebar")) {
    return "dockview-floating-titlebar";
  }
  if (element.classList.contains("dv-tabs-and-actions-container")) {
    return "dockview-group-tabs";
  }
  return "dockview-group-content";
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function holdsVisibleTerminal(element: HTMLElement): boolean {
  return [
    ...element.querySelectorAll<HTMLElement>(TERMINAL_ROOT_SELECTOR),
  ].some(isVisible);
}

/**
 * 收集所有必须回填的 dockview chrome 元素。
 * 浮组内含可见终端时不能整块回填（会同时抹掉该终端自己的洞）。
 */
function collectOverlayTargets(root: HTMLElement): HTMLElement[] {
  const targets = new Set<HTMLElement>();
  for (const sash of root.querySelectorAll<HTMLElement>(SASH_SELECTOR)) {
    targets.add(sash);
  }
  for (const container of root.querySelectorAll<HTMLElement>(
    FLOATING_CONTAINER_SELECTOR
  )) {
    if (!holdsVisibleTerminal(container)) {
      targets.add(container);
      continue;
    }
    for (const chrome of container.querySelectorAll<HTMLElement>(
      `${FLOATING_TITLEBAR_SELECTOR}, ${GROUP_TABS_SELECTOR}`
    )) {
      targets.add(chrome);
    }
    for (const content of container.querySelectorAll<HTMLElement>(
      GROUP_CONTENT_SELECTOR
    )) {
      if (!holdsVisibleTerminal(content)) {
        targets.add(content);
      }
    }
  }
  return [...targets];
}

export function attachWorkspaceSashWebOverlays(
  root: HTMLElement,
  layoutChanges: WorkspaceLayoutChangeSource
): () => void {
  const entries = new Map<HTMLElement, OverlayEntry>();
  let nextSequence = 1;
  let frameRequest: number | null = null;
  let disposed = false;

  const register = (element: HTMLElement): OverlayEntry => {
    const overlayId = `${overlayIdPrefix(element)}:${nextSequence}`;
    nextSequence += 1;
    // 位置由 dockview 写 inline style（sash left/top、浮组 left/top/宽高）；
    // 尺寸不变时 ResizeObserver 不触发，等分 / 键盘改布局也没有 pointerup，
    // 所以盯 style 属性本身。浮组子元素随容器位移，容器 style 也要盯。
    const observer = new MutationObserver(scheduleSync);
    observer.observe(element, {
      attributeFilter: ["style"],
      attributes: true,
    });
    const container = element.closest<HTMLElement>(FLOATING_CONTAINER_SELECTOR);
    if (container && container !== element) {
      observer.observe(container, {
        attributeFilter: ["style"],
        attributes: true,
      });
    }
    return {
      observer,
      registration: registerTerminalElementWebOverlay(overlayId, element),
    };
  };

  const sync = (): void => {
    frameRequest = null;
    if (disposed) {
      return;
    }
    const current = new Set(collectOverlayTargets(root));
    for (const element of current) {
      const existing = entries.get(element);
      if (existing) {
        existing.registration.flush();
        continue;
      }
      entries.set(element, register(element));
    }
    for (const [element, entry] of entries) {
      if (current.has(element)) {
        continue;
      }
      entry.observer.disconnect();
      entry.registration.dispose();
      entries.delete(element);
    }
  };

  function scheduleSync(): void {
    if (disposed || frameRequest !== null) {
      return;
    }
    frameRequest = requestAnimationFrame(sync);
  }

  const layoutSubscription = layoutChanges.onDidLayoutChange(scheduleSync);
  // 切 tab 只改变可见性，不一定改 DOM 结构：active panel 变化必须重算
  // 「content 区是否承载可见终端」。
  const activePanelSubscription =
    layoutChanges.onDidActivePanelChange?.(scheduleSync) ?? null;
  // dockview 增删分栏 / 浮组时重建容器；容器也可能被整体替换而不改父结构。
  const rootObserver = new MutationObserver(scheduleSync);
  rootObserver.observe(root, { childList: true, subtree: true });

  sync();

  return () => {
    disposed = true;
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
      frameRequest = null;
    }
    layoutSubscription.dispose();
    activePanelSubscription?.dispose();
    rootObserver.disconnect();
    for (const entry of entries.values()) {
      entry.observer.disconnect();
      entry.registration.dispose();
    }
    entries.clear();
  };
}
