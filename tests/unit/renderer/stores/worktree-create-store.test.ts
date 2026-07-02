import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  closeWorktreeCreatePanel,
  openWorktreeCreatePanel,
  setWorktreeCreateBase,
  submitWorktreeCreate,
  updateWorktreeCreateInput,
  useWorktreeCreateStore,
} from "@/stores/worktree-create.store.ts";

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));

const listMock = vi.fn();
const createMock = vi.fn();
const listBranchesMock = vi.fn();
const preferencesReadMock = vi.fn();
const terminalOpenMock = vi.fn();

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  listMock.mockResolvedValue({
    currentPath: "/repo",
    mainPath: "/repo",
    path: "/repo",
    status: "available",
    worktrees: [
      {
        bare: false,
        branch: "main",
        detached: false,
        head: "abc",
        isCurrent: true,
        isMain: true,
        locked: false,
        lockedReason: null,
        path: "/repo",
        prunable: false,
        prunableReason: null,
      },
    ],
  });
  createMock.mockResolvedValue({
    copiedFiles: [".env"],
    created: {
      bare: false,
      branch: "wt/fix-focus",
      detached: false,
      head: "def",
      isCurrent: false,
      isMain: false,
      locked: false,
      lockedReason: null,
      path: "/repo/.worktrees/fix-focus",
      prunable: false,
      prunableReason: null,
    },
    targetPath: "/repo/.worktrees/fix-focus",
    worktrees: [],
  });
  listBranchesMock.mockResolvedValue([
    {
      isCurrent: true,
      kind: "local",
      lastCommit: "abc",
      name: "main",
      upstream: null,
    },
  ]);
  preferencesReadMock.mockResolvedValue({
    worktreeBranchPrefix: "wt/",
    worktreeCopyPatterns: [".env*"],
    worktreeSetupCommand: "pnpm setup:worktree",
  });
  terminalOpenMock.mockResolvedValue(null);
  Object.assign(window, {
    pier: {
      git: { listBranches: listBranchesMock },
      preferences: { read: preferencesReadMock },
      terminal: { open: terminalOpenMock },
      worktrees: { create: createMock, list: listMock },
    },
  });
});

afterEach(() => {
  closeWorktreeCreatePanel();
  vi.clearAllMocks();
});

describe("worktree-create.store", () => {
  it("打开面板后输入描述实时推导分支与目录名", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus bug");
    const session = useWorktreeCreateStore.getState().session;
    expect(session?.branch).toBe("wt/fix-focus-bug");
    expect(session?.name).toBe("fix-focus-bug");
    expect(session?.setupCommand).toBe("pnpm setup:worktree");
  });

  it("提交:create → terminal.open(cwd=targetPath, command=setup)", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: true });
    expect(createMock).toHaveBeenCalledWith({
      branch: "wt/fix-focus",
      name: "fix-focus",
      path: "/repo",
    });
    expect(terminalOpenMock).toHaveBeenCalledWith({
      focus: true,
      launch: {
        command: "pnpm setup:worktree",
        cwd: "/repo/.worktrees/fix-focus",
      },
    });
    expect(useWorktreeCreateStore.getState().session).toBeNull();
  });

  it("仅创建(start:false)不开终端", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: false });
    expect(terminalOpenMock).not.toHaveBeenCalled();
  });

  it("create 失败时面板保留并显示错误", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: true });
    const session = useWorktreeCreateStore.getState().session;
    expect(session?.error).toContain("invalid worktree branch");
    expect(session?.phase).toBe("idle");
  });

  it("setupCommand 为空时 terminal.open 不带 command 字段", async () => {
    preferencesReadMock.mockResolvedValue({
      worktreeBranchPrefix: "wt/",
      worktreeCopyPatterns: [".env*"],
      worktreeSetupCommand: "  ",
    });
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: true });
    expect(terminalOpenMock).toHaveBeenCalledWith({
      focus: true,
      launch: { cwd: "/repo/.worktrees/fix-focus" },
    });
  });

  it("设置 base 分支后 create 携带 base", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    setWorktreeCreateBase("main");
    await submitWorktreeCreate({ start: false });
    expect(createMock).toHaveBeenCalledWith({
      base: "main",
      branch: "wt/fix-focus",
      name: "fix-focus",
      path: "/repo",
    });
  });

  it("terminal.open 失败时报错但不抛出,worktree 创建结果不回滚", async () => {
    terminalOpenMock.mockRejectedValueOnce(new Error("spawn failed"));
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await expect(
      submitWorktreeCreate({ start: true })
    ).resolves.toBeUndefined();
    expect(toastMocks.error).toHaveBeenCalledWith(
      expect.stringContaining("spawn failed")
    );
    expect(useWorktreeCreateStore.getState().session).toBeNull();
  });

  it("worktrees.list 意外拒绝时报错且不创建会话", async () => {
    listMock.mockRejectedValueOnce(new Error("ipc down"));
    await expect(
      openWorktreeCreatePanel({ path: "/repo" })
    ).resolves.toBeUndefined();
    expect(toastMocks.error).toHaveBeenCalledWith(
      expect.stringContaining("ipc down")
    );
    expect(useWorktreeCreateStore.getState().session).toBeNull();
  });

  it("worktrees.list 返回 unavailable 时经 i18n 提示原因,而非裸 enum", async () => {
    listMock.mockResolvedValueOnce({
      path: "/repo",
      reason: "not_git_repo",
      status: "unavailable",
    });
    await expect(
      openWorktreeCreatePanel({ path: "/repo" })
    ).resolves.toBeUndefined();
    expect(toastMocks.error).toHaveBeenCalledWith(
      expect.stringContaining("not_git_repo")
    );
    expect(toastMocks.error).not.toHaveBeenCalledWith("not_git_repo");
    expect(useWorktreeCreateStore.getState().session).toBeNull();
  });
});
