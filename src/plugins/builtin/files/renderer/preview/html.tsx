import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { HtmlPreviewTicketIssueResult } from "@shared/contracts/file/html-preview-ticket.ts";
import { buildHtmlPreviewUrl } from "@shared/contracts/file/html-preview-url.ts";
import { Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFilesDocument } from "../document/use-document.ts";
import type { FilesTranslate } from "../i18n.ts";

export const HTML_PREVIEW_TOUCH_INTERVAL_MS = 4 * 60_000;

type HtmlPreviewFailReason = Extract<
  HtmlPreviewTicketIssueResult,
  { issued: false }
>["reason"];

function failDescriptionKey(reason: HtmlPreviewFailReason): string {
  if (reason === "not-found") {
    return "filePanel.htmlPreview.fail.notFound";
  }
  if (reason === "outside-root") {
    return "filePanel.htmlPreview.fail.outsideRoot";
  }
  if (reason === "forbidden") {
    return "filePanel.htmlPreview.fail.forbidden";
  }
  return "filePanel.htmlPreview.fail.retryable";
}

function failDescriptionFallback(reason: HtmlPreviewFailReason): string {
  if (reason === "not-found") {
    return "This file could not be found. It may have been moved or deleted.";
  }
  if (reason === "outside-root") {
    return "This file is outside the current project.";
  }
  if (reason === "forbidden") {
    return "Pier doesn’t have permission to read this file.";
  }
  return "The preview couldn’t be loaded. Try again.";
}

function releaseTicket(
  context: RendererPluginContext,
  ticket: string | null
): void {
  if (!ticket) {
    return;
  }
  context.htmlPreviews.release(ticket).catch(() => undefined);
}

/**
 * 磁盘 HTML 的 iframe 预览：票据化 URL（pier-html-preview:）+ 沙箱
 * `allow-scripts`（不加 allow-same-origin —— 两者同挂等于沙箱失效）。
 * 预览渲染磁盘已保存内容；document.revision（保存/外部变更落盘）触发重签重载。
 * 首屏骨架盖到 iframe onLoad；换票时旧帧留到新帧 load，且换票前不吊销旧票。
 */
