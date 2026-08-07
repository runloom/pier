/**
 * Diff 行内评论 gutter 文案 + 文件级 drift chip。
 *
 * gutter `+` UI 走 `@pierre/diffs` 原生 `enableGutterUtility`；点击激活由
 * `use-content-selection` capture 拦截（避免 Pierre gutterSelecting 写蓝选），
 * 再经 `activateGutterReview` / `gutterReviewThreadForLine` 调 host
 * `onGutterReviewActivate`。本模块不再自绘 gutter 按钮。保留：
 * ① `gutterReviewThreadForLine`（按 (side, lineNumber) 查询该行线程）；
 * ② `PierGutterReviewEvent` 事件类型；
 * ③ `DriftCommentChip`（文件 header metadata 行的 drift chip）。
 *
 * v1 瘦身：每锚点一条评论、无 open/resolved 分支。有评论的行由 base
 * `review-thread` annotation 常驻渲染评论卡，gutter 无计数/展开文案。
 */
import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../button.tsx";
import type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
} from "../items.ts";

/**
 * gutter 评论入口激活事件（host 据此在该行打开新建草稿）。
 * `threadId` 为该行已有线程的 id（仅上下文信息）——已有评论恒常驻行内，
 * 入口不承担展开/收起。
 */
export interface PierGutterReviewEvent {
  readonly itemId: string;
  readonly lineNumber: number;
  /** 'deletions' | 'additions' — 与 AnnotationSide / thread.side 同源。 */
  readonly side: "additions" | "deletions";
  /** 已有评论线程 id；缺省表示该行无评论（新建）。 */
  readonly threadId?: string;
}

/**
 * 按 (side, lineNumber) 查询该行评论线程。
 *
 * 一行至多一个线程（git-diff 锚定单行）；多线程合并由 host 投影期处理，
 * gutter 只取首个匹配。返回 undefined 时 gutter 不渲染入口。
 */
export function gutterReviewThreadForLine(
  threads: readonly PierDiffReviewCommentThread[] | undefined,
  side: "additions" | "deletions",
  lineNumber: number
): PierDiffReviewCommentThread | undefined {
  if (threads === undefined) {
    return;
  }
  return threads.find(
    (thread) => thread.side === side && thread.line === lineNumber
  );
}

/**
 * 文件级 drift 评论 chip（漂移 + git-file 文件级）的 aria/title 文案。
 *
 * 渲染在文件 header metadata 行（非 gutter），每个 drift 线程一个 chip；
 * tooltip 区分行内漂移（带原 anchor 行号）与文件级（无锚点）。
 */
export interface PierDriftCommentLabels {
  /** 行内漂移评论 chip tooltip（{{line}} 占位）。 */
  readonly driftedLineComment: string;
  /** 文件级漂移折叠区 summary：行内漂移原行号（{{line}} 占位）。 */
  readonly driftedLineLabel: string;
  /** 文件级评论 chip tooltip（无占位）。 */
  readonly fileComment: string;
  /** 文件级漂移折叠区 summary：文件级评论（无 anchor）。 */
  readonly fileLabel: string;
  /** 文件级漂移折叠区标题（「代码已修改」，对齐 GitHub outdated）。 */
  readonly sectionHeading: string;
}

/** 按 thread.line 区分漂移/文件级，套用对应模板。 */
export function driftChipLabel(
  thread: PierDiffReviewDriftThread,
  labels: PierDriftCommentLabels
): string {
  if (thread.line !== undefined) {
    return labels.driftedLineComment.replaceAll(
      "{{line}}",
      String(thread.line)
    );
  }
  return labels.fileComment;
}

/**
 * 文件级 drift 评论 chip。渲染在文件 header metadata 行（light-DOM），
 * 每个 drift 线程一个 icon-xs 按钮；点击触发 {@link onActivate} 由 host
 * 打开评论卡。中性 ghost，不抢 gutter `+` 蓝色动作色。
 */
export function DriftCommentChip({
  labels,
  onActivate,
  thread,
}: {
  readonly labels: PierDriftCommentLabels;
  readonly onActivate: () => void;
  readonly thread: PierDiffReviewDriftThread;
}): ReactNode {
  const label = driftChipLabel(thread, labels);
  return (
    <Button
      aria-label={label}
      data-pier-drift-review="present"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size="icon-xs"
      title={label}
      tone="muted"
      type="button"
      variant="ghost"
    >
      <MessageSquare aria-hidden data-icon="inline-start" />
    </Button>
  );
}
