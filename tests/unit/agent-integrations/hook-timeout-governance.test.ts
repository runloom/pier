/**
 * 各 agent hook timeout 与平台契约对齐检查。
 *
 * 嵌套 hooks.json 工厂默认 5（秒系）/ 平台显式覆盖（毫秒系或 SessionEnd 上限）。
 * Codex SessionEnd 官方上限 3s——写 5 会 clamp 并警告。
 */
import { describe, expect, it } from "vitest";
import { withPierAntigravityHooks } from "../../../src/main/services/agents/integrations/antigravity.ts";
import { withPierAutohandHooks } from "../../../src/main/services/agents/integrations/autohand.ts";
import { withPierClaudeHooks } from "../../../src/main/services/agents/integrations/claude.ts";
import { withPierCodexHooks } from "../../../src/main/services/agents/integrations/codex.ts";
import { withPierCopilotHooks } from "../../../src/main/services/agents/integrations/copilot.ts";
import { withPierCursorHooks } from "../../../src/main/services/agents/integrations/cursor.ts";
import { withPierGeminiHooks } from "../../../src/main/services/agents/integrations/gemini.ts";
import { withPierGooseHooks } from "../../../src/main/services/agents/integrations/goose.ts";
import {
  KIMI_HOOK_TIMEOUT_SECONDS_VALUE,
  withPierKimiHooks,
} from "../../../src/main/services/agents/integrations/kimi.ts";
import { withPierVibeHooks } from "../../../src/main/services/agents/integrations/mistral-vibe.ts";
import {
  DEFAULT_NESTED_HOOK_TIMEOUT,
  resolveNestedHookTimeout,
  withPierNestedHooks,
} from "../../../src/main/services/agents/integrations/shared.ts";

interface NestedHookLeaf {
  timeout?: number;
  type?: string;
}
interface NestedMatcher {
  hooks?: NestedHookLeaf[];
}

function nestedTimeout(
  installed: Record<string, unknown>,
  nativeEvent: string
): number | undefined {
  const hooks = installed.hooks as
    | Record<string, NestedMatcher[] | undefined>
    | undefined;
  return hooks?.[nativeEvent]?.[0]?.hooks?.[0]?.timeout;
}

function flatTimeout(
  installed: Record<string, unknown>,
  nativeEvent: string,
  field: "timeout" | "timeoutSec" = "timeout"
): number | undefined {
  const hooks = installed.hooks as
    | Record<string, Record<string, unknown>[] | undefined>
    | undefined;
  const entry = hooks?.[nativeEvent]?.[0];
  const value = entry?.[field];
  return typeof value === "number" ? value : undefined;
}

describe("resolveNestedHookTimeout", () => {
  it("prefers event timeout over spec default over factory default", () => {
    expect(
      resolveNestedHookTimeout({ nativeEvent: "Stop", pierEvent: "Stop" }, {})
    ).toBe(DEFAULT_NESTED_HOOK_TIMEOUT);
    expect(
      resolveNestedHookTimeout(
        { nativeEvent: "Stop", pierEvent: "Stop" },
        { timeoutSeconds: 10 }
      )
    ).toBe(10);
    expect(
      resolveNestedHookTimeout(
        { nativeEvent: "SessionEnd", pierEvent: "SessionEnd", timeout: 3 },
        { timeoutSeconds: 10 }
      )
    ).toBe(3);
  });
});

describe("nested hooks.json timeout contracts", () => {
  it("Codex SessionEnd is capped at 3s (platform max); other events stay 5s", () => {
    const installed = withPierCodexHooks({});
    expect(nestedTimeout(installed, "SessionEnd")).toBe(3);
    expect(nestedTimeout(installed, "SessionStart")).toBe(5);
    expect(nestedTimeout(installed, "Stop")).toBe(5);
    expect(nestedTimeout(installed, "UserPromptSubmit")).toBe(5);
  });

  it("Claude-family SessionEnd uses default 5s (platform allows up to 60s)", () => {
    const installed = withPierClaudeHooks({});
    expect(nestedTimeout(installed, "SessionEnd")).toBe(5);
    expect(nestedTimeout(installed, "Stop")).toBe(5);
  });

  it("Gemini writes millisecond timeouts (10_000 = 10s)", () => {
    const installed = withPierGeminiHooks({});
    expect(nestedTimeout(installed, "SessionEnd")).toBe(10_000);
    expect(nestedTimeout(installed, "SessionStart")).toBe(10_000);
  });

  it("Goose uses nested factory default 5s for SessionEnd", () => {
    const installed = withPierGooseHooks({});
    expect(nestedTimeout(installed, "SessionEnd")).toBe(5);
  });

  it("event-level timeout override wins for nested installs", () => {
    const installed = withPierNestedHooks(
      {},
      {
        agentId: "codex",
        configPath: () => "/dev/null",
        events: [
          {
            nativeEvent: "SessionEnd",
            pierEvent: "SessionEnd",
            timeout: 3,
          },
          { nativeEvent: "Stop", pierEvent: "Stop" },
        ],
        runtime: { stopAuthority: "advisory" },
        timeoutSeconds: 9,
      }
    );
    expect(nestedTimeout(installed, "SessionEnd")).toBe(3);
    expect(nestedTimeout(installed, "Stop")).toBe(9);
  });
});

describe("non-nested hook timeout contracts", () => {
  it("Cursor sessionEnd uses 10s timeout field", () => {
    const installed = withPierCursorHooks({ version: 1 });
    expect(flatTimeout(installed, "sessionEnd")).toBe(10);
    expect(flatTimeout(installed, "sessionStart")).toBe(10);
  });

  it("Copilot sessionEnd uses timeoutSec=5", () => {
    const installed = withPierCopilotHooks({});
    expect(flatTimeout(installed, "sessionEnd", "timeoutSec")).toBe(5);
    expect(flatTimeout(installed, "sessionStart", "timeoutSec")).toBe(5);
  });

  it("Autohand session-end uses 5000ms", () => {
    const installed = withPierAutohandHooks({});
    const hooks = (
      installed.hooks as {
        hooks?: Array<{ event?: string; timeout?: number }>;
      }
    ).hooks;
    const sessionEnd = hooks?.find((entry) => entry.event === "session-end");
    expect(sessionEnd?.timeout).toBe(5000);
  });

  it("Antigravity named pier-agent-status Stop uses 5s", () => {
    const installed = withPierAntigravityHooks({});
    // Shape: top-level "pier-agent-status".Stop[], not Claude nested hooks.
    const named = installed["pier-agent-status"] as
      | Record<string, Array<{ timeout?: number }> | undefined>
      | undefined;
    expect(named?.Stop?.[0]?.timeout).toBe(5);
    expect(named?.PreInvocation?.[0]?.timeout).toBe(5);
  });

  it("Kimi TOML hooks use 5s", () => {
    const raw = withPierKimiHooks("");
    expect(raw).toContain(`timeout = ${KIMI_HOOK_TIMEOUT_SECONDS_VALUE}`);
    expect(KIMI_HOOK_TIMEOUT_SECONDS_VALUE).toBe(5);
  });

  it("Mistral Vibe TOML hooks use 10s", () => {
    const raw = withPierVibeHooks("");
    expect(raw).toContain("timeout = 10.0");
  });
});
