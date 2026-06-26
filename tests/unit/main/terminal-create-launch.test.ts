import { nativeLaunchOptions } from "@main/ipc/terminal-create-launch.ts";
import { describe, expect, it } from "vitest";

describe("terminal create launch options", () => {
  it("does not pass profileId through to native when it has no native effect", () => {
    expect(
      nativeLaunchOptions(
        {
          command: "pnpm test",
          cwd: "/tmp/stale",
          env: { PIER_MODE: "dev" },
          profileId: "codex",
        },
        "/tmp/pier"
      )
    ).toEqual({
      command: "pnpm test",
      cwd: "/tmp/pier",
      env: { PIER_MODE: "dev" },
    });
  });
});
