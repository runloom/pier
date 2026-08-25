/**
 * Agent 状态词的扫光文本：单节点渲染, 动画为纯 CSS 渐变裁剪扫光
 * （globals.css [data-agent-status-text] 段, background-clip: text +
 * background-position 关键帧）——零 JS 帧循环、字形静止无抖动。
 * prefers-reduced-motion 与 forced-colors 的降级同样由 CSS 承担。
 */
export function AgentShimmerText({ text }: { text: string }) {
  return (
    <span data-agent-status-kind="running" data-agent-status-text>
      {text}
    </span>
  );
}
