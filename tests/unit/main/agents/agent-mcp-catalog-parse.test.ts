import {
  parseClaudeUserJsonMcpServerNames,
  parseCodexTomlMcpServerNames,
  parseJsonMcpServerNames,
  parseMcpServerNames,
  parseOpencodeJsonMcpServerNames,
} from "@main/services/agent-mcp-catalog/parse-server-names.ts";
import { describe, expect, it } from "vitest";

describe("parseMcpServerNames", () => {
  it("reads mcpServers keys from JSON and ignores payloads", () => {
    const names = parseJsonMcpServerNames(
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "secret"],
            env: { TOKEN: "x" },
          },
          docs: { url: "https://example.invalid" },
        },
      })
    );
    expect(names).toEqual(["docs", "github"]);
  });

  it("returns empty on invalid JSON or missing mcpServers", () => {
    expect(parseJsonMcpServerNames("{")).toEqual([]);
    expect(parseJsonMcpServerNames("{}")).toEqual([]);
    expect(parseJsonMcpServerNames(JSON.stringify({ foo: 1 }))).toEqual([]);
  });

  it("merges Claude user top-level and matching project keys", () => {
    const root = "/Users/me/proj";
    const names = parseClaudeUserJsonMcpServerNames(
      JSON.stringify({
        mcpServers: { globalOne: {} },
        projects: {
          [root]: { mcpServers: { projectOne: {} } },
          "/other": { mcpServers: { ignored: {} } },
        },
      }),
      root
    );
    expect(names).toEqual(["globalOne", "projectOne"]);
  });

  it("extracts Codex TOML mcp_servers section names only", () => {
    const names = parseCodexTomlMcpServerNames(`
[mcp_servers.github]
command = "gh"

[mcp_servers."my server"]
command = "echo"

[other.section]
x = 1
`);
    expect(names).toEqual(["github", "my server"]);
  });

  it("routes by format", () => {
    expect(
      parseMcpServerNames(
        '[mcp_servers.a]\ncommand = "x"\n',
        "codex-toml",
        null
      )
    ).toEqual(["a"]);
  });

  it("reads OpenCode mcp map and optional mcpServers", () => {
    expect(
      parseOpencodeJsonMcpServerNames(
        JSON.stringify({
          mcp: { native: { type: "local", command: ["npx"] } },
          mcpServers: { compat: { command: "npx" } },
        })
      )
    ).toEqual(["compat", "native"]);
  });
});
