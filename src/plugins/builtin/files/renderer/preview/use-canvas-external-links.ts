import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type RefObject, useEffect, useRef } from "react";
import type { FilesTranslate } from "../i18n.ts";

export function isCanvasExternalHttpUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function explicitHttpHref(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute("href")?.trim() ?? "";
  if (!isCanvasExternalHttpUrl(raw)) {
    return null;
  }
  return raw;
}

export function findCanvasExternalAnchor(
  target: EventTarget | null
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }
  return explicitHttpHref(anchor) ? anchor : null;
}

/**
 * Canvas preview cannot use `target=_blank` (host denies window.open) or
 * `will-navigate` (host denies in-page navigation). Intercept http(s) clicks
 * and open via the same external-navigation path as Markdown preview.
 */
export function useCanvasExternalLinks(input: {
  readonly context: RendererPluginContext;
  readonly enabled: boolean;
  readonly hostRef: RefObject<HTMLDivElement | null>;
  readonly t: FilesTranslate;
}): void {
  const inFlightRef = useRef<string | null>(null);
  const context = input.context;
  const t = input.t;

  useEffect(() => {
    const host = input.hostRef.current;
    if (!(input.enabled && host)) {
      return;
    }

    const open = async (url: string) => {
      if (inFlightRef.current === url) {
        return;
      }
      if (inFlightRef.current) {
        context.notifications.info(
          t(
            "filePanel.markdown.externalOpenBusy",
            "Another external link is already opening."
          )
        );
        return;
      }
      inFlightRef.current = url;
      try {
        const result = await context.externalNavigation.open(url);
        if (!result.opened && result.reason === "busy") {
          context.notifications.info(
            t(
              "filePanel.markdown.externalOpenBusy",
              "Another external link is already opening."
            )
          );
        } else if (!result.opened) {
          await context.dialogs.alert({
            body: t(
              "filePanel.markdown.externalOpenFailed.description",
              "The external link could not be opened."
            ),
            title: t(
              "filePanel.markdown.externalOpenFailed.title",
              "Unable to open link"
            ),
          });
        }
      } catch (error) {
        await context.dialogs
          .alert({
            body: error instanceof Error ? error.message : String(error),
            title: t(
              "filePanel.markdown.externalOpenFailed.title",
              "Unable to open link"
            ),
          })
          .catch(() => undefined);
      } finally {
        if (inFlightRef.current === url) {
          inFlightRef.current = null;
        }
      }
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      const anchor = findCanvasExternalAnchor(event.target);
      if (!anchor) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const href = anchor.getAttribute("href")?.trim();
      if (!href) {
        return;
      }
      open(href).catch(() => undefined);
    };

    host.addEventListener("click", onClick);
    return () => {
      host.removeEventListener("click", onClick);
    };
  }, [context, input.enabled, input.hostRef, t]);
}
