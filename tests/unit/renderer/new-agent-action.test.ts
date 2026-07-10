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
import { NEW_AGENT_ACTION_CONTRIBUTIONS } from "@/lib/actions/new-agent-action.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));
const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({ toast: { error: toastMocks.error } }));
vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: appDialogMocks.showAppAlert,
}));

const prepareLaunch = vi.fn();
const selection = vi.fn();
const addTerminal = vi.fn(() => "terminal-1");

function runNewAgent(): Promise<void> | void {
  return NEW_AGENT_ACTION_CONTRIBUTIONS[0]?.handler();
}

describe("new agent action", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ addTerminal } as never);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { agents: { prepareLaunch, selection } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("使用主进程统一排序结果选择 agent", async () => {
    selection.mockResolvedValueOnce({
      detectedIds: ["claude", "codex"],
      enabledIds: ["claude", "codex"],
      rankedIds: ["codex", "claude"],
      selectedId: "codex",
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-1" });

    await runNewAgent();

    expect(selection).toHaveBeenCalledTimes(1);
    expect(prepareLaunch).toHaveBeenCalledWith("codex");
    expect(addTerminal).toHaveBeenCalledWith({ launchId: "launch-1" });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("无可用 agent → toast，且不创建终端", async () => {
    selection.mockResolvedValueOnce({
      detectedIds: ["claude"],
      enabledIds: [],
      rankedIds: [],
      selectedId: null,
    });

    await runNewAgent();

    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(prepareLaunch).not.toHaveBeenCalled();
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("prepareLaunch 返回 null launchId → 不创建终端", async () => {
    selection.mockResolvedValueOnce({
      detectedIds: ["claude"],
      enabledIds: ["claude"],
      rankedIds: ["claude"],
      selectedId: "claude",
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: null });

    await runNewAgent();

    expect(prepareLaunch).toHaveBeenCalledWith("claude");
    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Agent is no longer available"
    );
  });

  it("agent 选择失败时用宿主弹窗展示技术详情", async () => {
    selection.mockRejectedValueOnce(new Error("selection IPC failed"));

    await runNewAgent();

    expect(appDialogMocks.showAppAlert).toHaveBeenCalledWith({
      body: "selection IPC failed",
      title: "Failed to Start Agent",
    });
    expect(prepareLaunch).not.toHaveBeenCalled();
    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("成功路径 → 用 launchId 创建终端", async () => {
    selection.mockResolvedValueOnce({
      detectedIds: ["claude", "codex"],
      enabledIds: ["claude", "codex"],
      rankedIds: ["codex", "claude"],
      selectedId: "codex",
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-xyz" });

    await runNewAgent();

    expect(prepareLaunch).toHaveBeenCalledWith("codex");
    expect(addTerminal).toHaveBeenCalledTimes(1);
    expect(addTerminal).toHaveBeenCalledWith({ launchId: "launch-xyz" });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
