import type {
  ExternalTransitionAuthorization,
  ExternalTransitionGate,
} from "./external-transition-gate.ts";

export class MainDisposalAuthorizationStore {
  private readonly authorizations = new Map<
    string,
    ExternalTransitionAuthorization
  >();

  clear(): void {
    this.authorizations.clear();
  }

  finalize(
    gate: ExternalTransitionGate,
    input: {
      desiredSignature: string | null;
      generation: number;
      outcome: "abort" | "commit";
      pluginId: string;
      transitionId: string;
    }
  ): void {
    const authorization = gate.authorization(
      input.pluginId,
      input.transitionId,
      input.generation
    );
    const accepted = gate.finalize(input);
    if (accepted && authorization && input.outcome === "commit") {
      this.authorizations.set(input.pluginId, authorization);
    } else if (
      input.outcome === "abort" &&
      this.get(input.pluginId)?.transitionId === input.transitionId
    ) {
      this.remove(input.pluginId);
    }
  }

  get(pluginId: string): ExternalTransitionAuthorization | undefined {
    return this.authorizations.get(pluginId);
  }

  remove(pluginId: string): void {
    this.authorizations.delete(pluginId);
  }
}
