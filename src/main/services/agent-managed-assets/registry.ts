import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { FilePathTransactionLock } from "../files/path-transaction-lock.ts";
import {
  LedgerStore,
  type ManagedTargetBook,
  recoverPendingTargets,
} from "./ledger.ts";
import {
  buildLauncherEntry,
  buildOpenCodeLauncherEntry,
  inferMemoryFormat,
  type MemoryConfigFormat,
} from "./serializers.ts";
import { applyMemoryTarget, fingerprintOnDisk } from "./target.ts";
import type { TargetRow } from "./types.ts";

/**
 * v3 全局注册:每个智能体的**用户级全局配置**只有一条指向启动器的 pier-memory
 * 条目(cmux-agent-mcp 模式)。这些文件全部在用户家目录,不存在 git 跟踪问题。
 * 单机一份 registry 账本承接 WAL 与指纹(结构复用项目账本的 targets/pending)。
 */
export interface MemoryRegistry extends ManagedTargetBook {
  /** v2 目标反向清理 + 确认门残留清理,同批一次性标记。 */
  migratedFromV2?: boolean;
}

export function memoryRegistryPath(home: string = homedir()): string {
  return join(home, ".pier", "memory", "registry.json");
}

export interface MemoryGlobalTarget {
  abs: string;
  agent: string;
  entry: (launcherPath: string) => Record<string, unknown>;
  format: MemoryConfigFormat;
}

/**
 * 与 agents/integrations/codex.ts 的 $CODEX_HOME 语义一致(shell tilde 展开);
 * 相对路径不可信(会相对 Electron cwd 落盘),回退默认。
 */
function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  const raw = env.CODEX_HOME;
  if (!raw) {
    return join(home, ".codex");
  }
  if (raw === "~") {
    return home;
  }
  if (raw.startsWith("~/")) {
    return join(home, raw.slice(2));
  }
  return isAbsolute(raw) ? raw : join(home, ".codex");
}

/** omp 暂不覆盖:待核实其是否消费 ~/.claude.json(v3 spec 风险表)。 */
export function memoryGlobalTargets(options?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): MemoryGlobalTarget[] {
  const home = options?.home ?? homedir();
  const env = options?.env ?? process.env;
  const xdgConfig =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(home, ".config");
  return [
    {
      abs: join(home, ".claude.json"),
      agent: "claude",
      entry: buildLauncherEntry,
      format: "mcp-servers-json",
    },
    {
      abs: join(home, ".cursor", "mcp.json"),
      agent: "cursor",
      entry: buildLauncherEntry,
      format: "mcp-servers-json",
    },
    {
      abs: join(codexHome(env, home), "config.toml"),
      agent: "codex",
      entry: buildLauncherEntry,
      format: "codex-toml",
    },
    {
      abs: join(home, ".gemini", "settings.json"),
      agent: "gemini",
      entry: buildLauncherEntry,
      format: "mcp-servers-json",
    },
    {
      abs: join(xdgConfig, "opencode", "opencode.json"),
      agent: "opencode",
      entry: buildOpenCodeLauncherEntry,
      format: "opencode-json",
    },
  ];
}

/**
 * OpenCode 的 JSONC 优先级高于 JSON(与 agents/integrations/opencode.ts 一致):
 * `opencode.jsonc` 存在时写 `.json` 会被静默忽略。此时把目标改到 jsonc,
 * 由 serializer 用 jsonc-parser 局部编辑保留注释。
 */
async function withLiveTargetAbs(
  target: MemoryGlobalTarget
): Promise<MemoryGlobalTarget> {
  if (target.agent !== "opencode") {
    return target;
  }
  const jsoncPath = target.abs.replace(/\.json$/u, ".jsonc");
  const jsonc = await stat(jsoncPath).catch(() => null);
  return jsonc ? { ...target, abs: jsoncPath } : target;
}

/** jsonc 优先时不要再写会被忽略的 .json;账本记录迁到 live 路径以保留指纹。 */
function retargetOpenCodeSibling(
  registry: MemoryRegistry,
  jsonAbs: string,
  liveAbs: string
): void {
  if (liveAbs === jsonAbs) {
    return;
  }
  if (registry.targets[liveAbs] === undefined) {
    const prior = registry.targets[jsonAbs];
    if (prior) {
      registry.targets[liveAbs] = prior;
    }
  }
  delete registry.targets[jsonAbs];
  registry.pending = registry.pending.filter(
    (item) => item.targetPath !== jsonAbs
  );
}

