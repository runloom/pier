import { createSeparator } from "@pierre/diffs";
import { expect, it } from "vitest";
import { createFormatUnmodifiedLines } from "../../../../packages/ui/src/diff-view/use-code-options.ts";

function collectTextByAttr(
  node: unknown,
  attr: string,
  out: string[] = []
): string[] {
  if (!node || typeof node !== "object") {
    return out;
  }
  const el = node as {
    children?: unknown[];
    properties?: Record<string, unknown>;
    type?: string;
    value?: string;
  };
  if (el.type === "text" && typeof el.value === "string") {
    return out;
  }
  const props = el.properties ?? {};
  const hasAttr = Object.hasOwn(props, attr);
  if (hasAttr && Array.isArray(el.children)) {
    const text = el.children
      .map((child) => {
        if (
          child &&
          typeof child === "object" &&
          (child as { type?: string }).type === "text"
        ) {
          return String((child as { value?: string }).value ?? "");
        }
        return "";
      })
      .join("");
    out.push(text);
  }
  if (Array.isArray(el.children)) {
    for (const child of el.children) {
      collectTextByAttr(child, attr, out);
    }
  }
  return out;
}

it("formats singular and plural unmodified-line templates for pierre", () => {
  expect(createFormatUnmodifiedLines({})(1)).toBe("1 unmodified line");
  expect(createFormatUnmodifiedLines({})(12)).toBe("12 unmodified lines");
  const zh = createFormatUnmodifiedLines({
    unmodifiedLine: "{{count}} 行未修改",
    unmodifiedLines: "{{count}} 行未修改",
  });
  expect(zh(1)).toBe("1 行未修改");
  expect(zh(42)).toBe("42 行未修改");
});

it("patched createSeparator uses localized content and expand-all label", () => {
  const format = createFormatUnmodifiedLines({
    unmodifiedLine: "{{count}} 行未修改",
    unmodifiedLines: "{{count}} 行未修改",
  });
  const separator = createSeparator({
    type: "line-info",
    content: format(42),
    expandIndex: 0,
    chunked: true,
    slotName: "hunk-0",
    isFirstHunk: false,
    isLastHunk: false,
    expandAllLabel: "全部展开",
  });

  expect(collectTextByAttr(separator, "data-unmodified-lines")).toEqual([
    "42 行未修改",
  ]);
  expect(collectTextByAttr(separator, "data-expand-all-button")).toEqual([
    "全部展开",
  ]);
});

it("patched DiffHunksRenderer stores formatUnmodifiedLines option", async () => {
  const { DiffHunksRenderer } = await import("@pierre/diffs");
  const format = createFormatUnmodifiedLines({
    unmodifiedLine: "{{count}} 行未修改",
    unmodifiedLines: "{{count}} 行未修改",
  });
  const renderer = new DiffHunksRenderer({
    expandAllUnmodifiedLabel: "全部展开",
    formatUnmodifiedLines: format,
  });
  expect(renderer.options.formatUnmodifiedLines?.(3)).toBe("3 行未修改");
  expect(renderer.options.expandAllUnmodifiedLabel).toBe("全部展开");
});
