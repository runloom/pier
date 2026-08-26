import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentRulesService } from "../agent-rules/service.ts";
import type { FilePathTransactionLock } from "../files/path-transaction-lock.ts";
import { applyGuidance } from "./guidance.ts";
import {
  type LedgerPending,
  LedgerStore,
  type MemoryLedger,
} from "./ledger.ts";
import { resolveProjectIdentity } from "./project-identity.ts";
import { fingerprintManagedSlice, inferMemoryFormat } from "./serializers.ts";
import { MemoryStoreManager } from "./store.ts";
import { applyMemoryTarget } from "./target.ts";
import type {
  NeedsConfirmation,
  ProjectRoot,
  ReconcileReport,
  StatusSnapshot,
  TargetRow,
} from "./types.ts";
import { selectMemoryTargets } from "./write-targets.ts";

export interface ReconcileDeps {
  agentRules: AgentRulesService;
  baseDir: string;
  isTracked: (absolutePath: string) => Promise<boolean>;
  listInstalledAgents: () => Promise<readonly AgentKind[]>;
  lock: FilePathTransactionLock;
}

async function currentFingerprint(item: LedgerPending): Promise<string> {
  let raw: string | null;
  try {
    raw = await readFile(item.targetPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      raw = null;
    } else {
      throw error;
    }
  }
  if (item.kind === "mcp-target") {
    return fingerprintManagedSlice(raw, inferMemoryFormat(item.targetPath));
  }
  return raw === null
    ? "absent"
    : fingerprintManagedSlice(raw, "mcp-servers-json");
}

async function recoverPending(ledger: MemoryLedger): Promise<void> {
  const remaining: LedgerPending[] = [];
  for (const item of ledger.pending) {
    const verdict = LedgerStore.recover(item, await currentFingerprint(item));
    if (verdict.branch === 1) {
      LedgerStore.applyCommit(ledger, item);
      continue;
    }
    if (verdict.branch === 2) {
      remaining.push(item);
      continue;
    }
    ledger.targets[item.targetPath] = {
      detail: "conflict: third-party change during crash window",
      existedBefore: ledger.targets[item.targetPath]?.existedBefore ?? true,
      fingerprint: ledger.targets[item.targetPath]?.fingerprint ?? "",
      lastOutcome: "failed",
    };
  }
  ledger.pending = remaining;
}

function derivedState(
  desired: "enabled" | "disabled",
  rows: readonly TargetRow[]
): ReconcileReport["state"] {
  if (rows.some((row) => row.outcome === "failed")) {
    return "degraded";
  }
  return desired === "enabled" ? "enabled" : "disabled";
}

export class MemoryReconciler {
  readonly #deps: ReconcileDeps;

  constructor(deps: ReconcileDeps) {
    this.#deps = deps;
  }

  async acknowledgeTracked(root: ProjectRoot): Promise<void> {
    await this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const store = new LedgerStore({
        canonicalRoot: identity.canonicalRoot,
        dir: join(this.#deps.baseDir, identity.key),
      });
      const ledger = await store.load();
      ledger.trackedAcknowledged = true;
      await store.save(ledger);
    });
  }

  async enable(
    root: ProjectRoot
  ): Promise<ReconcileReport | NeedsConfirmation> {
    return this.#run(root, "enabled");
  }

  async disable(root: ProjectRoot): Promise<ReconcileReport> {
    const report = await this.#run(root, "disabled");
    if (report.kind !== "report") {
      throw new Error("disable cannot request confirmation");
    }
    return report;
  }

  async status(root: ProjectRoot): Promise<StatusSnapshot> {
    return this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const storeDir = join(this.#deps.baseDir, identity.key);
      const ledgerStore = new LedgerStore({
        canonicalRoot: identity.canonicalRoot,
        dir: storeDir,
      });
      const ledger = await ledgerStore.load();
      await recoverPending(ledger);
      await ledgerStore.save(ledger);
      const targets: TargetRow[] = Object.entries(ledger.targets).map(
        ([configPath, record]) => ({
          configPath,
          consumers: [],
          ...(record.detail ? { detail: record.detail } : {}),
          outcome: record.lastOutcome,
        })
      );
      const storePath = join(storeDir, "memory.jsonl");
      const counts = await new MemoryStoreManager({
        baseDir: this.#deps.baseDir,
      }).stats(storePath);
      return {
        derivedState: derivedState(ledger.desiredState, targets),
        desiredState: ledger.desiredState,
        enginePackage: ledger.enginePackage,
        entityCount: counts.entities,
        observationCount: counts.observations,
        storePath,
        targets,
      };
    });
  }

  async #lockFor<T>(root: ProjectRoot, fn: () => Promise<T>): Promise<T> {
    const identity = await resolveProjectIdentity(root.projectRootPath);
    return this.#deps.lock.run(
      [root.projectRootPath, join(this.#deps.baseDir, identity.key)],
      fn
    );
  }

  async #run(
    root: ProjectRoot,
    desired: "enabled" | "disabled"
  ): Promise<ReconcileReport | NeedsConfirmation> {
    return this.#lockFor(root, async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const storeDir = join(this.#deps.baseDir, identity.key);
      const ledgerStore = new LedgerStore({
        canonicalRoot: identity.canonicalRoot,
        dir: storeDir,
      });
      const ledger = await ledgerStore.load();
      await recoverPending(ledger);
      const selected = selectMemoryTargets(
        await this.#deps.listInstalledAgents()
      );
      if (desired === "enabled" && !ledger.trackedAcknowledged) {
        const trackedTargets: string[] = [];
        for (const target of selected) {
          const abs = join(root.projectRootPath, target.relativePath);
          if (await this.#deps.isTracked(abs)) {
            trackedTargets.push(abs);
          }
        }
        if (trackedTargets.length > 0) {
          await ledgerStore.save(ledger);
          return { kind: "needsConfirmation", trackedTargets };
        }
      }
      ledger.desiredState = desired;
      const storePath =
        desired === "enabled"
          ? (
              await new MemoryStoreManager({
                baseDir: this.#deps.baseDir,
              }).ensure(identity.key)
            ).storePath
          : join(storeDir, "memory.jsonl");
      const rows: TargetRow[] = [];
      for (const target of selected) {
        rows.push(
          await applyMemoryTarget({
            abs: join(root.projectRootPath, target.relativePath),
            consumers: target.consumers,
            desired,
            format: target.format,
            ledger,
            ledgerStore,
            storePath,
          })
        );
      }
      rows.push(
        await applyGuidance({
          agentRules: this.#deps.agentRules,
          desired,
          ledger,
          root,
        })
      );
      await ledgerStore.save(ledger);
      return {
        kind: "report",
        state: derivedState(desired, rows),
        targets: rows,
      };
    });
  }
}
