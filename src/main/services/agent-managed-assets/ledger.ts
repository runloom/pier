import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { ENGINE_PACKAGE } from "./serializers.ts";

/**
 * WAL 只覆盖 MCP 配置目标:引导段与 CLAUDE.md 引用靠 marker 段整体替换幂等收敛,
 * 归属由 marker 表达,没有「无法证明归属」的中间态,不进 pending。
 */
export interface LedgerPending {
  action: "write" | "remove";
  commitRecord: {
    existedBefore: boolean;
    fingerprint: string;
    lastOutcome: "written" | "removed";
  };
  expectedFingerprint: string;
  kind: "mcp-target";
  priorFingerprint: string;
  targetPath: string;
}

export interface MemoryLedger {
  claudeReference: { insertedByPier: boolean; present: boolean };
  /**
   * 决策来源:v3 的显式开关写 "user"。v2 确认门残留清理只删**没有**此标记的
   * 疑似残留形态——用户决策绝不靠形态推断保护。
   */
  decidedBy?: "user";
  desiredState: "enabled" | "disabled";
  enginePackage: string;
  pending: LedgerPending[];
  projectIdentity: { canonicalRoot: string };
  rulesSection: {
    agentsMdExistedBefore: boolean;
    fingerprint: string;
    inserted: boolean;
  };
  targets: Record<
    string,
    {
      detail?: string;
      existedBefore: boolean;
      fingerprint: string;
      lastOutcome: "written" | "removed" | "failed" | "skipped";
    }
  >;
}

/** 账本最小面:v2 项目账本与 v3 全局 registry 共用 WAL/target 记录逻辑。 */
export interface ManagedTargetBook {
  pending: LedgerPending[];
  targets: MemoryLedger["targets"];
}

/**
 * 恢复阶段(WAL 三分支):①实况=期望 → 零推导提交;②实况=先验 → 保留 pending,
 * 由 forward 收敛重放;③第三方漂移 → 记 failed,绝不认领。
 */
export async function recoverPendingTargets(
  book: ManagedTargetBook,
  currentFingerprint: (item: LedgerPending) => Promise<string>
): Promise<void> {
  const remaining: LedgerPending[] = [];
  for (const item of book.pending) {
    const verdict = LedgerStore.recover(item, await currentFingerprint(item));
    if (verdict.branch === 1) {
      LedgerStore.applyCommit(book, item);
      continue;
    }
    if (verdict.branch === 2) {
      remaining.push(item);
      continue;
    }
    book.targets[item.targetPath] = {
      detail: "conflict: third-party change during crash window",
      existedBefore: book.targets[item.targetPath]?.existedBefore ?? true,
      fingerprint: book.targets[item.targetPath]?.fingerprint ?? "",
      lastOutcome: "failed",
    };
  }
  book.pending = remaining;
}

export class LedgerStore {
  readonly #canonicalRoot: string;
  readonly #path: string;

  constructor(options: { canonicalRoot: string; dir: string }) {
    this.#canonicalRoot = options.canonicalRoot;
    this.#path = join(options.dir, "ledger.json");
  }

  static recover(
    pending: LedgerPending,
    currentFingerprint: string
  ):
    | { branch: 1; commit: LedgerPending["commitRecord"] }
    | { branch: 2 }
    | { branch: 3 } {
    if (currentFingerprint === pending.expectedFingerprint) {
      return { branch: 1, commit: pending.commitRecord };
    }
    if (currentFingerprint === pending.priorFingerprint) {
      return { branch: 2 };
    }
    return { branch: 3 };
  }

  static applyCommit(
    book: Pick<ManagedTargetBook, "targets">,
    item: LedgerPending
  ): void {
    book.targets[item.targetPath] = { ...item.commitRecord };
  }

  async load(): Promise<MemoryLedger> {
    try {
      const raw = await readFile(this.#path, "utf8");
      return JSON.parse(raw) as MemoryLedger;
    } catch {
      return {
        claudeReference: { insertedByPier: false, present: false },
        desiredState: "disabled",
        enginePackage: ENGINE_PACKAGE,
        pending: [],
        projectIdentity: { canonicalRoot: this.#canonicalRoot },
        rulesSection: {
          agentsMdExistedBefore: true,
          fingerprint: "",
          inserted: false,
        },
        targets: {},
      };
    }
  }

  async save(ledger: MemoryLedger): Promise<void> {
    await mkdir(join(this.#path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.#path, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
