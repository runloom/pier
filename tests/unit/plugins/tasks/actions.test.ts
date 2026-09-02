import { describe, expect, it, vi } from "vitest";
import { createTaskActions } from "../../../../packages/plugin-tasks/src/main/actions.ts";
import type { TrackerProvider } from "../../../../packages/plugin-tasks/src/main/providers/types.ts";
import { createKeyedMutationLanes } from "../../../../packages/plugin-tasks/src/main/serial-queue.ts";
import type { TaskBoardSnapshot } from "../../../../packages/plugin-tasks/src/shared/types.ts";

function snapshot(overrides?: Partial<TaskBoardSnapshot>): TaskBoardSnapshot {
  return {
    canWrite: true,
    columnMapping: "heuristic",
    columns: [
      {
        id: "todo",
        items: [
          {
            assignee: null,
            blockers: [],
            externalBlockedByCount: 0,
            externalBlockers: [],
            key: "acme/app#1",
            labels: [],
            linkedPRs: [],
            milestone: "M1",
            number: 1,
            openBlockedByCount: 0,
            repo: "acme/app",
            title: "Ship",
            url: "https://example.test/1",
          },
        ],
        readonly: false,
        title: "Todo",
      },
      { id: "inProgress", items: [], readonly: false, title: "In progress" },
      { id: "done", items: [], readonly: true, title: "Done" },
    ],
    cycleKeys: [],
    fetchedAt: 1,
    generation: 1,
    hasCycle: false,
    params: { repo: "acme/app", milestone: "M1" },
    schemaVersion: 1,
    truncated: false,
    ...overrides,
  };
}

describe("task actions", () => {
  it("refuses done without confirm or merged PRs", async () => {
    const provider = {
      setClosed: vi.fn(),
      setAssignees: vi.fn(),
      viewerLogin: vi.fn(async () => "ada"),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await expect(
      actions.setStatus({
        columnId: "done",
        itemKey: "acme/app#1",
        params: { repo: "acme/app", milestone: "M1" },
      })
    ).rejects.toThrow(/read-only/);
    expect(provider.setClosed).not.toHaveBeenCalled();
  });

  it("closes when confirm is true", async () => {
    const provider = {
      setClosed: vi.fn(async () => undefined),
      setAssignees: vi.fn(),
      viewerLogin: vi.fn(async () => "ada"),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "done",
      confirm: true,
      itemKey: "acme/app#1",
      params: { repo: "acme/app", milestone: "M1" },
    });
    expect(provider.setClosed).toHaveBeenCalledWith("acme/app#1", true, {
      milestone: "M1",
      repo: "acme/app",
    });
  });

  it("reopens the issue when a card moves back to in progress", async () => {
    const provider = {
      setAssignees: vi.fn(async () => undefined),
      setClosed: vi.fn(async () => undefined),
      viewerLogin: vi.fn(async () => "ada"),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "inProgress",
      itemKey: "acme/app#1",
      params: { repo: "acme/app" },
    });
    expect(provider.setAssignees).toHaveBeenCalledWith("acme/app#1", ["ada"], {
      repo: "acme/app",
    });
    expect(provider.setClosed).toHaveBeenCalledWith("acme/app#1", false, {
      repo: "acme/app",
    });
  });

  it("does not start a later mutation after an earlier failure in the same lane", async () => {
    const order: string[] = [];
    const provider = {
      setAssignees: vi.fn(async () => {
        order.push("assign");
        throw new Error("boom");
      }),
      setClosed: vi.fn(async () => {
        order.push("close");
      }),
      viewerLogin: vi.fn(async () => "ada"),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    const first = actions.setStatus({
      columnId: "inProgress",
      itemKey: "acme/app#1",
      params: { repo: "acme/app" },
    });
    const second = actions.close({
      confirm: true,
      itemKey: "acme/app#1",
      params: { repo: "acme/app" },
    });
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(order).toEqual(["assign", "close"]);
  });

  it("writes Linear and Jira columns through setColumnStatus", async () => {
    const provider = {
      setAssignees: vi.fn(),
      setClosed: vi.fn(),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "inProgress",
      itemKey: "ENG-1",
      params: { provider: "linear", repo: "ENG" },
    });
    expect(provider.setColumnStatus).toHaveBeenCalledWith(
      "ENG-1",
      "inProgress",
      { provider: "linear", repo: "ENG" },
      undefined
    );
    expect(provider.setAssignees).not.toHaveBeenCalled();
    expect(provider.setClosed).not.toHaveBeenCalled();
  });

  it("writes Linear done without GitHub PR confirmation", async () => {
    const provider = {
      setAssignees: vi.fn(),
      setClosed: vi.fn(),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "done",
      itemKey: "ENG-1",
      params: { provider: "linear", repo: "ENG" },
    });
    expect(provider.setColumnStatus).toHaveBeenCalledWith(
      "ENG-1",
      "done",
      { provider: "linear", repo: "ENG" },
      undefined
    );
    expect(provider.setClosed).not.toHaveBeenCalled();
  });

  it("forwards Jira neighbor keys so Agile Rank can keep the drop index", async () => {
    const provider = {
      setAssignees: vi.fn(),
      setClosed: vi.fn(),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "todo",
      itemKey: "ENG-1",
      params: { provider: "jira", repo: "ENG" },
      rankAfterKey: "ENG-0",
      rankBeforeKey: "ENG-2",
    });
    expect(provider.setColumnStatus).toHaveBeenCalledWith(
      "ENG-1",
      "todo",
      { provider: "jira", repo: "ENG" },
      { rankAfterKey: "ENG-0", rankBeforeKey: "ENG-2" }
    );
  });

  it("forwards the drop rank to Linear setColumnStatus", async () => {
    const provider = {
      setAssignees: vi.fn(),
      setClosed: vi.fn(),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "todo",
      itemKey: "ENG-1",
      params: { provider: "linear", repo: "ENG" },
      sortOrder: 42,
    });
    expect(provider.setColumnStatus).toHaveBeenCalledWith(
      "ENG-1",
      "todo",
      { provider: "linear", repo: "ENG" },
      { sortOrder: 42 }
    );
  });

  it("reads the board without a forced refresh before writing a column", async () => {
    const calls: string[] = [];
    const provider = {
      setAssignees: vi.fn(),
      setClosed: vi.fn(),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      read: async () => {
        calls.push("read");
        return snapshot();
      },
      refresh: async () => {
        calls.push("refresh");
        return snapshot();
      },
    });
    await actions.setStatus({
      columnId: "inProgress",
      itemKey: "ENG-1",
      params: { provider: "linear", repo: "ENG" },
    });
    expect(calls).toEqual(["read", "refresh"]);
  });

  it("keeps GitHub on assignment writes even if setColumnStatus exists", async () => {
    const provider = {
      setAssignees: vi.fn(async () => undefined),
      setClosed: vi.fn(async () => undefined),
      setColumnStatus: vi.fn(async () => undefined),
      viewerLogin: vi.fn(async () => "ada"),
    } as unknown as TrackerProvider;
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      refresh: async () => snapshot(),
    });
    await actions.setStatus({
      columnId: "inProgress",
      itemKey: "acme/app#1",
      params: { provider: "github", repo: "acme/app" },
    });
    expect(provider.setColumnStatus).not.toHaveBeenCalled();
    expect(provider.setAssignees).toHaveBeenCalled();
  });
});
