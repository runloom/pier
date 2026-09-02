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

interface ActivityFixture {
  panelId: string;
  status: ActivityStatus;
  windowId: string;
}

function services(opts: {
  registry?: PendingInteractionRegistry;
  status?: ActivityStatus;
  /** 覆盖默认单活动快照（面板寻址歧义用例）。 */
  activities?: ActivityFixture[];
}): PierCoreServices {
  const activities =
    opts.activities ??
    (opts.status
      ? [{ panelId: PANEL_ID, status: opts.status, windowId: WINDOW_ID }]
      : null);
  return {
    ...(opts.registry ? { pendingInteractions: opts.registry } : {}),
    ...(activities
      ? {
          foregroundActivity: {
            snapshot: () => ({
              activities: activities.map((activity) => ({
                agentId: "claude",
                kind: "agent",
                panelId: activity.panelId,
                source: "hook",
                status: activity.status,
                subagentCount: 0,
                windowId: activity.windowId,
              })),
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

describe("agent.attention.respond 面板寻址（移动端：裸 panelId）", () => {
  beforeEach(() => {
    sendText.mockClear();
    sendText.mockReturnValue(true);
  });

  it("裸 panelId → FA 快照解析当前窗口 → success", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "p1",
      { ...cmd("enter"), agentRef: PANEL_ID },
      services({ registry: registryWith(), status: "waiting" })
    );
    expect(result).toEqual({
      data: { accepted: true },
      ok: true,
      requestId: "p1",
    });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("裸 panelId + windowId 消歧两窗同 id → 写到指定窗", async () => {
    const w2Ref = makeAgentRef("w2", PANEL_ID);
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(
      { ...requested(INTERACTION_ID), windowId: "w2" },
      w2Ref
    );
    const result = await executeAgentAttentionRespondCommand(
      "p2b",
      { ...cmd("enter"), agentRef: PANEL_ID, windowId: "w2" },
      services({
        activities: [
          { panelId: PANEL_ID, status: "waiting", windowId: WINDOW_ID },
          { panelId: PANEL_ID, status: "waiting", windowId: "w2" },
        ],
        registry,
      })
    );
    expect(result).toEqual({
      data: { accepted: true },
      ok: true,
      requestId: "p2b",
    });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("裸 panelId 跨窗歧义（两窗同面板 id）→ interaction_stale，不写终端", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "p2",
      { ...cmd(), agentRef: PANEL_ID },
      services({
        activities: [
          { panelId: PANEL_ID, status: "waiting", windowId: WINDOW_ID },
          { panelId: PANEL_ID, status: "waiting", windowId: "w2" },
        ],
        registry: registryWith(),
      })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("裸 panelId 无 FA 快照 → interaction_stale（fail closed）", async () => {
    const result = await executeAgentAttentionRespondCommand(
      "p3",
      { ...cmd(), agentRef: PANEL_ID },
      services({ registry: registryWith() })
    );
    expect(result).toMatchObject({
      error: { code: "interaction_stale" },
      ok: false,
    });
    expect(sendText).not.toHaveBeenCalled();
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
