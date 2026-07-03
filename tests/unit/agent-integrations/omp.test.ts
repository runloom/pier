import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOmpExtensionSource,
  installOmpExtension,
  OMP_EVENT_MAP,
  OMP_MARKER,
  ompDetect,
  ompExtensionPath,
  ompHome,
  uninstallOmpExtension,
} from "../../../src/main/services/agents/integrations/omp.ts";

const NATIVE_EVENTS = [
  "session_start",
  "turn_start",
  "tool_call",
  "tool_result",
  "turn_end",
  "session_shutdown",
];

describe("buildOmpExtensionSource", () => {
  it("含 marker、三个 PIER_ 环境变量守卫、无顶层 import 声明", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain(OMP_MARKER);
    // JSONL 通路的三个环境变量（HTTP 时代 PORT/TOKEN 已删）
    expect(src).toContain("PIER_AGENT_EVENT_LOG");
    expect(src).toContain("PIER_PANEL_ID");
    expect(src).toContain("PIER_WINDOW_ID");
    expect(src).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(src).not.toContain("PIER_AGENT_HOOK_TOKEN");
    for (const line of src.split("\n")) {
      expect(line.trimStart().startsWith("import ")).toBe(false);
    }
    // 运行时 require 拿到 fs.promises（electron-vite 模板扫描陷阱豁免）
    expect(src).toContain('require("node:fs/promises")');
    // HTTP 通路已删
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("/agent-event");
  });

  it("事件表齐全：全部 6 个原生事件均注册且映射到正确 pier 事件", () => {
    const src = buildOmpExtensionSource();
    expect(OMP_EVENT_MAP).toHaveLength(6);
    for (const evt of NATIVE_EVENTS) {
      expect(src).toContain(`pi.on("${evt}"`);
    }
    expect(src).toContain('pierEmit("SessionStart")');
    expect(src).toContain('pierEmit("PromptSubmit")');
    expect(src).toContain('pierEmit("ToolStart")');
    expect(src).toContain('pierEmit("ToolComplete")');
    expect(src).toContain('pierEmit("Stop")');
    expect(src).toContain('pierEmit("SessionEnd")');
    expect(
      OMP_EVENT_MAP.find((e) => e.nativeEvent === "session_start")?.pierEvent
    ).toBe("SessionStart");
    expect(
      OMP_EVENT_MAP.find((e) => e.nativeEvent === "tool_call")?.pierEvent
    ).toBe("ToolStart");
    expect(
      OMP_EVENT_MAP.find((e) => e.nativeEvent === "tool_result")?.pierEvent
    ).toBe("ToolComplete");
  });

  it("agent 字段为 omp", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain('agent: "omp"');
  });

  it("加载即 emit SessionStart：extension 函数体开头独立调用, 先于 pi.on 订阅", () => {
    const src = buildOmpExtensionSource();
    const functionStart = src.indexOf(
      "export default function PierAgentStatus(pi)"
    );
    const loadEmit = src.indexOf('pierEmit("SessionStart");', functionStart);
    const firstSubscription = src.indexOf(
      'pi.on("session_start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(loadEmit).toBeGreaterThan(functionStart);
    expect(loadEmit).toBeLessThan(firstSubscription);
    // 独立语句, 不在任何 pi.on(...) 回调闭包内。
    const between = src.slice(functionStart, firstSubscription);
    expect(between.match(/pierEmit\("SessionStart"\)/g)).toHaveLength(1);
    expect(between).not.toContain("pi.on(");
  });
});

describe("ompHome", () => {
  const ORIG = process.env.OMP_HOME;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.OMP_HOME;
    } else {
      process.env.OMP_HOME = ORIG;
    }
  });

  it("默认 ~/.omp/agent", () => {
    delete process.env.OMP_HOME;
    expect(ompHome()).toContain(join(".omp", "agent"));
  });

  it("OMP_HOME 设置时使用该路径", () => {
    process.env.OMP_HOME = "/custom/omp-home";
    expect(ompHome()).toBe("/custom/omp-home");
  });
});

describe("ompExtensionPath", () => {
  it("落在 <home>/extensions/pier-agent-status.ts", () => {
    expect(ompExtensionPath()).toContain(
      join("extensions", "pier-agent-status.ts")
    );
  });
});

describe("ompDetect", () => {
  it("返回布尔值", () => {
    expect(typeof ompDetect()).toBe("boolean");
  });

  it("home 目录存在时为真", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-detect-"));
    const orig = process.env.OMP_HOME;
    process.env.OMP_HOME = dir;
    vi.resetModules();
    const mod = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(mod.ompDetect()).toBe(true);
    if (orig === undefined) {
      delete process.env.OMP_HOME;
    } else {
      process.env.OMP_HOME = orig;
    }
    vi.resetModules();
  });
});

describe("install/uninstallOmpExtension (文件 IO)", () => {
  let dir: string;
  let extPath: string;

  afterEach(() => {
    delete process.env.OMP_HOME;
    vi.resetModules();
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "pier-omp-io-test-"));
    process.env.OMP_HOME = dir;
    extPath = join(dir, "extensions", "pier-agent-status.ts");
  }

  it("detect 为真时安装写入 marker 全文件, 卸载删除该文件", async () => {
    await setup();
    await installOmpExtension(extPath);
    const installed = await readFile(extPath, "utf8");
    expect(installed).toContain(OMP_MARKER);
    await uninstallOmpExtension(extPath);
    await expect(readFile(extPath, "utf8")).rejects.toThrow();
  });

  it("重复安装第二次不改变文件内容（幂等）", async () => {
    await setup();
    await installOmpExtension(extPath);
    const afterFirst = await readFile(extPath, "utf8");
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(afterFirst);
  });

  it("非托管文件（无 marker）不覆盖, 跳过并 warn", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign =
      "// not managed by pier\nexport default function Foo() {}\n";
    await writeFile(extPath, foreign, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uninstall 对非托管文件不删除", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign = "// not managed by pier\n";
    await writeFile(extPath, foreign, "utf8");
    await uninstallOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
  });

  it("uninstall 对不存在的文件零副作用（不抛异常）", async () => {
    await setup();
    await expect(uninstallOmpExtension(extPath)).resolves.toBeUndefined();
  });

  it("detect 为假时（无 home 目录、无 omp 命令）install 不写入任何文件", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pier-omp-nodetect-"));
    delete process.env.OMP_HOME;
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = emptyDir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/omp.ts"
      );
      const missingPath = join(
        emptyDir,
        ".omp",
        "agent",
        "extensions",
        "pier-agent-status.ts"
      );
      expect(mod.ompDetect()).toBe(false);
      await mod.installOmpExtension(missingPath);
      await expect(readFile(missingPath, "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      vi.resetModules();
    }
  });
});

describe("ompIntegration 契约", () => {
  it("capability 为 full, id 为 omp", async () => {
    const { ompIntegration } = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(ompIntegration.capability).toBe("full");
    expect(ompIntegration.id).toBe("omp");
  });
});
