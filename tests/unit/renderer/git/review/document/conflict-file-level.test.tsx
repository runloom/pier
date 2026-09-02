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
});
