import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  classifyRemoteGitError,
  remoteOperationFailurePresentation,
  reportRemoteOperationFailure,
} from "@plugins/builtin/git/renderer/remote-error.ts";
import { describe, expect, it, vi } from "vitest";

function makeContext(): RendererPluginContext {
  return {
    dialogs: {
      alert: vi.fn(async () => undefined),
    },
    i18n: {
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
    notifications: {
      error: vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

describe("classifyRemoteGitError", () => {
  it("detects missing upstream from git pull wording", () => {
    expect(
      classifyRemoteGitError(
        new Error(
          "There is no tracking information for the current branch.\nSee git-pull(1) for details."
        )
      )
    ).toBe("noUpstream");
  });

  it("detects auth and network failures", () => {
    expect(
      classifyRemoteGitError(new Error("Permission denied (publickey)"))
    ).toBe("auth");
    expect(
      classifyRemoteGitError(new Error("Could not resolve host: github.com"))
    ).toBe("network");
  });

  it("detects non-fast-forward rejection", () => {
    expect(
      classifyRemoteGitError(
        new Error("! [rejected] main -> main (non-fast-forward)")
      )
    ).toBe("rejected");
  });

  it("detects host timeout and local hook prefixes", () => {
    expect(
      classifyRemoteGitError(
        new Error(
          "Git operation timed out (local checks or remote transfer may still be running)"
        )
      )
    ).toBe("timeout");
    expect(
      classifyRemoteGitError(
        new Error("A local Git hook rejected or stopped this operation")
      )
    ).toBe("hook");
  });
});

describe("remoteOperationFailurePresentation", () => {
  it("uses alert with check output for local hook failures", () => {
    const context = makeContext();
    const presentation = remoteOperationFailurePresentation(
      context,
      new Error(
        [
          "A local Git hook rejected or stopped this operation",
          "",
          "husky - pre-push script failed (code 1)",
          "Error: typecheck failed in packages/ui",
        ].join("\n")
      )
    );
    expect(presentation.kind).toBe("hook");
    expect(presentation.useAlert).toBe(true);
    expect(presentation.title).toBe("Project check script blocked this action");
    expect(presentation.body).toContain(
      "Fix the check output below in a terminal, then try again."
    );
    expect(presentation.body).toContain("typecheck failed in packages/ui");
    expect(presentation.body).toContain("husky - pre-push");
  });

  it("maps auth to short product toast copy", () => {
    const context = makeContext();
    const presentation = remoteOperationFailurePresentation(
      context,
      new Error("fatal: authentication failed")
    );
    expect(presentation.kind).toBe("auth");
    expect(presentation.useAlert).toBe(false);
    expect(presentation.body).toBeNull();
    expect(presentation.title).toMatch(/authenticate/i);
  });
});

describe("reportRemoteOperationFailure", () => {
  it("opens dialogs.alert for hook failures (not toast / message center)", async () => {
    const context = makeContext();
    await reportRemoteOperationFailure(
      context,
      new Error(
        "A local Git hook rejected or stopped this operation\n\nhusky - pre-push script failed (code 1)"
      )
    );
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: expect.stringContaining("husky - pre-push"),
      title: "Project check script blocked this action",
    });
    expect(context.notifications.error).not.toHaveBeenCalled();
  });

  it("uses toast for short auth failures", async () => {
    const context = makeContext();
    await reportRemoteOperationFailure(
      context,
      new Error("Permission denied (publickey)")
    );
    expect(context.notifications.error).toHaveBeenCalledWith(
      expect.stringMatching(/authenticate/i)
    );
    expect(context.dialogs.alert).not.toHaveBeenCalled();
  });
});
