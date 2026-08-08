import type { FileDocumentWriteResult } from "@shared/contracts/file.ts";
import { LIVE_MODULES_PROJECT_CONFIG_PATH } from "@shared/contracts/live-modules.ts";
import {
  normalizeProjectRelativePath,
  normalizeProjectRootKey,
} from "@shared/live-module-canvas-path.ts";
import {
  applyLiveModulesProjectConfigFromDiskContents,
  ensureLiveModulesProjectConfigLoaded,
} from "@/lib/live-modules/project-config-cache.ts";
import { languageForPath } from "../editor/language-detection.ts";
import type { FilesDocument } from "./types.ts";

/**
 * After a successful write, if the path is project live-modules config, refresh
 * runtime content roots so open canvas panels pick up agent/hand edits.
 */
export function syncLiveModulesConfigAfterDocumentWrite(input: {
  document: FilesDocument | null | undefined;
  savedContents: string;
}): void {
  const document = input.document;
  if (
    document?.source.kind !== "disk" ||
    normalizeProjectRelativePath(document.source.path) !==
      LIVE_MODULES_PROJECT_CONFIG_PATH
  ) {
    return;
  }
  applyLiveModulesProjectConfigFromDiskContents(
    document.source.root,
    input.savedContents
  );
}

/** Recompute `language` for open disk docs after contentDirectories change. */
export function refreshDiskDocumentLanguagesForProject(input: {
  projectRootPath: string;
  documents: Iterable<[string, FilesDocument]>;
  replaceDocument: (
    documentId: string,
    update: (document: FilesDocument) => FilesDocument
  ) => void;
}): void {
  const key = normalizeProjectRootKey(input.projectRootPath);
  for (const [id, document] of input.documents) {
    if (document.source.kind !== "disk") {
      continue;
    }
    if (normalizeProjectRootKey(document.source.root) !== key) {
      continue;
    }
    const language = languageForPath(
      document.source.path,
      document.source.root
    );
    if (language === document.language) {
      continue;
    }
    input.replaceDocument(id, (current) => ({ ...current, language }));
  }
}

/** Fire-and-forget: load project config then restamp languages for that root. */
export function scheduleLiveModulesLanguageRefresh(input: {
  projectRootPath: string;
  refresh: (projectRootPath: string) => void;
}): void {
  ensureLiveModulesProjectConfigLoaded(input.projectRootPath)
    .then(() => {
      input.refresh(input.projectRootPath);
    })
    .catch(() => undefined);
}

/** Narrow type for markDocumentWritten result payloads. */
export type WrittenDocumentResult = Extract<
  FileDocumentWriteResult,
  { kind: "written" }
>;
