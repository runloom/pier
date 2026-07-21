import type { CSSProperties } from "react";

/**
 * Agent 状态词的扫光文本：单节点渲染, 动画为纯 CSS 渐变裁剪扫光
 * （globals.css [data-agent-status-text] 段, background-clip: text +
 * background-position 关键帧）——零 JS 帧循环、字形静止无抖动。
 * 高亮色经内联 --pier-agent-status-color 注入（状态色 / 长跑覆盖）。
 * prefers-reduced-motion 与 forced-colors 的降级同样由 CSS 承担。
 */
export function AgentShimmerText({
  colorVar,
  text,
}: {
  colorVar: string;
  text: string;
}) {
  const style = {
    "--pier-agent-status-color": `var(${colorVar})`,
  } as CSSProperties;

  return (
    <span data-agent-status-kind="running" data-agent-status-text style={style}>
      {text}
    </span>
  );
}
