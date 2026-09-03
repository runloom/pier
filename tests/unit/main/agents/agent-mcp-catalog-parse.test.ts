import {
  parseCodexTomlMcpServerDecls,
  parseGooseYamlMcpServerDecls,
  parseJsonMcpServerDecls,
  parseOpencodeJsonMcpServerDecls,
} from "@main/services/agent-mcp-catalog/parse-server-decls.ts";
import {
  parseAmpSettingsMcpServerNames,
  parseClaudeUserJsonMcpServerNames,
  parseCodexTomlMcpServerNames,
  parseGooseYamlMcpServerNames,
  parseJsonMcpServerNames,
  parseMcpServerNames,
  parseOpencodeJsonMcpServerNames,
  parseVibeTomlMcpServerNames,
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

  it("reads Amp amp.mcpServers, Goose extensions, and Vibe array tables", () => {
    expect(
      parseAmpSettingsMcpServerNames(
        JSON.stringify({
          "amp.mcpServers": { playwright: { command: "npx" } },
        })
      )
    ).toEqual(["playwright"]);
    expect(
      parseGooseYamlMcpServerNames(
        "extensions:\n  filesystem:\n    type: stdio\n"
      )
    ).toEqual(["filesystem"]);
    expect(
      parseVibeTomlMcpServerNames(
        '[[mcp_servers]]\nname = "alpha"\ncommand = "x"\n'
      )
    ).toEqual(["alpha"]);
    expect(
      parseMcpServerNames(
        "mcp_servers:\n  github:\n    command: npx\n",
        "hermes-yaml",
        null
      )
    ).toEqual(["github"]);
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

describe("parseMcpServerDecls", () => {
  it("infers stdio vs http and strips payloads", () => {
    const decls = parseJsonMcpServerDecls(
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "secret"],
            env: { TOKEN: "x" },
          },
          docs: { url: "https://example.invalid/secret" },
          off: { command: "npx", disabled: true },
        },
      })
    );
    expect(decls).toEqual([
      { enabled: true, name: "docs", transport: "http" },
      { enabled: true, name: "github", transport: "stdio" },
      { enabled: false, name: "off", transport: "stdio" },
    ]);
    expect(JSON.stringify(decls)).not.toContain("secret");
    expect(JSON.stringify(decls)).not.toContain("TOKEN");
  });

  it("reads Codex TOML command/url/enabled without payloads", () => {
    const decls = parseCodexTomlMcpServerDecls(`
[mcp_servers.github]
command = "gh"
args = ["--token", "sekrit"]

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
enabled = false
`);
    expect(decls).toEqual([
      { enabled: true, name: "github", transport: "stdio" },
      { enabled: false, name: "linear", transport: "http" },
    ]);
    expect(JSON.stringify(decls)).not.toContain("sekrit");
    expect(JSON.stringify(decls)).not.toContain("mcp.linear.app");
  });

  it("reads OpenCode remote type as http", () => {
    expect(
      parseOpencodeJsonMcpServerDecls(
        JSON.stringify({
          mcp: { linear: { type: "remote", url: "https://hidden" } },
        })
      )
    ).toEqual([{ enabled: true, name: "linear", transport: "http" }]);
  });

  it("reads Goose sse type as http", () => {
    expect(
      parseGooseYamlMcpServerDecls(
        "extensions:\n  cloud:\n    type: sse\n    cmd: ignored\n"
      )
    ).toEqual([{ enabled: true, name: "cloud", transport: "http" }]);
  });

  it("skips Goose builtin/platform and reads streamable_http uri", () => {
    const decls = parseGooseYamlMcpServerDecls(`
extensions:
  developer:
    type: builtin
  memory:
    type: platform
  filesystem:
    type: stdio
    cmd: npx
  remote-tools:
    type: streamable_http
    uri: https://hidden.example/mcp
`);
    expect(decls).toEqual([
      { enabled: true, name: "filesystem", transport: "stdio" },
      { enabled: true, name: "remote-tools", transport: "http" },
    ]);
    expect(JSON.stringify(decls)).not.toContain("hidden.example");
  });
});
