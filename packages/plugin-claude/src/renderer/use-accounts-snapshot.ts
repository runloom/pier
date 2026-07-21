import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useSyncExternalStore } from "react";
import type { ClaudeAccountsSnapshot } from "../shared/accounts.ts";

interface AccountsSnapshotState {
  error: string | null;
  snapshot: ClaudeAccountsSnapshot | null;
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
    for (const listener of listeners) {
      listener();
    }
  };

  // revision monotonic increase: drop out-of-order snapshots for eventual
  // consistency (mirrors Codex/Grok).
  const acceptSnapshot = (snapshot: ClaudeAccountsSnapshot): void => {
    if (snapshot.revision <= currentRevision) {
      return;
    }
    currentRevision = snapshot.revision;
    publish({ error: null, snapshot });
  };

  const connect = (): void => {
    if (unsubscribeRpc) {
      return;
    }
    const generation = ++connectionGeneration;
    unsubscribeRpc = context.rpc.on<ClaudeAccountsSnapshot>(
      "accounts.changed",
      acceptSnapshot
    );
    context.rpc
      .invoke<ClaudeAccountsSnapshot>("accounts.snapshot", null)
      .then((initial) => {
        if (generation === connectionGeneration) {
          acceptSnapshot(initial);
        }
      })
      .catch((error: unknown) => {
        if (generation !== connectionGeneration) {
          return;
        }
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
      if (listeners.size === 1) {
        connect();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          disconnect();
        }
      };
    },
  };
}

function getAccountsSnapshotStore(
  context: ExternalRendererPluginContext
): AccountsSnapshotStore {
  const existing = stores.get(context);
  if (existing) {
    return existing;
  }
  const created = createAccountsSnapshotStore(context);
  stores.set(context, created);
  return created;
}

/** Multiple settings pages / widgets share one RPC subscription + snapshot. */
export function useClaudeAccountsSnapshot(
  context: ExternalRendererPluginContext
): AccountsSnapshotState {
  const store = getAccountsSnapshotStore(context);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}
