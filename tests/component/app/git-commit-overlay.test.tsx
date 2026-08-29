import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { openGitCommitOverlay } from "@plugins/builtin/git/renderer/commit/overlay.tsx";
import { resetGitStatusSessionsForTests } from "@plugins/builtin/git/renderer/status-state.ts";
import {
  resetSyncBusyForTests,
  trackSync,
} from "@plugins/builtin/git/renderer/sync-busy.ts";
import { GIT_COMMIT_PUSH_AFTER_SETTING_KEY } from "@plugins/builtin/git/settings.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContentDialogHost } from "@/components/common/dialogs/content-host.tsx";
import { AppDialogHost } from "@/components/common/dialogs/host.tsx";
import {
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  updateAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

function interpolate(
  template: string | undefined,
  values: Record<string, number | string> | undefined
): string {
  const base = template ?? "";
  if (!values) {
    return base;
  }
  return base.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

const commitMock = vi.fn(async () => true);
const stageMock = vi.fn(async () => true);
const pushMock = vi.fn(async () => ({ kind: "ok" as const }));
const publishMock = vi.fn(async () => ({ kind: "ok" as const }));
const getStatusMock = vi.fn();
const successMock = vi.fn();
const alertMock = vi.fn(async () => undefined);
const configurationSetMock = vi.fn(async () => undefined);
const watchListeners: Array<(event: { status?: GitStatus }) => void> = [];
const loadingMock = vi.fn(() => ({
  dismiss: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  update: vi.fn(),
}));

function gitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: {
      ahead: 0,
      behind: 0,
      branch: "main",
      mergedIntoDefault: null,
      oid: "abc",
      upstream: null,
      upstreamGone: false,
    },
    changeSummary: {
      changedFiles: 1,
      deletions: 0,
      excludedFiles: 0,
      insertions: 1,
      kind: "lineDelta",
    },
    counts: { conflict: 0, modified: 0, staged: 1, untracked: 0 },
    files: [{ index: "M", origPath: null, path: "src/a.ts", worktree: "." }],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
    ...overrides,
  };
}

function createContext(
  options: { pushAfterPref?: boolean } = {}
): RendererPluginContext {
  return {
    configuration: {
      get: (key: string) =>
        key === GIT_COMMIT_PUSH_AFTER_SETTING_KEY
          ? options.pushAfterPref === true
          : undefined,
      onDidChange: () => () => undefined,
      reset: vi.fn(async () => undefined),
      set: configurationSetMock,
    },
    dialogs: {
      alert: alertMock,
      close: (id: string, result?: unknown) =>
        closeAppContentDialog(id, result),
      confirm: vi.fn(async () => false),
      open: (request: Parameters<typeof openAppContentDialog>[0]) =>
        openAppContentDialog(request),
      prompt: vi.fn(async () => null),
      update: (
        id: string,
        patch: Parameters<typeof updateAppContentDialog>[1]
      ) => updateAppContentDialog(id, patch),
    },
    git: {
      commit: commitMock,
      getStatus: getStatusMock,
      publish: publishMock,
      push: pushMock,
      stage: stageMock,
      watch: vi.fn(
        (_cwd, listener: (event: { status?: GitStatus }) => void) => {
          watchListeners.push(listener);
          return () => {
            const index = watchListeners.indexOf(listener);
            if (index >= 0) {
              watchListeners.splice(index, 1);
            }
          };
        }
      ),
    },
    i18n: {
      commandTitle: (_id: string, fallback?: string) => fallback ?? _id,
      t: (
        _key: string,
        values: Record<string, number | string> | undefined,
        fallback?: string
      ) => interpolate(fallback, values),
    },
    notifications: {
      loading: loadingMock,
      success: successMock,
    },
  } as unknown as RendererPluginContext;
}

