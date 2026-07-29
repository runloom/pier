import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  atomicReplaceSymlink,
  isPierHooksCurrentSymlink,
  readInstalledHookRuntimeGeneration,
  withAgentHooksInstallLock,
} from "../../../src/main/services/agents/agent-hooks-install.ts";
import {
  installAgentHooksStack,
  installAllAgentHooks,
  uninstallAllAgentHooks,
} from "../../../src/main/services/agents/integrations/registry.ts";
import type { AgentHookIntegration } from "../../../src/main/services/agents/integrations/types.ts";

function fakeIntegration(
  id: AgentHookIntegration["id"],
  input: {
    detect?: boolean | (() => boolean);
    install: () => Promise<void>;
    uninstall?: () => Promise<void>;
  }
): AgentHookIntegration {
  return {
    detect: () =>
      typeof input.detect === "function"
        ? input.detect()
        : (input.detect ?? true),
    id,
    install: input.install,
    runtime: { emittedMappings: [], stopAuthority: "none" },
    uninstall: input.uninstall ?? (async () => undefined),
  };
}

async function publishHigherRuntime(hooksHome: string): Promise<void> {
  await mkdir(join(hooksHome, "v11"), { recursive: true });
  await atomicReplaceSymlink(join(hooksHome, "current"), "v11");
  await writeFile(join(hooksHome, "GENERATION"), "11\n", "utf8");
}

describe("installAgentHooksStack", () => {
  it("先完成共享运行时，再并行隔离各提供方安装失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-stack-"));
    const hooksHome = join(root, "hooks");
    const installed: string[] = [];
    const skippedInstall = vi.fn(async () => undefined);
    const assertRuntimeReady = async () => {
      expect(await isPierHooksCurrentSymlink(hooksHome)).toBe(true);
      expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(10);
    };
    const integrations = [
      fakeIntegration("claude", {
        install: async () => {
          await assertRuntimeReady();
          installed.push("claude");
          throw new Error("isolated provider failure");
        },
      }),
      fakeIntegration("codex", {
        install: async () => {
          await assertRuntimeReady();
          installed.push("codex");
        },
      }),
      fakeIntegration("grok", {
        detect: false,
        install: skippedInstall,
      }),
    ] as const;

    await expect(
      installAgentHooksStack(
        { hooksHome, userData: join(root, "userData") },
        integrations
      )
    ).resolves.toBeUndefined();

    expect(installed.sort()).toEqual(["claude", "codex"]);
    expect(skippedInstall).not.toHaveBeenCalled();
  });

  it("Windows 整栈明确 no-op，不写 runtime/userData 且不探测任何提供方", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-stack-win-"));
    const hooksHome = join(root, "hooks");
    const userData = join(root, "userData");
    const detect = vi.fn(() => true);
    const install = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await installAgentHooksStack(
      { hooksHome, platform: "win32", userData } as {
        hooksHome: string;
        platform: NodeJS.Platform;
        userData: string;
      },
      [fakeIntegration("devin", { detect, install })]
    );

    expect(detect).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    await expect(stat(hooksHome)).rejects.toThrow();
    await expect(stat(join(userData, "agent-hooks"))).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[agent-hooks] unsupported hook platform, skip stack: win32"
    );
    warn.mockRestore();
  });

  it("共享运行时来自更高世代时跳过所有提供方探测与安装", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-stack-newer-"));
    const hooksHome = join(root, "hooks");
    const detect = vi.fn(() => true);
    const install = vi.fn(async () => undefined);
    await mkdir(join(hooksHome, "v11"), { recursive: true });
    await writeFile(join(hooksHome, "GENERATION"), "11\n", "utf8");

    await installAgentHooksStack(
      { hooksHome, userData: join(root, "userData") },
      [fakeIntegration("devin", { detect, install })]
    );

    expect(detect).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(11);
  });

  it("提供方安装完成前持续持锁，较高世代只能随后发布并成为最终配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-stack-race-"));
    const hooksHome = join(root, "hooks");
    const providerEntered = Promise.withResolvers<void>();
    const releaseProvider = Promise.withResolvers<void>();
    const higherContended = Promise.withResolvers<void>();
    const retryHigher = Promise.withResolvers<void>();
    const higherEntered = Promise.withResolvers<void>();
    let configOwner = "none";

    const lowerInstall = installAgentHooksStack(
      { hooksHome, userData: join(root, "userData") },
      [
        fakeIntegration("devin", {
          install: async () => {
            providerEntered.resolve();
            await releaseProvider.promise;
            configOwner = "v10";
          },
        }),
      ]
    );
    await providerEntered.promise;

    const higherInstall = withAgentHooksInstallLock(
      hooksHome,
      async () => {
        await publishHigherRuntime(hooksHome);
        configOwner = "v11";
        higherEntered.resolve();
      },
      {
        acquireTimeoutMs: 30_000,
        delay: async () => {
          higherContended.resolve();
          await retryHigher.promise;
        },
      }
    );
    const outcome = await Promise.race([
      higherContended.promise.then(() => "waited" as const),
      higherEntered.promise.then(() => "entered" as const),
    ]);

    releaseProvider.resolve();
    await lowerInstall;
    retryHigher.resolve();
    await higherInstall;

    expect(outcome).toBe("waited");
    expect(configOwner).toBe("v11");
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(11);
  });
});

