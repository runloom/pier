import { PierFileTree, type PierFileTreeItem } from "@pier/ui/file-tree.tsx";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const ITEMS = [
  { kind: "file" as const, path: "README.md" },
] as const satisfies readonly PierFileTreeItem[];

// pier 主题的 :root CSS 变量 → @pierre/trees 的 `--trees-*-override` 槽。
// 在 host 元素的 inline style 上设 override,穿透 shadow DOM 生效,树因此
// 跟随 style preset / light-dark 切换。这里锁死每一条映射,防止有人在
// packages/ui/src/file-tree.tsx 里删/改导致文件树颜色又和主题脱钩。
const EXPECTED_OVERRIDES: Readonly<Record<string, string>> = {
  "--trees-bg-override": "var(--sidebar)",
  "--trees-fg-override": "var(--sidebar-foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-bg-muted-override": "var(--interactive-hover)",
  "--trees-input-bg-override": "var(--muted)",
  "--trees-border-color-override": "var(--sidebar-border)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-accent-override": "var(--primary)",
  "--trees-selected-bg-override": "var(--sidebar-accent)",
  "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
  "--trees-search-bg-override": "var(--muted)",
  "--trees-search-fg-override": "var(--foreground)",
  "--trees-font-family-override": "var(--pier-ui-font-family)",
  "--trees-git-added-color-override": "var(--success)",
  "--trees-git-modified-color-override": "var(--info)",
  "--trees-git-deleted-color-override": "var(--destructive)",
  "--trees-git-renamed-color-override": "var(--warning)",
  "--trees-git-untracked-color-override": "var(--success)",
  "--trees-git-ignored-color-override": "var(--muted-foreground)",
};

describe("PierFileTree theming", () => {
  it("wires every pier semantic token into the @pierre/trees override slot", () => {
    const { container } = render(<PierFileTree items={ITEMS} label="test" />);

    const host = container.querySelector(
      'file-tree-container[data-slot="pier-file-tree"]'
    );
    expect(host).toBeInstanceOf(HTMLElement);
    const inlineStyle = (host as HTMLElement).getAttribute("style") ?? "";

    for (const [name, value] of Object.entries(EXPECTED_OVERRIDES)) {
      expect(inlineStyle, `${name} should map to ${value}`).toContain(
        `${name}: ${value}`
      );
    }
  });
});
