import { spawn } from "node:child_process";

import type {
  LspSessionCloseCause,
  LspSessionClosedEvent,
} from "@shared/contracts/lsp.ts";
import type { LspServerLaunchSpec } from "@shared/contracts/lsp-provider.ts";
import {
  createPosixProcessTreeHandle,
  type LspChildProcess,
  launchWindowsProcessTree,
  loadWindowsJobAddon,
  type ProcessTreeHandle,
  type WindowsSupervisor,
} from "./process-termination.ts";
import { normalizeFsRoot } from "./resolve-root.ts";
import {
  createFailedLaunchProcessTreeHandle,
  deferredProcessTree,
  sessionOwnerKey,
} from "./session-host-process.ts";
import {
  createLspSessionRuntime,
  type LanguageToolsTextDocument,
  type LspSessionClientRole,
  type LspSessionRuntime,
} from "./session-runtime.ts";
import { spawnWindowsSupervisor } from "./windows-supervisor.ts";

export type {
  LanguageToolsTextDocument,
  LspSessionClientRole,
} from "./session-runtime.ts";

interface ProcessTreeFactoryInput {
  child: LspChildProcess;
  launch: LspServerLaunchSpec;
}

export interface LspSessionStartedEvent {
  clientRole: LspSessionClientRole;
  pid: number | null;
  processTree: ProcessTreeHandle;
  rootPath: string;
  serverId: string;
  sessionId: string;
  workspaceKey: string;
}

export interface LspSessionHostObserver {
  closeRequested(sessionId: string, cause: LspSessionCloseCause): void;
  started(event: LspSessionStartedEvent): void;
  treeTerminal(sessionId: string): void;
}

export type LspProcessSpawner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    detached: boolean;
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
  }
) => LspChildProcess;

export interface LspSessionHostOptions {
  observer?: LspSessionHostObserver;
  processTreeFactory?: (input: ProcessTreeFactoryInput) => ProcessTreeHandle;
  spawnImpl?: LspProcessSpawner;
}

interface ClosingTree {
  closePromise: Promise<boolean>;
  notificationSent: boolean;
  runtime: LspSessionRuntime;
  stickyCause: LspSessionCloseCause | null;
  workspaceKey: string;
}

export class LspSessionHost {
  readonly #bySessionId = new Map<string, LspSessionRuntime>();
  readonly #byOwnerKey = new Map<string, string>();
  readonly #closingTrees = new Map<string, ClosingTree>();
  readonly #onCloseAcceptedBySessionId = new Map<
    string,
    (sessionId: string) => void
  >();
  readonly #observer: LspSessionHostObserver | undefined;
  readonly #processTreeFactory:
    | ((input: ProcessTreeFactoryInput) => ProcessTreeHandle)
    | undefined;
  readonly #spawn: LspProcessSpawner;
  #nextSessionId = 1;

  constructor(options: LspSessionHostOptions = {}) {
    this.#observer = options.observer;
    this.#spawn = options.spawnImpl ?? spawn;
    this.#processTreeFactory = options.processTreeFactory;
  }

