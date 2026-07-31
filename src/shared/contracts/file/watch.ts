export type FileWatchChangeKind = "changed" | "created" | "deleted";

export interface FileWatchChange {
  kind: FileWatchChangeKind;
  /** root-relative posix path */
  path: string;
}

export interface FileWatchEvent {
  changes: readonly FileWatchChange[];
  root: string;
}
