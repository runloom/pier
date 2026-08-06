/**
 * 文件级漂移评论折叠区（F5，文件 header 下，对齐 GitHub outdated）。
 *
 * 由 `renderAnnotation` 在 `review-drift` annotation 槽内渲染（文件级
 * `lineNumber: 0` annotation，首个 hunk 前）。每个 drift 线程一个可折叠
 * 条目：summary 行（原行号 / 文件级）+ 展开态复用 `InlineReviewThreadCard`
 * （完整 thread 经 `threadById` 查，写操作复用行内 `handlers`）。折叠由
 * CollapsibleTrigger 自己切换，卡片不再提供关闭按钮。
 *
 * v1 瘦身：无 open/resolved 状态徽标；折叠走 shadcn `Collapsible` 原语。
 * 区域壳保留 diff 文件级折叠区样式（非卡片）。
 */
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../../button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../collapsible.tsx";
import type { PierDriftCommentLabels } from "../gutter/gutter-comments.tsx";
import type { PierDiffReviewDriftThread } from "../items.ts";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./inline-comment-types.ts";
import { InlineReviewThreadCard } from "./inline-thread-card.tsx";

export function DriftedComments({
  driftCommentLabels,
  handlers,
  labels,
  threadById,
  threads,
}: {
  readonly driftCommentLabels: PierDriftCommentLabels;
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly threadById: ReadonlyMap<string, PierInlineReviewThread>;
  readonly threads: readonly PierDiffReviewDriftThread[];
}): ReactNode {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const toggle = useCallback((threadId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);
  return (
    <div
      className="flex flex-col gap-1.5 border-border border-b bg-muted/20 py-2 text-sm"
      data-slot="pier-diff-drift-comments"
    >
      <div className="flex items-center gap-2 px-4 text-muted-foreground text-xs">
        <MessageSquare
          aria-hidden
          className="size-3.5 shrink-0"
          data-icon="inline-start"
        />
        <span>{driftCommentLabels.sectionHeading}</span>
      </div>
      {threads.map((thread) => {
        const expanded = expandedIds.has(thread.threadId);
        const lineLabel =
          thread.line === undefined
            ? driftCommentLabels.fileLabel
            : driftCommentLabels.driftedLineLabel.replaceAll(
                "{{line}}",
                String(thread.line)
              );
        const full = threadById.get(thread.threadId);
        return (
          <Collapsible
            className="px-2"
            key={thread.threadId}
            onOpenChange={(open) => {
              if (open !== expanded) {
                toggle(thread.threadId);
              }
            }}
            open={expanded}
          >
            <CollapsibleTrigger asChild>
              <Button
                className="w-full justify-start gap-2"
                tone="muted"
                variant="ghost"
              >
                {expanded ? (
                  <ChevronDown aria-hidden data-icon="inline-start" />
                ) : (
                  <ChevronRight aria-hidden data-icon="inline-start" />
                )}
                <span className="min-w-0 truncate">{lineLabel}</span>
              </Button>
            </CollapsibleTrigger>
            {full === undefined ? null : (
              <CollapsibleContent>
                <div className="mt-1.5">
                  <InlineReviewThreadCard
                    handlers={handlers}
                    labels={labels}
                    thread={full}
                  />
                </div>
              </CollapsibleContent>
            )}
          </Collapsible>
        );
      })}
    </div>
  );
}
