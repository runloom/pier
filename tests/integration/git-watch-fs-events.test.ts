import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import {
  createGitWatchService,
  type GitWatchService,
} from "@main/services/git-watch-service.ts";
import { resolveRepoAnchors } from "@main/services/git-watch-signatures.ts";
import type { GitChangeEvent } from "@shared/contracts/git.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fs 事件驱动链路集成测试："工作树内容修改 → 广播"在 poll 门控关闭
 *（isPollActive=false，模拟未聚焦窗口）时必须仅靠真实 fs.watch 事件成立。
 * 布局仿照多 worktree 工作区：嵌套 .worktrees/<name> linked worktree + node_modules 软链。
 * 本文件故意走真实时钟：被测路径是 fs.watch 事件 → debounce 定时器，
 * fake timers 无法驱动内核 FSEvents 投递。
 *
 * baseline 屏障：hub 挂接（anchors 解析）严格发生在 baseline 之后（src 保证），
 * 所以 anchors 解析回调触发 ⟹ baseline 签名已采样，此后的文件修改必然产生签名差异。
 */

async function initRepo(dir: string): Promise<void> {
  await execGit(["init", "-q", "-b", "main"], { cwd: dir });
  await execGit(["config", "user.email", "test@pier.local"], { cwd: dir });
  await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
  await writeFile(join(dir, "a.txt"), "one\n");
  await writeFile(join(dir, "b.txt"), "two\n");
  await execGit(["add", "."], { cwd: dir });
  await execGit(["commit", "-q", "-m", "init"], { cwd: dir });
}

const WORKTREE_CHANGE_RE = /worktree|both/;

interface ProbeHandle {
  baselineDone(root: string): Promise<void>;
  service: GitWatchService;
}

function createProbeService(): ProbeHandle {
  const resolved = new Map<string, PromiseWithResolvers<void>>();
  const gate = (root: string): PromiseWithResolvers<void> => {
    let entry = resolved.get(root);
    if (entry === undefined) {
      entry = Promise.withResolvers<void>();
      resolved.set(root, entry);
    }
    return entry;
  };
  const service = createGitWatchService({
    isPollActive: () => false,
    pollMs: 60_000,
    resolveRepoAnchors: async (root) => {
      const anchors = await resolveRepoAnchors(root);
      gate(root).resolve();
      return anchors;
    },
  });
  return { baselineDone: (root) => gate(root).promise, service };
}

describe("git watch probe — 真实 fs 事件驱动", () => {
  let base = "";

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "pier-watch-probe-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("未聚焦(poll 门控关)时,主工作树内容修改仍应广播 worktree 变化", async () => {
    const main = join(base, "main");
    await mkdir(main);
    await initRepo(main);
    // 仿真用户布局:node_modules 软链 + 嵌套 linked worktree
    const linkTarget = join(base, "shared-node-modules");
    await mkdir(linkTarget);
    await symlink(linkTarget, join(main, "node_modules"));
    await execGit(
      ["worktree", "add", "-q", "-b", "feat", join(main, ".worktrees", "feat")],
      { cwd: main }
    );

    const { service, baselineDone } = createProbeService();
    const events: GitChangeEvent[] = [];
    const unsubscribe = service.watch(main, (event) => events.push(event));
    await baselineDone(main);

    // baseline 后首次内容修改:clean → modified,签名必变
    await writeFile(join(main, "b.txt"), "changed by agent\n");
    await vi.waitFor(
      () => {
        expect(events.length).toBeGreaterThan(0);
      },
      { timeout: 8000 }
    );
    expect(events.at(-1)?.changeKind).toMatch(WORKTREE_CHANGE_RE);

    unsubscribe();
    await service.dispose();
  }, 20_000);

  it("嵌套 linked worktree 订阅者:其内容修改应广播到对应 root", async () => {
    const main = join(base, "main");
    const wt = join(main, ".worktrees", "feat");
    await mkdir(main);
    await initRepo(main);
    await execGit(["worktree", "add", "-q", "-b", "feat", wt], { cwd: main });

    const { service, baselineDone } = createProbeService();
    const mainEvents: GitChangeEvent[] = [];
    const wtEvents: GitChangeEvent[] = [];
    const unsubMain = service.watch(main, (event) => mainEvents.push(event));
    const unsubWt = service.watch(wt, (event) => wtEvents.push(event));
    await baselineDone(main);
    await baselineDone(wt);

    await writeFile(join(wt, "a.txt"), "wt change\n");
    await vi.waitFor(
      () => {
        expect(wtEvents.length).toBeGreaterThan(0);
      },
      { timeout: 8000 }
    );
    expect(wtEvents.at(-1)?.changeKind).toMatch(WORKTREE_CHANGE_RE);

    unsubMain();
    unsubWt();
    await service.dispose();
  }, 20_000);
});
