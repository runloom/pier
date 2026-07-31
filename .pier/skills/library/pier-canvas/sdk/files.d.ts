export interface CanvasFileReadResult {
  contents: string;
  /** Opaque revision to pass back to `write`. */
  revision: string;
}

export type CanvasFileWriteOutcome =
  | { kind: "written"; revision: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

export interface CanvasFileApi {
  /** False when the Canvas has no file scope. */
  available: boolean;
  /** Project-relative directory containing the Canvas. */
  directory: string;
  read(fileName: string): Promise<CanvasFileReadResult>;
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

export const useCanvasFile: () => CanvasFileApi;
