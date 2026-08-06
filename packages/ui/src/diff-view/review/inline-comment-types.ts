/**
 * 行内评论卡片的通用投影类型（packages/ui 不耦合 host 评论契约）。
 *
 * host（git 插件）把 `CommentThread` / `CommentItem` 映射成此类型后经
 * `PierDiffView` props 注入：`authorLabel` 已解析为显示名（user → "你"，
 * agent → displayName），时间戳直传。卡片据此渲染 + 调用 `handlers`
 * 完成写操作，不直接接触 host 评论服务——对齐 hunk-actions 等其它
 * diff-view 通用槽的"数据 + 回调经 props 注入"边界。
 *
 * v1 瘦身（对标 Codex 单条批注）：每个锚点一条评论，无线程回复、无
 * resolved 状态。Thread 投影直接承载单条 comment。
 */

/** 行内评论卡片的单条评论投影。 */
export interface PierInlineReviewComment {
  readonly authorLabel: string;
  readonly body: string;
  readonly createdAt: number;
  readonly deletedAt?: number;
  readonly id: string;
}

/** 行内评论卡数据（单条评论，供卡片渲染）。 */
export interface PierInlineReviewThread {
  readonly comment: PierInlineReviewComment;
  readonly threadId: string;
}

/** 行内评论卡 i18n 文案（host 注入，禁止卡片内联用户串）。 */
export interface PierInlineReviewLabels {
  readonly authorYou: string;
  readonly close: string;
  readonly create: string;
  readonly deleteComment: string;
  readonly deleted: string;
  readonly editComment?: string;
  readonly inputPlaceholder: string;
  readonly title: string;
}

/**
 * 行内评论写操作回调（host 提供，卡片调用）。
 *
 * 卡片自带身份（`threadId` / `draftId` 从 annotation metadata 取），
 * 回调只管写操作；`onSubmitDraft` 返回 boolean（成功才清空输入框，失败
 * 保留用户输入）。已展开线程的收起不经卡片按钮——host 用 gutter /
 * 漂移入口 toggle 处理。
 */
export interface PierInlineReviewHandlers {
  /** 取消草稿（移除该 draft 槽）。 */
  readonly onCancelDraft: (draftId: string) => void;
  /** 删除评论（= 删除整条批注）。 */
  readonly onDeleteComment: (
    threadId: string,
    commentId: string
  ) => Promise<void>;
  /** 编辑评论 */
  readonly onEditComment?: (
    threadId: string,
    commentId: string,
    body: string
  ) => Promise<boolean>;
  /** 创建新评论（草稿提交）。 */
  readonly onSubmitDraft: (draftId: string, body: string) => Promise<boolean>;
}
