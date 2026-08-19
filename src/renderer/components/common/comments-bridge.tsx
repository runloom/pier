import { useEffect } from "react";
import { registerCommentsStatusItem } from "@/panel-kits/terminal/status-items/comments.tsx";
import { registerTerminalHistoryStatusItem } from "@/panel-kits/terminal/status-items/history.tsx";
import { initComments } from "@/stores/comments.store.ts";

/**
 * 评论镜像水合桥 — 不渲染 UI（对齐 NotificationCenterBridge）。
 * 挂载时订阅 main 广播；首拉由 ensureCommentsLoaded 按需触发
 *（首次访问某 worktree 的评论 UI 时）。卸载时 detach。
 */
export function CommentsBridge(): null {
  useEffect(() => initComments(), []);
  useEffect(() => registerCommentsStatusItem(), []);
  useEffect(() => registerTerminalHistoryStatusItem(), []);
  return null;
}
