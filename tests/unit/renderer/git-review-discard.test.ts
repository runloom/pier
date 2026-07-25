import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  confirmGitDiscard,
  partitionDiscardPaths,
} from "@plugins/builtin/git/renderer/git-review-discard.ts";
import { describe, expect, it, vi } from "vitest";

function mockContext(options: {
  choice?: "alt" | "cancel" | "confirm";
  confirm?: boolean;
}): RendererPluginContext {
  return {
    dialogs: {
      choice: vi.fn(async () => options.choice ?? "cancel"),
      confirm: vi.fn(async () => options.confirm ?? false),
    },
    i18n: {
      t: (_key: string, values: unknown, fallback: string) => {
        if (!values || typeof values !== "object") {
          return fallback;
        }
        return Object.entries(values as Record<string, string | number>).reduce(
          (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
          fallback
        );
      },
    },
  } as unknown as RendererPluginContext;
}

describe("partitionDiscardPaths", () => {
  it("splits tracked modified/deleted from untracked added", () => {
    expect(
      partitionDiscardPaths({
        paths: ["a.ts", "b.ts", "c.ts"],
        statuses: new Map([
          ["a.ts", "modified"],
          ["b.ts", "added"],
          ["c.ts", "deleted"],
        ]),
      })
    ).toEqual({
      allTrackedDeleted: false,
      trackedPaths: ["a.ts", "c.ts"],
      untrackedPaths: ["b.ts"],
    });
  });

  it("marks allTrackedDeleted when every tracked path is deleted", () => {
    expect(
      partitionDiscardPaths({
        paths: ["gone.ts"],
        uniformStatus: "deleted",
      })
    ).toEqual({
      allTrackedDeleted: true,
      trackedPaths: ["gone.ts"],
      untrackedPaths: [],
    });
  });
});

describe("confirmGitDiscard", () => {
  it("single tracked file uses confirm/cancel only", async () => {
    const context = mockContext({ confirm: true });
    const result = await confirmGitDiscard(context, {
      trackedPaths: ["src/a.ts"],
      untrackedPaths: [],
    });
    expect(result).toEqual({ kind: "proceed", paths: ["src/a.ts"] });
    expect(context.dialogs.confirm).toHaveBeenCalledOnce();
    expect(context.dialogs.choice).not.toHaveBeenCalled();
    const confirmArg = vi.mocked(context.dialogs.confirm).mock.calls[0]?.[0];
    expect(confirmArg?.confirmLabel).toBe("Discard");
    expect(confirmArg?.title).toBe("Discard Changes");
    expect(confirmArg?.body).toContain("a.ts");
    expect(confirmArg?.body).not.toContain("\n\n");
  });

  it("single untracked file offers Move to Trash", async () => {
    const context = mockContext({ confirm: true });
    const result = await confirmGitDiscard(context, {
      trackedPaths: [],
      untrackedPaths: ["new.ts"],
    });
    expect(result).toEqual({ kind: "proceed", paths: ["new.ts"] });
    const confirmArg = vi.mocked(context.dialogs.confirm).mock.calls[0]?.[0];
    expect(confirmArg?.title).toBe("Move to Trash");
    expect(confirmArg?.confirmLabel).toBe("Move to Trash");
    expect(confirmArg?.body).toContain("new.ts");
    expect(confirmArg?.body).toContain("Trash");
    expect(confirmArg?.body).not.toMatch(/\buntracked\b/i);
    expect(confirmArg?.body).not.toContain("\n\n");
  });

  it("mixed multi offers tracked-only (confirm) vs all (alt)", async () => {
    const context = mockContext({ choice: "confirm" });
    const trackedOnly = await confirmGitDiscard(context, {
      trackedPaths: ["a.ts", "b.ts"],
      untrackedPaths: ["u1.ts", "u2.ts"],
    });
    expect(trackedOnly).toEqual({
      kind: "proceed",
      paths: ["a.ts", "b.ts"],
    });

    const allContext = mockContext({ choice: "alt" });
    const all = await confirmGitDiscard(allContext, {
      trackedPaths: ["a.ts", "b.ts"],
      untrackedPaths: ["u1.ts", "u2.ts"],
    });
    expect(all).toEqual({
      kind: "proceed",
      paths: ["a.ts", "b.ts", "u1.ts", "u2.ts"],
    });

    const choiceArg = vi.mocked(allContext.dialogs.choice).mock.calls[0]?.[0];
    expect(choiceArg?.buttonOrder).toBe("confirm-alt-cancel");
    expect(choiceArg?.confirmLabel).toBe("Discard 2 Changes");
    expect(choiceArg?.altLabel).toBe("Discard All 4");
    expect(choiceArg?.body).toContain("2");
    expect(choiceArg?.body).not.toMatch(/IRREVERSIBLE|untracked/i);
  });

  it("cancel returns cancel for mixed choice", async () => {
    const context = mockContext({ choice: "cancel" });
    await expect(
      confirmGitDiscard(context, {
        trackedPaths: ["a.ts"],
        untrackedPaths: ["b.ts"],
      })
    ).resolves.toEqual({ kind: "cancel" });
  });
});
