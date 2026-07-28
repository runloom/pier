import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPierManagedPluginContent,
  PIER_MANAGED_PLUGIN_GENERATION,
  pierManagedPluginGeneration,
  pierManagedPluginMarker,
  writeManagedPluginFile,
} from "../../../src/main/services/agents/integrations/managed-plugin-file.ts";

describe("managed-plugin-file", () => {
  let baseDir: string | null = null;

  afterEach(async () => {
    if (baseDir) {
      const { rm } = await import("node:fs/promises");
      await rm(baseDir, { force: true, recursive: true });
      baseDir = null;
    }
  });

  async function tempPath(name: string): Promise<string> {
    const { mkdtemp } = await import("node:fs/promises");
    baseDir = await mkdtemp(join(tmpdir(), "pier-managed-plugin-"));
    return join(baseDir, name);
  }

  it("marker 含当前世代", () => {
    expect(pierManagedPluginMarker()).toBe(
      `pier-agent-status:v${PIER_MANAGED_PLUGIN_GENERATION} (managed by Pier)`
    );
  });

  it("解析版本化 marker 与历史 loose marker", () => {
    expect(
      pierManagedPluginGeneration("x pier-agent-status:v5 (managed by Pier) y")
    ).toBe(5);
    expect(pierManagedPluginGeneration("managed by Pier")).toBe(1);
    expect(pierManagedPluginGeneration("// not managed by pier\n")).toBeNull();
    expect(pierManagedPluginGeneration("user plugin")).toBeNull();
    expect(isPierManagedPluginContent(pierManagedPluginMarker(3))).toBe(true);
  });

  it("非托管同名文件不覆盖", async () => {
    const path = await tempPath("plugin.ts");
    await writeFile(path, "// user owned\n", "utf8");
    const result = await writeManagedPluginFile({
      path,
      source: `// ${pierManagedPluginMarker()}\nexport {}\n`,
      label: "test",
    });
    expect(result).toBe("skipped-unmanaged");
    expect(await readFile(path, "utf8")).toBe("// user owned\n");
  });

  it("磁盘更高世代不降级", async () => {
    const path = await tempPath("plugin.ts");
    const high = PIER_MANAGED_PLUGIN_GENERATION + 3;
    await writeFile(
      path,
      `// ${pierManagedPluginMarker(high)}\nexport const high = true;\n`,
      "utf8"
    );
    const result = await writeManagedPluginFile({
      path,
      source: `// ${pierManagedPluginMarker()}\nexport const low = true;\n`,
      label: "test",
      generation: PIER_MANAGED_PLUGIN_GENERATION,
    });
    expect(result).toBe("skipped-newer");
    expect(await readFile(path, "utf8")).toContain(`v${high}`);
    expect(await readFile(path, "utf8")).toContain("high = true");
  });

  it("字节相同不落盘；内容变化则写入", async () => {
    const path = await tempPath("plugin.ts");
    const source = `// ${pierManagedPluginMarker()}\nexport const a = 1;\n`;
    expect(await writeManagedPluginFile({ path, source, label: "test" })).toBe(
      "written"
    );
    expect(await writeManagedPluginFile({ path, source, label: "test" })).toBe(
      "unchanged"
    );
    const next = `// ${pierManagedPluginMarker()}\nexport const a = 2;\n`;
    expect(
      await writeManagedPluginFile({ path, source: next, label: "test" })
    ).toBe("written");
    expect(await readFile(path, "utf8")).toBe(next);
  });

  it("可 chmod 可执行位", async () => {
    const path = await tempPath("hook-script");
    await writeManagedPluginFile({
      path,
      source: `#!/bin/sh\n# ${pierManagedPluginMarker()}\n`,
      label: "test",
      mode: 0o755,
    });
    const { stat } = await import("node:fs/promises");
    const st = await stat(path);
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode
    expect(st.mode & 0o777).toBe(0o755);
  });

  it("内容相同仍恢复可执行位（unchanged + mode）", async () => {
    const path = await tempPath("hook-script");
    const source = `#!/bin/sh\n# ${pierManagedPluginMarker()}\necho ok\n`;
    await writeManagedPluginFile({ path, source, label: "test", mode: 0o755 });
    const { chmod, stat } = await import("node:fs/promises");
    await chmod(path, 0o644);
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode
    expect((await stat(path)).mode & 0o777).toBe(0o644);
    const result = await writeManagedPluginFile({
      path,
      source,
      label: "test",
      mode: 0o755,
    });
    expect(result).toBe("unchanged");
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode
    expect((await stat(path)).mode & 0o777).toBe(0o755);
  });

  it("缺失父目录时自动创建", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    baseDir = await mkdtemp(join(tmpdir(), "pier-managed-plugin-"));
    const path = join(baseDir, "nested", "deep", "plugin.ts");
    await writeManagedPluginFile({
      path,
      source: `// ${pierManagedPluginMarker()}\n`,
      label: "test",
    });
    expect(await readFile(path, "utf8")).toContain("pier-agent-status:v");
  });
});
