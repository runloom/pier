/**
 * Exhaustive install / update / uninstall plan smoke for every catalog agent.
 * Run on host and idle Mac (darwin) so brew/cask plans are exercised.
 */
import { platform } from "node:os";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import {
  buildInstallPlan,
  buildUninstallPlan,
  buildUpdatePlan,
} from "../../../../../src/main/services/agents/lifecycle/plan.ts";
import {
  getAgentLifecycleSpec,
  listAgentLifecycleSpecs,
} from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

const host = platform() === "win32" ? ("win" as const) : ("posix" as const);
const isDarwin = platform() === "darwin";

function listFullSpecs() {
  return listAgentLifecycleSpecs().filter((s) => s.support === "full");
}

describe("lifecycle command matrix (all full agents)", () => {
  it("every AgentKind has a lifecycle spec entry", () => {
    for (const id of agentKindSchema.options) {
      expect(getAgentLifecycleSpec(id as AgentKind).agentId).toBe(id);
    }
  });

  for (const spec of listFullSpecs()) {
    describe(spec.agentId, () => {
      it("install plan is non-null when install channels exist for host", () => {
        const plan = buildInstallPlan(spec, host);
        if (spec.install.length === 0) {
          expect(plan).toBeNull();
          return;
        }
        // At least one channel should map on this host for full agents.
        expect(plan).not.toBeNull();
        expect(plan?.steps.length).toBeGreaterThan(0);
        expect(plan?.preview.trim().length).toBeGreaterThan(0);
      });

      it("update plan is non-null when update channels exist", () => {
        if (spec.update.length === 0) {
          expect(
            buildUpdatePlan(spec, {
              host,
              defaultBinPath: `/tmp/bin/${spec.agentId}`,
            })
          ).toBeNull();
          return;
        }
        const plan = buildUpdatePlan(spec, {
          host,
          defaultBinPath: `/tmp/bin/${spec.agentId}`,
          installSource: "path",
        });
        expect(plan).not.toBeNull();
        expect(plan?.preview.trim().length).toBeGreaterThan(0);
      });

      it("uninstall: managed sources get a plan; path does not", () => {
        const pathPlan = buildUninstallPlan(spec, {
          host,
          installSource: "path",
          defaultBinPath: `/tmp/bin/${spec.agentId}`,
        });
        // Path never maps to managed uninstall unless defaultShellCommands.uninstall
        if (!spec.defaultShellCommands?.uninstall) {
          expect(pathPlan).toBeNull();
        }

        const hasNpm = spec.install.some((c) => c.kind === "npm");
        if (hasNpm) {
          const npmPlan = buildUninstallPlan(spec, {
            host,
            installSource: "npm",
          });
          expect(npmPlan).not.toBeNull();
          expect(npmPlan?.preview).toMatch(/uninstall|remove/i);
        }

        const brew = spec.install.find((c) => c.kind === "brew");
        if (brew?.kind === "brew") {
          const brewPlan = buildUninstallPlan(spec, {
            host,
            installSource: "brew",
            defaultBinPath: isDarwin
              ? `/opt/homebrew/bin/${spec.expectedBins[0] ?? spec.agentId}`
              : `/home/linuxbrew/.linuxbrew/bin/${spec.expectedBins[0] ?? spec.agentId}`,
          });
          if (host === "win") {
            expect(brewPlan).toBeNull();
          } else if (brew.cask === true && !isDarwin) {
            expect(brewPlan).toBeNull();
          } else {
            expect(brewPlan).not.toBeNull();
            expect(brewPlan?.preview).toContain("uninstall");
          }
        }

        const hasUv = spec.install.some((c) => c.kind === "uv");
        if (hasUv) {
          const uvPlan = buildUninstallPlan(spec, {
            host,
            installSource: "uv",
          });
          expect(uvPlan).not.toBeNull();
          expect(uvPlan?.preview).toContain("uninstall");
        }

        const hasPipx = spec.install.some((c) => c.kind === "pipx");
        if (hasPipx) {
          const pipxPlan = buildUninstallPlan(spec, {
            host,
            installSource: "pipx",
          });
          expect(pipxPlan).not.toBeNull();
          expect(pipxPlan?.preview).toContain("uninstall");
        }
      });
    });
  }
});
