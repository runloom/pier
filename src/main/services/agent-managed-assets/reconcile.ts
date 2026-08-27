import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryListResult } from "@shared/contracts/agent/memory.ts";
import type { LocalEnvironmentProjectKind } from "@shared/contracts/environment.ts";
import type { AgentRulesService } from "../agent-rules/service.ts";
import type { FilePathTransactionLock } from "../files/path-transaction-lock.ts";
import { applyGuidance } from "./guidance.ts";
import {
  deleteMemoryObservation,
  MEMORY_JSONL_MAX_BYTES,
  readMemoryList,
  writeMemoryJsonl,
} from "./jsonl.ts";
import {
  LedgerStore,
  type MemoryLedger,
  recoverPendingTargets,
} from "./ledger.ts";
import { resolveProjectIdentity } from "./project-identity.ts";
import { MemoryStoreManager } from "./store.ts";
import { fingerprintOnDisk } from "./target.ts";
import type {
  ProjectRoot,
  ReconcileReport,
  StatusSnapshot,
  TargetRow,
} from "./types.ts";

export interface ReconcileDeps {
  agentRules: AgentRulesService;
  baseDir: string;
  getProjectKind: (
    projectRootPath: string
  ) => Promise<LocalEnvironmentProjectKind | null>;
  lock: FilePathTransactionLock;
  /** enable 完成后的钩子(组合根挂引擎预热)。 */
  onEnabled?: () => void;
  /** v3 全局注册健康(六个用户级配置目标 + 磁盘指纹核对);组合根注入。 */
  registryStatus: () => Promise<TargetRow[]>;
}

