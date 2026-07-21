import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function readSrc(rel: string): Promise<string> {
  return readFile(join(root, rel), "utf8");
}

describe("project-skills launch architecture", () => {
  it("wires ManagedAgentLaunchGate through terminal create and AI one-shot", async () => {
    const [
      launchGate,
      terminalHandler,
      terminalIpc,
      index,
      aiService,
      appCore,
      commands,
    ] = await Promise.all([
      readSrc("src/main/services/project-skills/launch-gate.ts"),
      readSrc("src/main/ipc/terminal-create-handler.ts"),
      readSrc("src/main/ipc/terminal.ts"),
      readSrc("src/main/index.ts"),
      readSrc("src/main/services/ai/ai-service.ts"),
      // Gate wiring split from app-core.ts (file-size cap); app-core delegates.
      readSrc("src/main/app-core/project-skills-wiring.ts"),
      readSrc("src/main/app-core/project-skills-commands.ts"),
    ]);

    expect(launchGate).toContain(
      "export function createManagedAgentLaunchGate"
    );
    expect(launchGate).toContain("SPAWN_INTENT");
    expect(launchGate).toContain("continueLaunch");

    // Terminal path: gate before native createTerminal
    expect(terminalHandler).toContain("launchGate");
    expect(terminalHandler).toContain("ensureReady");
    const gateIdx = terminalHandler.indexOf("launchGate.ensureReady");
    const createIdx = terminalHandler.indexOf("addon.createTerminal");
    expect(gateIdx).toBeGreaterThan(0);
    expect(createIdx).toBeGreaterThan(gateIdx);

    expect(terminalIpc).toContain("launchGate");
    expect(index).toContain("launchGate: appCore.services.agentLaunchGate");

    // AI one-shot path
    expect(aiService).toContain("launchGate");
    expect(aiService).toContain("ensureReady");
    const aiGateIdx = aiService.indexOf("launchGate.ensureReady");
    const runIdx = aiService.indexOf("runOneShot(invocation.binary");
    expect(aiGateIdx).toBeGreaterThan(0);
    expect(runIdx).toBeGreaterThan(aiGateIdx);

    // app-core constructs shared gate
    expect(appCore).toContain("createManagedAgentLaunchGate");
    expect(appCore).toContain("agentLaunchGate");

    // continue command
    expect(commands).toContain("agent.launch.continue");
    expect(commands).toContain("continueLaunch");
  });

  it("does not trust renderer context alone in terminal gate comments/code path", async () => {
    const terminalHandler = await readSrc(
      "src/main/ipc/terminal-create-handler.ts"
    );
    expect(terminalHandler).toContain(
      "never treat renderer createArgs.context"
    );
    // Prefer native launch cwd / main-resolved fields
    expect(terminalHandler).toContain("launch.nativeLaunch?.cwd");
  });

  it("production wiring provides every runtime seam (no test-only injection gaps)", async () => {
    // Regression guard: services expose optional seams that tests inject;
    // production assembly MUST provide all of them. A missing seam surfaced
    // as "showOpenDialog is required for prepareLocalImport (inject in
    // tests)" in the running app.
    const wiring = await readSrc("src/main/app-core/project-skills-wiring.ts");
    expect(wiring).toContain("wireProjectSkills");
    // Folder import picker (design v8 §7.5).
    expect(wiring).toContain("showOpenDialog");
    expect(wiring).toContain("dialog.showOpenDialog");
    // Git five-state for deletion confirmations (design v8 §3.6 / §7.11).
    expect(wiring).toContain("inspectGitState");
    expect(wiring).toContain("check-ignore");
    // Shared project index + installed agents + system skills channel.
    expect(wiring).toContain("listKnownProjectRoots");
    expect(wiring).toContain("listInstalledAgents");
    expect(wiring).toContain("createSystemSkillsChannel");
  });
});
