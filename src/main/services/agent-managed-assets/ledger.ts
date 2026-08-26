import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { ENGINE_PACKAGE } from "./serializers.ts";

export interface LedgerPending {
  action: "write" | "remove";
  commitRecord: {
    existedBefore: boolean;
    fingerprint: string;
    lastOutcome: "written" | "removed";
  };
  expectedFingerprint: string;
  kind: "mcp-target" | "rules-section" | "claude-reference";
  priorFingerprint: string;
  targetPath: string;
}

export interface MemoryLedger {
  claudeReference: { insertedByPier: boolean; present: boolean };
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
  trackedAcknowledged?: boolean;
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

  static applyCommit(ledger: MemoryLedger, item: LedgerPending): void {
    const commit = item.commitRecord;
    if (item.kind === "mcp-target") {
      ledger.targets[item.targetPath] = { ...commit };
      return;
    }
    if (item.kind === "rules-section") {
      ledger.rulesSection = {
        agentsMdExistedBefore: ledger.rulesSection.agentsMdExistedBefore,
        fingerprint: commit.fingerprint,
        inserted: commit.lastOutcome === "written",
      };
      return;
    }
    ledger.claudeReference = {
      insertedByPier:
        commit.lastOutcome === "written"
          ? true
          : ledger.claudeReference.insertedByPier,
      present: commit.lastOutcome === "written",
    };
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
