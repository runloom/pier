export interface CanvasFileReadResult {
  contents: string;
  /** Opaque revision to pass back to `write`. */
  revision: string;
}

export type CanvasFileWriteOutcome =
  | { kind: "written"; revision: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

export interface CanvasFileWatchEvent {
  kind: "changed" | "created" | "deleted";
  path: string;
}

export type CanvasFileCommandOutcome =
  | { kind: "started"; runId: string }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export interface CanvasFileApi {
  /** False when the canvas has no sibling-file scope. */
  available: boolean;
  /** Project-relative directory containing the canvas. */
  directory: string;
  /**
   * Run a command declared in this canvas folder’s `instance.json`.
   * First run (or after the command string changes) asks for confirmation.
   */
  invokeCommand(key: string): Promise<CanvasFileCommandOutcome>;
  /** Read a sibling text file, or one nested folder (`state/data.json`). */
  read(fileName: string): Promise<CanvasFileReadResult>;
  /**
   * Listen for changes to a sibling file. Call the returned function to stop
   * (including when the canvas unmounts).
   */
  watch(
    fileName: string,
    listener: (event: CanvasFileWatchEvent) => void
  ): () => void;
  /**
   * Write a sibling text file. Pass `null` only when the file must not exist;
   * otherwise pass the revision returned by `read`.
   */
  write(
    fileName: string,
    contents: string,
    expectedRevision: string | null
  ): Promise<CanvasFileWriteOutcome>;
}

/** Read and write files next to this canvas. Not a general file API. */
export const useCanvasFile: () => CanvasFileApi;
