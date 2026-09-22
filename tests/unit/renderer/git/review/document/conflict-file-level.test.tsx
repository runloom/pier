import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileLevelConflictCard } from "@plugins/builtin/git/renderer/review/document/conflict-file-level.tsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});

function context(): RendererPluginContext {
  return {
    i18n: {
      t: vi.fn((key: string, _values?: unknown, fallback?: string) =>
        typeof fallback === "string" ? fallback : key
      ),
    },
  } as never;
}

describe("FileLevelConflictCard", () => {
  it("still offers modify/delete actions when worktree text is present", () => {
    render(
      <FileLevelConflictCard
        busy={false}
        conflict={{
          contents: "keep current\n",
          contentsDigest: "sha256:keep",
          presentation: "file-level",
          stages: { baseOid: null, oursOid: null, theirsOid: null },
          xy: "UD",
        }}
        context={context()}
        itemId="section:conflict"
        onResolve={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Keep Current File" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeTruthy();
  });

  it("keeps marker-free text on the file body, without a resolve card", () => {
    const { container } = render(
      <FileLevelConflictCard
        busy={false}
        conflict={{
          contents: "resolved\n",
          contentsDigest: "sha256:resolved",
          presentation: "file-level",
          stages: { baseOid: null, oursOid: null, theirsOid: null },
          xy: "UU",
        }}
        context={context()}
        itemId="section:conflict"
        onResolve={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("makes open file the primary action when the conflict cannot be previewed", () => {
    render(
      <FileLevelConflictCard
        busy={false}
        conflict={{
          contents: null,
          contentsDigest: "sha256:large",
          presentation: "tooLarge",
          stages: { baseOid: null, oursOid: null, theirsOid: null },
          xy: "UU",
        }}
        context={context()}
        itemId="section:conflict"
        onOpen={vi.fn()}
        onResolve={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.at(-1)?.textContent).toBe("Open File");
    expect(buttons.at(-1)?.getAttribute("data-git-review-conflict-open")).toBe(
      ""
    );
  });
});
