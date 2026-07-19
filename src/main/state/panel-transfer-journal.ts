import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  panelTransferOfferSchema,
  panelTransferPhaseSchema,
  panelTransferPlacementSchema,
  panelTransferSourceSnapshotSchema,
} from "@shared/contracts/panel-transfer.ts";
import { z } from "zod";
import type {
  PanelTransferJournalFile,
  PanelTransferJournalRecord,
} from "../services/panel-transfer/panel-transfer-types.ts";
import { pathExists, writeDurableJson } from "./durable-json-io.ts";

const callerSchema = z
  .object({
    navigationGeneration: z.number().int().nonnegative(),
    runtimeWindowId: z.string().min(1).max(256),
    webContentsId: z.number().int().nonnegative(),
    windowRecordId: z.string().min(1).max(256),
  })
  .strict();

const targetSchema = z
  .object({
    kind: z.enum(["internal", "managed"]),
    runtimeWindowId: z.string().min(1).max(256),
    windowRecordId: z.string().min(1).max(256),
  })
  .strict();

const movableOfferSchema = panelTransferOfferSchema.refine(
  (offer): offer is Extract<typeof offer, { capability: "movable" }> =>
    offer.capability === "movable",
  { message: "journal only stores movable offers" }
);

export const panelTransferJournalRecordSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    offer: movableOfferSchema,
    phase: panelTransferPhaseSchema,
    placement: panelTransferPlacementSchema.optional(),
    snapshot: panelTransferSourceSnapshotSchema.optional(),
    source: callerSchema,
    target: targetSchema.optional(),
    targetPanelId: z.string().min(1).max(256).optional(),
    transferId: z.uuid(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const panelTransferJournalFileSchema = z
  .object({
    transfers: z.array(panelTransferJournalRecordSchema),
    version: z.literal(1),
  })
  .strict();

export interface PanelTransferJournalParseFailure {
  error: unknown;
  kind: "parse-failed";
  path: string;
}

export type PanelTransferJournalLoadResult =
  | { file: PanelTransferJournalFile; kind: "ok" }
  | { kind: "missing"; file: PanelTransferJournalFile }
  | PanelTransferJournalParseFailure;

export function panelTransferJournalPath(userDataDir: string): string {
  return join(userDataDir, "panel-transfers.json");
}

export function emptyPanelTransferJournal(): PanelTransferJournalFile {
  return { transfers: [], version: 1 };
}

export async function loadPanelTransferJournal(
  filePath: string
): Promise<PanelTransferJournalLoadResult> {
  if (!(await pathExists(filePath))) {
    return { file: emptyPanelTransferJournal(), kind: "missing" };
  }
  let rawText: string;
  try {
    rawText = await readFile(filePath, "utf8");
  } catch (error) {
    return { error, kind: "parse-failed", path: filePath };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText) as unknown;
  } catch (error) {
    return { error, kind: "parse-failed", path: filePath };
  }
  const parsed = panelTransferJournalFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error, kind: "parse-failed", path: filePath };
  }
  return { file: parsed.data, kind: "ok" };
}

export async function writePanelTransferJournal(
  filePath: string,
  file: PanelTransferJournalFile
): Promise<void> {
  const parsed = panelTransferJournalFileSchema.parse(file);
  await writeDurableJson(filePath, parsed);
}

export class PanelTransferJournal {
  readonly #filePath: string;
  #file: PanelTransferJournalFile = emptyPanelTransferJournal();
  #initPromise: Promise<void> | null = null;
  #parseFailure: PanelTransferJournalParseFailure | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.#filePath = panelTransferJournalPath(userDataDir);
  }

  get filePath(): string {
    return this.#filePath;
  }

  get parseFailure(): PanelTransferJournalParseFailure | null {
    return this.#parseFailure;
  }

  init(): Promise<void> {
    if (!this.#initPromise) {
      this.#initPromise = this.#load();
    }
    return this.#initPromise;
  }

  list(): readonly PanelTransferJournalRecord[] {
    return this.#file.transfers;
  }

  get(transferId: string): PanelTransferJournalRecord | null {
    return (
      this.#file.transfers.find((entry) => entry.transferId === transferId) ??
      null
    );
  }

  async upsert(record: PanelTransferJournalRecord): Promise<void> {
    await this.init();
    if (this.#parseFailure) {
      throw new Error(
        `panel transfer journal unreadable at ${this.#parseFailure.path}`
      );
    }
    const parsed = panelTransferJournalRecordSchema.parse(record);
    const index = this.#file.transfers.findIndex(
      (entry) => entry.transferId === parsed.transferId
    );
    if (index >= 0) {
      this.#file.transfers[index] = parsed;
    } else {
      this.#file.transfers.push(parsed);
    }
    await this.#enqueueWrite();
  }

  async remove(transferId: string): Promise<void> {
    await this.init();
    if (this.#parseFailure) {
      throw new Error(
        `panel transfer journal unreadable at ${this.#parseFailure.path}`
      );
    }
    const next = this.#file.transfers.filter(
      (entry) => entry.transferId !== transferId
    );
    if (next.length === this.#file.transfers.length) {
      return;
    }
    this.#file = { transfers: next, version: 1 };
    await this.#enqueueWrite();
  }

  async flush(): Promise<void> {
    await this.init();
    await this.#writeQueue;
  }

  async #load(): Promise<void> {
    const loaded = await loadPanelTransferJournal(this.#filePath);
    if (loaded.kind === "parse-failed") {
      this.#parseFailure = loaded;
      // Do not wipe corrupt journal.
      this.#file = emptyPanelTransferJournal();
      return;
    }
    this.#parseFailure = null;
    this.#file = {
      transfers: [...loaded.file.transfers],
      version: 1,
    };
  }

  #enqueueWrite(): Promise<void> {
    const snapshot: PanelTransferJournalFile = {
      transfers: this.#file.transfers.map((entry) => ({ ...entry })),
      version: 1,
    };
    this.#writeQueue = this.#writeQueue
      .then(() => writePanelTransferJournal(this.#filePath, snapshot))
      .catch((error: unknown) => {
        console.error("[panel-transfer-journal] write failed:", error);
        throw error;
      });
    return this.#writeQueue;
  }
}
