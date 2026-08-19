import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLspE2eObserverFromEnvironment,
  installLspE2eObserverGlobal,
  LspE2eObserver,
  removeLspE2eObserverGlobal,
} from "../../../../src/main/services/lsp/e2e-observer.ts";
import type { ProcessTreeHandle } from "../../../../src/main/services/lsp/process-termination.ts";
import { LspSessionHost } from "../../../../src/main/services/lsp/session-host.ts";
import { FakeLspChild, flushMicrotasks } from "./test-fixtures.ts";

interface ControlledTree extends ProcessTreeHandle {
  resolveTerminal(): void;
}

function createControlledTree(): ControlledTree {
  const terminal = Promise.withResolvers<void>();
  let alive = true;
  let terminalSettled = false;
  const resolveTerminal = () => {
    if (terminalSettled) {
      return;
    }
    terminalSettled = true;
    alive = false;
    terminal.resolve();
  };
  return {
    terminal: terminal.promise,
    async close() {
      await terminal.promise;
    },
    async forceTerminate() {
      resolveTerminal();
    },
    async gracefulTerminate() {
      resolveTerminal();
    },
    async isAlive() {
      return alive;
    },
    resolveTerminal,
  };
}

const started = (tree: ProcessTreeHandle) => ({
  pid: 4242,
  processTree: tree,
  rootPath: "/repo",
  serverId: "typescript",
  sessionId: "lsp-1",
  workspaceKey: "main:/repo",
});

describe("LspE2eObserver", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    removeLspE2eObserverGlobal(globalThis.__PIER_LSP_E2E_OBSERVER__ ?? null);
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { force: true, recursive: true }))
    );
    vi.restoreAllMocks();
  });

  it("is disabled unless the dedicated environment gate is exactly enabled", () => {
    const closeSession = vi.fn(async () => true);

    expect(
      createLspE2eObserverFromEnvironment({ closeSession, env: {} })
    ).toBeNull();
    expect(
      createLspE2eObserverFromEnvironment({
        closeSession,
        env: { PIER_LSP_E2E_OBSERVER: "0" },
      })
    ).toBeNull();

    const observer = createLspE2eObserverFromEnvironment({
      closeSession,
      env: { PIER_LSP_E2E_OBSERVER: "1" },
    });
    expect(observer).toBeInstanceOf(LspE2eObserver);
    expect(globalThis.__PIER_LSP_E2E_OBSERVER__).toBeUndefined();
  });

  it("installs and removes only the requested observer global", () => {
    const first = new LspE2eObserver({ closeSession: async () => true });
    const second = new LspE2eObserver({ closeSession: async () => true });

    expect(installLspE2eObserverGlobal(first, {})).toBe(false);
    expect(globalThis.__PIER_LSP_E2E_OBSERVER__).toBeUndefined();
    expect(
      installLspE2eObserverGlobal(first, {
        PIER_LSP_E2E_OBSERVER: "1",
      })
    ).toBe(true);
    expect(globalThis.__PIER_LSP_E2E_OBSERVER__).toBe(first);

    removeLspE2eObserverGlobal(second);
    expect(globalThis.__PIER_LSP_E2E_OBSERVER__).toBe(first);

    removeLspE2eObserverGlobal(first);
    expect(globalThis.__PIER_LSP_E2E_OBSERVER__).toBeUndefined();
  });

  it("returns immutable point-in-time snapshots of the full session history", async () => {
    const tree = createControlledTree();
    const observer = new LspE2eObserver({
      closeSession: async () => true,
      now: () => 1234,
    });
    observer.started(started(tree));

    const first = await observer.snapshot();
    expect(first).toEqual([
      {
        alive: true,
        closeCause: null,
        pid: 4242,
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-1",
        startedAt: 1234,
        treeTerminal: false,
        workspaceKey: "main:/repo",
      },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);

    observer.closeRequested("lsp-1", "app-quit");
    tree.resolveTerminal();
    observer.treeTerminal("lsp-1");
    const second = await observer.snapshot();

    expect(first[0]).toMatchObject({
      alive: true,
      closeCause: null,
      treeTerminal: false,
    });
    expect(second[0]).toMatchObject({
      alive: false,
      closeCause: "app-quit",
      treeTerminal: true,
    });
  });

  it("force-terminates the recorded process tree and rejects unsupported close causes", async () => {
    const tree = createControlledTree();
    const closeSession = vi.fn(async () => true);
    const observer = new LspE2eObserver({ closeSession });
    observer.started(started(tree));

    await expect(observer.terminate("missing")).resolves.toBe(false);
    await expect(observer.terminate("lsp-1")).resolves.toBe(true);
    await expect(observer.terminate("lsp-1")).resolves.toBe(false);
    await expect(observer.close("lsp-1", "idle-release")).resolves.toBe(true);
    expect(closeSession).toHaveBeenCalledWith("lsp-1", "idle-release");
    await expect(
      Reflect.apply(observer.close, observer, ["lsp-1", "app-quit"])
    ).rejects.toThrow("Unsupported E2E close cause: app-quit");
  });

  it("records host start, close request, and process-tree terminal callbacks", async () => {
    const child = new FakeLspChild(9876);
    const tree = createControlledTree();
    const observer = new LspE2eObserver({
      closeSession: vi.fn(async () => false),
      now: () => 5678,
    });
    const host = new LspSessionHost({
      observer,
      processTreeFactory: () => tree,
      spawnImpl: () => child,
    });
    const session = host.ensure({
      launch: { args: ["--stdio"], command: "fake-ls", cwd: "/repo" },
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });

    const closing = host.close(session.sessionId, "workspace-evicted");
    child.exit(0);
    tree.resolveTerminal();
    await closing;
    await flushMicrotasks();

    await expect(observer.snapshot()).resolves.toEqual([
      {
        alive: false,
        closeCause: "workspace-evicted",
        pid: 9876,
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: session.sessionId,
        startedAt: 5678,
        treeTerminal: true,
        workspaceKey: "main:/repo",
      },
    ]);
  });

  it("atomically writes a final shutdown report from live process probes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-lsp-observer-"));
    temporaryDirectories.push(dir);
    const reportPath = join(dir, "report.json");
    const tree = createControlledTree();
    const observer = new LspE2eObserver({
      closeSession: async () => true,
      reportPath,
    });
    observer.started(started(tree));
    observer.closeRequested("lsp-1", "app-quit");
    tree.resolveTerminal();
    observer.treeTerminal("lsp-1");

    await observer.writeFinalReport();

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report).toEqual({
      liveProcessTrees: [],
      sessions: [
        expect.objectContaining({
          alive: false,
          closeCause: "app-quit",
          sessionId: "lsp-1",
          treeTerminal: true,
        }),
      ],
      shutdownCompleted: true,
    });
  });
});
