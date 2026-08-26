/**
 * Canvas Host 只读不变式治理：
 * `pier/host` 白名单内每条命令的授权能力都不得包含任何 `*:write` 能力——
 * 只读纪律门（discipline gate）一旦混入写能力即视为回归。
 */
import { commandMetadataFor } from "@main/app-core/command-metadata.ts";
import { CANVAS_HOST_ALLOWED_COMMANDS } from "@shared/contracts/canvas-host.ts";
import { describe, expect, it } from "vitest";

describe("canvas host 只读白名单", () => {
  it("白名单命令的 capabilities 均不含 :write 结尾的能力", () => {
    expect(CANVAS_HOST_ALLOWED_COMMANDS.length).toBeGreaterThan(0);
    for (const type of CANVAS_HOST_ALLOWED_COMMANDS) {
      const writeCapabilities = commandMetadataFor(type).capabilities.filter(
        (capability) => capability.endsWith(":write")
      );
      expect(writeCapabilities, `${type} 携带写能力`).toEqual([]);
    }
  });

  it("pluginAction.invoke 是唯一使用 plugin:action 的画布命令", () => {
    const actionCommands = CANVAS_HOST_ALLOWED_COMMANDS.filter((type) =>
      commandMetadataFor(type).capabilities.includes("plugin:action")
    );
    expect(actionCommands).toEqual(["pluginAction.invoke"]);
    expect(
      commandMetadataFor("pluginAction.invoke").allowedClientKinds
    ).toEqual(["canvas"]);
  });
});
