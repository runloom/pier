import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { buildMarkdownDiff } from "@plugins/builtin/files/renderer/git-changes/markdown/model.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { describe, expect, it } from "vitest";

function model(before: string, after: string, index = 0) {
  const range = compareFileContents({ before, after, path: "a.md", version: 1 })
    .ranges[index];
  if (!range) throw new Error("missing fixture change");
  return buildMarkdownDiff({
    before: parseMarkdownToIr(before),
    after: parseMarkdownToIr(after),
    range,
  });
}

describe("rendered diff review regressions", () => {
  it("limits adjacent paragraph edits to their selected source range", () => {
    const before = "First old\n\nSecond old\n";
    const after = "First new\n\nSecond new\n";
    const first = model(before, after);
    const second = model(before, after, 1);
    expect(first.blocks).toHaveLength(1);
    expect(second.blocks).toHaveLength(1);
    expect(JSON.stringify(first.blocks)).not.toContain("Second");
    expect(JSON.stringify(second.blocks)).not.toContain("First");
  });

  it("does not charge a small selection for an adjacent oversized changed block", () => {
    const before = `Small old\n\n${"large ".repeat(45_000)}old\n`;
    const after = before
      .replace("Small old", "Small new")
      .replace(/old\n$/u, "new\n");
    expect(model(before, after).blocks).toHaveLength(1);
  });

  it("includes a reference target when its definition changes beside a heading", () => {
    const before = "[Guide][g]\n\nStable\n\n# Tail old\n[g]: old.md\n";
    const after = before
      .replace("Tail old", "Tail new")
      .replace("old.md", "new.md");
    const result = model(before, after);
    expect(result.blocks.some((entry) => entry.block.kind === "heading")).toBe(
      true
    );
    expect(result.attributes).toContainEqual({
      kind: "link",
      before: "old.md",
      after: "new.md",
    });
  });

  it("aligns images before describing an insertion ahead of unchanged images", () => {
    const result = model(
      "![A](a.png) ![B](b.png)\n",
      "![X](x.png) ![A](a.png) ![B](b.png)\n"
    );
    expect(result.attributes).toEqual([
      { kind: "image", before: "", after: "x.png" },
      { kind: "image", before: "", after: "X" },
    ]);
  });

  it("retains a real image replacement after anchoring unchanged neighbours", () => {
    const result = model(
      "![A](a.png) ![B](old.png)\n",
      "![X](x.png) ![A](a.png) ![B](new.png)\n"
    );
    expect(result.attributes).toContainEqual({
      kind: "image",
      before: "old.png",
      after: "new.png",
    });
    expect(result.attributes.some((change) => change.before === "a.png")).toBe(
      false
    );
  });
});
