import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-04-terminal-file-open-in-pier-gold-standard.md";
const AGENTS = "AGENTS.md";
const CLEAN_ENV = "src/main/services/process-environment/clean-env.ts";
const APPLY_HOST = "src/main/services/process-environment/apply-host-env.ts";
const OPEN_PATH = "src/main/services/files/open-path.ts";
const HANDLER = "src/plugins/builtin/files/renderer/open-url/handler.ts";
const PROTOCOL = "src/main/app-core/pier-file-protocol.ts";
const BUILDER = "electron-builder.yml";
const INDEX = "src/main/index.ts";
const MOUSE_ADDON = "native/src/addon.mm";
const LINK_ACTIONS = "src/renderer/lib/terminal/link-actions.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("terminal file-open-in-pier gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(agents).toContain("### 终端文件链接在 Pier 中打开");
    expect(agents).toContain(
      "tests/unit/main/terminal/file-open/governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("鼠标上报");
    expect(spec).toContain("shouldNeverSystemOpen");
    expect(spec).toContain("pier://file/");
    expect(spec).toContain("不劫持");
    expect(spec).toContain("HostLinkClickTests.swift");
    expect(spec).toContain("TerminalLinkWrapDetectionTests.swift");
    expect(spec).toContain("pier-file-protocol.test.ts");
  });

  it("keeps TERM_PROGRAM stripped and never spoofs vscode", () => {
    const clean = read(CLEAN_ENV);
    const apply = read(APPLY_HOST);
    expect(clean).toContain('"TERM_PROGRAM"');
    expect(apply).toContain('"TERM_PROGRAM"');
    expect(apply).toContain("isForbiddenLaunchWrapEnvKey");
    expect(clean).not.toMatch(/TERM_PROGRAM\s*=\s*["']vscode["']/);
    expect(apply).not.toMatch(/TERM_PROGRAM\s*=\s*["']vscode["']/);
  });

  it("keeps shell.openPath as the OS opener and blocks it for source paths", () => {
    const openPath = read(OPEN_PATH);
    expect(openPath).toContain("shell.openPath");
    const handler = read(HANDLER);
    expect(handler).toContain("shouldNeverSystemOpen");
    expect(handler).toContain("prefer-pier-editor");
  });

  it("registers pier:// as an OS protocol and never shims open", () => {
    const protocol = read(PROTOCOL);
    const builder = read(BUILDER);
    const index = read(INDEX);
    expect(protocol).toContain("setAsDefaultProtocolClient");
    expect(protocol).toContain("open-url");
    expect(protocol).toContain("second-instance");
    expect(builder).toContain("schemes:");
    expect(builder).toMatch(/-\s+pier\b/);
    expect(index).toContain("attachPierFileProtocol");
    expect(index).toContain("markReady");
    expect(protocol).not.toContain("TERM_PROGRAM");
    expect(protocol).not.toContain("executePanelOpenCommand");
    expect(protocol).not.toContain("ensureDirectoryTerminal");
  });

  it("forwards hover linkUrl on right-click and exposes host link actions", () => {
    const addon = read(MOUSE_ADDON);
    const actions = read(LINK_ACTIONS);
    expect(addon).toContain("linkUrl");
    expect(actions).toContain("pier.terminal.openLink");
    expect(actions).toContain("pier.terminal.copyLink");
    expect(actions).toContain("pier.terminal.revealLink");
    expect(actions).toContain("shouldNeverSystemOpen");
    expect(actions).toContain("0_0_link");
  });
});
