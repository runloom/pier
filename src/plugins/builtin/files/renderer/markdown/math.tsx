import katex from "katex";
import "katex/dist/katex.css";
import { useEffect, useRef } from "react";

const MAX_MATH_SOURCE_LENGTH = 32 * 1024;

export function MarkdownMath({
  displayMode,
  value,
}: {
  displayMode: boolean;
  value: string;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const oversized = value.length > MAX_MATH_SOURCE_LENGTH;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || oversized) return;
    katex.render(value, root, {
      displayMode,
      errorColor: "currentColor",
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    });
  }, [displayMode, oversized, value]);
  if (oversized) {
    return (
      <code
        className={
          displayMode
            ? "my-4 block overflow-x-auto font-mono text-sm"
            : undefined
        }
      >
        {value}
      </code>
    );
  }
  return (
    <span data-markdown-math={displayMode ? "block" : "inline"} ref={rootRef} />
  );
}