describe("GitCommitOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchListeners.length = 0;
    getStatusMock.mockReset();
    render(
      <>
        <AppDialogHost />
        <AppContentDialogHost />
      </>
    );
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  afterEach(() => {
    act(() => {
      resetAppContentDialogForTests();
      resetAppDialogForTests();
    });
    resetGitStatusSessionsForTests();
    resetSyncBusyForTests();
    cleanup();
  });

  function emitLiveStatus(status: GitStatus): void {
    act(() => {
      for (const listener of watchListeners) {
        listener({ status });
      }
    });
  }

  async function open(
    status: GitStatus = gitStatus(),
    options?: { pushAfterPref?: boolean }
  ): Promise<void> {
    getStatusMock.mockImplementation(async () => status);
    act(() => {
      openGitCommitOverlay(createContext(options), { cwd: "/repo", status });
    });
    expect(await screen.findByRole("dialog")).toBeVisible();
    await waitFor(() => {
      expect(getStatusMock).toHaveBeenCalled();
    });
  }

  it("shows counts and keeps submit disabled without a message", async () => {
    await open();
    expect(screen.getByText("1 staged · 0 unstaged")).toBeVisible();
    const include = screen.getByRole("checkbox", {
      name: "Include unstaged changes",
    });
    expect(include).toBeDisabled();
    expect(include).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("commits the index without staging when include-unstaged is off", async () => {
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "fix typo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalledWith("/repo", { message: "fix typo" });
    });
    expect(stageMock).not.toHaveBeenCalled();
    expect(successMock).toHaveBeenCalledWith("Committed");
  });

  it("defaults include-unstaged on and stages those paths before commit", async () => {
    await open(
      gitStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        files: [
          { index: ".", origPath: null, path: "src/b.ts", worktree: "M" },
        ],
      })
    );
    const include = screen.getByRole("checkbox", {
      name: "Include unstaged changes",
    });
    expect(include).toBeEnabled();
    expect(include).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "wip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(stageMock).toHaveBeenCalledWith("/repo", ["src/b.ts"]);
    });
    expect(commitMock).toHaveBeenCalledWith("/repo", { message: "wip" });
  });

  it("commits the index only after the user turns include-unstaged off", async () => {
    await open(
      gitStatus({
        counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
        files: [
          { index: "M", origPath: null, path: "src/a.ts", worktree: "." },
          { index: ".", origPath: null, path: "src/b.ts", worktree: "M" },
        ],
      })
    );
    const include = screen.getByRole("checkbox", {
      name: "Include unstaged changes",
    });
    expect(include).toBeChecked();
    fireEvent.click(include);
    expect(include).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "staged only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalledWith("/repo", {
        message: "staged only",
      });
    });
    expect(stageMock).not.toHaveBeenCalled();
  });

  it("publishes after commit when there is no upstream", async () => {
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Push after commit" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "ship" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledWith("/repo");
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(successMock).toHaveBeenCalledWith("Committed");
    expect(loadingMock).not.toHaveBeenCalled();
  });

  it("pushes after commit when an upstream exists", async () => {
    await open(
      gitStatus({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "main",
          mergedIntoDefault: null,
          oid: "abc",
          upstream: "origin/main",
          upstreamGone: false,
        },
      })
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Push after commit" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "ship" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/repo");
    });
    expect(publishMock).not.toHaveBeenCalled();
    expect(successMock).toHaveBeenCalledWith("Committed");
    expect(loadingMock).not.toHaveBeenCalled();
  });

  it("hides push-after when detached", async () => {
    await open(
      gitStatus({
        branch: {
          ahead: 0,
          behind: 0,
          branch: null,
          mergedIntoDefault: null,
          oid: "abc",
          upstream: null,
          upstreamGone: false,
        },
      })
    );
    expect(
      screen.queryByRole("checkbox", { name: "Push after commit" })
    ).toBeNull();
  });

  it("starts push-after on from the git setting and does not write it back", async () => {
    await open(gitStatus(), { pushAfterPref: true });
    const pushAfter = screen.getByRole("checkbox", {
      name: "Push after commit",
    });
    expect(pushAfter).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "ship" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledWith("/repo");
    });
    expect(configurationSetMock).not.toHaveBeenCalled();
  });

  it("lets this commit turn push-after off without changing the setting", async () => {
    await open(gitStatus(), { pushAfterPref: true });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Push after commit" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "local only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalledWith("/repo", {
        message: "local only",
      });
    });
    expect(publishMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(configurationSetMock).not.toHaveBeenCalled();
  });

  it("describes committing the current changes and focuses the message", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Commit" })).toBeVisible();
    expect(screen.getByText("Commit the current changes.")).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Commit message" })
    ).toHaveFocus();
  });

  it("submits with Mod+Enter and still lets Enter insert a newline", async () => {
    await open();
    const message = screen.getByRole("textbox", { name: "Commit message" });
    fireEvent.change(message, { target: { value: "fix typo" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();
    });
    fireEvent.keyDown(message, { key: "Enter" });
    expect(commitMock).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalledWith("/repo", { message: "fix typo" });
    });
  });

  it("stages paths from getStatus at submit, not the open snapshot", async () => {
    const opened = gitStatus({
      counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
      files: [{ index: ".", origPath: null, path: "src/b.ts", worktree: "M" }],
    });
    const atSubmit = gitStatus({
      counts: { conflict: 0, modified: 2, staged: 0, untracked: 0 },
      files: [
        { index: ".", origPath: null, path: "src/b.ts", worktree: "M" },
        { index: ".", origPath: null, path: "src/c.ts", worktree: "M" },
      ],
    });
    await open(opened);
    expect(screen.getByText("0 staged · 1 unstaged")).toBeVisible();
    getStatusMock.mockImplementation(async () => atSubmit);
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "wip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(stageMock).toHaveBeenCalledWith("/repo", ["src/b.ts", "src/c.ts"]);
    });
    expect(commitMock).toHaveBeenCalledWith("/repo", { message: "wip" });
  });

  it("keeps an include-unstaged off choice when live status still has unstaged files", async () => {
    const withUnstaged = gitStatus({
      counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
      files: [
        { index: "M", origPath: null, path: "src/a.ts", worktree: "." },
        { index: ".", origPath: null, path: "src/b.ts", worktree: "M" },
      ],
    });
    await open(withUnstaged);
    const include = screen.getByRole("checkbox", {
      name: "Include unstaged changes",
    });
    fireEvent.click(include);
    expect(include).not.toBeChecked();
    emitLiveStatus(
      gitStatus({
        ...withUnstaged,
        counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
      })
    );
    expect(include).not.toBeChecked();
    expect(include).toBeEnabled();
  });

  it("shows a paused error without closing the dialog", async () => {
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "keep me" },
    });
    emitLiveStatus(
      gitStatus({
        repoState: { conflictCount: 1, kind: "merging" },
      })
    );
    expect(
      screen.getByText(
        "Continue or abort the current git operation from the status bar first."
      )
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveValue(
      "keep me"
    );
  });

  it("stages newly unstaged files at submit when include was never toggled", async () => {
    await open();
    expect(
      screen.getByRole("checkbox", { name: "Include unstaged changes" })
    ).not.toBeChecked();
    getStatusMock.mockImplementation(async () =>
      gitStatus({
        counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
        files: [
          { index: "M", origPath: null, path: "src/a.ts", worktree: "." },
          { index: ".", origPath: null, path: "src/c.ts", worktree: "M" },
        ],
      })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "wip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(stageMock).toHaveBeenCalledWith("/repo", ["src/c.ts"]);
    });
  });

  it("alerts instead of joining an in-flight sync after commit", async () => {
    trackSync("/repo", () => new Promise(() => undefined));
    await open(gitStatus(), { pushAfterPref: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "ship" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => {
      expect(commitMock).toHaveBeenCalled();
    });
    expect(publishMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Committed, but couldn't push",
      })
    );
  });
});
