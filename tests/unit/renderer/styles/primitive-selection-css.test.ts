import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier primitive selection CSS", () => {
  it("keeps command palette selected items aligned with accent selection states", () => {
    const commandSource = readFileSync(
      join(process.cwd(), "packages/ui/src/command.tsx"),
      "utf8"
    );

    // cmdk 1.1 对未选中项渲染 data-selected="false",选中样式必须用值选择器
    // (裸 data-selected 是 presence 匹配,会让所有行常态高亮、hover 无反馈)。
    expect(commandSource).toContain("data-[selected=true]:bg-accent");
    expect(commandSource).toContain(
      "data-[selected=true]:text-accent-foreground"
    );
    expect(commandSource).not.toContain("data-selected:bg-accent");
    expect(commandSource).not.toContain("data-[selected=true]:bg-muted");
  });
});
