import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIDER_BLOCK_MARKERS,
  aiderConfigPath,
  aiderDetect,
  aiderIntegration,
  installAiderHooks,
  uninstallAiderHooks,
  withoutPierAiderNotifications,
} from "../../../src/main/services/agents/integrations/aider.ts";

describe("withoutPierAiderNotifications", () => {
  it("移除 pier marker 块后还原", () => {
    const original = "model: gpt-4\n";
    const { begin, end } = AIDER_BLOCK_MARKERS;
    const withBlock = `${original}${begin}\nnotifications: true\n${end}\n`;
    const removed = withoutPierAiderNotifications(withBlock);
    expect(removed).toBe(original);
  });

  it("无 pier 块时原样返回", () => {
    const raw = "model: gpt-4\n";
    expect(withoutPierAiderNotifications(raw)).toBe(raw);
  });
});

describe("aiderConfigPath / aiderDetect", () => {
  it("配置路径为 ~/.aider.conf.yml", () => {
    expect(aiderConfigPath()).toContain(".aider.conf.yml");
  });

  it("detect 返回 boolean", () => {
    expect(typeof aiderDetect()).toBe("boolean");
  });
});

describe("install（退役后 = 清理历史托管块）", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("对无历史块的文件不写入新块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await writeFile(path, "model: gpt-4\n", "utf8");
    await installAiderHooks(path);
    const after = await readFile(path, "utf8");
    expect(after).toBe("model: gpt-4\n");
    // 关键：退役后 install 绝不写入 notifications-command
    expect(after).not.toContain("notifications-command");
  });

  it("对空文件不写入新块也不落盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await writeFile(path, "", "utf8");
    await installAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("对不存在的文件不创建文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    // 文件不存在，readConfigRaw 返回 ""，无块可清→不落盘
    await installAiderHooks(path);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("清理历史安装的 pier 托管块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    const { begin, end } = AIDER_BLOCK_MARKERS;
    const legacy = `model: gpt-4\n${begin}\nnotifications: true\nnotifications-command: 'old-pier-cmd'\n${end}\n`;
    await writeFile(path, legacy, "utf8");
    await installAiderHooks(path);
    const after = await readFile(path, "utf8");
    expect(after).toBe("model: gpt-4\n");
    expect(after).not.toContain(begin);
    expect(after).not.toContain("notifications-command");
  });

  it("非 pier 托管的用户内容不受影响", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    const original =
      'notifications: true\nnotifications-command: "say custom"\n';
    await writeFile(path, original, "utf8");
    await installAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });
});

describe("uninstallAiderHooks", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("卸载只删 pier marker 块, 不触碰用户自己的 notifications 配置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    const original =
      'notifications: true\nnotifications-command: "say custom"\n';
    await writeFile(path, original, "utf8");
    await uninstallAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("未安装时卸载零写入", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await writeFile(path, "model: gpt-4\n", "utf8");
    await uninstallAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe("model: gpt-4\n");
  });
});

describe("aiderIntegration 契约", () => {
  it("capability 为 coarse, id 为 aider", () => {
    expect(aiderIntegration.capability).toBe("coarse");
    expect(aiderIntegration.id).toBe("aider");
  });
});
