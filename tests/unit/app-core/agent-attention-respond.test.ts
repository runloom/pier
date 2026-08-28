/**
 * agent.attention.respond（M1 审批回写）：
 * 双重门（未决交互注册表 assertCurrent + FA status===waiting）、
 * 13 种键字节映射、失败码 interaction_stale。
 */
import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeAgentAttentionRespondCommand } from "@main/app-core/commands/agent-attention-respond.ts";
import {
  createPendingInteractionRegistry,
  type PendingInteractionRegistry,
} from "@main/services/agent-attention/pending-interactions.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendText = vi.hoisted(() => vi.fn((_key: string, _text: string) => true));

vi.mock("@main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => ({ sendText }),
}));

vi.mock("@main/windows/identity.ts", () => ({
  findAppWindowForActivityWindowId: () => ({
    id: 7,
    isDestroyed: () => false,
  }),
}));

const WINDOW_ID = "w1";
const PANEL_ID = "p1";
const AGENT_REF = makeAgentRef(WINDOW_ID, PANEL_ID);
const INTERACTION_ID = "ix-1";

type RespondCommand = Extract<PierCommand, { type: "agent.attention.respond" }>;
type RespondKey = RespondCommand["key"];

function requested(interactionId?: string): AgentHookEventPayloadV3 {
  return {
    agent: "claude",
    event: "InteractionRequested",
    interactionKind: "permission",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: PANEL_ID,
    v: 3,
    windowId: WINDOW_ID,
    ...(interactionId ? { interactionId } : {}),
  };
}

function registryWith(id: string | undefined = INTERACTION_ID) {
  const registry = createPendingInteractionRegistry();
  registry.onHookEvent(requested(id), AGENT_REF);
  return registry;
}

function services(opts: {
  registry?: PendingInteractionRegistry;
  status?: ActivityStatus;
}): PierCoreServices {
  return {
    ...(opts.registry ? { pendingInteractions: opts.registry } : {}),
    ...(opts.status
      ? {
          foregroundActivity: {
            snapshot: () => ({
              activities: [
                {
                  agentId: "claude",
                  kind: "agent",
                  panelId: PANEL_ID,
                  source: "hook",
                  status: opts.status,
                  subagentCount: 0,
                  windowId: WINDOW_ID,
                },
              ],
              ts: 1,
            }),
          },
        }
      : {}),
  } as never;
}

function cmd(key: RespondKey = "enter"): RespondCommand {
  return {
    agentRef: AGENT_REF,
    interactionId: INTERACTION_ID,
    key,
    type: "agent.attention.respond",
  };
}

describe("agent.attention.respond 双重门", () => {
  beforeEach(() => {
    sendText.mockClear();
    sendText.mockReturnValue(true);
  });

  it("非本命令类型 → null（交回 executor 链）", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r0",
      { type: "notifications.list" },
      services({})
    );
    expect(result).toBeNull();
  });

  it("无登记记录 → interaction_stale，不写终端", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r1",
      cmd(),
      services({
        registry: createPendingInteractionRegistry(),
        status: "waiting",
      })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("interactionId 不匹配 → interaction_stale", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r2",
      { ...cmd(), interactionId: "ix-other" },
      services({ registry: registryWith(), status: "waiting" })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("注册表未注入 → interaction_stale", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r3",
      cmd(),
      services({ status: "waiting" })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("status 非 waiting → interaction_stale", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r4",
      cmd(),
      services({ registry: registryWith(), status: "processing" })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("FA 快照缺席 → interaction_stale", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r5",
      cmd(),
      services({ registry: registryWith() })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("双重门通过 → sendText 且 success { accepted: true }", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "r6",
      cmd("enter"),
      services({ registry: registryWith(), status: "waiting" })
    );
    expect(result).toEqual({
      data: { accepted: true },
      ok: true,
      requestId: "r6",
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[1]).toBe("\r");
  });

  it("sendText 拒绝 → platform_unavailable", async () => {
    sendText.mockReturnValue(false);
    const result = await executeAgentAttentionRespondCommand(
      "r7",
      cmd(),
      services({ registry: registryWith(), status: "waiting" })
    );
    expect(result).toMatchObject({
      error: { code: "platform_unavailable" },
      ok: false,
    });
  });
});

describe("agent.attention.respond 键字节映射", () => {
  const KEY_BYTES: ReadonlyArray<readonly [RespondKey, string]> = [
    ["enter", "\r"],
    ["escape", "\u001b"],
    ["y", "y"],
    ["n", "n"],
    ["1", "1"],
    ["2", "2"],
    ["3", "3"],
    ["4", "4"],
    ["5", "5"],
    ["6", "6"],
    ["7", "7"],
    ["8", "8"],
    ["9", "9"],
  ];

  beforeEach(() => {
    sendText.mockClear();
    sendText.mockReturnValue(true);
  });

  it.each(KEY_BYTES)("key %s → 字节 %j", async (key, bytes) => {
    const result = await executeAgentAttentionRespondCommand(
      `k-${key}`,
      cmd(key),
      services({ registry: registryWith(), status: "waiting" })
    );
    expect(result).toMatchObject({ ok: true });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[1]).toBe(bytes);
  });
});
