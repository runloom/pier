"use client";

import { cn } from "@pier/ui/utils.ts";
import { Loader2Icon } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
} from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing-slice.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

function StatusGlyph({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        className
      )}
    >
      {children}
    </span>
  );
}

function CheckGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" className="size-2" fill="none" viewBox="0 0 10 10">
      <path
        d="M1.5 5.2 3.8 7.5 8.5 2.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function BangGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="size-2"
      fill="currentColor"
      viewBox="0 0 10 10"
    >
      <rect height="5" rx="0.8" width="1.6" x="4.2" y="1.2" />
      <circle cx="5" cy="8.1" r="0.95" />
    </svg>
  );
}

function InfoGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="size-2"
      fill="currentColor"
      viewBox="0 0 10 10"
    >
      <circle cx="5" cy="2.4" r="0.95" />
      <rect height="4.6" rx="0.8" width="1.6" x="4.2" y="4" />
    </svg>
  );
}

function WarningGlyph(): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center text-[color:var(--warning)]"
    >
      <svg
        aria-hidden="true"
        className="size-4"
        fill="currentColor"
        viewBox="0 0 18 18"
      >
        <path d="M8.05 2.6c.4-.72 1.5-.72 1.9 0l6.2 11.05c.4.72-.1 1.6-.95 1.6H2.8c-.85 0-1.35-.88-.95-1.6L8.05 2.6Z" />
        <g fill="var(--status-solid-foreground)">
          <rect height="5" rx="0.8" width="1.6" x="8.2" y="6.2" />
          <circle cx="9" cy="13.1" r="0.95" />
        </g>
      </svg>
    </span>
  );
}

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
          success: (
            <StatusGlyph className="bg-[color:var(--success)] text-status-solid-foreground">
              <CheckGlyph />
            </StatusGlyph>
          ),
          info: (
            <StatusGlyph className="bg-[color:var(--info)] text-status-solid-foreground">
              <InfoGlyph />
            </StatusGlyph>
          ),
          warning: <WarningGlyph />,
          error: (
            <StatusGlyph className="bg-[color:var(--destructive)] text-status-solid-foreground">
              <BangGlyph />
            </StatusGlyph>
          ),
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
