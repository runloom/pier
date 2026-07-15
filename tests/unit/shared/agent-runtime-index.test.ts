import {
  agentIndexCounts,
  agentRuntimeFocusResultSchema,
  agentRuntimeIndexEntrySchema,
  agentRuntimeIndexSnapshotSchema,
  isAgentIndexNeedsYou,
  isAgentIndexRunning,
  makeAgentRef,
  parseAgentRef,
  projectAgentActivities,
  sortAgentIndexEntries,
} from "@shared/contracts/agent-runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";

function agent(
  overrides: Partial<Extract<ForegroundActivity, { kind: "agent" }>> & {
    panelId: string;
    windowId: string;
  }
): Extract<ForegroundActivity, { kind: "agent" }> {
  return {
    agentId: "claude",
    kind: "agent",
    source: "hook",
    spawnedAt: 1,
    subagentCount: 0,
    updatedAt: 10,
    ...overrides,
  };
}

describe("agent-runtime-index agentRef", () => {
  it("round-trips windowId and panelId", () => {
    const ref = makeAgentRef("1", "panel-a");
    expect(parseAgentRef(ref)).toEqual({
      panelId: "panel-a",
      windowId: "1",
    });
  });

  it("rejects malformed refs", () => {
    expect(parseAgentRef("")).toBeNull();
    expect(parseAgentRef("only-window")).toBeNull();
    expect(parseAgentRef("\0panel")).toBeNull();
  });
});

describe("projectAgentActivities", () => {
  it("keeps only agent activities and preserves launch without status", () => {
    const activities: ForegroundActivity[] = [
      agent({
        panelId: "p1",
        source: "launch",
        windowId: "1",
      }),
      {
        commandLine: "ls",
        kind: "shell",
        panelId: "p2",
        spawnedAt: 1,
        updatedAt: 2,
        windowId: "1",
      },
      {
        kind: "task",
        label: "build",
        panelId: "p3",
        runId: "r1",
        spawnedAt: 1,
        taskId: "build",
        updatedAt: 2,
        windowId: "1",
      },
    ];
    const entries = projectAgentActivities(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      agentId: "claude",
      agentRef: makeAgentRef("1", "p1"),
      panelId: "p1",
      source: "launch",
      windowId: "1",
    });
    expect(entries[0]?.status).toBeUndefined();
  });

  it("projects hook status fields", () => {
    const [entry] = projectAgentActivities([
      agent({
        panelId: "p1",
        stateStartedAt: 5,
        status: "waiting",
        windowId: "2",
      }),
    ]);
    expect(entry?.status).toBe("waiting");
    expect(entry?.stateStartedAt).toBe(5);
  });

  it("attaches optional context summary without inventing fields", () => {
    const [entry] = projectAgentActivities(
      [
        agent({
          panelId: "p1",
          status: "waiting",
          windowId: "1",
        }),
      ],
      {
        resolveContext: (windowId, panelId) => {
          expect(windowId).toBe("1");
          expect(panelId).toBe("p1");
          return {
            cwd: "/tmp/work",
            projectRootPath: "/tmp/pier",
            worktreeKey: "wt-1",
          };
        },
      }
    );
    expect(entry).toMatchObject({
      cwd: "/tmp/work",
      projectRootPath: "/tmp/pier",
      worktreeKey: "wt-1",
    });

    const [bare] = projectAgentActivities(
      [agent({ panelId: "p2", status: "ready", windowId: "1" })],
      { resolveContext: () => null }
    );
    expect(bare?.projectRootPath).toBeUndefined();
  });
});

