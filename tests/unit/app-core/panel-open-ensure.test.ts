import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const peekContext = vi.hoisted(() => vi.fn());
const peekAgent = vi.hoisted(() => vi.fn());
const peekTask = vi.hoisted(() => vi.fn());

vi.mock("@main/state/terminal-session-state.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    peekTerminalPanelAgent: (...args: unknown[]) => peekAgent(...args),
    peekTerminalPanelContext: (...args: unknown[]) => peekContext(...args),
    peekTerminalPanelTask: (...args: unknown[]) => peekTask(...args),
  };
});

import {
  listPanels,
  type PanelCommandServices,
} from "@main/app-core/commands/panel.ts";
import { executePanelOpenCommand } from "@main/app-core/commands/panel-open.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";

const tempDirs: string[] = [];

function contextFor(path: string): PanelContext {
  return {
    contextId: `ctx:${path}`,
    cwd: path,
    openedPath: path,
    projectRootPath: path,
    source: "cli",
    updatedAt: 1,
    worktreeKey: path,
  };
}

function services(input: {
  panels?: Array<{
    active?: boolean;
    component?: string;
    context?: PanelContext;
    id: string;
    kind?: string;
    params?: Record<string, unknown>;
  }>;
  renderer?: unknown[];
  runtimeAgents?: Array<{ agentId: string; panelId: string }>;
}): PanelCommandServices {
  const renderer = input.renderer ?? [];
  const panels = input.panels ?? [];
  return {
    localEnvironments: {
      resolveForWorktree: async () => null,
      resolveProject: async () => null,
    },
    panelContexts: {
      recordRecent: async () => undefined,
      resolveForPath: async (path) => contextFor(path),
    },
    preferences: {
      read: async () => ({}) as never,
    },
    processEnvironment: {
      resolve: async () => ({ env: {} }),
    } as never,
    rendererCommand: {
      execute: async (command) => {
        renderer.push(command);
        if (command.type === "panel.list") {
          return {
            data: panels,
            ok: true,
            requestId: "r",
          };
        }
        if (command.type === "panel.focus") {
          return {
            data: { panelId: command.panelId },
            ok: true,
            requestId: "r",
          };
        }
        if (command.type === "terminal.open") {
          return {
            data: { panelId: "terminal-new" },
            ok: true,
            requestId: "r",
          };
        }
        if (command.type === "files.openDisk") {
          return {
            data: { panelId: "file-1", reused: false },
            ok: true,
            requestId: "r",
          };
        }
        return { data: null, ok: true, requestId: "r" };
      },
      resolve: () => undefined,
    },
    terminalLaunches: {
      consume: async () => null,
      discard: async () => undefined,
      read: async () => null,
      register: () => "launch-1",
    },
    terminalProfiles: {
      resolve: async () => null,
    },
    window: {
      list: () => [{ focused: true, id: "main", recordId: "record-main" }],
    },
    agentRuntimeIndex: {
      listMachine: () => ({
        entries: input.runtimeAgents ?? [],
      }),
    },
  } as PanelCommandServices;
}

