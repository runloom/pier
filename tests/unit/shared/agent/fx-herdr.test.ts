import {
  FX_HERDR_AGENT,
  FX_HERDR_SOURCE,
  fxHerdrEventFields,
  fxHerdrPanelId,
  fxHerdrReportToPierEvent,
  fxHerdrToAgentEvent,
  parseFxHerdrFrame,
} from "@shared/contracts/agent/fx-herdr.ts";
import { describe, expect, it } from "vitest";

function frame(params: Record<string, unknown>): string {
  return JSON.stringify({
    id: "7",
    method: "pane.report_agent",
    params: { agent: "fx", source: "custom:fx", ...params },
  });
}

describe("fx Herdr 上报协议", () => {
  it("解析上游单行帧（working/idle/blocked+reason）", () => {
    expect(
      parseFxHerdrFrame(frame({ pane_id: "terminal-1", state: "working" }))
    ).toEqual({ paneId: "terminal-1", state: "working" });
    expect(
      parseFxHerdrFrame(frame({ pane_id: "terminal-1", state: "idle" }))
    ).toEqual({ paneId: "terminal-1", state: "idle" });
    expect(
      parseFxHerdrFrame(
        frame({
          agent_session_id: "session-42",
          custom_status: "permission",
          pane_id: "terminal-1",
          state: "blocked",
        })
      )
    ).toEqual({
      customStatus: "permission",
      paneId: "terminal-1",
      sessionId: "session-42",
      state: "blocked",
    });
  });

  it("精确匹配上游 wire 样本（含 custom_status 省略形态）", () => {
    // src/builtins/hooks/herdr.zig: report_agent serializes a single
    // newline-delimited json line.
    expect(
      parseFxHerdrFrame(
        '{"id":"7","method":"pane.report_agent","params":{"pane_id":"w1:p1","source":"custom:fx","agent":"fx","state":"working","custom_status":"editing"}}\n'
      )
    ).toEqual({ paneId: "w1:p1", state: "working" });
    expect(
      parseFxHerdrFrame(
        '{"id":"1","method":"pane.report_agent","params":{"pane_id":"w1:p1","source":"custom:fx","agent":"fx","state":"idle"}}'
      )
    ).toEqual({ paneId: "w1:p1", state: "idle" });
  });

  it("拒绝非 report_agent 方法、异源帧与非法 pane/state", () => {
    expect(parseFxHerdrFrame("not json")).toBeNull();
    expect(
      parseFxHerdrFrame(
        JSON.stringify({ id: "1", method: "pane.rename", params: {} })
      )
    ).toBeNull();
    // pane.report_agent_session 是会话身份帧，不进状态机。
    expect(
      parseFxHerdrFrame(
        JSON.stringify({
          id: "3",
          method: "pane.report_agent_session",
          params: {
            agent: "fx",
            agent_session_id: "session-42",
            pane_id: "terminal-1",
            source: "custom:fx",
          },
        })
      )
    ).toBeNull();
    expect(
      parseFxHerdrFrame(
        frame({ agent: "other", pane_id: "terminal-1", state: "working" })
      )
    ).toBeNull();
    expect(
      parseFxHerdrFrame(
        frame({ pane_id: "terminal-1", source: "other", state: "working" })
      )
    ).toBeNull();
    expect(
      parseFxHerdrFrame(frame({ pane_id: "../escape", state: "working" }))
    ).toBeNull();
    expect(
      parseFxHerdrFrame(frame({ pane_id: "terminal-1", state: "flying" }))
    ).toBeNull();
  });

  it("映射纪律：working→processing，idle→ActivityIdle", () => {
    expect(
      fxHerdrReportToPierEvent({ paneId: "terminal-1", state: "working" })
    ).toEqual({ event: "processing" });
    expect(
      fxHerdrReportToPierEvent({ paneId: "terminal-1", state: "idle" })
    ).toEqual({ event: "ActivityIdle" });
  });

  it("映射纪律：blocked 全种保持 processing（无配对解除，不进 waiting）", () => {
    // 上游只有请求帧、无配对解除帧；按等待治理（请求+解除成对）不得进
    // waiting。原因保留在 nativeEvent（herdr.blocked.permission 等）。
    for (const customStatus of [
      "permission",
      "question",
      "recovery",
    ] as const) {
      expect(
        fxHerdrReportToPierEvent({
          customStatus,
          paneId: "terminal-1",
          state: "blocked",
        })
      ).toEqual({ event: "processing" });
    }
    expect(
      fxHerdrReportToPierEvent({ paneId: "terminal-1", state: "blocked" })
    ).toEqual({ event: "processing" });
  });

  it("nativeEvent 命名与 panel 路由", () => {
    expect(
      fxHerdrEventFields({ paneId: "terminal-1", state: "working" }).nativeEvent
    ).toBe("herdr.working");
    expect(
      fxHerdrEventFields({ paneId: "terminal-1", state: "idle" }).nativeEvent
    ).toBe("herdr.idle");
    expect(
      fxHerdrEventFields({
        customStatus: "permission",
        paneId: "terminal-1",
        state: "blocked",
      }).nativeEvent
    ).toBe("herdr.blocked.permission");
    expect(fxHerdrPanelId("terminal-abc")).toBe("terminal-abc");
    expect(fxHerdrPanelId("w1:p1")).toBeNull();
    expect(FX_HERDR_SOURCE).toBe("custom:fx");
    expect(FX_HERDR_AGENT).toBe("fx");
  });

  it("组装严格 v3 agentEvent（turnId 恒为空，走文件水位纪律）", () => {
    const event = fxHerdrToAgentEvent(
      { paneId: "terminal-1", state: "working" },
      { panelId: "terminal-1", windowId: "7" }
    );
    expect(event).toMatchObject({
      agent: "fx",
      event: "processing",
      kind: "agentEvent",
      nativeEvent: "herdr.working",
      panelId: "terminal-1",
      v: 3,
      windowId: "7",
    });
    expect("turnId" in event).toBe(false);
  });
});
