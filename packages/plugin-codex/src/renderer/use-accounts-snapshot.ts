import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useCallback, useSyncExternalStore } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";

interface AccountsSnapshotState {
  error: string | null;
  snapshot: CodexAccountsSnapshot | null;
}

interface AccountsSnapshotStore {
  getSnapshot: () => AccountsSnapshotState;
  reload: () => void;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_STATE: AccountsSnapshotState = { error: null, snapshot: null };
const stores = new WeakMap<
  ExternalRendererPluginContext,
  AccountsSnapshotStore
>();

function createAccountsSnapshotStore(
  context: ExternalRendererPluginContext
): AccountsSnapshotStore {
  let state = EMPTY_STATE;
  let currentRevision = 0;
  let connectionGeneration = 0;
  let unsubscribeRpc: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: AccountsSnapshotState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  // revision 单调递增：丢弃乱序到达的旧快照，保证最终一致性。
  const acceptSnapshot = (snapshot: CodexAccountsSnapshot): void => {
    if (snapshot.revision <= currentRevision) return;
    currentRevision = snapshot.revision;
    publish({ error: null, snapshot });
  };

  const fetchSnapshot = (generation: number): void => {
    context.rpc
      .invoke<CodexAccountsSnapshot>("accounts.snapshot", null)
      .then((initial) => {
        if (generation === connectionGeneration) acceptSnapshot(initial);
      })
      .catch((error: unknown) => {
        if (generation !== connectionGeneration) return;
        publish({
          error: error instanceof Error ? error.message : String(error),
          snapshot: state.snapshot,
        });
      });
  };

  const connect = (): void => {
    if (unsubscribeRpc) return;
    const generation = ++connectionGeneration;
    unsubscribeRpc = context.rpc.on<CodexAccountsSnapshot>(
      "accounts.changed",
      acceptSnapshot
    );
    fetchSnapshot(generation);
  };

  const disconnect = (): void => {
    connectionGeneration += 1;
    unsubscribeRpc?.();
    unsubscribeRpc = null;
  };

  const reload = (): void => {
    if (!unsubscribeRpc) {
      connect();
      return;
    }
    const generation = ++connectionGeneration;
    publish({ error: null, snapshot: state.snapshot });
    fetchSnapshot(generation);
  };

  return {
    getSnapshot: () => state,
    reload,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) disconnect();
      };
    },
  };
}

function getAccountsSnapshotStore(
  context: ExternalRendererPluginContext
): AccountsSnapshotStore {
  const existing = stores.get(context);
  if (existing) return existing;
  const created = createAccountsSnapshotStore(context);
  stores.set(context, created);
  return created;
}

/** 多个设置页／物料共享一个 RPC 订阅与首次快照请求。 */
export function useCodexAccountsSnapshot(
  context: ExternalRendererPluginContext
): AccountsSnapshotState & { reload: () => void } {
  const store = getAccountsSnapshotStore(context);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const reload = useCallback(() => {
    store.reload();
  }, [store]);
  return { ...state, reload };
}
