import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const SPEC =
  "docs/superpowers/specs/2026-09-10-tree-multiselect-gold-standard.md";
const TREE = join(ROOT, "packages/ui/src/file/tree.tsx");
const SALVAGE = join(
  ROOT,
  "packages/ui/src/file/use-tree-row-click-salvage.ts"
);
const INTERNAL = join(ROOT, "packages/ui/src/file/tree-internal.ts");
const GIT_REVIEW = join(ROOT, "src/plugins/builtin/git/renderer/review");
const GIT_LOCALES = join(ROOT, "src/plugins/builtin/git/locales");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isDirectory()) {
      walk(filePath, files);
      continue;
    }
    if (/\.(?:ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(filePath);
    }
  }
  return files;
}

describe("file-tree multiselect gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### 目录树高亮多选");
    expect(agents).toContain(
      "tests/unit/ui/file-tree-multiselect-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("选择是集合，激活是单点");
    expect(spec).toContain("K3");
    expect(spec).toContain("G0–G5");
    expect(spec).toMatch(/禁止/);
    expect(spec).toContain("Stage All");
    expect(spec).toContain("Delete ({{count}})");
    expect(spec).toContain("剪切 / 复制 / 复制路径标题保持单数");
    expect(spec).toContain("order-sketches-multiselect.test.ts");
    expect(spec).toContain(
      "tests/unit/renderer/git/review/tree/multiselect-menu.test.ts"
    );
    expect(spec).toContain(
      "tests/unit/renderer/git/review/tree/selection-rebind.test.ts"
    );
  });

  it("hides inapplicable tree-menu items instead of inventing a short menu", () => {
    const filesActions = read(
      "src/plugins/builtin/files/renderer/tree/actions.ts"
    );
    const duplicate = read(
      "src/plugins/builtin/files/renderer/tree/actions-duplicate.ts"
    );
    const del = read(
      "src/plugins/builtin/files/renderer/tree/delete-action.ts"
    );
    const openDirectory = read(
      "src/plugins/builtin/git/renderer/review/directory/open-action.ts"
    );
    expect(filesActions).toContain("isFilesTreeMultiSelection");
    expect(duplicate).toContain("isFilesTreeMultiSelection");
    expect(del).toContain("filePanel.tree.action.deleteN");
    expect(openDirectory).toContain("isReviewTreeItemMultiSelection");
    expect(filesActions).not.toMatch(/compareSelected/i);
    const reviewActions = read(
      "src/plugins/builtin/git/renderer/review/tree-actions.ts"
    );
    expect(reviewActions).not.toMatch(/compareSelected/i);
  });

  it("does not open files from selection-change", () => {
    const tree = readFileSync(TREE, "utf8");
    const selectionHandler = tree.slice(
      tree.indexOf("handleSelectionChange"),
      tree.indexOf("const modelAheadMovesRef")
    );
    expect(selectionHandler).toContain("onSelectPaths");
    expect(selectionHandler).not.toContain("onOpenPath");
    expect(selectionHandler).not.toContain("takePendingActivation");
    expect(selectionHandler).not.toContain("nextSelectedPaths.at(-1)");
    expect(tree).toContain("handleFileTreeHostKeyDown");
    expect(read("packages/ui/src/file/tree-selection-model.ts")).toContain(
      'event.key !== "Enter"'
    );
  });

  it("does not select-only when revealing a path already in L-Select", () => {
    const reveal = read("packages/ui/src/file/tree-reveal.ts");
    const apply = reveal.slice(
      reveal.indexOf("function applyProgrammaticSelectAndFocus"),
      reveal.indexOf("function isPathSelected")
    );
    expect(apply).toContain("if (!isPathSelected(model, officialPath))");
    expect(apply).toContain("model.selectOnlyPath(officialPath)");
  });

  it("restores the full command-menu selection snapshot", () => {
    const internal = readFileSync(INTERNAL, "utf8");
    expect(internal).toContain("commandSelectionSnapshot");
    expect(internal).toContain("replaceSelectedPaths");
  });

  it("keeps salvage modifier-aware", () => {
    const salvage = readFileSync(SALVAGE, "utf8");
    const selection = read("packages/ui/src/file/tree-selection-model.ts");
    expect(salvage).toContain("metaKey");
    expect(salvage).toContain("shiftKey");
    expect(salvage).toContain("applyFileTreeRowSelection");
    expect(salvage).toContain("onClick:");
    expect(salvage).not.toContain("takePendingActivation");
    expect(selection).toContain("selectPathRange");
    expect(selection).toContain("togglePathSelectionFromInput");
  });

  it("bans review-tree checkboxes and stage-all revival", () => {
    const offenders: string[] = [];
    for (const file of walk(GIT_REVIEW)) {
      const rel = relative(ROOT, file);
      const source = readFileSync(file, "utf8");
      if (
        /type=["']checkbox["']/.test(source) ||
        /<Checkbox[\s>]/.test(source)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    expect(
      walk(GIT_REVIEW).some((file) =>
        file.endsWith("git-review-tree-toolbar.tsx")
      )
    ).toBe(false);
    for (const locale of ["en.json", "zh-CN.json"] as const) {
      const text = readFileSync(join(GIT_LOCALES, locale), "utf8");
      expect(text, locale).not.toMatch(/"ui\.stageAll"/);
    }
  });
});