/** 展示用路径:家目录前缀折叠为 `~`;不在家目录下保持绝对路径。 */
export function homeRelativeDisplayPath(
  absolutePath: string,
  home: string
): string {
  if (absolutePath === home) {
    return "~";
  }
  if (home.length > 1 && absolutePath.startsWith(`${home}/`)) {
    return `~${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}

function derivedState(
  desired: "enabled" | "disabled",
  rows: readonly TargetRow[]
): ReconcileReport["state"] {
  if (desired === "disabled") {
    return "disabled";
  }
  return rows.some((row) => row.outcome === "failed") ? "degraded" : "enabled";
}

interface ProjectBook {
  ledger: MemoryLedger;
  ledgerExisted: boolean;
  save: () => Promise<void>;
  storeDir: string;
}

/**
 * v3:MCP 交付走「全局注册 + 启动器运行时解析」(registry.ts),reconciler 只管
 * 项目级声明(desiredState,缺账本 = 默认启用)、AGENTS.md 引导段与 JSONL 治理。
 * 项目仓库内零写入——确认门/tracked 通知/默认启用扫描已随 v2 交付面删除。
 */
export class MemoryReconciler {
  readonly #deps: ReconcileDeps;

  constructor(deps: ReconcileDeps) {
    this.#deps = deps;
  }

  async enable(root: ProjectRoot): Promise<ReconcileReport> {
    const report = await this.#lockFor(root, async () => {
      const book = await this.#loadBook(root);
      await new MemoryStoreManager({ baseDir: this.#deps.baseDir }).ensure(
        this.#storeKeyOf(book)
      );
      book.ledger.decidedBy = "user";
      book.ledger.desiredState = "enabled";
      const guidance = await applyGuidance({
        agentRules: this.#deps.agentRules,
        desired: "enabled",
        ledger: book.ledger,
        root,
      });
      await book.save();
      return {
        kind: "report" as const,
        state: derivedState("enabled", [guidance]),
        targets: [guidance],
      };
    });
    this.#deps.onEnabled?.();
    return report;
  }

  async disable(root: ProjectRoot): Promise<ReconcileReport> {
    return this.#lockFor(root, async () => {
      const book = await this.#loadBook(root);
      book.ledger.decidedBy = "user";
      book.ledger.desiredState = "disabled";
      const guidance = await applyGuidance({
        agentRules: this.#deps.agentRules,
        desired: "disabled",
        ledger: book.ledger,
        root,
      });
      await book.save();
      return {
        kind: "report" as const,
        state: "disabled" as const,
        targets: [guidance],
      };
    });
  }

  async status(root: ProjectRoot): Promise<StatusSnapshot> {
    const targets = await this.#deps.registryStatus();
    return this.#lockFor(root, async () => {
      const book = await this.#loadBook(root);
      if (book.ledgerExisted) {
        await book.save();
      }
      // v3 语义:从未决策(无账本)= 默认启用。
      const desired = book.ledgerExisted ? book.ledger.desiredState : "enabled";
      const storePath = join(book.storeDir, "memory.jsonl");
      const counts = await new MemoryStoreManager({
        baseDir: this.#deps.baseDir,
      }).stats(storePath);
      return {
        derivedState: derivedState(desired, targets),
        desiredState: desired,
        enginePackage: book.ledger.enginePackage,
        entityCount: counts.entities,
        observationCount: counts.observations,
        storePath,
        storePathDisplay: homeRelativeDisplayPath(storePath, homedir()),
        targets,
      };
    });
  }

  async list(root: ProjectRoot): Promise<MemoryListResult> {
    return this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const storePath = join(this.#deps.baseDir, identity.key, "memory.jsonl");
      return readMemoryList(storePath);
    });
  }

  async deleteObservation(
    root: ProjectRoot,
    entityName: string,
    index: number,
    observation: string
  ): Promise<void> {
    await this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const storePath = join(this.#deps.baseDir, identity.key, "memory.jsonl");
      const info = await stat(storePath).catch(() => null);
      if (info && info.size > MEMORY_JSONL_MAX_BYTES) {
        throw new Error("memory file is too large to edit from settings");
      }
      const raw = await readFile(storePath, "utf8").catch(() => "");
      const result = deleteMemoryObservation(
        raw,
        entityName,
        index,
        observation
      );
      if ("error" in result) {
        throw new Error("memory observation not found");
      }
      await writeMemoryJsonl(storePath, result.next);
    });
  }

  async clearStore(root: ProjectRoot): Promise<void> {
    await this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const { storePath } = await new MemoryStoreManager({
        baseDir: this.#deps.baseDir,
      }).ensure(identity.key);
      await writeMemoryJsonl(storePath, "");
    });
  }

  #storeKeyOf(book: ProjectBook): string {
    return book.storeDir.slice(this.#deps.baseDir.length + 1);
  }

  /**
   * 加载项目账本 + 清算历史 pending(v2 遗留);缺账本时不落盘(声明式默认启用)。
   * 「存在但不可解析」视同缺失:与启动器 fail-open 语义对齐,且避免 status()
   * 把 load() 的 disabled 默认值当真、进而落盘固化一个用户从未做过的决策。
   */
  async #loadBook(root: ProjectRoot): Promise<ProjectBook> {
    const identity = await resolveProjectIdentity(root.projectRootPath);
    const storeDir = join(this.#deps.baseDir, identity.key);
    const ledgerStore = new LedgerStore({
      canonicalRoot: identity.canonicalRoot,
      dir: storeDir,
    });
    const raw = await readFile(join(storeDir, "ledger.json"), "utf8").catch(
      () => null
    );
    let ledgerExisted = false;
    if (raw !== null) {
      try {
        JSON.parse(raw);
        ledgerExisted = true;
      } catch {
        ledgerExisted = false;
      }
    }
    const ledger = await ledgerStore.load();
    await recoverPendingTargets(ledger, (item) =>
      fingerprintOnDisk(item.targetPath)
    );
    return {
      ledger,
      ledgerExisted,
      save: () => ledgerStore.save(ledger),
      storeDir,
    };
  }

  async #lockFor<T>(root: ProjectRoot, fn: () => Promise<T>): Promise<T> {
    const normalized = await realpath(root.projectRootPath);
    const kind = await this.#deps.getProjectKind(normalized);
    if (kind !== "project") {
      throw new Error("project scope requires a registered Pier project");
    }
    const identity = await resolveProjectIdentity(root.projectRootPath);
    return this.#deps.lock.run(
      [root.projectRootPath, join(this.#deps.baseDir, identity.key)],
      fn
    );
  }
}
