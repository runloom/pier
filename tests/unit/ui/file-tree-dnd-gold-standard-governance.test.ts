import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");

describe("file-tree DnD gold standard (engine patch)", () => {
  const publicTypes = readFileSync(
    join(
      REPO_ROOT,
      "packages/ui/node_modules/@pierre/trees/dist/model/publicTypes.d.ts"
    ),
    "utf8"
  );
  const controller = readFileSync(
    join(
      REPO_ROOT,
      "packages/ui/node_modules/@pierre/trees/dist/model/FileTreeController.js"
    ),
    "utf8"
  );

  it("declares commitOnDrop on FileTreeDragAndDropConfig", () => {
    expect(publicTypes).toMatch(
      /interface FileTreeDragAndDropConfig \{[\s\S]*commitOnDrop\?: boolean/
    );
  });

  it("skips store.move when commitOnDrop is false", () => {
    expect(controller).toMatch(/commitOnDrop !== false/);
    expect(controller).toMatch(/onDropComplete/);
  });

  it("emits on completeDrag success so skip-store still clears drag state", () => {
    const completeDrag = controller.match(
      /completeDrag\(\) \{[\s\S]*?\n\t\}/
    )?.[0];
    expect(completeDrag).toBeTruthy();
    const successTail = completeDrag!.match(
      /catch \(error\) \{[\s\S]*?\}\s*([\s\S]*?)return true;/
    )?.[1];
    expect(successTail).toMatch(/this\.#emit\(\)/);
  });

  it("disables HTML5 draggable when pointerDragThresholdPx is active", () => {
    const view = readFileSync(
      join(
        REPO_ROOT,
        "packages/ui/node_modules/@pierre/trees/dist/render/FileTreeView.js"
      ),
      "utf8"
    );
    expect(view).toMatch(/pointerDragThresholdPx/);
    expect(view).toMatch(
      /draggable:\s*dragAndDropEnabled && !isParked && pointerDragThresholdPx <= 0/
    );
  });

  it("swallows the trailing click after an active pointer drag and clears suppressClickRef", () => {
    const view = readFileSync(
      join(
        REPO_ROOT,
        "packages/ui/node_modules/@pierre/trees/dist/render/FileTreeView.js"
      ),
      "utf8"
    );
    const handle = view.match(
      /const handleRowPointerDown = \(event, row, targetPath\) => \{[\s\S]*?\n\t\};/
    )?.[0];
    expect(handle).toBeTruthy();
    expect(handle).toMatch(
      /addEventListener\("click", \w+, \{\s*capture:\s*true,\s*once:\s*true\s*\}/
    );
    expect(handle).toMatch(/clickEvent\.stopPropagation\(\)/);
    expect(handle).toMatch(/clickEvent\.preventDefault\(\)/);
    expect(handle).toMatch(/setTimeout\(|requestAnimationFrame\(/);
    const pointerUp = handle!.match(
      /const handlePointerUp = \(upEvent\) => \{[\s\S]*?\n\t\t\};/
    )?.[0];
    expect(pointerUp).toBeTruthy();
    expect(pointerUp).toMatch(
      /if \(!wasActive\) \{\s*disarmPointerDrag\(\);\s*return;/
    );
    expect(pointerUp).toMatch(/suppressClickRef\.current = true/);
    const inactiveUp = pointerUp!.match(
      /if \(!wasActive\) \{[\s\S]*?return;[\s\S]*?\}/
    )?.[0];
    expect(inactiveUp).toBeTruthy();
    expect(inactiveUp).not.toMatch(/suppressClickRef/);
    const cancel = handle!.match(
      /const cancelArmedPointerDrag = \([^)]*\) => \{[\s\S]*?\n\t\t\};/
    )?.[0];
    expect(cancel).toBeTruthy();
    expect(cancel).toMatch(/wasActive/);
    expect(cancel).toMatch(
      /if \(wasActive\) \{[\s\S]*suppressClickRef\.current = true/
    );
  });

  it("wires Files tree drag to commitOnDrop false and 8px pointer threshold", () => {
    const source = readFileSync(
      join(REPO_ROOT, "packages/ui/src/file/tree-write-options.ts"),
      "utf8"
    );
    expect(source).toContain("FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8");
    expect(source).toContain("commitOnDrop: false");
    expect(source).toContain(
      "pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX"
    );
  });
});
