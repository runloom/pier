import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { LedgerStore, type MemoryLedger } from "./ledger.ts";
import {
  fingerprintManagedSlice,
  type MemoryConfigFormat,
  planJsonUpsert,
  planOpenCodeUpsert,
  planRemove,
  planTomlAppend,
} from "./serializers.ts";
import type { TargetRow } from "./types.ts";

function planUpsert(
  format: MemoryConfigFormat,
  raw: string | null,
  storePath: string
) {
  if (format === "codex-toml") {
    return planTomlAppend(raw, storePath);
  }
  if (format === "opencode-json") {
    return planOpenCodeUpsert(raw, storePath);
  }
  return planJsonUpsert(raw, storePath);
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

async function writeManaged(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content);
}

export async function applyMemoryTarget(args: {
  abs: string;
  consumers: readonly string[];
  desired: "enabled" | "disabled";
  format: MemoryConfigFormat;
  ledger: MemoryLedger;
  ledgerStore: LedgerStore;
  storePath: string;
}): Promise<TargetRow> {
  const { abs, desired, format, ledger, ledgerStore, storePath } = args;
  const consumers = [...args.consumers];
  const record = ledger.targets[abs];
  const raw = await readOptional(abs);
  if (desired === "enabled") {
    const plan = planUpsert(format, raw, storePath);
    if (!plan.ok) {
      return {
        configPath: abs,
        consumers,
        detail: plan.reason,
        outcome: "failed",
      };
    }
    if (fingerprintManagedSlice(raw, format) === plan.fingerprint) {
      ledger.targets[abs] = {
        existedBefore: raw !== null,
        fingerprint: plan.fingerprint,
        lastOutcome: "written",
      };
      return { configPath: abs, consumers, outcome: "written" };
    }
    const pending = {
      action: "write" as const,
      commitRecord: {
        existedBefore: raw !== null,
        fingerprint: plan.fingerprint,
        lastOutcome: "written" as const,
      },
      expectedFingerprint: plan.fingerprint,
      kind: "mcp-target" as const,
      priorFingerprint: fingerprintManagedSlice(raw, format),
      targetPath: abs,
    };
    ledger.pending = [
      ...ledger.pending.filter((item) => item.targetPath !== abs),
      pending,
    ];
    await ledgerStore.save(ledger);
    await writeManaged(abs, plan.next);
    LedgerStore.applyCommit(ledger, pending);
    ledger.pending = ledger.pending.filter((item) => item.targetPath !== abs);
    return { configPath: abs, consumers, outcome: "written" };
  }
  if (!record?.fingerprint || raw === null) {
    return {
      configPath: abs,
      consumers,
      detail: "nothing to remove",
      outcome: "skipped",
    };
  }
  const plan = planRemove(raw, format);
  if (!plan.ok) {
    return {
      configPath: abs,
      consumers,
      detail: plan.reason,
      outcome: "failed",
    };
  }
  if (plan.fingerprint !== record.fingerprint) {
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
  ledger.pending = [
    ...ledger.pending.filter((item) => item.targetPath !== abs),
    pending,
  ];
  await ledgerStore.save(ledger);
  if (plan.next === null) {
    if (record.existedBefore) {
      await writeManaged(abs, "{}\n");
    } else {
      await unlink(abs);
    }
  } else {
    await writeManaged(abs, plan.next);
  }
  LedgerStore.applyCommit(ledger, pending);
  ledger.pending = ledger.pending.filter((item) => item.targetPath !== abs);
  return { configPath: abs, consumers, outcome: "removed" };
}
