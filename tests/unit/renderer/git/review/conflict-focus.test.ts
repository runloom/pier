import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isConflictOnlyBody,
  resolveReviewDocumentBody,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/conflict-focus.ts";

function item(
  id: string,
  kind: "conflict" | "estimate" | "loaded" = "conflict"
) {
  return {
    cacheKey: id,
    id,
    kind,
    patch: kind === "loaded" ? "diff" : null,
  };
}

describe("isConflictOnlyBody", () => {
  it("is true only when every remaining member is a focused conflict", () => {
    expect(isConflictOnlyBody(0, 3)).toBe(false);
    expect(isConflictOnlyBody(1, 3)).toBe(false);
    expect(isConflictOnlyBody(1, 0)).toBe(true);
    expect(isConflictOnlyBody(0, 0)).toBe(false);
  });
});

describe("resolveReviewDocumentBody", () => {
  const mixed = [item("skill", "loaded"), item("meta")];

  it("keeps every conflict-surface file in tree order", () => {
    expect(resolveReviewDocumentBody(mixed, "conflict")).toEqual({
      items: mixed,
    });
  });

  it("does not filter the list down to the selected file", () => {
    const body = resolveReviewDocumentBody(
      [item("a"), item("b"), item("c")],
      "conflict"
    );
    expect(body.items.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps ordinary diff surfaces on CodeView", () => {
    expect(
      resolveReviewDocumentBody(
        [item("a", "loaded"), item("b", "loaded")],
        "index"
      )
    ).toEqual({
      items: [item("a", "loaded"), item("b", "loaded")],
    });
  });
});

describe("conflict reading surface layout", () => {
  it("always mounts ReviewCodeView and never a parallel conflict host", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../src/plugins/builtin/git/renderer/review/document/content-body.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("resolveReviewDocumentBody");
    expect(source).toContain("ReviewCodeView");
    expect(source).not.toContain("ReviewConflictView");
    expect(source).not.toContain("max-h-[45%]");
    expect(source).not.toContain("allCollapsed");
  });

  it("embeds UnresolvedFile in the CodeView annotation, not a second file header", () => {
    const host = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../packages/ui/src/diff-view/unresolved-conflict/host.tsx"
      ),
      "utf8"
    );
    const items = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../packages/ui/src/diff-view/items.ts"
      ),
      "utf8"
    );
    expect(host).toContain("embedInCodeView");
    expect(host).not.toContain('from "./index.tsx"');
    expect(items).toContain("createUnresolvedConflictFileDiff");
    expect(items).toContain("buildUnresolvedConflictAnnotation");
  });

  it("hides the split/unified control on merge-changes", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../src/plugins/builtin/git/renderer/review/surfaces.tsx"
      ),
      "utf8"
    );
    expect(source).toContain('showDiffStyle={activeSurface !== "conflict"}');
  });
});
