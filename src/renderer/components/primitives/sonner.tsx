"use client";

import { StatusIcon } from "@pier/ui/status-icon.tsx";
import { Loader2Icon } from "lucide-react";
import { type CSSProperties, useEffect } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let observedToaster: Element | null = null;

    const idFor = (element: HTMLElement): string => {
      let id = elementIds.get(element);
      if (!id) {
        id = crypto.randomUUID();
        elementIds.set(element, id);
      }
      return id;
    };

    const sync = () => {
      const toaster = document.querySelector("[data-sonner-toaster]");
      const toastEls = toaster
        ? [...toaster.querySelectorAll<HTMLElement>("[data-sonner-toast]")]
        : [];
      const nextIds = new Set<string>();

      for (const element of new Set(toastEls)) {
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
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        sync();
      }, 32);
    };

    const toasterObserver = new MutationObserver(scheduleSync);

    const bindToasterObserver = () => {
      const toaster = document.querySelector("[data-sonner-toaster]");
      if (!toaster || toaster === observedToaster) {
        return;
      }
      observedToaster = toaster;
      toasterObserver.disconnect();
      toasterObserver.observe(toaster, {
        attributeFilter: [
          "data-expanded",
          "data-mounted",
          "data-removed",
          "data-styled",
        ],
        attributes: true,
        childList: true,
        subtree: true,
      });
    };

    // toaster 可能晚于 bridge 挂载；body 只负责发现 toaster，属性变更收窄到 toaster 子树。
    const bodyObserver = new MutationObserver(() => {
      bindToasterObserver();
      scheduleSync();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    bindToasterObserver();
    sync();

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      toasterObserver.disconnect();
      bodyObserver.disconnect();
      for (const registration of registrations.values()) {
        registration.dispose();
      }
      registrations.clear();
    };
  }, []);

  return null;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useThemeStore((s) => s.resolvedTheme);

  return (
    <>
      <SonnerToasterTerminalOverlayBridge />
      <Sonner
        className="toaster group"
        expand
        gap={10}
        icons={{
          success: <StatusIcon kind="success" />,
          info: <StatusIcon kind="info" />,
          warning: <StatusIcon kind="warning" />,
          error: <StatusIcon kind="error" />,
          loading: (
            <Loader2Icon className="size-[18px] animate-spin text-[color:var(--toast-foreground)]" />
          ),
        }}
        offset={{ top: "calc(var(--app-titlebar-height) + 24px)" }}
        position="top-center"
        style={
          {
            "--normal-bg": "var(--toast-surface)",
            "--normal-text": "var(--toast-foreground)",
            "--normal-border": "transparent",
            "--border-radius": "9999px",
            /* toaster 需要真实宽度才能 left:50%+translateX(-50%) 居中；
               abspos 子项不撑开 max-content，会塌成 0 宽导致胶囊从中线往右偏。 */
            "--width": "min(420px, calc(100vw - 32px))",
          } as CSSProperties
        }
        theme={theme}
        toastOptions={{
          classNames: {
            toast: "cn-toast pier-toast app-no-drag",
            title: "pier-toast-title",
            description: "hidden",
            actionButton: "pier-toast-action app-no-drag",
            cancelButton: "hidden",
            closeButton: "hidden",
          },
        }}
        {...props}
      />
    </>
  );
};

export { Toaster };
