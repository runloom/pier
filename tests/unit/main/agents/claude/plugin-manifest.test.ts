import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pier.claude manifest", () => {
  it("keeps accounts widget refreshable=false so host does not double-render refresh", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/plugin-claude/plugin.json"),
        "utf8"
      )
    ) as {
      workbenchWidgets: Array<{ id: string; refreshable?: boolean }>;
    };
    const widget = raw.workbenchWidgets.find(
      (entry) => entry.id === "pier.claude.accounts"
    );
    expect(widget).toBeTruthy();
    expect(widget?.refreshable).toBe(false);
  });
});
