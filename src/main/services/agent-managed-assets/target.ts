import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { LedgerStore, type ManagedTargetBook } from "./ledger.ts";
import {
  fingerprintManagedSlice,
  inferMemoryFormat,
  type MemoryConfigFormat,
  planMemoryUpsert,
  planRemove,
} from "./serializers.ts";
import type { TargetRow } from "./types.ts";

export type { ManagedTargetBook } from "./ledger.ts";

function planUpsert(
  format: MemoryConfigFormat,
  raw: string | null,
  entry: Record<string, unknown>,
  ownedFingerprint?: string
) {
  return planMemoryUpsert(format, raw, entry, ownedFingerprint);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** 目标文件当前托管切片指纹(文件缺失 = "absent");WAL 恢复与状态核对共用。 */
export async function fingerprintOnDisk(
  targetPath: string,
  format: MemoryConfigFormat = inferMemoryFormat(targetPath)
): Promise<string> {
  const raw = await readOptional(targetPath);
  return fingerprintManagedSlice(raw, format);
}

async function writeManaged(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content);
}

export async function applyMemoryTarget(args: {
  abs: string;
  book: ManagedTargetBook;
  consumers: readonly string[];
  desired: "enabled" | "disabled";
  /** enabled 时必填:写入的托管条目(v2 引擎直连 / v3 启动器)。 */
  entry?: Record<string, unknown>;
  format: MemoryConfigFormat;
  save: () => Promise<void>;
}): Promise<TargetRow> {
  const { abs, book, desired, format, save } = args;
  const consumers = [...args.consumers];
  const record = book.targets[abs];
  const raw = await readOptional(abs);
  // 只要上一轮仍是 written,「Pier 是否创建了骨架文件」的历史事实必须保留;
  // 用当下 raw 重推会在幂等重写时把自建文件误判为 existedBefore=true,
  // disable 就不再删除自建骨架。
  const existedBefore =
    record?.lastOutcome === "written" ? record.existedBefore : raw !== null;
  if (desired === "enabled") {
    if (!args.entry) {
      throw new Error("enabled target requires an entry");
    }
    const plan = planUpsert(
      format,
      raw,
      args.entry,
      record?.fingerprint || undefined
    );
    if (!plan.ok) {
      book.targets[abs] = {
        detail: plan.reason,
        existedBefore,
        fingerprint: record?.fingerprint ?? "",
        lastOutcome: "failed",
      };
      return {
        configPath: abs,
        consumers,
        detail: plan.reason,
        outcome: "failed",
      };
    }
    if (fingerprintManagedSlice(raw, format) === plan.fingerprint) {
      book.targets[abs] = {
        existedBefore,
        fingerprint: plan.fingerprint,
        lastOutcome: "written",
      };
      return { configPath: abs, consumers, outcome: "written" };
    }
    const pending = {
      action: "write" as const,
      commitRecord: {
        existedBefore,
        fingerprint: plan.fingerprint,
        lastOutcome: "written" as const,
      },
      expectedFingerprint: plan.fingerprint,
      kind: "mcp-target" as const,
      priorFingerprint: fingerprintManagedSlice(raw, format),
      targetPath: abs,
    };
    book.pending = [
      ...book.pending.filter((item) => item.targetPath !== abs),
      pending,
    ];
    await save();
    if (plan.next === null) {
      return {
        configPath: abs,
        consumers,
        detail: "empty write plan",
        outcome: "failed",
      };
    }
    await writeManaged(abs, plan.next);
    LedgerStore.applyCommit(book, pending);
    book.pending = book.pending.filter((item) => item.targetPath !== abs);
    return { configPath: abs, consumers, outcome: "written" };
  }
  if (!record?.fingerprint || raw === null) {
    if (record) {
      book.targets[abs] = {
        detail: "nothing to remove",
        existedBefore: record.existedBefore,
        fingerprint: "",
        lastOutcome: "skipped",
      };
    }
    return {
      configPath: abs,
      consumers,
      detail: "nothing to remove",
      outcome: "skipped",
    };
  }
  const plan = planRemove(raw, format);
  if (!plan.ok) {
    book.targets[abs] = {
      detail: plan.reason,
      existedBefore: record.existedBefore,
      fingerprint: record.fingerprint,
      lastOutcome: "failed",
    };
    return {
      configPath: abs,
      consumers,
      detail: plan.reason,
      outcome: "failed",
    };
  }
  if (plan.fingerprint !== record.fingerprint) {
    book.targets[abs] = {
      detail: "drifted: not removing foreign changes",
      existedBefore: record.existedBefore,
      fingerprint: record.fingerprint,
      lastOutcome: "failed",
    };
    return {
      configPath: abs,
      consumers,
      detail: "drifted: not removing foreign changes",
      outcome: "failed",
    };
  }
  const pending = {
    action: "remove" as const,
    commitRecord: {
      existedBefore: record.existedBefore,
      fingerprint: "",
      lastOutcome: "removed" as const,
    },
    expectedFingerprint: "absent",
    kind: "mcp-target" as const,
    priorFingerprint: record.fingerprint,
    targetPath: abs,
  };
  book.pending = [
    ...book.pending.filter((item) => item.targetPath !== abs),
    pending,
  ];
  await save();
  if (plan.next === null) {
    if (record.existedBefore) {
      await writeManaged(abs, "{}\n");
    } else {
      await unlink(abs);
    }
  } else {
    await writeManaged(abs, plan.next);
  }
  LedgerStore.applyCommit(book, pending);
  book.pending = book.pending.filter((item) => item.targetPath !== abs);
  return { configPath: abs, consumers, outcome: "removed" };
}
