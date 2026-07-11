import { MAX_COMPLETED_TRANSITIONS } from "./plugin-lifecycle-types.ts";

export class PluginLifecycleCompletionTracker {
  private readonly outcomes = new Map<string, "abort" | "commit">();

  get(transitionId: string): "abort" | "commit" | undefined {
    return this.outcomes.get(transitionId);
  }

  remember(transitionId: string, outcome: "abort" | "commit"): void {
    this.outcomes.set(transitionId, outcome);
    while (this.outcomes.size > MAX_COMPLETED_TRANSITIONS) {
      const oldest = this.outcomes.keys().next().value;
      if (typeof oldest !== "string") return;
      this.outcomes.delete(oldest);
    }
  }
}
