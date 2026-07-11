import { describe, expect, it } from "vitest";
import { ExternalTransitionGate } from "@/lib/plugins/external-transition-gate.ts";
import { MainDisposalAuthorizationStore } from "@/lib/plugins/runtime-main-disposal-authorizations.ts";

function prepare(
  gate: ExternalTransitionGate,
  generation: number,
  transitionId = `transition-${generation}`
): boolean {
  return gate.prepare({
    generation,
    pluginId: "pier.external",
    reason: "plugin-reload",
    signature: "rev-1",
    transitionId,
  });
}

function finalize(
  gate: ExternalTransitionGate,
  generation: number,
  outcome: "abort" | "commit",
  transitionId = `transition-${generation}`,
  desiredSignature = "rev-2"
): boolean {
  return gate.finalize({
    desiredSignature,
    generation,
    outcome,
    pluginId: "pier.external",
    transitionId,
  });
}

describe("ExternalTransitionGate", () => {
  it("does not let an older abort clear the latest disposal authorization", () => {
    const gate = new ExternalTransitionGate();
    const authorizations = new MainDisposalAuthorizationStore();
    expect(prepare(gate, 1)).toBe(true);
    authorizations.finalize(gate, {
      desiredSignature: "rev-2",
      generation: 1,
      outcome: "commit",
      pluginId: "pier.external",
      transitionId: "transition-1",
    });
    expect(prepare(gate, 2)).toBe(true);
    authorizations.finalize(gate, {
      desiredSignature: "rev-2",
      generation: 2,
      outcome: "commit",
      pluginId: "pier.external",
      transitionId: "transition-2",
    });

    authorizations.finalize(gate, {
      desiredSignature: "rev-2",
      generation: 1,
      outcome: "abort",
      pluginId: "pier.external",
      transitionId: "transition-1",
    });

    expect(authorizations.get("pier.external")?.transitionId).toBe(
      "transition-2"
    );
  });

  it("rejects an older prepare after a newer generation completed", () => {
    const gate = new ExternalTransitionGate();
    expect(prepare(gate, 2)).toBe(true);
    expect(finalize(gate, 2, "commit")).toBe(true);
    expect(gate.has("pier.external")).toBe(false);

    expect(prepare(gate, 1)).toBe(false);
    expect(gate.has("pier.external")).toBe(false);
  });

  it("remembers an early finalizer so its later prepare is ignored", () => {
    const gate = new ExternalTransitionGate();
    expect(finalize(gate, 1, "commit")).toBe(true);
    expect(prepare(gate, 1)).toBe(false);
    expect(gate.has("pier.external")).toBe(false);
  });

  it("does not let an older finalizer change the current gate", () => {
    const gate = new ExternalTransitionGate();
    expect(prepare(gate, 2)).toBe(true);

    expect(finalize(gate, 1, "abort")).toBe(false);
    expect(gate.has("pier.external")).toBe(true);
  });

  it.each([
    ["finalize-before-registry", true],
    ["registry-before-finalize", false],
  ] as const)("releases commit with %s ordering", (_name, finalizeFirst) => {
    const gate = new ExternalTransitionGate();
    expect(prepare(gate, 1)).toBe(true);
    if (finalizeFirst) {
      expect(finalize(gate, 1, "commit", "transition-1", "rev-1")).toBe(false);
      gate.releaseConfirmed(() => "rev-2");
    } else {
      gate.releaseConfirmed(() => "rev-2");
      expect(gate.has("pier.external")).toBe(true);
      expect(finalize(gate, 1, "commit")).toBe(true);
    }
    expect(gate.has("pier.external")).toBe(false);
  });
});