  ensure(input: {
    clientRole: LspSessionClientRole;
    launch: LspServerLaunchSpec;
    onClose?: (
      event: LspSessionClosedEvent,
      treeTerminal: Promise<void>
    ) => void;
    onCloseAccepted?: (sessionId: string) => void;
    onMessage: (sessionId: string, jsonBody: string) => void;
    rootPath: string;
    serverId: string;
    webContentsId: number;
    workspaceKey: string;
  }): {
    reused: boolean;
    rootPath: string;
    serverId: string;
    sessionId: string;
  } {
    const rootPath = normalizeFsRoot(input.rootPath);
    const ownerKey = sessionOwnerKey({ ...input, rootPath });
    const existingId = this.#byOwnerKey.get(ownerKey);
    if (existingId) {
      const existing = this.#bySessionId.get(existingId);
      if (
        existing &&
        existing.phase !== "shutting-down" &&
        existing.phase !== "exit-sent" &&
        existing.phase !== "terminating" &&
        existing.phase !== "closed"
      ) {
        return {
          reused: true,
          rootPath,
          serverId: input.serverId,
          sessionId: existingId,
        };
      }
      this.#byOwnerKey.delete(ownerKey);
    }

    const sessionId = `lsp-${this.#nextSessionId++}`;
    let child: LspChildProcess;
    let processTree: ProcessTreeHandle;

    if (process.platform === "win32" && !this.#processTreeFactory) {
      let supervisor: WindowsSupervisor | undefined;
      let spawnError: unknown;
      const treePromise = launchWindowsProcessTree({
        addon: loadWindowsJobAddon(),
        launch: input.launch,
        spawnSupervisor: () => {
          try {
            supervisor = spawnWindowsSupervisor();
            return supervisor;
          } catch (error) {
            spawnError = error;
            throw error;
          }
        },
      });
      if (!supervisor) {
        treePromise.catch(() => undefined);
        let detail = "";
        if (spawnError instanceof Error) {
          detail = spawnError.message;
        } else if (spawnError) {
          detail = String(spawnError);
        }
        throw new Error(
          detail
            ? `Windows LSP supervisor failed to spawn: ${detail}`
            : "Windows LSP supervisor failed to spawn",
          {
            cause: spawnError instanceof Error ? spawnError : undefined,
          }
        );
      }
      child = supervisor.child;
      processTree = deferredProcessTree(treePromise, supervisor.terminal);
      treePromise.catch((error: unknown) => {
        child.emit("error", error);
      });
    } else {
      child = this.#spawn(input.launch.command, [...input.launch.args], {
        cwd: input.launch.cwd || rootPath,
        detached: process.platform !== "win32",
        env: { ...process.env, ...input.launch.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const childPid = child.pid;
      if (typeof childPid === "number" && childPid > 0) {
        processTree = this.#processTreeFactory
          ? this.#processTreeFactory({ child, launch: input.launch })
          : createPosixProcessTreeHandle({ pgid: childPid });
      } else {
        const failedLaunchTree = createFailedLaunchProcessTreeHandle(child);
        processTree = this.#processTreeFactory
          ? this.#processTreeFactory({ child, launch: input.launch })
          : failedLaunchTree;
      }
    }

    let runtime: LspSessionRuntime;
    runtime = createLspSessionRuntime({
      child,
      clientRole: input.clientRole,
      ...(input.launch.initializationOptions
        ? { initializationOptions: input.launch.initializationOptions }
        : {}),
      onMessage: input.onMessage,
      onOutcome: (event) => {
        this.#acceptOutcome(runtime, ownerKey, event, input.onClose);
      },
      processTree,
      rootPath,
      serverId: input.serverId,
      sessionId,
      webContentsId: input.webContentsId,
      workspaceKey: input.workspaceKey,
    });
    this.#bySessionId.set(sessionId, runtime);
    this.#byOwnerKey.set(ownerKey, sessionId);
    if (input.onCloseAccepted) {
      this.#onCloseAcceptedBySessionId.set(sessionId, input.onCloseAccepted);
    }
    this.#observer?.started({
      clientRole: input.clientRole,
      pid: typeof child.pid === "number" && child.pid > 0 ? child.pid : null,
      processTree,
      rootPath,
      serverId: input.serverId,
      sessionId,
      workspaceKey: input.workspaceKey,
    });
    if (this.#observer) {
      processTree.terminal.then(
        () => {
          this.#observer?.treeTerminal(sessionId);
        },
        () => undefined
      );
    }
    return { reused: false, rootPath, serverId: input.serverId, sessionId };
  }

  send(sessionId: string, jsonBody: string): boolean {
    return this.#bySessionId.get(sessionId)?.send(jsonBody) ?? false;
  }

  close(sessionId: string, cause: LspSessionCloseCause): Promise<boolean> {
    const retained = this.#closingTrees.get(sessionId);
    if (retained) {
      return retained.closePromise;
    }
    const runtime = this.#bySessionId.get(sessionId);
    if (!runtime) {
      return Promise.resolve(false);
    }
    this.#observer?.closeRequested(sessionId, cause);
    this.#onCloseAcceptedBySessionId.get(sessionId)?.(sessionId);
    this.#removeActiveRouting(runtime);
    const runtimeClose = runtime.close(cause);
    const closePromise = runtimeClose.then(() => true);
    this.#closingTrees.set(sessionId, {
      closePromise,
      notificationSent: false,
      runtime,
      stickyCause: cause,
      workspaceKey: runtime.workspaceKey,
    });
    runtime.terminal.then(
      () => this.#releaseClosingTree(sessionId),
      () => undefined
    );
    return closePromise;
  }

  async closeMany(
    sessionIds: readonly string[],
    cause: LspSessionCloseCause
  ): Promise<void> {
    await Promise.all(
      sessionIds.map((sessionId) => this.close(sessionId, cause))
    );
  }

  async dropAllForWebContents(webContentsId: number): Promise<void> {
    const sessionIds = [...this.#bySessionId.values()]
      .filter((runtime) => runtime.webContentsId === webContentsId)
      .map((runtime) => runtime.sessionId);
    await this.closeMany(sessionIds, "owner-destroyed");
  }

  async dispose(): Promise<void> {
    const active = [...this.#bySessionId.keys()].map((sessionId) =>
      this.close(sessionId, "app-quit")
    );
    const closing = [...this.#closingTrees.values()].map(
      (entry) => entry.closePromise
    );
    await Promise.all([...active, ...closing]);
  }

  async retryTermination(sessionIds: readonly string[]): Promise<void> {
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const retained = this.#closingTrees.get(sessionId);
        if (retained) {
          const previousAttempt = retained.runtime.terminationAttempt;
          const retry = retained.runtime.retryTermination();
          const nextAttempt = retained.runtime.terminationAttempt;
          if (nextAttempt && nextAttempt !== previousAttempt) {
            const closePromise = nextAttempt.then(() => true);
            retained.closePromise = closePromise;
            closePromise.catch(() => undefined);
          }
          await retry;
        }
      })
    );
  }

  getSessionMeta(sessionId: string): {
    clientRole: LspSessionClientRole;
    rootPath: string;
    serverId: string;
    webContentsId: number;
    workspaceKey: string;
  } | null {
    const runtime = this.#bySessionId.get(sessionId);
    if (!runtime) {
      return null;
    }
    return {
      clientRole: runtime.clientRole,
      rootPath: runtime.rootPath,
      serverId: runtime.serverId,
      webContentsId: runtime.webContentsId,
      workspaceKey: runtime.workspaceKey,
    };
  }

  /** Session ids currently bound to a provider (exact serverId match). */
  listSessionIdsForServer(serverId: string): string[] {
    const ids: string[] = [];
    for (const [sessionId, runtime] of this.#bySessionId) {
      if (runtime.serverId === serverId) {
        ids.push(sessionId);
      }
    }
    return ids;
  }

  /** Sessions whose serverId equals id or is prefixed with `${pluginId}:`. */
  listSessionIdsForPlugin(pluginId: string): string[] {
    const prefix = `${pluginId}:`;
    const ids: string[] = [];
    for (const [sessionId, runtime] of this.#bySessionId) {
      if (
        runtime.serverId === pluginId ||
        runtime.serverId.startsWith(prefix)
      ) {
        ids.push(sessionId);
      }
    }
    return ids;
  }

  ensureInitialized(
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const runtime = this.#bySessionId.get(sessionId);
    return runtime
      ? runtime.ensureInitialized(params)
      : Promise.reject(new Error("LSP session not available"));
  }

  ensureLanguageToolsDocumentOpen(
    sessionId: string,
    document: LanguageToolsTextDocument,
    readText: () => Promise<string>
  ): Promise<void> {
    const runtime = this.#bySessionId.get(sessionId);
    return runtime
      ? runtime.ensureLanguageToolsDocumentOpen(document, readText)
      : Promise.reject(new Error("LSP session not available"));
  }

  request(
    sessionId: string,
    method: string,
    params: unknown
  ): Promise<unknown> {
    const runtime = this.#bySessionId.get(sessionId);
    return runtime
      ? runtime.request(method, params)
      : Promise.reject(new Error("LSP session not available"));
  }

  #acceptOutcome(
    runtime: LspSessionRuntime,
    ownerKey: string,
    event: LspSessionClosedEvent,
    onClose:
      | ((event: LspSessionClosedEvent, treeTerminal: Promise<void>) => void)
      | undefined
  ): void {
    this.#removeActiveRouting(runtime, ownerKey);
    let retained = this.#closingTrees.get(runtime.sessionId);
    if (!retained) {
      const closePromise = (
        runtime.terminationAttempt ?? runtime.terminal
      ).then(() => true);
      retained = {
        closePromise,
        notificationSent: false,
        runtime,
        stickyCause: runtime.requestedCloseCause,
        workspaceKey: runtime.workspaceKey,
      };
      this.#closingTrees.set(runtime.sessionId, retained);
      closePromise.catch(() => undefined);
      runtime.terminal.then(
        () => this.#releaseClosingTree(runtime.sessionId),
        () => undefined
      );
    }
    if (!retained.notificationSent) {
      retained.notificationSent = true;
      onClose?.(event, runtime.terminal);
    }
  }

  #removeActiveRouting(
    runtime: LspSessionRuntime,
    knownOwnerKey?: string
  ): void {
    this.#bySessionId.delete(runtime.sessionId);
    this.#onCloseAcceptedBySessionId.delete(runtime.sessionId);
    const ownerKey = knownOwnerKey ?? sessionOwnerKey(runtime);
    if (this.#byOwnerKey.get(ownerKey) === runtime.sessionId) {
      this.#byOwnerKey.delete(ownerKey);
    }
  }

  #releaseClosingTree(sessionId: string): void {
    const retained = this.#closingTrees.get(sessionId);
    if (retained?.runtime.phase === "closed") {
      this.#closingTrees.delete(sessionId);
    }
  }
}
