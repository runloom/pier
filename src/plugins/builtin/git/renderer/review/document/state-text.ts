import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewFileSection } from "@shared/contracts/git/review.ts";
import { pluginText } from "../../plugin-text.ts";

type ReviewStateSection = Extract<GitReviewFileSection, { kind: "state" }>;
type ReviewConflictSection = Extract<
  GitReviewFileSection,
  { kind: "conflict" }
>;

const STATE_SECTION_TEXT = {
  binary: { fallback: "Binary file", key: "reviewStateBinary" },
  conflict: { fallback: "Merge conflict", key: "reviewStateConflict" },
  invalidEncoding: {
    fallback: "Unsupported text encoding",
    key: "reviewStateInvalidEncoding",
  },
  readError: {
    fallback: "File could not be read",
    key: "reviewStateReadError",
  },
  submodule: { fallback: "Submodule change", key: "reviewStateSubmodule" },
  symlink: { fallback: "Symbolic link", key: "reviewStateSymlink" },
  tooLarge: { fallback: "File is too large", key: "reviewStateTooLarge" },
} as const satisfies Record<
  ReviewStateSection["reason"],
  { readonly fallback: string; readonly key: string }
>;

/** Localized conflict body copy for section notices / file-level cards. */
export function conflictSectionText(
  context: RendererPluginContext,
  section: ReviewConflictSection,
  locale: string
): string {
  switch (section.presentation) {
    case "markers-text":
      return pluginText(
        context,
        "reviewStateConflictMarkersDetail",
        "Merge conflict — accept current, incoming, or both below. When all regions are accepted, Pier saves and stages the file.",
        undefined,
        locale
      );
    case "file-level":
      return pluginText(
        context,
        "reviewStateConflictFileLevelDetail",
        "Merge conflict without markers — keep one side or open the file.",
        undefined,
        locale
      );
    case "binary":
      return pluginText(
        context,
        "reviewStateConflictBinaryDetail",
        "Binary merge conflict — keep one side or open the file.",
        undefined,
        locale
      );
    case "tooLarge":
      return pluginText(
        context,
        "reviewStateConflictTooLargeDetail",
        "Conflict file is too large to preview — open the file or keep one side.",
        undefined,
        locale
      );
    case "invalidEncoding":
      return pluginText(
        context,
        "reviewStateConflictInvalidEncodingDetail",
        "Conflict file has unsupported encoding — open the file or keep one side.",
        undefined,
        locale
      );
    case "readError":
      return pluginText(
        context,
        "reviewStateConflictReadErrorDetail",
        "Conflict file could not be read — open the file to resolve.",
        undefined,
        locale
      );
    default: {
      const exhaustive: never = section.presentation;
      return exhaustive;
    }
  }
}

export function stateSectionText(
  context: RendererPluginContext,
  section: ReviewStateSection,
  locale: string
): string {
  if (section.reason === "binary") {
    return binaryStateNotice(context, section.targetPath, locale);
  }
  if (section.reason === "symlink") {
    if (section.oldPath) {
      return pluginText(
        context,
        "reviewStateSymlinkRename",
        "Symbolic link · {{from}} → {{to}}",
        { from: section.oldPath, to: section.targetPath },
        locale
      );
    }
    return pluginText(
      context,
      "reviewStateSymlink",
      "Symbolic link",
      undefined,
      locale
    );
  }
  if (section.reason === "submodule") {
    return pluginText(
      context,
      "reviewStateSubmoduleDetail",
      "Submodule commit changed",
      undefined,
      locale
    );
  }
  if (section.reason === "tooLarge") {
    return pluginText(
      context,
      "reviewStateTooLargeDetail",
      "File is too large to display a text diff",
      undefined,
      locale
    );
  }
  if (section.reason === "invalidEncoding") {
    return pluginText(
      context,
      "reviewStateInvalidEncodingDetail",
      "Unsupported text encoding — open the file to inspect",
      undefined,
      locale
    );
  }
  if (section.reason === "conflict") {
    return pluginText(
      context,
      "reviewStateConflictDetail",
      "Merge conflict — resolve in the editor",
      undefined,
      locale
    );
  }
  const text = STATE_SECTION_TEXT[section.reason];
  return pluginText(context, text.key, text.fallback, undefined, locale);
}

/** Extension → industry-style binary kind label (font/image/audio/…). */
function binaryStateNotice(
  context: RendererPluginContext,
  path: string,
  locale: string
): string {
  const kind = binaryKindFromPath(path);
  if (!kind) {
    return pluginText(
      context,
      "reviewStateBinaryDetail",
      "Binary file — content not shown",
      undefined,
      locale
    );
  }
  return pluginText(
    context,
    "reviewStateBinaryKind",
    "Binary {{kind}} — content not shown",
    { kind: pluginText(context, kind.key, kind.fallback, undefined, locale) },
    locale
  );
}

function binaryKindFromPath(
  path: string
): { readonly fallback: string; readonly key: string } | null {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  const ext = base.slice(dot + 1);
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "ico",
      "tif",
      "tiff",
      "avif",
      "heic",
      "svg",
    ].includes(ext)
  ) {
    return { fallback: "image", key: "reviewBinaryKindImage" };
  }
  if (["woff", "woff2", "ttf", "otf", "eot", "ttc"].includes(ext)) {
    return { fallback: "font", key: "reviewBinaryKindFont" };
  }
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus"].includes(ext)) {
    return { fallback: "audio", key: "reviewBinaryKindAudio" };
  }
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) {
    return { fallback: "video", key: "reviewBinaryKindVideo" };
  }
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    return { fallback: "document", key: "reviewBinaryKindDocument" };
  }
  if (["zip", "gz", "tgz", "bz2", "7z", "rar", "xz"].includes(ext)) {
    return { fallback: "archive", key: "reviewBinaryKindArchive" };
  }
  if (
    [
      "wasm",
      "so",
      "dylib",
      "dll",
      "exe",
      "bin",
      "o",
      "a",
      "class",
      "pyc",
    ].includes(ext)
  ) {
    return { fallback: "binary", key: "reviewBinaryKindNative" };
  }
  return null;
}
