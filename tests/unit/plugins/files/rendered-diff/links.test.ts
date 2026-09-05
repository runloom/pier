import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { buildMarkdownDiff } from "@plugins/builtin/files/renderer/git-changes/markdown/model.ts";
import type { MarkdownInline } from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { describe, expect, it } from "vitest";

function compare(beforeSource: string, afterSource: string) {
  const before = parseMarkdownToIr(beforeSource);
  const after = parseMarkdownToIr(afterSource);
  const original = JSON.stringify({ before, after });
  const range = compareFileContents({
    before: beforeSource,
    after: afterSource,
    path: "a.md",
    version: 1,
  }).ranges[0]!;
  const result = buildMarkdownDiff({ before, after, range });
  expect(JSON.stringify({ before, after })).toBe(original);
  return result;
}

function links(nodes: MarkdownInline[]): MarkdownInline[] {
  return nodes.flatMap((node) => {
    if (node.kind === "link") return [node];
    return "children" in node ? links(node.children) : [];
  });
}

describe("rendered diff link identity", () => {
  it("keeps one link for an invisible destination change without mutating parsed documents", () => {
    const result = compare(
      "Read **[Guide](old.md)**.\n",
      "Read **[Guide](new.md)**.\n"
    );
    const block = result.blocks[0]!.block;
    if (block.kind !== "paragraph") throw new Error("expected paragraph");
    expect(links(block.children)).toEqual([
      expect.objectContaining({
        url: "new.md",
        previous: { url: "old.md", title: null },
      }),
    ]);
  });

  it.each([
    ["", "[Guide](new.md)\n"],
    ["[Guide](old.md)\n", ""],
    ["[Old](old.md)\n", "[New](new.md)\n"],
  ])("does not describe ordinary link additions or deletions as target changes", (before, after) => {
    expect(compare(before, after).attributes).toEqual([]);
  });

  it("aligns an existing link after a differently named link is inserted", () => {
    const result = compare(
      "[Guide](old.md)\n",
      "[New](added.md) and [Guide](new.md)\n"
    );
    expect(result.attributes).toEqual([
      { kind: "link", before: "old.md", after: "new.md" },
    ]);
    const block = result.blocks[0]!.block;
    if (block.kind !== "paragraph") throw new Error("expected paragraph");
    expect(links(block.children)).toHaveLength(2);
  });

  it("anchors identical links before aligning a same-label insertion", () => {
    const result = compare(
      "[Guide](keep.md) [Guide](old.md)\n",
      "[Guide](added.md) [Guide](keep.md) [Guide](new.md)\n"
    );
    expect(result.attributes).toEqual([
      { kind: "link", before: "old.md", after: "new.md" },
    ]);
  });

  it("does not pair a deleted link with a remaining link of another name", () => {
    const result = compare(
      "[Remove](gone.md) [Keep](old.md)\n",
      "[Keep](new.md)\n"
    );
    expect(result.attributes).toEqual([
      { kind: "link", before: "old.md", after: "new.md" },
    ]);
  });

  it("keeps link changes attached inside structural before/after rendering", () => {
    const result = compare(
      "| Guide |\n| --- |\n| [Read](old.md) |\n",
      "| Guide |\n| --- |\n| [Read](new.md) |\n"
    );
    const block = result.blocks.find((entry) => entry.side === "after")!.block;
    if (block.kind !== "table") throw new Error("expected table");
    expect(block.rows[1]!.cells[0]!.children[0]).toMatchObject({
      previous: { url: "old.md", title: null },
    });
  });

  it.each([
    ["Read [Guide][g].\n", "Read [Guide][g].\n\n[g]: guide.md\n"],
    ["Read [Guide][g].\n\n[g]: guide.md\n", "Read [Guide][g].\n"],
  ])("keeps reference-only additions and deletions visible in prose", (before, after) => {
    const result = compare(before, after);
    expect(result.blocks).not.toHaveLength(0);
  });
});
