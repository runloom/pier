import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AIDER_BLOCK_MARKERS,
  installAiderHooks,
} from "@main/services/agents/integrations/aider.ts";
import { withPierClaudeHooks } from "@main/services/agents/integrations/claude.ts";
import { installCrushHooks } from "@main/services/agents/integrations/crush.ts";
import type { InactiveAgentStatusTraceFixture } from "./status-trace-types.ts";

const HISTORICAL_PIER_COMMAND = `[ -x "\${PIER_AGENT_HOOKS_DIR}/emit" ] && "\${PIER_AGENT_HOOKS_DIR}/emit" "agentEventV2" "kiro" "Stop" "stop" || true`;

function assertArtifactHasNoPierProducer(
  agentId: InactiveAgentStatusTraceFixture["agentId"],
  artifact: string
): void {
  if (
    artifact.includes("PIER_AGENT_HOOKS_DIR") ||
    artifact.includes("agentEventV2") ||
    artifact.includes("agentEventV3")
  ) {
    throw new Error(`${agentId} 安装产物仍含 Pier 状态 producer`);
  }
}

function assertNegativeDetectorHasActiveControl(): void {
  const activeArtifact = JSON.stringify(withPierClaudeHooks({}));
  let rejected = false;
  try {
    assertArtifactHasNoPierProducer("aider", activeArtifact);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error("非主动 producer 负断言无法识别真实 active 安装产物");
  }
}

async function assertAiderCleanupOnly(): Promise<void> {
  assertNegativeDetectorHasActiveControl();
  const root = await mkdtemp(join(tmpdir(), "pier-aider-inactive-trace-"));
  const path = join(root, ".aider.conf.yml");
  const userContent =
    'model: gpt-4\nnotifications-command: "say user-finished"\n';
  const historical = `${userContent}${AIDER_BLOCK_MARKERS.begin}\nnotifications: true\nnotifications-command: '\${PIER_AGENT_HOOKS_DIR}/emit agentEventV2 aider Stop stop'\n${AIDER_BLOCK_MARKERS.end}\n`;
  try {
    await writeFile(path, historical, "utf8");
    await installAiderHooks(path);
    const artifact = await readFile(path, "utf8");
    if (artifact !== userContent) {
      throw new Error("aider 清理历史 producer 时改写了用户配置");
    }
    assertArtifactHasNoPierProducer("aider", artifact);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function assertCrushCleanupOnly(): Promise<void> {
  assertNegativeDetectorHasActiveControl();
  const root = await mkdtemp(join(tmpdir(), "pier-crush-inactive-trace-"));
  const path = join(root, "crush.json");
  const userHook = { command: "echo user-defined", name: "user-hook" };
  try {
    await writeFile(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              command: `pier-hook-gen=1; "\${PIER_AGENT_HOOKS_DIR}/emit" agentEventV2 crush ToolStart tool_call_before`,
            },
            userHook,
          ],
        },
        model: "crush-1",
      }),
      "utf8"
    );
    await installCrushHooks(path);
    const artifact = await readFile(path, "utf8");
    const parsed = JSON.parse(artifact) as {
      hooks?: { PreToolUse?: unknown[] };
      model?: string;
    };
    if (
      parsed.model !== "crush-1" ||
      JSON.stringify(parsed.hooks?.PreToolUse) !== JSON.stringify([userHook])
    ) {
      throw new Error("crush 清理历史 producer 时改写了用户配置");
    }
    assertArtifactHasNoPierProducer("crush", artifact);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function assertKiroCleanupOnly(): Promise<void> {
  assertNegativeDetectorHasActiveControl();
  const root = await mkdtemp(join(tmpdir(), "pier-kiro-inactive-trace-"));
  const agentsDir = join(root, ".kiro", "agents");
  const path = join(agentsDir, "user-agent.json");
  const previousHome = process.env.HOME;
  const userHook = { command: "say user-done" };
  try {
    process.env.HOME = root;
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        hooks: {
          agentSpawn: [{ command: HISTORICAL_PIER_COMMAND }],
          stop: [userHook, { command: HISTORICAL_PIER_COMMAND }],
        },
        name: "user-agent",
      }),
      "utf8"
    );
    const { installKiroHooks } = await import(
      "@main/services/agents/integrations/kiro.ts"
    );
    await installKiroHooks();
    const artifact = await readFile(path, "utf8");
    const parsed = JSON.parse(artifact) as {
      hooks?: { agentSpawn?: unknown[]; stop?: unknown[] };
      name?: string;
    };
    if (
      parsed.name !== "user-agent" ||
      parsed.hooks?.agentSpawn !== undefined ||
      JSON.stringify(parsed.hooks?.stop) !== JSON.stringify([userHook])
    ) {
      throw new Error("kiro 清理历史 producer 时改写了用户配置");
    }
    assertArtifactHasNoPierProducer("kiro", artifact);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(root, { force: true, recursive: true });
  }
}

export const INACTIVE_AGENT_STATUS_TRACES = [
  {
    agentId: "aider",
    assertNoStatusOutput: assertAiderCleanupOnly,
  },
  {
    agentId: "crush",
    assertNoStatusOutput: assertCrushCleanupOnly,
  },
  {
    agentId: "kiro",
    assertNoStatusOutput: assertKiroCleanupOnly,
  },
] as const satisfies readonly InactiveAgentStatusTraceFixture[];
