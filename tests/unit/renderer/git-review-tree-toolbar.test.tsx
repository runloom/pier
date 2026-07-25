import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitReviewTreeToolbar } from "@plugins/builtin/git/renderer/git-review-tree-toolbar.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function entry(partial: {
  path: string;
  slots: Array<{
    group: "unstaged" | "staged" | "conflict" | "committed";
    sectionKey: string;
    status?: "modified" | "added" | "conflicted" | "deleted" | "renamed";
    targetPath?: string;
  }>;
}): GitReviewIndexEntry {
  const status =
    partial.slots.find((slot) => slot.status === "conflicted")?.status ??
    partial.slots[0]?.status ??
    "modified";
  return {
    entryKey: `ek:${partial.path}`,
    oldPaths: [],
    path: partial.path,
    status,
    renderSlots: partial.slots.map((slot) => ({
      group: slot.group,
      oldPath: null,
      sectionKey: slot.sectionKey,
      status:
        slot.status ?? (slot.group === "conflict" ? "conflicted" : "modified"),
      targetPath: slot.targetPath ?? partial.path,
    })),
  };
}

function createContext(overrides?: {
  stage?: ReturnType<typeof vi.fn>;
  unstage?: ReturnType<typeof vi.fn>;
  info?: ReturnType<typeof vi.fn>;
  error?: ReturnType<typeof vi.fn>;
}): RendererPluginContext {
  return {
    git: {
      stage: overrides?.stage ?? vi.fn(async () => true),
      unstage: overrides?.unstage ?? vi.fn(async () => true),
    },
    i18n: {
      t: (_key: string, _values: unknown, fallback: string) => fallback,
    },
    notifications: {
      error: overrides?.error ?? vi.fn(),
      info: overrides?.info ?? vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

describe("GitReviewTreeToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("stages unstaged paths and reports skipped conflicts", async () => {
    const stage = vi.fn(async () => true);
    const unstage = vi.fn(async () => true);
    const onSkippedConflicts = vi.fn();
    const context = createContext({ stage, unstage });
    const entries = [
      entry({
        path: "a.ts",
        slots: [{ group: "unstaged", sectionKey: "sec:u:a" }],
      }),
      entry({
        path: "new.ts",
        slots: [
          { group: "unstaged", sectionKey: "sec:u:new", status: "added" },
        ],
      }),
      entry({
        path: "conflict.ts",
        slots: [
          {
            group: "conflict",
            sectionKey: "sec:c",
            status: "conflicted",
          },
        ],
      }),
      entry({
        path: "staged-only.ts",
        slots: [{ group: "staged", sectionKey: "sec:s" }],
      }),
    ];

    render(
      <GitReviewTreeToolbar
        context={context}
        entries={entries}
        gitRootPath="/repo"
        onSkippedConflicts={onSkippedConflicts}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stage All" }));
    await waitFor(() => {
      expect(stage).toHaveBeenCalledWith("/repo", ["a.ts", "new.ts"]);
    });
    expect(onSkippedConflicts).toHaveBeenCalledWith(2, 1);

    fireEvent.click(screen.getByRole("button", { name: "Unstage All" }));
    await waitFor(() => {
      expect(unstage).toHaveBeenCalledWith("/repo", ["staged-only.ts"]);
    });
  });

  it("disables buttons when there are no matching paths", () => {
    const context = createContext();
    render(
      <GitReviewTreeToolbar
        context={context}
        entries={[
          entry({
            path: "conflict.ts",
            slots: [
              {
                group: "conflict",
                sectionKey: "sec:c",
                status: "conflicted",
              },
            ],
          }),
        ]}
        gitRootPath="/repo"
      />
    );
    expect(screen.getByRole("button", { name: "Stage All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unstage All" })).toBeDisabled();
  });
});
