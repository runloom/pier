import { afterEach, describe, expect, it } from "vitest";
import { parsePierCliArgs } from "../../../bin/pier-cli-parser.js";

const ENV_KEYS = [
  "PIER_AGENT_PANELS_DISABLED",
  "PIER_PANEL_ID",
  "PIER_WINDOW_ID",
] as const;

function withEnv(
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => void
): void {
  const saved = new Map(
    ENV_KEYS.map((key) => [key, process.env[key]] as const)
  );
  try {
    for (const key of ENV_KEYS) {
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    }
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

afterEach(() => {
  delete process.env.PIER_AGENT_PANELS_DISABLED;
});

describe("pier agents start CLI parsing", () => {
  it("rejects spawning when PIER_AGENT_PANELS_DISABLED is set", () => {
    withEnv(
      {
        PIER_AGENT_PANELS_DISABLED: "1",
        PIER_PANEL_ID: "p1",
        PIER_WINDOW_ID: "w1",
      },
      () => {
        expect(() => parsePierCliArgs(["agents", "start", "omp"])).toThrow(
          /PIER_AGENT_PANELS_DISABLED/
        );
      }
    );
  });

  it("requires PIER_PANEL_ID and PIER_WINDOW_ID origin env", () => {
    withEnv({}, () => {
      expect(() => parsePierCliArgs(["agents", "start", "omp"])).toThrow(
        /PIER_PANEL_ID and PIER_WINDOW_ID/
      );
    });
    withEnv({ PIER_PANEL_ID: "p1" }, () => {
      expect(() => parsePierCliArgs(["agents", "start", "omp"])).toThrow(
        /PIER_PANEL_ID and PIER_WINDOW_ID/
      );
    });
  });

  it("injects origin from env and accepts --stdin textSource", () => {
    withEnv({ PIER_PANEL_ID: "panel_a", PIER_WINDOW_ID: "win_a" }, () => {
      const r = parsePierCliArgs(["agents", "start", "omp", "--stdin"]);
      expect(r.protocol).toBe("v2");
      if (r.protocol !== "v2") {
        return;
      }
      expect(r.op).toBe("agents.start");
      expect(r.params).toMatchObject({
        agentId: "omp",
        origin: { panelId: "panel_a", windowId: "win_a" },
      });
      expect(r.textSource).toEqual({ kind: "stdin" });
    });
  });

  it("accepts --placement tab|right|below and rejects others", () => {
    withEnv({ PIER_PANEL_ID: "p", PIER_WINDOW_ID: "w" }, () => {
      for (const placement of ["tab", "right", "below"] as const) {
        const r = parsePierCliArgs([
          "agents",
          "start",
          "omp",
          "--placement",
          placement,
        ]);
        if (r.protocol !== "v2") {
          throw new Error("expected v2");
        }
        expect(r.params).toMatchObject({ placement });
      }
      expect(() =>
        parsePierCliArgs(["agents", "start", "omp", "--placement", "floating"])
      ).toThrow(/--placement/);
    });
  });

  it("threads --operation-id and --expected-boot into the request", () => {
    withEnv({ PIER_PANEL_ID: "p", PIER_WINDOW_ID: "w" }, () => {
      const r = parsePierCliArgs([
        "agents",
        "start",
        "omp",
        "--operation-id",
        "op_1234567890abcdef1234567890abcdef",
        "--expected-boot",
        "boot_x",
      ]);
      if (r.protocol !== "v2") {
        throw new Error("expected v2");
      }
      expect(r.effectKey).toBe("op_1234567890abcdef1234567890abcdef");
      expect(r.expectedBootId).toBe("boot_x");
    });
  });

  it("keeps --text/--text-file/--stdin mutually exclusive", () => {
    withEnv({ PIER_PANEL_ID: "p", PIER_WINDOW_ID: "w" }, () => {
      expect(() =>
        parsePierCliArgs(["agents", "start", "omp", "--text", "hi", "--stdin"])
      ).toThrow(/only one of/);
    });
  });
});
