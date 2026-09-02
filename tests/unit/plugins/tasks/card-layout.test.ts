import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ISSUE_ID_CLASS } from "../../../../packages/plugin-tasks/applets/tracker-board/status-badges.tsx";

describe("task card layout", () => {
  it("keeps tracker identifiers start-aligned", () => {
    expect(ISSUE_ID_CLASS).toContain("justify-start");
    expect(ISSUE_ID_CLASS).toContain("w-fit");
  });

  it("gives board columns a 16rem floor so they scroll instead of crushing cards", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/plugin-tasks/src/renderer/styles.css"),
      "utf8"
    );
    expect(css).toContain("[data-tracker-board]");
    expect(css).toContain("flex: 0 0 calc(50% - 0.25rem)");
    expect(css).toContain("[data-tracker-narrow]");
    expect(css).toContain("-webkit-line-clamp: 2");
    expect(css).not.toContain("overflow-wrap: anywhere");
    expect(css).toContain("[data-tracker-column-scroll]");
    expect(css).toContain("padding: 0.5rem 0 0.5rem 0.5rem");
    expect(css).toContain("padding-inline: 0.625rem");
    expect(css).not.toContain("padding-inline: 0.625rem 0");
  });
});