export function FileHtmlPreview(props: {
  context: RendererPluginContext;
  documentId: string;
  path: string;
  root: string;
  t: FilesTranslate;
}) {
  const document = useFilesDocument(props.documentId);
  const revision = document?.revision ?? null;
  const [retryNonce, setRetryNonce] = useState(0);
  const [liveSrc, setLiveSrc] = useState("");
  const [pendingSrc, setPendingSrc] = useState("");
  const [failedReason, setFailedReason] =
    useState<HtmlPreviewFailReason | null>(null);
  const liveTicketRef = useRef<string | null>(null);
  const pendingTicketRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    const reloadToken = `${revision ?? ""}:${retryNonce}`;
    setFailedReason(null);
    let cancelled = false;
    props.context.htmlPreviews
      .issue({ path: props.path, root: props.root })
      .then((result) => {
        if (cancelled || requestGenerationRef.current !== requestGeneration) {
          if (result.issued) {
            releaseTicket(props.context, result.ticket);
          }
          return;
        }
        if (!result.issued) {
          if (liveTicketRef.current) {
            const pending = pendingTicketRef.current;
            pendingTicketRef.current = null;
            setPendingSrc("");
            releaseTicket(props.context, pending);
            return;
          }
          pendingTicketRef.current = null;
          liveTicketRef.current = null;
          setPendingSrc("");
          setLiveSrc("");
          setFailedReason(result.reason);
          return;
        }
        const replacedPending = pendingTicketRef.current;
        pendingTicketRef.current = result.ticket;
        setPendingSrc(
          `${buildHtmlPreviewUrl(result.ticket, result.relPath)}?r=${encodeURIComponent(reloadToken)}`
        );
        if (replacedPending && replacedPending !== result.ticket) {
          releaseTicket(props.context, replacedPending);
        }
      })
      .catch(() => {
        if (cancelled || requestGenerationRef.current !== requestGeneration) {
          return;
        }
        if (liveTicketRef.current) {
          const pending = pendingTicketRef.current;
          pendingTicketRef.current = null;
          setPendingSrc("");
          releaseTicket(props.context, pending);
          return;
        }
        pendingTicketRef.current = null;
        liveTicketRef.current = null;
        setPendingSrc("");
        setLiveSrc("");
        setFailedReason("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [props.context, props.path, props.root, revision, retryNonce]);

  useEffect(
    () => () => {
      releaseTicket(props.context, liveTicketRef.current);
      releaseTicket(props.context, pendingTicketRef.current);
      liveTicketRef.current = null;
      pendingTicketRef.current = null;
    },
    [props.context]
  );

  useEffect(() => {
    const tickets = [
      liveSrc ? liveTicketRef.current : null,
      pendingSrc ? pendingTicketRef.current : null,
    ].filter((ticket): ticket is string => Boolean(ticket));
    if (tickets.length === 0 || failedReason) {
      return;
    }
    const timer = window.setInterval(() => {
      for (const ticket of tickets) {
        props.context.htmlPreviews.touch(ticket).then(
          (ok) => {
            if (ok) {
              return;
            }
            if (ticket === liveTicketRef.current && !pendingTicketRef.current) {
              liveTicketRef.current = null;
              setLiveSrc("");
              setFailedReason("unavailable");
            }
          },
          () => undefined
        );
      }
    }, HTML_PREVIEW_TOUCH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [failedReason, liveSrc, pendingSrc, props.context]);

  const commitPending = (src: string) => {
    const retiring = liveTicketRef.current;
    liveTicketRef.current = pendingTicketRef.current;
    pendingTicketRef.current = null;
    setLiveSrc(src);
    setPendingSrc("");
    if (retiring && retiring !== liveTicketRef.current) {
      releaseTicket(props.context, retiring);
    }
  };

  if (failedReason) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Globe />
          </EmptyMedia>
          <EmptyTitle>
            {props.t(
              "filePanel.htmlPreview.loadFailed",
              "Couldn’t load preview"
            )}
          </EmptyTitle>
          <EmptyDescription>
            {props.t(
              failDescriptionKey(failedReason),
              failDescriptionFallback(failedReason)
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              setRetryNonce((nonce) => nonce + 1);
            }}
            type="button"
            variant="outline"
          >
            {props.t("filePanel.htmlPreview.retry", "Retry")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const dirty = document
    ? document.savedContents !== document.currentContents
    : false;
  const showSkeleton = !liveSrc;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {dirty ? (
        <div
          className="shrink-0 border-border border-b px-3 py-1.5 text-muted-foreground text-xs"
          data-slot="file-html-preview-dirty"
        >
          {props.t(
            "filePanel.htmlPreview.dirtyHint",
            "Preview shows the saved file. Save to update it."
          )}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {liveSrc ? (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: iframe load failures are scoped to the ticketed preview URL
          <iframe
            className="size-full border-0"
            data-slot="file-html-preview-frame"
            onError={() => {
              if (pendingSrc) {
                return;
              }
              liveTicketRef.current = null;
              setLiveSrc("");
              setFailedReason("unavailable");
            }}
            sandbox="allow-scripts"
            src={liveSrc}
            title={document?.name ?? props.path}
          />
        ) : null}
        {pendingSrc ? (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: iframe load failures are scoped to the ticketed preview URL
          <iframe
            className={cn(
              "size-full border-0",
              liveSrc && "pointer-events-none absolute inset-0 opacity-0"
            )}
            data-slot="file-html-preview-frame-pending"
            onError={() => {
              const pending = pendingTicketRef.current;
              pendingTicketRef.current = null;
              setPendingSrc("");
              releaseTicket(props.context, pending);
              if (!liveTicketRef.current) {
                setFailedReason("unavailable");
              }
            }}
            onLoad={() => {
              commitPending(pendingSrc);
            }}
            sandbox="allow-scripts"
            src={pendingSrc}
            title={document?.name ?? props.path}
          />
        ) : null}
        {showSkeleton ? (
          <div
            className={cn(
              "mx-auto w-full max-w-5xl px-6 py-5",
              pendingSrc && "absolute inset-0 z-10 bg-background"
            )}
            data-slot="file-html-preview-loading"
            role="status"
          >
            <span className="sr-only">
              {props.t("filePanel.htmlPreview.loading", "Loading preview")}
            </span>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-1/3 rounded-md" />
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-4 w-4/5 rounded-md" />
              <Skeleton className="h-28 w-full rounded-md" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
