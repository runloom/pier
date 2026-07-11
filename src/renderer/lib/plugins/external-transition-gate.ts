interface ExternalTransition {
  committed: boolean;
  generation: number;
  reason: "plugin-disable" | "plugin-reload";
  signature: string | null;
  transitionId: string;
}

export type ExternalTransitionAuthorization = Pick<
  ExternalTransition,
  "reason" | "transitionId"
>;

/** 在 main 的 prepare/finalize 与 registry 广播之间封住外部激活竞态。 */
export class ExternalTransitionGate {
  private readonly highestGeneration = new Map<string, number>();
  private readonly transitions = new Map<string, ExternalTransition>();

  clear(): void {
    this.highestGeneration.clear();
    this.transitions.clear();
  }

  has(pluginId: string): boolean {
    return this.transitions.has(pluginId);
  }

  authorization(
    pluginId: string,
    transitionId: string,
    generation: number
  ): ExternalTransitionAuthorization | undefined {
    const transition = this.transitions.get(pluginId);
    if (
      transition?.transitionId !== transitionId ||
      transition.generation !== generation
    ) {
      return;
    }
    return {
      reason: transition.reason,
      transitionId: transition.transitionId,
    };
  }

  prepare(input: {
    generation: number;
    pluginId: string;
    reason: "plugin-disable" | "plugin-reload";
    signature: string | null;
    transitionId: string;
  }): boolean {
    const existing = this.transitions.get(input.pluginId);
    const highest = this.highestGeneration.get(input.pluginId);
    if (highest !== undefined && input.generation < highest) {
      return false;
    }
    if (highest === input.generation && !existing) {
      return false;
    }
    if (existing) {
      if (
        existing.transitionId === input.transitionId &&
        existing.generation === input.generation
      ) {
        return true;
      }
      if (existing.generation >= input.generation) {
        return false;
      }
    }
    this.highestGeneration.set(input.pluginId, input.generation);
    this.transitions.set(input.pluginId, {
      committed: false,
      generation: input.generation,
      reason: input.reason,
      signature: input.signature,
      transitionId: input.transitionId,
    });
    return true;
  }

  finalize(input: {
    desiredSignature: string | null;
    generation: number;
    outcome: "abort" | "commit";
    pluginId: string;
    transitionId: string;
  }): boolean {
    const highest = this.highestGeneration.get(input.pluginId);
    if (highest !== undefined && input.generation < highest) {
      return false;
    }
    if (highest === undefined || input.generation > highest) {
      this.highestGeneration.set(input.pluginId, input.generation);
      this.transitions.delete(input.pluginId);
      return true;
    }
    const transition = this.transitions.get(input.pluginId);
    if (
      !transition ||
      transition.transitionId !== input.transitionId ||
      transition.generation !== input.generation
    ) {
      return false;
    }
    if (input.outcome === "abort") {
      this.transitions.delete(input.pluginId);
      return true;
    }
    transition.committed = true;
    return this.releaseIfConfirmed(input.pluginId, input.desiredSignature);
  }

  releaseConfirmed(
    desiredSignature: (pluginId: string) => string | null
  ): void {
    for (const pluginId of this.transitions.keys()) {
      this.releaseIfConfirmed(pluginId, desiredSignature(pluginId));
    }
  }

  private releaseIfConfirmed(
    pluginId: string,
    desiredSignature: string | null
  ): boolean {
    const transition = this.transitions.get(pluginId);
    if (!transition?.committed) {
      return false;
    }
    const confirmed =
      transition.reason === "plugin-disable"
        ? desiredSignature === null
        : desiredSignature !== transition.signature;
    if (confirmed) {
      this.transitions.delete(pluginId);
    }
    return confirmed;
  }
}