async function loadRegistry(path: string): Promise<MemoryRegistry> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as MemoryRegistry;
    return {
      migratedFromV2: parsed.migratedFromV2 === true,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      targets:
        parsed.targets && typeof parsed.targets === "object"
          ? parsed.targets
          : {},
    };
  } catch {
    return { pending: [], targets: {} };
  }
}

async function saveRegistry(
  path: string,
  registry: MemoryRegistry
): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

interface RawLedgerShape {
  decidedBy?: unknown;
  desiredState?: unknown;
  pending?: unknown[];
  rulesSection?: { fingerprint?: unknown; inserted?: unknown };
  targets?: Record<string, unknown>;
  trackedAcknowledged?: unknown;
}

/**
 * v2 确认门残留清理(随迁移批一次性):v2 自动路径被 git 跟踪门拦下时会落
 * `desiredState: "disabled"` 账本作「别再自动尝试」标记——那不是用户决策,
 * 却会在 v3 挡住「缺账本 = 默认启用」。
 * 保护规则:带 `decidedBy: "user"`(v3 显式开关)一票否决,**用户决策绝不靠
 * 形态推断保护**;其余按形态判残留(disabled + 空 targets/pending + 无 ack +
 * 无引导段痕迹)。真实的 v2 用户关闭会留下 removed/skipped 记录或 ack。
 */
async function clearV2GateArtifacts(
  baseDir: string,
  lockFor: <T>(storeDir: string, fn: () => Promise<T>) => Promise<T>
): Promise<void> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "launcher") {
      continue;
    }
    const storeDir = join(baseDir, entry.name);
    await lockFor(storeDir, async () => {
      const ledgerPath = join(storeDir, "ledger.json");
      let parsed: RawLedgerShape;
      try {
        parsed = JSON.parse(
          await readFile(ledgerPath, "utf8")
        ) as RawLedgerShape;
      } catch {
        return;
      }
      const gateArtifact =
        parsed.decidedBy !== "user" &&
        parsed.desiredState === "disabled" &&
        parsed.trackedAcknowledged !== true &&
        Object.keys(parsed.targets ?? {}).length === 0 &&
        (parsed.pending ?? []).length === 0 &&
        parsed.rulesSection?.inserted !== true &&
        !parsed.rulesSection?.fingerprint;
      if (gateArtifact) {
        await rm(ledgerPath, { force: true });
      }
    });
  }
}

/**
 * v2 → v3 迁移:逐项目账本把写进项目仓库的托管条目按指纹反向移除
 * (漂移的保留并记 failed,绝不动第三方内容)。**先跑 WAL 恢复**:v2 崩溃窗口
 * 内「pending 已落盘、文件已写、commit 未落」的条目经分支①提交为 written
 * 后同样被反向清理——否则裸清 pending 会把唯一的归属证据销毁,让 Pier 写进
 * 仓库的条目永久无人认领(零写入红线)。
 */
async function migrateV2ProjectTargets(
  baseDir: string,
  lockFor: <T>(storeDir: string, fn: () => Promise<T>) => Promise<T>
): Promise<void> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "launcher") {
      continue;
    }
    const dir = join(baseDir, entry.name);
    await lockFor(dir, async () => {
      const ledgerExists = await stat(join(dir, "ledger.json")).catch(
        () => null
      );
      if (!ledgerExists) {
        return;
      }
      const store = new LedgerStore({ canonicalRoot: "", dir });
      const ledger = await store.load();
      await recoverPendingTargets(ledger, (item) =>
        fingerprintOnDisk(item.targetPath)
      );
      const targetPaths = Object.entries(ledger.targets)
        .filter(([, record]) => record.lastOutcome === "written")
        .map(([path]) => path);
      if (targetPaths.length === 0 && ledger.pending.length === 0) {
        return;
      }
      for (const targetPath of targetPaths) {
        await applyMemoryTarget({
          abs: targetPath,
          book: ledger,
          consumers: [],
          desired: "disabled",
          format: inferMemoryFormat(targetPath),
          save: () => store.save(ledger),
        });
      }
      // 移除成功/跳过的记录清掉;漂移 failed 保留作诊断,不再参与任何写入。
      ledger.targets = Object.fromEntries(
        Object.entries(ledger.targets).filter(
          ([, record]) => record.lastOutcome === "failed"
        )
      );
      ledger.pending = [];
      await store.save(ledger);
    });
  }
}

let convergeChain: Promise<TargetRow[]> = Promise.resolve([]);

