import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useSyncExternalStore } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";

interface AccountsSnapshotState {
  error: string | null;
  snapshot: CodexAccountsSnapshot | null;
}

interface AccountsSnapshotStore {
  getSnapshot: () => AccountsSnapshotState;
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

  const acceptSnapshot = (snapshot: CodexAccountsSnapshot): void => {
    if (snapshot.revision <= currentRevision) return;
    currentRevision = snapshot.revision;
    publish({ error: null, snapshot });
  };

  const connect = (): void => {
    if (unsubscribeRpc) return;
    const generation = ++connectionGeneration;
    unsubscribeRpc = context.rpc.on<CodexAccountsSnapshot>(
      "accounts.changed",
      acceptSnapshot
    );
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

  const disconnect = (): void => {
    connectionGeneration += 1;
    unsubscribeRpc?.();
    unsubscribeRpc = null;
  };

  return {
    getSnapshot: () => state,
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
): AccountsSnapshotState {
  const store = getAccountsSnapshotStore(context);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}
