/** Store error classes, split from store.ts (file-size cap). */

export type LedgerCorruptCode = "ledger-corrupt" | "recovery-record-corrupt";

export class ProjectSkillsGenerationConflict extends Error {
  readonly code = "generation-conflict" as const;
  readonly expectedGeneration: number;
  readonly actualGeneration: number | null;

  constructor(args: {
    expectedGeneration: number;
    actualGeneration: number | null;
    ledger: "ownership";
  }) {
    super(
      `project-skills ${args.ledger} generation conflict: expected ${args.expectedGeneration}, actual ${args.actualGeneration ?? "absent"}`
    );
    this.name = "ProjectSkillsGenerationConflict";
    this.expectedGeneration = args.expectedGeneration;
    this.actualGeneration = args.actualGeneration;
  }
}

export class ProjectSkillsLedgerCorrupt extends Error {
  readonly code: LedgerCorruptCode;

  constructor(code: LedgerCorruptCode, message: string) {
    super(message);
    this.name = "ProjectSkillsLedgerCorrupt";
    this.code = code;
  }
}

export class ProjectSkillsOperationConflict extends Error {
  readonly code = "operation-conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "ProjectSkillsOperationConflict";
  }
}

export class ProjectSkillsStagingConflict extends Error {
  readonly code = "staging-conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "ProjectSkillsStagingConflict";
  }
}
