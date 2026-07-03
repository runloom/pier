import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiderConfigPath,
  aiderDetect,
  aiderIntegration,
  buildAiderNotificationsBlock,
  hasForeignNotificationsKey,
  installAiderHooks,
  uninstallAiderHooks,
  withoutPierAiderNotifications,
  withPierAiderNotifications,
} from "../../../src/main/services/agents/integrations/aider.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

describe("buildAiderNotificationsBlock / withPierAiderNotifications", () => {
  it("生成 notifications: true + notifications-command 两行（连字符键名）", () => {
    const block = buildAiderNotificationsBlock();
    expect(block).toContain("notifications: true");
    expect(block).toContain("notifications-command:");
    expect(block).not.toContain("notifications_command");
  });

  it("command 含正确 agent id + Stop 事件 + PIER_AGENT_HOOK_PORT", () => {
    const block = buildAiderNotificationsBlock();
    expect(block).toContain('"aider"');
    expect(block).toContain(MARK);
    expect(block).toContain('"Stop"');
  });

  it("使用单引号 YAML 字面量承载 command", () => {
    const block = buildAiderNotificationsBlock();
    const line = block
      .split("\n")
      .find((l) => l.startsWith("notifications-command:"));
    expect(line).toBeDefined();
    expect(line?.includes(": '")).toBe(true);
    expect(line?.trimEnd().endsWith("'")).toBe(true);
  });

  it("幂等：重复安装字节不变", () => {
    const once = withPierAiderNotifications("");
    const twice = withPierAiderNotifications(once);
    expect(twice).toBe(once);
  });

  it("用户块外内容原样保留", () => {
    const user = "# aider config\nmodel: gpt-4\n";
    const next = withPierAiderNotifications(user);
    expect(next).toContain("# aider config");
    expect(next).toContain("model: gpt-4");
  });
});

describe("withoutPierAiderNotifications", () => {
  it("卸载后与原文件一致（还原）", () => {
    const original = "model: gpt-4\n";
    const installed = withPierAiderNotifications(original);
    const removed = withoutPierAiderNotifications(installed);
    expect(removed).toBe(original);
  });

  it("无 pier 块时原样返回", () => {
    const raw = "model: gpt-4\n";
    expect(withoutPierAiderNotifications(raw)).toBe(raw);
  });
});

describe("hasForeignNotificationsKey / 已有用户 notifications 键时跳过", () => {
  it("检测到顶层非 pier notifications: 键", () => {
    const raw = "notifications: true\n";
    expect(hasForeignNotificationsKey(raw)).toBe(true);
  });

  it("检测到顶层非 pier notifications-command: 键", () => {
    const raw = 'notifications-command: "say done"\n';
    expect(hasForeignNotificationsKey(raw)).toBe(true);
  });

  it("缩进的 notifications: 不触发误判", () => {
    const raw = "foo:\n  notifications: nested\n";
    expect(hasForeignNotificationsKey(raw)).toBe(false);
  });

  it("pier 自身管理的块不算作 foreign key", () => {
    const installed = withPierAiderNotifications("model: gpt-4\n");
    expect(hasForeignNotificationsKey(installed)).toBe(false);
  });

  it("withPierAiderNotifications 在已有 foreign 键时跳过安装, 原样返回", () => {
    const raw = "notifications: true\n";
    expect(withPierAiderNotifications(raw)).toBe(raw);
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

describe("install/uninstallAiderHooks (文件 IO)", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("往不存在的 config 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await installAiderHooks(path);
    const installed = await readFile(path, "utf8");
    expect(installed).toContain("notifications: true");
    expect(installed).toContain(MARK);
    await uninstallAiderHooks(path);
    const cleaned = await readFile(path, "utf8");
    expect(cleaned).toBe("");
  });

  it("未安装时卸载零写入", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await writeFile(path, "model: gpt-4\n", "utf8");
    const before = await readFile(path, "utf8");
    await uninstallAiderHooks(path);
    const after = await readFile(path, "utf8");
    expect(after).toBe(before);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    await writeFile(path, "", "utf8");
    await installAiderHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });

  it("已有用户 notifications 配置时 install 跳过, 不覆盖用户设置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aider-io-test-"));
    const path = join(dir, ".aider.conf.yml");
    const original =
      'notifications: true\nnotifications-command: "say custom"\n';
    await writeFile(path, original, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installAiderHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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
});

describe("aiderIntegration 契约", () => {
  it("capability 为 coarse, id 为 aider", () => {
    expect(aiderIntegration.capability).toBe("coarse");
    expect(aiderIntegration.id).toBe("aider");
  });
});