describe("sortAgentIndexEntries", () => {
  it("orders waiting before error before running before ready", () => {
    const entries = projectAgentActivities([
      agent({
        panelId: "ready",
        status: "ready",
        updatedAt: 100,
        windowId: "1",
      }),
      agent({
        panelId: "run",
        status: "processing",
        updatedAt: 100,
        windowId: "1",
      }),
      agent({
        panelId: "err",
        status: "error",
        updatedAt: 100,
        windowId: "1",
      }),
      agent({
        panelId: "wait",
        status: "waiting",
        updatedAt: 100,
        windowId: "1",
      }),
      agent({
        panelId: "launch",
        source: "launch",
        updatedAt: 100,
        windowId: "1",
      }),
    ]);
    const sorted = sortAgentIndexEntries(entries);
    expect(sorted.map((e) => e.panelId)).toEqual([
      "wait",
      "err",
      "launch",
      "run",
      "ready",
    ]);
  });

  it("prefers newer updatedAt within the same rank", () => {
    const entries = projectAgentActivities([
      agent({
        panelId: "old",
        status: "waiting",
        updatedAt: 1,
        windowId: "1",
      }),
      agent({
        panelId: "new",
        status: "waiting",
        updatedAt: 9,
        windowId: "1",
      }),
    ]);
    expect(sortAgentIndexEntries(entries).map((e) => e.panelId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("prefers preferredWindowId when timestamps tie", () => {
    const entries = projectAgentActivities([
      agent({
        panelId: "other",
        status: "waiting",
        updatedAt: 5,
        windowId: "2",
      }),
      agent({
        panelId: "here",
        status: "waiting",
        updatedAt: 5,
        windowId: "1",
      }),
    ]);
    expect(
      sortAgentIndexEntries(entries, { preferredWindowId: "1" }).map(
        (e) => e.panelId
      )
    ).toEqual(["here", "other"]);
  });

  it("prefers preferredProjectRootPath within the same window and timestamp", () => {
    const entries = projectAgentActivities(
      [
        agent({
          panelId: "other-root",
          status: "waiting",
          updatedAt: 5,
          windowId: "1",
        }),
        agent({
          panelId: "here-root",
          status: "waiting",
          updatedAt: 5,
          windowId: "1",
        }),
      ],
      {
        resolveContext: (_windowId, panelId) =>
          panelId === "here-root"
            ? { projectRootPath: "/tmp/active" }
            : { projectRootPath: "/tmp/other" },
      }
    );
    expect(
      sortAgentIndexEntries(entries, {
        preferredProjectRootPath: "/tmp/active",
        preferredWindowId: "1",
      }).map((e) => e.panelId)
    ).toEqual(["here-root", "other-root"]);
  });
});

describe("agentIndexCounts", () => {
  it("counts launch as running and waiting+error as needsYou", () => {
    const entries = projectAgentActivities([
      agent({ panelId: "a", source: "launch", windowId: "1" }),
      agent({ panelId: "b", status: "waiting", windowId: "1" }),
      agent({ panelId: "c", status: "error", windowId: "1" }),
      agent({ panelId: "d", status: "ready", windowId: "1" }),
    ]);
    expect(agentIndexCounts(entries)).toEqual({
      needsYou: 2,
      ready: 1,
      running: 1,
    });
  });
});

describe("needsYou / running helpers", () => {
  it("classifies statuses", () => {
    expect(isAgentIndexNeedsYou("waiting")).toBe(true);
    expect(isAgentIndexNeedsYou("error")).toBe(true);
    expect(isAgentIndexNeedsYou("ready")).toBe(false);
    expect(isAgentIndexRunning(undefined)).toBe(true);
    expect(isAgentIndexRunning("tool")).toBe(true);
    expect(isAgentIndexRunning("ready")).toBe(false);
  });
});

describe("agent-runtime-index schemas", () => {
  it("accepts a minimal entry and snapshot", () => {
    const entry = agentRuntimeIndexEntrySchema.parse({
      agentId: "codex",
      agentRef: makeAgentRef("1", "p"),
      panelId: "p",
      source: "hook",
      status: "waiting",
      updatedAt: 1,
      windowId: "1",
    });
    expect(entry.agentId).toBe("codex");
    const snap = agentRuntimeIndexSnapshotSchema.parse({
      entries: [entry],
      ts: 1,
    });
    expect(snap.entries).toHaveLength(1);
  });

  it("accepts focus result variants", () => {
    expect(agentRuntimeFocusResultSchema.parse({ status: "ok" }).status).toBe(
      "ok"
    );
    expect(
      agentRuntimeFocusResultSchema.parse({
        message: "boom",
        status: "error",
      }).status
    ).toBe("error");
  });
});
