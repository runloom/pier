import {
  AGENTS_SCREEN_DEFAULT_MAX_BYTES,
  AGENTS_SCREEN_DEFAULT_MAX_LINES,
  agentsScreenParamsSchema,
  agentsScreenPayloadSchema,
  agentsScreenResultSchema,
  agentsStartParamsSchema,
  agentsStartResultSchema,
  agentsTurnParamsSchema,
  agentsTurnResultSchema,
  agentsWaitParamsSchema,
} from "@shared/contracts/local-control/agents-runtime.ts";
import { LOCAL_CONTROL_ERROR_CODES } from "@shared/contracts/local-control/errors.ts";
import {
  matchRuntimeRef,
  runtimeRefSchema,
  runtimeRefsEqual,
} from "@shared/contracts/local-control/runtime-ref.ts";
import { describe, expect, it } from "vitest";

describe("RuntimeRef", () => {
  it("round-trips strict schema", () => {
    const ref = { bootId: "boot_1", runtimeId: "rt_1", generation: 2 };
    expect(runtimeRefSchema.parse(ref)).toEqual(ref);
  });

  it("rejects extra fields", () => {
    expect(() =>
      runtimeRefSchema.parse({
        bootId: "b",
        runtimeId: "r",
        generation: 0,
        panelId: "p",
      })
    ).toThrow();
  });

  it("compares all three fields", () => {
    const a = { bootId: "b", runtimeId: "r", generation: 1 };
    expect(runtimeRefsEqual(a, { ...a })).toBe(true);
    expect(runtimeRefsEqual(a, { ...a, generation: 2 })).toBe(false);
    expect(runtimeRefsEqual(a, { ...a, bootId: "x" })).toBe(false);
  });

  it("matchRuntimeRef returns stable codes", () => {
    const expected = { bootId: "b", runtimeId: "r", generation: 1 };
    expect(matchRuntimeRef({ expected, actual: null }).ok).toBe(false);
    expect(matchRuntimeRef({ expected, actual: null })).toMatchObject({
      code: "runtime_gone",
    });
    expect(
      matchRuntimeRef({
        expected,
        actual: { ...expected, bootId: "other" },
      })
    ).toMatchObject({ code: "boot_changed" });
    expect(
      matchRuntimeRef({
        expected,
        actual: { ...expected, generation: 9 },
      })
    ).toMatchObject({ code: "stale_generation" });
    expect(matchRuntimeRef({ expected, actual: expected })).toEqual({
      ok: true,
    });
  });
});

describe("agents runtime contracts", () => {
  it("start params require agentId", () => {
    expect(agentsStartParamsSchema.parse({ agentId: "codex" })).toEqual({
      agentId: "codex",
    });
    expect(() => agentsStartParamsSchema.parse({})).toThrow();
  });

  it("start result embeds RuntimeRef", () => {
    const result = {
      runtime: { bootId: "b", runtimeId: "rt", generation: 1 },
      agentId: "codex",
      panelId: "panel_1",
      windowId: "win_1",
    };
    expect(agentsStartResultSchema.parse(result)).toEqual(result);
  });

  it("turn only accepts accepted:true result", () => {
    const params = {
      bootId: "b",
      runtimeId: "rt",
      generation: 1,
      text: "hello",
    };
    expect(agentsTurnParamsSchema.parse(params)).toEqual(params);
    expect(
      agentsTurnResultSchema.parse({
        accepted: true,
        runtime: { bootId: "b", runtimeId: "rt", generation: 1 },
      })
    ).toMatchObject({ accepted: true });
    expect(() =>
      agentsTurnResultSchema.parse({
        accepted: false,
        runtime: { bootId: "b", runtimeId: "rt", generation: 1 },
      })
    ).toThrow();
  });

  it("screen params default maxLines/maxBytes; payload has no history fields", () => {
    const params = agentsScreenParamsSchema.parse({
      bootId: "b",
      runtimeId: "rt",
      generation: 0,
    });
    expect(params.maxLines).toBe(AGENTS_SCREEN_DEFAULT_MAX_LINES);
    expect(params.maxBytes).toBe(AGENTS_SCREEN_DEFAULT_MAX_BYTES);

    const screen = {
      text: "line",
      capturedAt: 1,
      rows: 24,
      cols: 80,
      truncated: false,
      maxLines: 200,
      maxBytes: 65_536,
    };
    expect(agentsScreenPayloadSchema.parse(screen)).toEqual(screen);
    expect(
      agentsScreenResultSchema.parse({
        screen,
        runtime: { bootId: "b", runtimeId: "rt", generation: 0 },
      })
    ).toMatchObject({ screen: { text: "line" } });
  });

  it("wait until enum is closed", () => {
    expect(
      agentsWaitParamsSchema.parse({
        bootId: "b",
        runtimeId: "rt",
        generation: 1,
        until: "ready",
      }).until
    ).toBe("ready");
    expect(() =>
      agentsWaitParamsSchema.parse({
        bootId: "b",
        runtimeId: "rt",
        generation: 1,
        until: "success",
      })
    ).toThrow();
  });

  it("v2 error codes include runtime lifecycle codes", () => {
    for (const code of [
      "runtime_gone",
      "panel_gone",
      "window_gone",
      "stale_generation",
      "timeout",
    ] as const) {
      expect(LOCAL_CONTROL_ERROR_CODES).toContain(code);
    }
  });
});
