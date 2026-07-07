import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";

/**
 * Codex accounts dashboard widget (plan Task 10). Consumes plugin RPC only —
 * no host `context.accounts` facade. Subscribes to `accounts.changed` BEFORE
 * requesting the initial snapshot, and applies only snapshots whose
 * `revision` exceeds the current one (revision-based stale rejection).
 */

export interface AccountsWidgetProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({ context }: AccountsWidgetProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<CodexAccountsSnapshot | null>(null);

  useEffect(() => {
    let currentRevision = 0;
    const unsubscribe = context.rpc.on<CodexAccountsSnapshot>(
      "accounts.changed",
      (event) => {
        if (event.revision > currentRevision) {
          currentRevision = event.revision;
          setSnapshot(event);
        }
      }
    );
    context.rpc
      .invoke<CodexAccountsSnapshot>("accounts.snapshot", null)
      .then((initial) => {
        if (initial.revision > currentRevision) {
          currentRevision = initial.revision;
          setSnapshot(initial);
        }
      })
      .catch(() => {
        /* keep null; error UI handled elsewhere */
      });
    return unsubscribe;
  }, [context]);

  if (!snapshot) {
    return <div>Codex accounts loading</div>;
  }
  return (
    <div>
      <h4>Codex Accounts</h4>
      {snapshot.accounts.length === 0 ? (
        <p>No accounts yet.</p>
      ) : (
        <ul>
          {snapshot.accounts.map((account) => (
            <li key={account.id}>
              {account.label} ({account.status})
              {account.id === snapshot.activeAccountId && " · active"}
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => {
          context.rpc.invoke("accounts.refreshUsage", null).catch(() => {
            /* no-op */
          });
        }}
        type="button"
      >
        Refresh usage
      </button>
    </div>
  );
}
