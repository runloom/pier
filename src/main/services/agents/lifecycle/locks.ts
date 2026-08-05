import type { AgentKind } from "@shared/contracts/agent.ts";

/**
 * Reject-on-busy per agent (no concurrent queue for the same agent).
 * Different agents may run in parallel — package managers own their own locks.
 */
export class LifecycleLocks {
  readonly #agentReserved = new Set<AgentKind>();

  isAgentBusy(agentId: AgentKind): boolean {
    return this.#agentReserved.has(agentId);
  }

  /**
   * Synchronously reserve the agent (or throw BusyError), then run `fn`.
   * `onReserved` runs immediately after claim so cancel(agentId) works mid-run.
   */
  async withAgentLock<T>(
    agentId: AgentKind,
    fn: () => Promise<T>,
    onReserved?: () => void
  ): Promise<T> {
    if (this.#agentReserved.has(agentId)) {
      throw new BusyError(agentId);
    }
    this.#agentReserved.add(agentId);
    try {
      onReserved?.();
      return await fn();
    } finally {
      this.#agentReserved.delete(agentId);
    }
  }
}

export class BusyError extends Error {
  readonly agentId: AgentKind;
  constructor(agentId: AgentKind) {
    super(`Agent lifecycle busy: ${agentId}`);
    this.name = "BusyError";
    this.agentId = agentId;
  }
}