describe("executePanelOpenCommand", () => {
  beforeEach(() => {
    peekContext.mockReset();
    peekAgent.mockReset();
    peekTask.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("reuses a matching shell terminal using recordId peek", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-"));
    tempDirs.push(dir);
    peekContext.mockImplementation((recordId: string, panelId: string) => {
      expect(recordId).toBe("record-main");
      return panelId === "shell-1" ? { cwd: dir } : null;
    });
    const renderer: unknown[] = [];
    const svc = services({
      panels: [
        {
          active: true,
          component: "terminal",
          context: contextFor(dir),
          id: "shell-1",
          kind: "terminal",
        },
      ],
      renderer,
    });
    const listed = await listPanels(
      { type: "panel.list", windowId: "main" },
      svc
    );
    expect(
      listed.panels.map((panel) => ({
        component: panel.component,
        cwd: panel.context?.cwd,
        id: panel.id,
      }))
    ).toEqual([{ component: "terminal", cwd: dir, id: "shell-1" }]);
    const result = await executePanelOpenCommand(
      "req",
      { path: dir, type: "panel.open" },
      svc
    );
    expect(result).toMatchObject({
      data: { panelId: "shell-1", reused: true },
      ok: true,
    });
    expect(renderer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ panelId: "shell-1", type: "panel.focus" }),
      ])
    );
  });

  it("does not reuse a live agent terminal with the same cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-agent-"));
    tempDirs.push(dir);
    peekContext.mockReturnValue({ cwd: dir });
    const result = await executePanelOpenCommand(
      "req",
      { path: dir, type: "panel.open" },
      services({
        panels: [
          {
            component: "terminal",
            id: "agent-1",
            context: contextFor(dir),
          },
        ],
        runtimeAgents: [{ agentId: "claude", panelId: "agent-1" }],
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "terminal-new", reused: false },
      ok: true,
    });
  });

  it("does not reuse an exited agent tab", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-exited-"));
    tempDirs.push(dir);
    peekContext.mockReturnValue({ cwd: dir });
    peekAgent.mockReturnValue({ status: "exited" });
    const result = await executePanelOpenCommand(
      "req",
      { path: dir, type: "panel.open" },
      services({
        panels: [
          {
            component: "terminal",
            id: "ended-agent",
            context: contextFor(dir),
          },
        ],
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "terminal-new", reused: false },
      ok: true,
    });
  });

  it("opens files via files.openDisk and never addTerminal(dirname)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-file-"));
    tempDirs.push(dir);
    const filePath = join(dir, "app.ts");
    await writeFile(filePath, "export {}\n");
    const renderer: unknown[] = [];
    const result = await executePanelOpenCommand(
      "req",
      {
        path: filePath,
        paths: [{ line: 12, path: filePath }],
        type: "panel.open",
      },
      services({ renderer })
    );
    expect(result).toMatchObject({
      data: {
        panelId: "file-1",
        results: [{ kind: "file", line: 12, reused: false }],
      },
      ok: true,
    });
    expect(renderer).toEqual([
      expect.objectContaining({
        line: 12,
        revealTree: false,
        type: "files.openDisk",
      }),
    ]);
    expect(renderer).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "terminal.open" }),
      ])
    );
  });

  it("skips reuse when placement/--split is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-split-"));
    tempDirs.push(dir);
    peekContext.mockReturnValue({ cwd: dir });
    const renderer: unknown[] = [];
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        placement: "split-right",
        type: "panel.open",
      },
      services({
        panels: [
          {
            active: true,
            component: "terminal",
            context: contextFor(dir),
            id: "shell-1",
            kind: "terminal",
          },
        ],
        renderer,
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "terminal-new", reused: false },
      ok: true,
    });
    expect(renderer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          placement: "split-right",
          type: "terminal.open",
        }),
      ])
    );
    expect(renderer).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "panel.focus" })])
    );
  });

  it("falls back when nested windowId is stale and origin panel is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-stale-"));
    tempDirs.push(dir);
    peekContext.mockImplementation((_recordId: string, panelId: string) =>
      panelId === "origin-1" ? { cwd: dir } : null
    );
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        referencePanelId: "origin-1",
        type: "panel.open",
        windowId: "stale-window",
      },
      services({
        panels: [
          {
            active: true,
            component: "terminal",
            context: contextFor(dir),
            id: "origin-1",
            kind: "terminal",
          },
        ],
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "origin-1", reused: true, windowId: "main" },
      ok: true,
    });
  });

  it("fails when an explicit windowId is stale and there is no nested origin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-stale-flag-"));
    tempDirs.push(dir);
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        type: "panel.open",
        windowId: "stale-window",
      },
      services({})
    );
    expect(result).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });
  });

  it("opens a nested new terminal within the origin group when cwd differs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-within-"));
    tempDirs.push(dir);
    peekContext.mockImplementation((_recordId: string, panelId: string) =>
      panelId === "origin-1" ? { cwd: "/other/project" } : null
    );
    const renderer: unknown[] = [];
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        referencePanelId: "origin-1",
        type: "panel.open",
        windowId: "main",
      },
      services({
        panels: [
          {
            component: "terminal",
            id: "origin-1",
            kind: "terminal",
          },
        ],
        renderer,
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "terminal-new", reused: false },
      ok: true,
    });
    expect(renderer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referencePanelId: "origin-1",
          type: "terminal.open",
        }),
      ])
    );
    expect(
      renderer.find(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "terminal.open"
      )
    ).not.toHaveProperty("placement");
  });

  it("does not reuse a nested agent origin even when cwd matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-nested-agent-"));
    tempDirs.push(dir);
    peekContext.mockReturnValue({ cwd: dir });
    const renderer: unknown[] = [];
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        referencePanelId: "agent-1",
        type: "panel.open",
        windowId: "main",
      },
      services({
        panels: [
          {
            component: "terminal",
            context: contextFor(dir),
            id: "agent-1",
            kind: "terminal",
          },
        ],
        renderer,
        runtimeAgents: [{ agentId: "claude", panelId: "agent-1" }],
      })
    );
    expect(result).toMatchObject({
      data: { panelId: "terminal-new", reused: false },
      ok: true,
    });
    expect(renderer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referencePanelId: "agent-1",
          type: "terminal.open",
        }),
      ])
    );
    expect(renderer).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ panelId: "agent-1", type: "panel.focus" }),
      ])
    );
  });

  it("uses the last path for panelId and the last directory for context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ensure-mixed-"));
    tempDirs.push(dir);
    const filePath = join(dir, "app.ts");
    await writeFile(filePath, "export {}\n");
    const result = await executePanelOpenCommand(
      "req",
      {
        path: dir,
        paths: [{ path: dir }, { line: 4, path: filePath }],
        type: "panel.open",
      },
      services({})
    );
    expect(result).toMatchObject({
      data: { panelId: "file-1", reused: false },
      ok: true,
    });
    const payload =
      result.ok && result.data && typeof result.data === "object"
        ? (result.data as {
            context?: { openedPath?: string };
            results?: Array<{ kind: string; line?: number }>;
          })
        : {};
    expect(payload.results?.map((item) => item.kind)).toEqual([
      "terminal",
      "file",
    ]);
    expect(payload.results?.[1]).toMatchObject({ kind: "file", line: 4 });
    expect(payload.context?.openedPath).not.toBe(filePath);
  });

  it("returns not_found for missing paths without creating files", async () => {
    const result = await executePanelOpenCommand(
      "req",
      { path: "/tmp/pier-does-not-exist-xyz", type: "panel.open" },
      services({})
    );
    expect(result).toMatchObject({
      error: {
        code: "not_found",
        message:
          "path not found: /tmp/pier-does-not-exist-xyz. Pier does not create files. Create it first, then retry.",
      },
      ok: false,
    });
  });
});
