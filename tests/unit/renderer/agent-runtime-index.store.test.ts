import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  initAgentRuntimeIndexBridge,
  useAgentRuntimeIndexStore,
} from "@/stores/agent-runtime-index.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
}));

describe("agent-runtime-index store", () => {
  beforeEach(() => {
    useAgentRuntimeIndexStore.getState().reset();
  });

  it("replaces the full table from a snapshot", () => {
    useAgentRuntimeIndexStore.getState().applySnapshot({
      entries: [
        {
          agentId: "claude",
          agentRef: makeAgentRef("1", "p1"),
          panelId: "p1",
          source: "hook",
          status: "waiting",
          updatedAt: 10,
          windowId: "1",
        },
      ],
      ts: 2,
    });

    expect(useAgentRuntimeIndexStore.getState().entries).toHaveLength(1);
    expect(useAgentRuntimeIndexStore.getState().ts).toBe(2);
  });

  it("rejects out-of-order snapshots by ts", () => {
    const apply = useAgentRuntimeIndexStore.getState().applySnapshot;
    apply({
      entries: [
        {
          agentId: "claude",
          agentRef: makeAgentRef("1", "a"),
          panelId: "a",
          source: "hook",
          status: "ready",
          updatedAt: 1,
          windowId: "1",
        },
      ],
      ts: 5,
    });
    apply({
      entries: [],
      ts: 4,
    });

    expect(useAgentRuntimeIndexStore.getState().entries).toHaveLength(1);
    expect(useAgentRuntimeIndexStore.getState().ts).toBe(5);
  });
});

describe("initAgentRuntimeIndexBridge", () => {
  beforeEach(async () => {
    useAgentRuntimeIndexStore.getState().reset();
    await initI18n();
    vi.clearAllMocks();
  });

  it("subscribes before list and applies both paths", async () => {
    const listeners: Array<(s: unknown) => void> = [];
    const list = vi.fn(async () => ({
      entries: [
        {
          agentId: "codex" as const,
          agentRef: makeAgentRef("2", "p2"),
          panelId: "p2",
          source: "launch" as const,
          updatedAt: 3,
          windowId: "2",
        },
      ],
      ts: 8,
    }));
    const onChanged = vi.fn((cb: (s: unknown) => void) => {
      listeners.push(cb);
      return () => undefined;
    });

    const previous = window.pier;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...previous,
        agentRuntimeIndex: {
          focus: vi.fn(),
          focusWaiting: vi.fn(),
          list,
          onAttentionDegraded: vi.fn(() => () => undefined),
          onChanged,
          onFocusFeedback: vi.fn(() => () => undefined),
        },
      },
    });

    const { dispose } = initAgentRuntimeIndexBridge();
    expect(onChanged).toHaveBeenCalled();
    expect(list).toHaveBeenCalled();

    await list.mock.results[0]?.value;
    expect(useAgentRuntimeIndexStore.getState().ts).toBe(8);

    listeners[0]?.({
      entries: [],
      ts: 9,
    });
    expect(useAgentRuntimeIndexStore.getState().entries).toEqual([]);
    expect(useAgentRuntimeIndexStore.getState().ts).toBe(9);

    dispose();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: previous,
    });
  });

  it("alerts when the startup list fails", async () => {
    const list = vi.fn(async () => {
      throw new Error("ipc down");
    });
    const previous = window.pier;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...previous,
        agentRuntimeIndex: {
          focus: vi.fn(),
          focusWaiting: vi.fn(),
          list,
          onAttentionDegraded: vi.fn(() => () => undefined),
          onChanged: vi.fn(() => () => undefined),
          onFocusFeedback: vi.fn(() => () => undefined),
        },
      },
    });

    initAgentRuntimeIndexBridge();
    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "ipc down",
        title: expect.any(String),
      });
    });

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: previous,
    });
  });
});