describe("installAllAgentHooks", () => {
  it("detect 抛错会告警并隔离，后续提供方仍完成安装", async () => {
    const installed = vi.fn(async () => undefined);
    const detectionError = new Error("broken detector");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await installAllAgentHooks([
      fakeIntegration("devin", {
        detect: () => {
          throw detectionError;
        },
        install: vi.fn(async () => undefined),
      }),
      fakeIntegration("droid", { install: installed }),
    ]);

    expect(installed).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[agent-hooks:devin] detect/install failed:",
      detectionError
    );
    warn.mockRestore();
  });
});

describe("uninstallAllAgentHooks", () => {
  it("共享运行时来自更高世代时跳过所有提供方卸载", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-uninstall-newer-"));
    const hooksHome = join(root, "hooks");
    const detect = vi.fn(() => true);
    const uninstall = vi.fn(async () => undefined);
    await mkdir(join(hooksHome, "v11"), { recursive: true });
    await writeFile(join(hooksHome, "GENERATION"), "11\n", "utf8");

    await uninstallAllAgentHooks({ hooksHome }, [
      fakeIntegration("devin", {
        detect,
        install: async () => undefined,
        uninstall,
      }),
    ]);

    expect(detect).not.toHaveBeenCalled();
    expect(uninstall).not.toHaveBeenCalled();
  });

  it.each([
    ["无共享运行时", false],
    ["当前共享运行时", true],
  ] as const)("%s 时不经 detect 并逐个隔离卸载", async (_label, current) => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-uninstall-current-"));
    const hooksHome = join(root, "hooks");
    if (current) {
      await mkdir(join(hooksHome, "v10"), { recursive: true });
      await writeFile(join(hooksHome, "GENERATION"), "10\n", "utf8");
    }
    const detectFirst = vi.fn(() => {
      throw new Error("detect must not run during uninstall");
    });
    const detectSecond = vi.fn(() => false);
    const uninstallError = new Error("isolated uninstall failure");
    const uninstallFirst = vi.fn(async () => {
      throw uninstallError;
    });
    const uninstallSecond = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await uninstallAllAgentHooks({ hooksHome }, [
      fakeIntegration("devin", {
        detect: detectFirst,
        install: async () => undefined,
        uninstall: uninstallFirst,
      }),
      fakeIntegration("droid", {
        detect: detectSecond,
        install: async () => undefined,
        uninstall: uninstallSecond,
      }),
    ]);

    expect(detectFirst).not.toHaveBeenCalled();
    expect(detectSecond).not.toHaveBeenCalled();
    expect(uninstallFirst).toHaveBeenCalledOnce();
    expect(uninstallSecond).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[agent-hooks:devin] uninstall failed:",
      uninstallError
    );
    warn.mockRestore();
  });

  it("提供方卸载完成前持续持锁，较高世代只能随后发布并保留最终配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-hook-uninstall-race-"));
    const hooksHome = join(root, "hooks");
    await mkdir(join(hooksHome, "v10"), { recursive: true });
    await writeFile(join(hooksHome, "GENERATION"), "10\n", "utf8");
    const providerEntered = Promise.withResolvers<void>();
    const releaseProvider = Promise.withResolvers<void>();
    const higherContended = Promise.withResolvers<void>();
    const retryHigher = Promise.withResolvers<void>();
    const higherEntered = Promise.withResolvers<void>();
    let configOwner = "v10";

    const lowerUninstall = uninstallAllAgentHooks({ hooksHome }, [
      fakeIntegration("devin", {
        install: async () => undefined,
        uninstall: async () => {
          providerEntered.resolve();
          await releaseProvider.promise;
          configOwner = "removed-by-v10";
        },
      }),
    ]);
    await providerEntered.promise;

    const higherInstall = withAgentHooksInstallLock(
      hooksHome,
      async () => {
        await publishHigherRuntime(hooksHome);
        configOwner = "v11";
        higherEntered.resolve();
      },
      {
        acquireTimeoutMs: 30_000,
        delay: async () => {
          higherContended.resolve();
          await retryHigher.promise;
        },
      }
    );
    const outcome = await Promise.race([
      higherContended.promise.then(() => "waited" as const),
      higherEntered.promise.then(() => "entered" as const),
    ]);

    releaseProvider.resolve();
    await lowerUninstall;
    retryHigher.resolve();
    await higherInstall;

    expect(outcome).toBe("waited");
    expect(configOwner).toBe("v11");
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(11);
  });
});
