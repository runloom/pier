import type { PierFileTreeApi } from "@pier/ui/file/tree.tsx";
import { revealGitReviewTreeSelection } from "@plugins/builtin/git/renderer/review/tree-reveal-selection.ts";
import { describe, expect, it, vi } from "vitest";

describe("revealGitReviewTreeSelection", () => {
  it("calls revealPath with explicit intent and no expandTarget", async () => {
    const revealPath = vi.fn(() => true);
    const api = { revealPath } as unknown as PierFileTreeApi;

    revealGitReviewTreeSelection(api, "group/src/app.tsx");

    await vi.waitFor(() => {
      expect(revealPath).toHaveBeenCalled();
    });
    expect(revealPath).toHaveBeenCalledWith("group/src/app.tsx", {
      expandTarget: false,
      intent: "explicit",
    });
  });

  it("no-ops for missing api or empty path", () => {
    expect(() => {
      revealGitReviewTreeSelection(null, "a");
      revealGitReviewTreeSelection(undefined, "a");
      revealGitReviewTreeSelection(
        { revealPath: vi.fn() } as unknown as PierFileTreeApi,
        ""
      );
    }).not.toThrow();
  });
});
