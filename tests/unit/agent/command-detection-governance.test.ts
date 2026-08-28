import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import {
  AGENT_OSC_BIN_DENYLIST,
  catalogCommandIdentityBins,
  matchAgentCommand,
} from "@shared/agent-command-detection.ts";
import { describe, expect, it } from "vitest";

describe("OSC 命令身份治理", () => {
  it("catalog 词元不含 denylist（agent / acli）", () => {
    for (const entry of AGENT_CATALOG) {
      for (const bin of catalogCommandIdentityBins(entry)) {
        expect(AGENT_OSC_BIN_DENYLIST.has(bin), `${entry.id} 含 ${bin}`).toBe(
          false
        );
      }
    }
  });

  it("每个 catalog 命令身份词元都能被 OSC 认到", () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.launchCommandPrefix) {
        expect(matchAgentCommand(entry.launchCommandPrefix.join(" "))).toBe(
          entry.id
        );
        continue;
      }
      for (const bin of catalogCommandIdentityBins(entry)) {
        expect(matchAgentCommand(bin), `${entry.id} ${bin}`).toBe(entry.id);
      }
    }
  });

  it("denylist 光杆命令不点亮", () => {
    for (const bin of AGENT_OSC_BIN_DENYLIST) {
      expect(matchAgentCommand(bin), bin).toBeNull();
    }
  });

  it("产品 id 不得单独进身份词元（必须同时是 CLI 名）", () => {
    for (const entry of AGENT_CATALOG) {
      const commandNames = new Set([
        entry.detectCmd,
        entry.expectedProcess,
        ...(entry.detectCmdAliases ?? []),
        entry.launchCmd.split(" ")[0],
      ]);
      if (commandNames.has(entry.id)) {
        continue;
      }
      expect(
        catalogCommandIdentityBins(entry).includes(entry.id),
        entry.id
      ).toBe(false);
    }
  });

  it("documents OSC 命令身份规则 in AGENTS.md", () => {
    const agents = readFileSync(join(process.cwd(), "AGENTS.md"), "utf8");
    expect(agents).toContain("matchAgentCommand");
    expect(agents).toContain("AGENT_OSC_BIN_DENYLIST");
    expect(agents).toContain("command-detection-governance.test.ts");
  });
});
