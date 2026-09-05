import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { buildMarkdownDiff } from "@plugins/builtin/files/renderer/git-changes/markdown/model.ts";
import type {
  MarkdownBlock,
  MarkdownInline,
} from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { describe, expect, it } from "vitest";

function model(before: string, after: string, index = 0) {
  const range = compareFileContents({ before, after, path: "a.md", version: 1 })
    .ranges[index];
  if (!range) throw new Error("fixture has no change");
  return buildMarkdownDiff({
    before: parseMarkdownToIr(before),
    after: parseMarkdownToIr(after),
    range,
  });
}
function text(nodes: readonly MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if ("children" in node) return text(node.children);
      return "value" in node ? node.value : "";
    })
    .join("");
}
function inlines(block: MarkdownBlock): MarkdownInline[] {
  if (!("children" in block)) throw new Error("expected prose");
  return block.children;
}

describe("rendered local diff model", () => {
  it("keeps inline formatting around removed and inserted words", () => {
    const result = model(
      "# Guide\n\nKeep **old** wording.\n",
      "# Guide\n\nKeep **new** wording.\n"
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.kind).toBe("modified");
    const children = inlines(result.blocks[0]!.block);
    expect(text(children)).toBe("Keep oldnew wording.");
    const strong = children.find((inline) => inline.kind === "strong");
    expect(strong?.children).toMatchObject([
      { value: "old", change: "deleted" },
      { value: "new", change: "added" },
    ]);
  });

  it("retains a complete deleted table, including headers outside the raw excerpt", () => {
    const before =
      "# Guide\n\n| Key | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n| c | 3 |\n| d | 4 |\n\nEnd\n";
    const result = model(before, "# Guide\n\nEnd\n");
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: "deleted",
      side: "before",
      block: { kind: "table", rows: expect.any(Array) },
    });
    const block = result.blocks[0]!.block;
    if (block.kind !== "table") throw new Error("expected table");
    expect(block.rows).toHaveLength(5);
    expect(text(block.rows[0]!.cells[0]!.children)).toBe("Key");
  });

  it("retains a complete code fence when the changed line is deep inside it", () => {
    const before = `Before\n\n\`\`\`ts\n${Array.from({ length: 12 }, (_, i) => `const a${i} = ${i};`).join("\n")}\n\`\`\`\n\nAfter\n`;
    const result = model(before, before.replace("a7 = 7", "a7 = 70"));
    expect(result.blocks.map((entry) => entry.block.kind)).toEqual([
      "code",
      "code",
    ]);
    expect(result.blocks[0]?.block).toMatchObject({
      lang: "ts",
      value: expect.stringContaining("const a0 = 0;"),
    });
    expect(result.blocks[1]?.block).toMatchObject({
      value: expect.stringContaining("const a11 = 11;"),
    });
  });

  it("renders an entirely new Markdown file as added content", () => {
    const result = model("", "# New\n\n- One\n- Two\n");
    expect(result.blocks.map(({ kind, block }) => [kind, block.kind])).toEqual([
      ["added", "heading"],
      ["added", "list"],
    ]);
  });

  it("preserves a deletion at EOF and deletion of the entire document", () => {
    expect(
      model("# Guide\n\nLast words\n", "# Guide\n").blocks[0]
    ).toMatchObject({ kind: "deleted", block: { kind: "paragraph" } });
    expect(model("# Guide\n", "").blocks[0]).toMatchObject({
      kind: "deleted",
      block: { kind: "heading" },
    });
  });

  it("keeps differing heading levels as two independently rendered versions", () => {
    const result = model("## Guide\n", "### Guide\n");
    expect(
      result.blocks.map(({ block }) =>
        block.kind === "heading" ? block.depth : null
      )
    ).toEqual([2, 3]);
  });

  it("captures reference-link changes even when the definition is outside rendered blocks", () => {
    const result = model(
      "Read [guide][g].\n\n[g]: https://old.example\n",
      "Read [guide][g].\n\n[g]: https://new.example\n"
    );
    expect(result.attributes).toContainEqual({
      kind: "link",
      before: "https://old.example",
      after: "https://new.example",
    });
    expect(result.blocks).not.toHaveLength(0);
  });

  it("reports a shared reference target once across separate affected paragraphs", () => {
    const before =
      "Read [guide][g].\n\nStable\n\nAlso [guide][g].\n\n[g]: https://old.example\n";
    const result = model(
      before,
      before.replace("https://old.example", "https://new.example")
    );
    expect(result.attributes).toEqual([
      {
        kind: "link",
        before: "https://old.example",
        after: "https://new.example",
      },
    ]);
  });

  it("does not show another reference edit when only whitespace changed in this definition", () => {
    const before =
      "[One][a]\n\n[Two][b]\n\n[a]: https://old.example\n\nStable\n\n[b]: https://old.example\n";
    const after = before
      .replace("[a]: https://old.example", "[a]:  https://old.example")
      .replace("[b]: https://old.example", "[b]: https://new.example");
    expect(model(before, after).blocks).toHaveLength(0);
  });

  it("selects only the requested distant change", () => {
    const before =
      "Old first\n\nUnchanged\n\n## Stable\n\nMore context\n\nOld last\n";
    const result = model(
      before,
      before.replace("Old first", "New first").replace("Old last", "New last"),
      1
    );
    expect(result.blocks).toHaveLength(1);
    expect(text(inlines(result.blocks[0]!.block))).toBe("OldNew last");
  });

  it("preserves CJK and emoji without splitting surrogate pairs", () => {
    const result = model("支持旧版 👩‍💻。\n", "支持新版 👩‍💻。\n");
    const children = inlines(result.blocks[0]!.block);
    const oldText = children.filter((node) => node.change !== "added");
    const newText = children.filter((node) => node.change !== "deleted");
    expect(text(oldText)).toBe("支持旧版 👩‍💻。");
    expect(text(newText)).toBe("支持新版 👩‍💻。");
  });

  it("flags historical images instead of representing current pixels as HEAD", () => {
    const result = model("![Diagram](old.png)\n", "![Diagram](new.png)\n");
    expect(result.hasHistoricalImages).toBe(true);
    expect(result.attributes).toContainEqual({
      kind: "image",
      before: "old.png",
      after: "new.png",
    });
  });

  it("keeps nested historical resources in their original rendering context", () => {
    const result = model("**![Old](old.png)**\n", "**![New](new.png)**\n");
    expect(result.blocks.map(({ side }) => side)).toEqual(["before", "after"]);
  });

  it("does not substitute a distant reference change for an invisible whitespace edit", () => {
    const before =
      "Paragraph\n\nStable\n\nMore context\n\nRead [guide][g].\n\n[g]: https://old.example\n";
    const after = before
      .replace("Paragraph\n", "Paragraph  \n")
      .replace("https://old.example", "https://new.example");
    expect(model(before, after).blocks).toHaveLength(0);
    expect(model(before, after, 1).attributes).toContainEqual({
      kind: "link",
      before: "https://old.example",
      after: "https://new.example",
    });
  });

  it("falls back to source instead of mounting an unbounded rendered block", () => {
    expect(() => model("", `${"Long paragraph ".repeat(40_000)}\n`)).toThrow(
      "markdown-diff-too-large"
    );
  });

  it("flags HTML attribute changes that may be invisible after sanitizing", () => {
    const result = model(
      '<div data-old="1">Same</div>\n',
      '<div data-new="2">Same</div>\n'
    );
    expect(result.hasHtml).toBe(true);
  });

  it("keeps both large paragraphs when detailed word alignment is too costly", () => {
    const result = model(
      `${"old ".repeat(8000)}\n`,
      `${"new ".repeat(8000)}\n`
    );
    expect(result.blocks.map(({ kind }) => kind)).toEqual(["deleted", "added"]);
  });
});
