import { sessionIdentityForLiveLifecycle } from "../../state/terminal-session-identity.ts";

/**
 * Lease-time rule: a live surface must agree with the session record. Restored
 * exited-agent cards have no native process, so nothing can contradict their
 * session; a present process does have authority — an empty live identity then
 * means the lifecycle entry is missing, not that the panel is static. Shells
 * normalize `shell:<n>` to "", so stale task metadata on a shell still vetoes.
 */
export function assertLeaseSessionIdentity(input: {
  hasLiveSurface: boolean;
  lifecycleId: string;
  sessionIdentity: string | undefined;
}): void {
  const expected = sessionIdentityForLiveLifecycle(input.lifecycleId);
  if (
    input.hasLiveSurface &&
    input.sessionIdentity &&
    input.sessionIdentity !== expected
  ) {
    throw new Error(
      `session lifecycle mismatch: expected ${input.lifecycleId}, got ${input.sessionIdentity}`
    );
  }
}
