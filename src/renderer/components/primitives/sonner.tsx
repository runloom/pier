"use client";

import { StatusIcon } from "@pier/ui/status-icon.tsx";
import { Loader2Icon } from "lucide-react";
import { type CSSProperties, useEffect } from "react";
import { Toaster as Sonner } from "sonner";
import {
  TOAST_CAPSULE_HEIGHT_PX,
  TOAST_CENTER_MAX_WIDTH_PX,
  TOAST_EDGE_INSET_PX,
  TOAST_GAP_PX,
  TOAST_LANE_CLEARANCE_PX,
  TOAST_STACK_DEPTH,
} from "@/lib/notifications/toast-metrics.ts";
import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing-slice.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

/**
 * Toast 浮在终端 NSView 上时必须登记 webOverlayRects，否则 action
 * 按钮点击会被 native 吃掉（看起来可点、实际无响应）。
 * 按每条 toast 胶囊登记，避免整条 toaster 轨道误挡终端。
 * overlay id 绑定 DOM 节点（WeakMap），不用 Sonner 空的 data-sonner-toast / 数组 index。
 */
function SonnerToasterTerminalOverlayBridge(): null {
  useEffect(() => {
    const registrations = new Map<
      string,
      ReturnType<typeof registerTerminalElementWebOverlay>
    >();
    const elementIds = new WeakMap<HTMLElement, string>();
    let syncFrame: number | null = null;

    const idFor = (element: HTMLElement): string => {
      let id = elementIds.get(element);
      if (!id) {
        id = crypto.randomUUID();
        elementIds.set(element, id);
      }
      return id;
    };

    const setToastInteractivity = (
      element: HTMLElement,
      interactive: boolean
    ) => {
      const tabIndex = interactive ? "0" : "-1";
      if (element.getAttribute("tabindex") !== tabIndex) {
        element.setAttribute("tabindex", tabIndex);
      }
      if (interactive) {
        element.removeAttribute("inert");
      } else {
        element.setAttribute("inert", "");
      }
    };

    const sync = () => {
      // Sonner 按 position 各渲一个 ol[data-sonner-toaster]（如 top-center + top-right）。
      const toasters = document.querySelectorAll("[data-sonner-toaster]");
      const toastEls = [...toasters].flatMap((toaster) => [
        ...toaster.querySelectorAll<HTMLElement>("[data-sonner-toast]"),
      ]);
      const nextIds = new Set<string>();

      for (const element of new Set(toastEls)) {
        const visible = element.dataset.visible !== "false";
        const interactive =
          visible &&
          (element.dataset.expanded === "true" ||
            element.dataset.front === "true");

        // 折叠 / 隐藏前先把焦点移到可见前条：inert 会让焦点掉到 body。
        if (!interactive) {
          const active = document.activeElement;
          if (active instanceof HTMLElement && element.contains(active)) {
            const front = element.parentElement?.querySelector<HTMLElement>(
              '[data-sonner-toast][data-front="true"]'
            );
            if (front && front !== element) {
              setToastInteractivity(front, true);
              front.focus({ preventScroll: true });
            }
          }
        }

        setToastInteractivity(element, interactive);

        // 隐藏条不登记终端洞：否则终端上会留下一块不可见的命中区。
        if (!visible) {
          continue;
        }

        const overlayId = `sonner-toast:${idFor(element)}`;
        nextIds.add(overlayId);
        const existing = registrations.get(overlayId);
        if (existing) {
          existing.flush();
          continue;
        }
        registrations.set(
          overlayId,
          registerTerminalElementWebOverlay(overlayId, element)
        );
      }

      for (const [overlayId, registration] of registrations) {
        if (nextIds.has(overlayId)) {
          continue;
        }
        registration.dispose();
        registrations.delete(overlayId);
      }
    };

    const scheduleSync = () => {
      if (syncFrame !== null) {
        return;
      }
      syncFrame = requestAnimationFrame(() => {
        syncFrame = null;
        sync();
      });
    };

    const isToastNode = (node: Node): boolean =>
      node instanceof Element &&
      (node.matches("[data-sonner-toaster], [data-sonner-toast]") ||
        node.querySelector("[data-sonner-toaster], [data-sonner-toast]") !==
          null);

    const isToastMutation = (record: MutationRecord): boolean => {
      if (record.type === "attributes") {
        return (
          record.target instanceof Element &&
          record.target.closest("[data-sonner-toaster]") !== null
        );
      }
      if (record.type !== "childList") {
        return false;
      }
      if (
        record.target instanceof Element &&
        record.target.closest("[data-sonner-toaster]") !== null
      ) {
        return true;
      }
      return [...record.addedNodes, ...record.removedNodes].some(isToastNode);
    };

    // 单一 body 子树观察器：toaster 可能晚于 bridge 挂载，toast 清空时 ol 也会
    // 卸载。不要按 body 变更反复 disconnect / observe —— 那会丢掉同一批
    // MutationRecord（例如最早一条从 hidden 变 visible），它永远不登记。
    // 只处理 toaster / toast 相关变更，避免终端等 DOM 抖动每帧重读 3 条几何。
    const observer = new MutationObserver((records) => {
      if (records.some(isToastMutation)) {
        scheduleSync();
      }
    });
    observer.observe(document.body, {
      attributeFilter: [
        "data-expanded",
        "data-front",
        "data-mounted",
        "data-removed",
        "data-styled",
        "data-visible",
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });
    sync();

    return () => {
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame);
      }
      observer.disconnect();
      for (const registration of registrations.values()) {
        registration.dispose();
      }
      registrations.clear();
    };
  }, []);

  return null;
}

const Toaster = () => {
  const theme = useThemeStore((s) => s.resolvedTheme);

  return (
    <>
      <SonnerToasterTerminalOverlayBridge />
      <Sonner
        className="toaster group"
        gap={TOAST_GAP_PX}
        icons={{
          success: <StatusIcon kind="success" />,
          info: <StatusIcon kind="info" />,
          warning: <StatusIcon kind="warning" />,
          error: <StatusIcon kind="error" />,
          loading: (
            <Loader2Icon className="size-[18px] animate-spin text-[color:var(--toast-foreground)]" />
          ),
        }}
        offset={{
          // 形态 B 消息 toast 用 top-right 时需要 right；形态 A 只用 top。
          right: `${TOAST_EDGE_INSET_PX}px`,
          top: `calc(var(--app-titlebar-height) + ${TOAST_EDGE_INSET_PX}px)`,
        }}
        // 默认中间上方（确认型短提示）；消息型在 showNotificationToast 里传 position: top-right。
        position="top-center"
        style={
          {
            "--normal-bg": "var(--toast-surface)",
            "--normal-text": "var(--toast-foreground)",
            "--normal-border": "transparent",
            "--border-radius": "9999px",
            "--width": `min(${TOAST_CENTER_MAX_WIDTH_PX}px, calc(100vw - 32px))`,
            "--pier-toast-center-width": `${TOAST_CENTER_MAX_WIDTH_PX}px`,
            "--pier-toast-capsule-height": `${TOAST_CAPSULE_HEIGHT_PX}px`,
            "--pier-toast-lane-clearance": `${TOAST_LANE_CLEARANCE_PX}px`,
          } as CSSProperties
        }
        theme={theme}
        toastOptions={{
          classNames: {
            toast: "cn-toast pier-toast app-no-drag",
            title: "pier-toast-title",
            actionButton: "pier-toast-action app-no-drag",
            cancelButton: "hidden",
          },
        }}
        visibleToasts={TOAST_STACK_DEPTH}
      />
    </>
  );
};

export { Toaster };