export interface ConvergeMemoryRegistryArgs {
  env?: NodeJS.ProcessEnv;
  home?: string;
  installedAgents: readonly string[];
  launcherPath: string;
  /**
   * 路径级串行(与 reconciler 同一把 FilePathTransactionLock):迁移/清理写项目
   * 账本、全局配置写入都要与用户开关及 Pier 其它写入方互斥,防丢更新。
   * 缺省(测试)退化为直接执行。
   */
  lock?: FilePathTransactionLock;
}

/** boot / 显式 enable 后调用;进程内串行,幂等(已达成目标零写入)。 */
export function convergeMemoryRegistry(
  args: ConvergeMemoryRegistryArgs
): Promise<TargetRow[]> {
  convergeChain = convergeChain.catch(() => []).then(() => runConverge(args));
  return convergeChain;
}

async function runConverge(
  args: ConvergeMemoryRegistryArgs
): Promise<TargetRow[]> {
  const home = args.home ?? homedir();
  const path = memoryRegistryPath(home);
  const lockFor = <T>(key: string, fn: () => Promise<T>): Promise<T> =>
    args.lock ? args.lock.run([key], fn) : fn();
  const registry = await loadRegistry(path);
  await recoverPendingTargets(registry, (item) =>
    fingerprintOnDisk(item.targetPath)
  );
  if (!registry.migratedFromV2) {
    const baseDir = join(home, ".pier", "memory");
    await migrateV2ProjectTargets(baseDir, lockFor);
    await clearV2GateArtifacts(baseDir, lockFor);
    registry.migratedFromV2 = true;
    await saveRegistry(path, registry);
  }
  const installed = new Set(args.installedAgents);
  const rows: TargetRow[] = [];
  for (const target of memoryGlobalTargets({
    ...(args.env ? { env: args.env } : {}),
    home,
  })) {
    if (!installed.has(target.agent)) {
      continue;
    }
    const live = await withLiveTargetAbs(target);
    retargetOpenCodeSibling(registry, target.abs, live.abs);
    rows.push(await convergeOneTarget(live, args, registry, path, lockFor));
  }
  await saveRegistry(path, registry);
  return rows;
}

/** 逐目标错误隔离:单个配置不可读/不可写(EACCES 等)不得中止其余智能体。 */
async function convergeOneTarget(
  target: MemoryGlobalTarget,
  args: ConvergeMemoryRegistryArgs,
  registry: MemoryRegistry,
  registryPath: string,
  lockFor: <T>(key: string, fn: () => Promise<T>) => Promise<T>
): Promise<TargetRow> {
  try {
    return await lockFor(target.abs, () =>
      applyMemoryTarget({
        abs: target.abs,
        book: registry,
        consumers: [target.agent],
        desired: "enabled",
        entry: target.entry(args.launcherPath),
        format: target.format,
        save: () => saveRegistry(registryPath, registry),
      })
    );
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    registry.targets[target.abs] = {
      detail,
      existedBefore: true,
      fingerprint: registry.targets[target.abs]?.fingerprint ?? "",
      lastOutcome: "failed",
    };
    return {
      configPath: target.abs,
      consumers: [target.agent],
      detail,
      outcome: "failed",
    };
  }
}

/** 状态视图(只读):registry 记录 + 磁盘指纹核对 + 未注册的已装智能体。 */
export async function memoryRegistryStatusRows(options: {
  env?: NodeJS.ProcessEnv;
  home?: string;
  installedAgents: readonly string[];
}): Promise<TargetRow[]> {
  const home = options.home ?? homedir();
  const registry = await loadRegistry(memoryRegistryPath(home));
  const targets = memoryGlobalTargets({
    ...(options.env ? { env: options.env } : {}),
    home,
  });
  const installed = new Set(options.installedAgents);
  const rows: TargetRow[] = [];
  for (const listed of targets) {
    if (!installed.has(listed.agent)) {
      continue;
    }
    const target = await withLiveTargetAbs(listed);
    const record = registry.targets[target.abs];
    if (record?.lastOutcome !== "written") {
      rows.push({
        configPath: target.abs,
        consumers: [target.agent],
        detail: record?.detail ?? "not configured yet",
        outcome: "failed",
      });
      continue;
    }
    const current = await fingerprintOnDisk(target.abs);
    if (current !== record.fingerprint) {
      rows.push({
        configPath: target.abs,
        consumers: [target.agent],
        detail: "managed entry missing or changed on disk",
        outcome: "failed",
      });
      continue;
    }
    rows.push({
      configPath: target.abs,
      consumers: [target.agent],
      outcome: "written",
    });
  }
  return rows;
}
