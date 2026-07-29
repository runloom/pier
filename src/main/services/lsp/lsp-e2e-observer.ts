import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LspSessionCloseCause } from "@shared/contracts/lsp.ts";
import type { ProcessTreeHandle } from "./lsp-process-termination.ts";
import type {
  LspSessionHostObserver,
  LspSessionStartedEvent,
} from "./lsp-session-host.ts";
import type { LspSessionClientRole } from "./lsp-session-runtime.ts";

export type LspE2eCloseCause = "idle-release" | "workspace-evicted";

export interface LspE2eSessionSnapshot {
  readonly alive: boolean;
  readonly clientRole: LspSessionClientRole;
  readonly closeCause: LspSessionCloseCause | null;
  readonly pid: number | null;
  readonly rootPath: string;
  readonly serverId: string;
  readonly sessionId: string;
  readonly startedAt: number;
  readonly treeTerminal: boolean;
  readonly workspaceKey: string;
}

export interface LspE2eFinalReport {
  readonly liveProcessTrees: readonly LspE2eSessionSnapshot[];
  readonly sessions: readonly LspE2eSessionSnapshot[];
  readonly shutdownCompleted: true;
}

export interface LspE2eObserverApi {
  close(sessionId: string, cause: LspE2eCloseCause): Promise<boolean>;
  snapshot(): Promise<readonly LspE2eSessionSnapshot[]>;
  terminate(sessionId: string): Promise<boolean>;
}

interface MutableObservedSession {
  clientRole: LspSessionClientRole;
  closeCause: LspSessionCloseCause | null;
  pid: number | null;
  processTree: ProcessTreeHandle;
  rootPath: string;
  serverId: string;
  sessionId: string;
  startedAt: number;
  treeTerminal: boolean;
  workspaceKey: string;
}

interface LspE2eObserverOptions {
  closeSession: (
    sessionId: string,
    cause: LspE2eCloseCause
  ) => Promise<boolean>;
  now?: () => number;
  reportPath?: string;
}

interface LspE2eObserverEnvironmentOptions {
  closeSession: (
    sessionId: string,
    cause: LspE2eCloseCause
  ) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export class LspE2eObserver
  implements LspE2eObserverApi, LspSessionHostObserver
{
  readonly #closeSession: LspE2eObserverOptions["closeSession"];
  readonly #now: () => number;
  readonly #reportPath: string | undefined;
  readonly #sessions = new Map<string, MutableObservedSession>();

  constructor(options: LspE2eObserverOptions) {
    this.#closeSession = options.closeSession;
    this.#now = options.now ?? Date.now;
    this.#reportPath = options.reportPath;
  }

  started(event: LspSessionStartedEvent): void {
    if (this.#sessions.has(event.sessionId)) {
      return;
    }
    this.#sessions.set(event.sessionId, {
      clientRole: event.clientRole,
      closeCause: null,
      pid: event.pid,
      processTree: event.processTree,
      rootPath: event.rootPath,
      serverId: event.serverId,
      sessionId: event.sessionId,
      startedAt: this.#now(),
      treeTerminal: false,
      workspaceKey: event.workspaceKey,
    });
  }

  closeRequested(sessionId: string, cause: LspSessionCloseCause): void {
    const session = this.#sessions.get(sessionId);
    if (session?.closeCause === null) {
      session.closeCause = cause;
    }
  }

  treeTerminal(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (session) {
      session.treeTerminal = true;
    }
  }

  async snapshot(): Promise<readonly LspE2eSessionSnapshot[]> {
    const sessions = await Promise.all(
      [...this.#sessions.values()].map(async (session) =>
        Object.freeze({
          alive: await session.processTree.isAlive(),
          clientRole: session.clientRole,
          closeCause: session.closeCause,
          pid: session.pid,
          rootPath: session.rootPath,
          serverId: session.serverId,
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          treeTerminal: session.treeTerminal,
          workspaceKey: session.workspaceKey,
        })
      )
    );
    return Object.freeze(sessions);
  }

  async terminate(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (!(session && (await session.processTree.isAlive()))) {
      return false;
    }
    await session.processTree.forceTerminate();
    await session.processTree.terminal;
    return true;
  }

  async close(sessionId: string, cause: LspE2eCloseCause): Promise<boolean> {
    if (cause !== "idle-release" && cause !== "workspace-evicted") {
      throw new Error(`Unsupported E2E close cause: ${String(cause)}`);
    }
    return this.#closeSession(sessionId, cause);
  }

  async writeFinalReport(): Promise<void> {
    if (!this.#reportPath) {
      return;
    }
    const sessions = await this.snapshot();
    const report: LspE2eFinalReport = Object.freeze({
      liveProcessTrees: Object.freeze(
        sessions.filter((session) => session.alive || !session.treeTerminal)
      ),
      sessions,
      shutdownCompleted: true,
    });
    const temporaryPath = `${this.#reportPath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.#reportPath), { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(report)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.#reportPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export function createLspE2eObserverFromEnvironment(
  options: LspE2eObserverEnvironmentOptions
): LspE2eObserver | null {
  const env = options.env ?? process.env;
  if (env.PIER_LSP_E2E_OBSERVER !== "1") {
    return null;
  }
  return new LspE2eObserver({
    closeSession: options.closeSession,
    ...(options.now ? { now: options.now } : {}),
    ...(env.PIER_LSP_E2E_REPORT_PATH
      ? { reportPath: env.PIER_LSP_E2E_REPORT_PATH }
      : {}),
  });
}

export function installLspE2eObserverGlobal(
  observer: LspE2eObserver,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.PIER_LSP_E2E_OBSERVER !== "1") {
    return false;
  }
  globalThis.__PIER_LSP_E2E_OBSERVER__ = observer;
  return true;
}

export function removeLspE2eObserverGlobal(
  observer: LspE2eObserverApi | null
): void {
  if (observer && globalThis.__PIER_LSP_E2E_OBSERVER__ === observer) {
    globalThis.__PIER_LSP_E2E_OBSERVER__ = undefined;
  }
}

declare global {
  var __PIER_LSP_E2E_OBSERVER__: LspE2eObserverApi | undefined;
}
