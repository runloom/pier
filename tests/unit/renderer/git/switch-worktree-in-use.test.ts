import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { handleSwitchWorktreeInUseError } from "@plugins/builtin/git/renderer/switch-worktree-in-use.ts";
import { describe, expect, it, vi } from "vitest";

function createContext(options?: {
  confirmResult?: boolean;
  openError?: Error;
}): RendererPluginContext {
  const open = options?.openError
    ? vi.fn().mockRejectedValue(options.openError)
    : vi.fn().mockResolvedValue({ panelId: "p1" });

  return {
    dialogs: {
      alert: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue(options?.confirmResult ?? true),
    },
    i18n: {
      t: (
        key: string,
        values?: Record<string, number | string>,
        fallback?: string
      ) => {
        let text = fallback ?? key;
        if (values) {
          for (const [name, value] of Object.entries(values)) {
            text = text.replaceAll(`{{${name}}}`, String(value));
          }
        }
        return text;
      },
    },
    worktrees: { open },
  } as unknown as RendererPluginContext;
}

describe("handleSwitchWorktreeInUseError", () => {
  it("returns false for unrelated errors", async () => {
    const context = createContext();
    const handled = await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error("merge conflict")
    );
    expect(handled).toBe(false);
    expect(context.dialogs.confirm).not.toHaveBeenCalled();
  });

  it("offers open worktree when path is present and opens on confirm", async () => {
    const context = createContext({ confirmResult: true });
    const handled = await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error(
        "git 退出码 128: fatal: 'main' is already used by worktree at '/Users/xyz/ABC/pier.worktree/feature-comment-support'"
      )
    );

    expect(handled).toBe(true);
    expect(context.dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmLabel: "Open Worktree",
        intent: "default",
        title: "Cannot switch to “main”",
      })
    );
    expect(context.worktrees.open).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier.worktree/feature-comment-support",
    });
  });

  it("does not open when user dismisses", async () => {
    const context = createContext({ confirmResult: false });
    const handled = await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error("fatal: 'main' is already used by worktree at '/tmp/other-wt'")
    );
    expect(handled).toBe(true);
    expect(context.worktrees.open).not.toHaveBeenCalled();
  });

  it("falls back to List Worktrees copy and keeps raw detail when path missing", async () => {
    const context = createContext();
    // Hint matches but capture fails (no path after at)
    const raw = "fatal: something is already used by worktree at ";
    const handled = await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error(raw)
    );
    expect(handled).toBe(true);
    expect(context.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("List Worktrees"),
        title: "Cannot switch to “main”",
      })
    );
    const body = (context.dialogs.alert as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0]?.body as string;
    expect(body).toContain(raw.trim());
    expect(context.dialogs.confirm).not.toHaveBeenCalled();
    expect(context.worktrees.open).not.toHaveBeenCalled();
  });

  it("opens when path is unquoted", async () => {
    const context = createContext({ confirmResult: true });
    await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error("fatal: 'main' is already used by worktree at /tmp/other-wt")
    );
    expect(context.worktrees.open).toHaveBeenCalledWith({
      path: "/tmp/other-wt",
    });
  });

  it("surfaces open failures", async () => {
    const context = createContext({
      confirmResult: true,
      openError: new Error("path not found"),
    });
    await handleSwitchWorktreeInUseError(
      context,
      "main",
      new Error("fatal: 'main' is already used by worktree at '/tmp/other-wt'")
    );
    expect(context.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "path not found",
      })
    );
  });
});
