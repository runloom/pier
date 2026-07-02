import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  SHIMMER_FRAME_INTERVAL_MS,
  type ShimmerTier,
  shimmerTiers,
} from "./agent-status-visual.ts";

/**
 * loomdesk shimmering-status-text 的 React 移植：逐 codepoint 渲染,
 * rAF 驱动（节流 ~30fps）重算每字符 tier, CSS 只负责 tier → 色/字重映射
 * （见 globals.css [data-agent-status-text] 段）。prefers-reduced-motion
 * 下静态钉在 mid 档, 不跑动画循环。
 */
export function AgentShimmerText({
  colorVar,
  text,
}: {
  colorVar: string;
  text: string;
}) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [tiers, setTiers] = useState<readonly ShimmerTier[]>(() =>
    shimmerTiers(text, 0)
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTiers(Array.from(text, () => "mid" as const));
      return;
    }
    let raf = 0;
    let lastFrame = 0;
    const startedAt = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastFrame < SHIMMER_FRAME_INTERVAL_MS - 1) {
        return;
      }
      lastFrame = now;
      setTiers(shimmerTiers(text, now - startedAt));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const style = {
    "--pier-agent-status-color": `var(${colorVar})`,
  } as CSSProperties;

  return (
    <span data-agent-status-kind="running" data-agent-status-text style={style}>
      {chars.map((char, index) => (
        <span
          data-char={char}
          data-shimmer-char
          data-shimmer-tier={tiers[index] ?? "low"}
          // biome-ignore lint/suspicious/noArrayIndexKey: 字符序列按位重排无语义, index 即身份
          key={index}
        >
          <span data-shimmer-glyph>{char}</span>
        </span>
      ))}
    </span>
  );
}
