import {
  getRetainedWindowsProcessTree,
  type LspChildProcess,
  type ProcessTreeHandle,
} from "./process-termination.ts";
import type { LspSessionClientRole } from "./session-runtime.ts";

/**
 * Session identity includes clientRole on purpose: editor sessions are long-lived
 * with streaming JSON-RPC to the renderer (`onMessage`), while language-tools is
 * main-side request/response. Sharing one child would require rebinding message
 * and close handlers on reuse. Cost is one process tree per role per root/window;
 * language-tools holds agentBusy during requests to avoid idle reaping mid-call.
 */
export function sessionOwnerKey(input: {
  clientRole: LspSessionClientRole;
  rootPath: string;
  serverId: string;
  webContentsId: number;
  workspaceKey: string;
}): string {
  return `${input.webContentsId}::${input.workspaceKey}::${input.serverId}::${input.rootPath}::${input.clientRole}`;
}

/** Process tree for a child that spawned without a usable pid. */
export function createFailedLaunchProcessTreeHandle(
  child: LspChildProcess
): ProcessTreeHandle {
  const terminal = Promise.withResolvers<void>();
  let terminalSettled = false;
  const settleTerminal = () => {
    if (terminalSettled) {
      return;
    }
    terminalSettled = true;
    terminal.resolve();
  };
  child.once("error", settleTerminal);
  child.once("exit", settleTerminal);
  child.once("close", settleTerminal);
  return {
    terminal: terminal.promise,
    async close() {
      await terminal.promise;
    },
    async forceTerminate() {},
    async gracefulTerminate() {},
    async isAlive() {
      return false;
    },
  };
}

export function deferredProcessTree(
  treePromise: Promise<ProcessTreeHandle>,
  setupTerminal: Promise<void>
): ProcessTreeHandle {
  const setupFailureTree: ProcessTreeHandle = {
    terminal: setupTerminal,
    async close() {
      await setupTerminal;
    },
    async forceTerminate() {
      await setupTerminal;
    },
    async gracefulTerminate() {
      await setupTerminal;
    },
    async isAlive() {
      await setupTerminal;
      return false;
    },
  };
  const resolvedTree = treePromise.catch(
    (error: unknown) => getRetainedWindowsProcessTree(error) ?? setupFailureTree
  );
  return {
    terminal: resolvedTree.then((tree) => tree.terminal),
    async close() {
      await (await resolvedTree).close();
    },
    async forceTerminate() {
      await (await resolvedTree).forceTerminate();
    },
    async gracefulTerminate() {
      await (await resolvedTree).gracefulTerminate();
    },
    async isAlive() {
      return (await resolvedTree).isAlive();
    },
  };
}
