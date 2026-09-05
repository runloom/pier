// Keep the native parser and its metadata at the shared Pierre integration boundary.
export {
  type FileDiffMetadata,
  type Hunk,
  parseDiffFromFile,
} from "@pierre/diffs";
