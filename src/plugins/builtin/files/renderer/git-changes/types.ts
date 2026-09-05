import type { FileDiffMetadata } from "@pier/ui/diff-view/file-diff/from-contents.ts";
import type {
  GitGutterChangeRange,
  GitGutterModel,
} from "../editor/git-markers.ts";

export interface FileChangeRange extends GitGutterChangeRange {
  readonly excerpt: FileDiffMetadata;
  readonly newLineCount: number;
  readonly oldLineCount: number;
  readonly oldLineFrom: number;
}
export interface FileChanges extends GitGutterModel {
  readonly ranges: readonly FileChangeRange[];
}
export interface CompareRequest {
  readonly after: string;
  readonly before: string;
  readonly path: string;
  readonly version: number;
}
export interface FileChangesSnapshot extends FileChanges {
  readonly baseline: string;
  readonly contents: string;
  readonly dirty: boolean;
  readonly gitRoot?: string;
  readonly headOid: string | null;
  readonly message?: string;
  readonly path?: string;
  readonly status:
    | "loading"
    | "ready"
    | "updating"
    | "on-demand"
    | "unavailable"
    | "error";
  readonly version: number;
}
export const EMPTY_FILE_CHANGES: FileChanges = {
  markers: new Map(),
  ranges: [],
};
