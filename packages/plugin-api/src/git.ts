/** Structural mirrors of the host HEAD-only baseline API. Requires git:read. */
export interface GitFileBaselineInput {
  path: string;
  root: string;
}

export type GitFileBaselineResult =
  | {
      status: "ready";
      gitRoot: string;
      path: string;
      basePath: string;
      headOid: string | null;
      /** UTF-8 text, normalized to LF with the encoding BOM removed. */
      contents: string;
      existsAtHead: boolean;
    }
  | {
      status: "unavailable";
      reason:
        | "not-repository"
        | "binary"
        | "too-large"
        | "unsupported-encoding"
        | "unsupported-file";
    }
  | { status: "error"; message: string };
