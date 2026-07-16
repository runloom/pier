/**
 * IPC 链路端到端集成测试:验证 renderer → command-router → GitService 真链路
 * (覆盖 git-service-e2e 直接调 service 漏掉的两层:
 *  1) RENDERER_FACADE_COMMAND_TYPES 白名单接入
 *  2) authorizeCommand 对 git:read/git:write capability 的守门)
 *
 * 直接构造 PierCoreServices + createCommandRouter,跳过 ipcMain 但走全部 router 逻辑。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import {
  createCommandRouter,
  type PierCoreServices,
} from "@main/app-core/command-router.ts";
import { PluginDisableTransitionCoordinator } from "@main/app-core/plugin-disable-transition.ts";
import { execGit } from "@main/services/git-exec.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import { createGitService } from "@main/services/git-service.ts";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import { createPanelContextService } from "@main/services/panel-context-service.ts";
import { createWorktreeService } from "@main/services/worktree-service.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierCapability,
  type PierClientKind,
} from "@shared/contracts/permissions.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOTHING_TO_COMMIT_RE = /clean|nothing/;
const SAFE_BRANCH_NAME_RE = /must not start with/;

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-git-ipc-"));
  tempDirs.push(dir);
  await execGit(["init", "-b", "main"], { cwd: dir });
  await execGit(["config", "user.email", "t@p.local"], { cwd: dir });
  await execGit(["config", "user.name", "t"], { cwd: dir });
  await execGit(["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "a.txt"), "x\n");
  await execGit(["add", "a.txt"], { cwd: dir });
  await execGit(["commit", "-m", "init"], { cwd: dir, timeoutMs: 30_000 });
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true }))
  );
});

function makeServices(): PierCoreServices {
  // 只填 router 调 git 命令时实际会用到的 services;其他用 throw 占位避免误用
  const trap = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error("not stubbed")) }
  );
  return {
    agentDetection: trap as never,
    agentUsage: trap as never,
    managedPlugins: trap as never,
    appUpdates: trap as never,
    ai: trap as never,
    commandPaletteMru: trap as never,
    git: createGitService(),
    gitReview: trap as never,
    gitWatch: createGitWatchService(),
    panelContexts: trap as never,
    localEnvironments: trap as never,
    plugins: trap as never,
    pluginDisableTransitions: new PluginDisableTransitionCoordinator(),
    pluginSettings: trap as never,
    preferences: trap as never,
    secrets: trap as never,
    usageData: trap as never,
    processEnvironment: trap as never,
    rendererCommand: trap as never,
    tasks: trap as never,
    terminalLaunches: trap as never,
    terminalProfiles: trap as never,
    terminalStatusBarPrefs: trap as never,
    window: trap as never,
    workspace: trap as never,
    worktrees: createWorktreeService(),
  };
}

function clientOf(kind: PierClientKind, extra: PierCapability[] = []) {
  const now = Date.now();
  return {
    capabilities: [...DEFAULT_CAPABILITIES_BY_CLIENT_KIND[kind], ...extra],
    createdAt: now,
    id: `${kind}-1`,
    kind,
    lastSeenAt: now,
  };
}

function envelope(clientId: string, command: PierCommand) {
  return {
    clientId,
    command,
    protocolVersion: 1 as const,
    requestId: "req-1",
  };
}

describe("git IPC 端到端(命令路由 + capability 守门)", () => {
  it("desktop-renderer 默认拥有 git:read,能调 git.getStatus 拿到真 repo 状态", async () => {
    const repo = await makeRepo();
    const clients = createClientRegistry();
    clients.register(clientOf("desktop-renderer"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const result = await router.execute(
      envelope("desktop-renderer-1", {
        cwd: repo,
        type: "git.getStatus",
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const status = result.data as { branch: { branch: string | null } };
      expect(status.branch.branch).toBe("main");
    }
  });

  it("desktop-renderer 默认拥有 git:write,能调 git.stage + git.commit", async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, "b.txt"), "y\n");
    const clients = createClientRegistry();
    clients.register(clientOf("desktop-renderer"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const stageResult = await router.execute(
      envelope("desktop-renderer-1", {
        cwd: repo,
        paths: ["b.txt"],
        type: "git.stage",
      })
    );
    const commitResult = await router.execute(
      envelope("desktop-renderer-1", {
        cwd: repo,
        message: "feat: b",
        type: "git.commit",
      })
    );

    expect(stageResult.ok).toBe(true);
    expect(commitResult.ok).toBe(true);
  });

  it("mcp-local 只有 git:read,git.commit 被 permission_denied 拦截", async () => {
    const repo = await makeRepo();
    const clients = createClientRegistry();
    clients.register(clientOf("mcp-local"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const result = await router.execute(
      envelope("mcp-local-1", {
        cwd: repo,
        message: "x",
        type: "git.commit",
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("非桌面客户端即使有 git:read 也不能进入 Git Review 路由", async () => {
    const clients = createClientRegistry();
    clients.register(clientOf("mcp-local"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const result = await router.execute(
      envelope("mcp-local-1", {
        request: {
          operationId: "c4883f41-047b-4f05-b858-9207eb0617d0",
          source: { contextId: "context-1", gitRootPath: "/repo" },
        },
        type: "git.getReviewIndex",
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("Git Review 经 router 与 service 复核 canonical context，跨 context 请求不读取索引", async () => {
    const repo = await makeRepo();
    const clients = createClientRegistry();
    clients.register(clientOf("desktop-renderer"));
    const read = vi.fn();
    const services = {
      ...makeServices(),
      gitReview: new GitReviewService({
        indexReader: { read, resolve: vi.fn() },
      }),
      panelContexts: createPanelContextService(),
    };
    const router = createCommandRouter({ clients, services });

    const result = await router.execute(
      envelope("desktop-renderer-1", {
        request: {
          operationId: "c4883f41-047b-4f05-b858-9207eb0617d0",
          source: { contextId: "context:forged", gitRootPath: repo },
        },
        type: "git.getReviewIndex",
      }),
      {
        navigationGeneration: 0,
        webContentsId: 7,
        windowRecordId: "record-1",
      }
    );

    expect(result).toMatchObject({
      data: { kind: "error", reason: "invalidSource", retryable: false },
      ok: true,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("git CLI 失败(空仓库无变更 commit)经 GitExecError → git_error 错误码 + stderr 透传", async () => {
    const repo = await makeRepo();
    const clients = createClientRegistry();
    clients.register(clientOf("desktop-renderer"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const result = await router.execute(
      envelope("desktop-renderer-1", {
        cwd: repo,
        message: "empty",
        type: "git.commit",
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("git_error");
      // stderr 摘要应被拼到 message(git 会输出 "nothing to commit" 或 "working tree clean")
      expect(result.error.message.toLowerCase()).toMatch(NOTHING_TO_COMMIT_RE);
    }
  });

  it("分支名以 - 开头被 service 层拒绝(防当 git flag)", async () => {
    const repo = await makeRepo();
    const clients = createClientRegistry();
    clients.register(clientOf("desktop-renderer"));
    const router = createCommandRouter({ clients, services: makeServices() });

    const result = await router.execute(
      envelope("desktop-renderer-1", {
        cwd: repo,
        name: "--evil",
        type: "git.createBranch",
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal_error");
      expect(result.error.message).toMatch(SAFE_BRANCH_NAME_RE);
    }
  });
});
