import {
  getRetainedWindowsProcessTree,
  type LspChildProcess,
  type ProcessTreeHandle,
} from "./process-termination.ts";

/**
 * Gateway 终态的会话身份：一个 (workspaceKey, serverId, rootPath) 只允许
 * 一棵真实进程树。窗口（webContents）与消费角色（editor / language-tools）
 * 不再进入身份——它们是 session-broker 上的虚拟消费者，消息路由与
 * didOpen/didClose 引用计数由 broker 统一承担。
 */
export function sessionOwnerKey(input: {
  rootPath: string;
  serverId: string;
  workspaceKey: string;
}): string {
  return `${input.workspaceKey}::${input.serverId}::${input.rootPath}`;
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
