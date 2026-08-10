import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMessage = vi.fn();
const toastError = vi.fn();
const showAppAlert = vi.fn(async () => undefined);
const requestTerminalRelaunch = vi.fn();
const prepareLaunchFromSpec = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    message: (...args: unknown[]) => toastMessage(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("i18next", () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: (...args: unknown[]) => showAppAlert(...args),
}));

vi.mock("@/stores/terminal-relaunch.store.ts", () => ({
  requestTerminalRelaunch: (...args: unknown[]) =>
    requestTerminalRelaunch(...args),
}));

describe("try-resume-last", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      pier: {
        agents: {
          prepareLaunchFromSpec,
        },
      },
    });
  });

  it("shows cold-start toast with try-resume action when tryResumeLast is present", async () => {
    const { notifyAgentRestoreOutcome } = await import(
      "../../../../src/renderer/panel-kits/terminal/hooks/try-resume-last.ts"
    );
    notifyAgentRestoreOutcome({
      context: undefined,
      panelId: "terminal-1",
      result: {
        ok: true,
        agentRestore: "cold-start",
        tryResumeLast: {
          agentId: "codex",
          command: "codex resume --last",
          cwd: "/repo",
        },
      },
      tab: undefined,
      t: (key) => key,
    });

    expect(toastMessage).toHaveBeenCalledWith(
      "terminal.agentSession.coldStart",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "terminal.agentSession.tryResumeLast",
        }),
      })
    );
  });

  it("shows cold-start toast without action when tryResumeLast is absent", async () => {
    const { notifyAgentRestoreOutcome } = await import(
      "../../../../src/renderer/panel-kits/terminal/hooks/try-resume-last.ts"
    );
    notifyAgentRestoreOutcome({
      context: undefined,
      panelId: "terminal-1",
      result: { ok: true, agentRestore: "cold-start" },
      tab: undefined,
      t: (key) => key,
    });

    expect(toastMessage).toHaveBeenCalledWith(
      "terminal.agentSession.coldStart",
      {}
    );
  });

  it("relaunches via prepareLaunchFromSpec and requestTerminalRelaunch", async () => {
    prepareLaunchFromSpec.mockResolvedValue({ launchId: "launch-1" });
    const { requestTryResumeLast } = await import(
      "../../../../src/renderer/panel-kits/terminal/hooks/try-resume-last.ts"
    );

    await requestTryResumeLast({
      context: {
        contextId: "ctx",
        cwd: "/old",
        openedPath: "/old",
        projectRootPath: "/old",
        source: "panel",
        updatedAt: 1,
        worktreeKey: "/old",
      },
      panelId: "terminal-1",
      tab: undefined,
      tryLast: {
        agentId: "codex",
        command: "codex resume --last",
        cwd: "/repo",
      },
    });

    expect(prepareLaunchFromSpec).toHaveBeenCalledWith({
      agentId: "codex",
      command: "codex resume --last",
      cwd: "/repo",
    });
    expect(requestTerminalRelaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "terminal-1",
        launchId: "launch-1",
        context: expect.objectContaining({ cwd: "/repo" }),
      })
    );
  });

  it("toasts error when prepareLaunchFromSpec returns no launchId", async () => {
    prepareLaunchFromSpec.mockResolvedValue({ launchId: "" });
    const { requestTryResumeLast } = await import(
      "../../../../src/renderer/panel-kits/terminal/hooks/try-resume-last.ts"
    );

    await requestTryResumeLast({
      context: undefined,
      panelId: "terminal-1",
      tab: undefined,
      tryLast: {
        agentId: "codex",
        command: "codex resume --last",
      },
    });

    expect(toastError).toHaveBeenCalledWith(
      "terminal.agentSession.tryResumeLastFailed"
    );
    expect(requestTerminalRelaunch).not.toHaveBeenCalled();
  });

  it("shows app alert when prepareLaunchFromSpec throws", async () => {
    prepareLaunchFromSpec.mockRejectedValue(new Error("boom"));
    const { requestTryResumeLast } = await import(
      "../../../../src/renderer/panel-kits/terminal/hooks/try-resume-last.ts"
    );

    await requestTryResumeLast({
      context: undefined,
      panelId: "terminal-1",
      tab: undefined,
      tryLast: {
        agentId: "claude",
        command: "claude --continue",
      },
    });

    expect(showAppAlert).toHaveBeenCalledWith({
      body: "boom",
      title: "terminal.agentSession.tryResumeLastFailed",
    });
  });
});
