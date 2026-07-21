import type { AgentKind } from "@shared/contracts/agent.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import {
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiService } from "../../../src/main/services/ai/ai-service.ts";
import type { ManagedAgentLaunchGate } from "../../../src/main/services/project-skills/launch-gate.ts";

beforeEach(() => {
  setDefaultLogSink(() => undefined);
});

afterEach(() => {
  resetDefaultLogSinkForTests();
});

describe("ai.generateText project-skills gate", () => {
  it("does not spawn one-shot when launch gate blocks", async () => {
    const runOneShot = vi.fn(async () => "should-not-run");
    const launchGate: ManagedAgentLaunchGate = {
      ensureReady: vi.fn(async () => ({
        status: "blocked" as const,
        launchAttemptId: "a1",
        issueSummary: ["unmanaged-conflict skill=review-guide"],
        degradePolicySummary: "denied" as const,
        expiresAt: Date.now() + 60_000,
      })),
      continueLaunch: vi.fn(),
      authorizeSpawn: vi.fn(async () => ({
        ok: false as const,
        reason: "unknown-attempt" as const,
        message: "n/a",
      })),
      recordSpawnResult: vi.fn(async () => undefined),
    };

    const service = createAiService({
      detectAgents: async () => ["claude"] as AgentKind[],
      launchGate,
      readPreferences: async () => projectPreferencesSchema.parse({}),
      runOneShot,
    });

    const result = await service.generateText({
      prompt: "hello",
      projectRootPath: process.cwd(),
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable")
      throw new Error("expected unavailable");
    expect(result.message).toContain("project skills not ready");
    expect(runOneShot).not.toHaveBeenCalled();
    expect(launchGate.ensureReady).toHaveBeenCalled();
  });

  it("spawns after launch gate ready", async () => {
    const runOneShot = vi.fn(async () => "ok-text");
    const launchGate: ManagedAgentLaunchGate = {
      ensureReady: vi.fn(async () => ({
        status: "ready" as const,
        launchAttemptId: "a2",
      })),
      continueLaunch: vi.fn(),
      authorizeSpawn: vi.fn(async () => ({
        ok: false as const,
        reason: "unknown-attempt" as const,
        message: "n/a",
      })),
      recordSpawnResult: vi.fn(async () => undefined),
    };

    const service = createAiService({
      detectAgents: async () => ["claude"] as AgentKind[],
      launchGate,
      readPreferences: async () => projectPreferencesSchema.parse({}),
      runOneShot,
    });

    const result = await service.generateText({
      prompt: "hello",
      projectRootPath: process.cwd(),
    });

    expect(result).toEqual({ status: "ok", text: "ok-text" });
    expect(runOneShot).toHaveBeenCalledOnce();
  });

  it("skips gate when no projectRootPath", async () => {
    const runOneShot = vi.fn(async () => "plain");
    const launchGate: ManagedAgentLaunchGate = {
      ensureReady: vi.fn(async () => ({
        status: "blocked" as const,
        launchAttemptId: "a3",
        issueSummary: ["should-not-matter"],
        degradePolicySummary: "denied" as const,
        expiresAt: Date.now() + 60_000,
      })),
      continueLaunch: vi.fn(),
      authorizeSpawn: vi.fn(async () => ({
        ok: false as const,
        reason: "unknown-attempt" as const,
        message: "n/a",
      })),
      recordSpawnResult: vi.fn(async () => undefined),
    };

    const service = createAiService({
      detectAgents: async () => ["claude"] as AgentKind[],
      launchGate,
      readPreferences: async () => projectPreferencesSchema.parse({}),
      runOneShot,
    });

    const result = await service.generateText({ prompt: "hello" });
    expect(result).toEqual({ status: "ok", text: "plain" });
    expect(launchGate.ensureReady).not.toHaveBeenCalled();
  });
});
