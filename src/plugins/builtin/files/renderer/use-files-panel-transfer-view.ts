import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import {
  peekFilesPanelViewSeed,
  rememberFilesPanelViewMode,
  subscribeFilesPanelViewSeed,
} from "./files-panel-transfer-state.ts";
import {
  readMarkdownOpenMode,
  writeMarkdownOpenMode,
} from "./markdown-preview-preferences.ts";

function resolveDocumentId(
  controller: FileEditorController,
  source: FilesDocumentPanelSource | null
): string | undefined {
  return source ? controller.documentId(source) : undefined;
}

function resolveSeedMode(input: {
  controller: FileEditorController;
  panelSessionId: string;
  stableSource: FilesDocumentPanelSource | null;
}): FileViewMode | null {
  const documentId = resolveDocumentId(input.controller, input.stableSource);
  const seed = peekFilesPanelViewSeed({
    panelId: input.panelSessionId,
    ...(documentId ? { documentId } : {}),
  });
  return seed?.mode ?? null;
}

function defaultModeForSource(
  source: FilesDocumentPanelSource | null,
  language: string | null | undefined
): FileViewMode {
  if (source && language === "markdown") {
    return readMarkdownOpenMode();
  }
  return "source";
}

export function useFilesPanelTransferView(input: {
  controller: FileEditorController;
  language?: string | null | undefined;
  panelSessionId: string;
  stableSource: FilesDocumentPanelSource | null;
}): {
  mode: FileViewMode;
  setMode: (mode: FileViewMode) => void;
} {
  const { controller, language, panelSessionId, stableSource } = input;
  const [mode, setModeState] = useState<FileViewMode>(
    () =>
      resolveSeedMode({ controller, panelSessionId, stableSource }) ??
      defaultModeForSource(stableSource, language)
  );
  const appliedTransferSeedRef = useRef(
    resolveSeedMode({ controller, panelSessionId, stableSource }) !== null
  );

  const applySeedMode = useCallback((next: FileViewMode) => {
    appliedTransferSeedRef.current = true;
    setModeState((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    const seeded = resolveSeedMode({
      controller,
      panelSessionId,
      stableSource,
    });
    if (seeded) {
      applySeedMode(seeded);
      return;
    }
    if (!appliedTransferSeedRef.current) {
      const fallback = defaultModeForSource(stableSource, language);
      setModeState((current) => (current === fallback ? current : fallback));
    }
  }, [applySeedMode, controller, language, panelSessionId, stableSource]);

  useEffect(
    () =>
      subscribeFilesPanelViewSeed((event) => {
        const documentId = resolveDocumentId(controller, stableSource);
        const matchesPanel = event.panelId === panelSessionId;
        const matchesDocument =
          documentId !== undefined && event.documentId === documentId;
        if (!(matchesPanel || matchesDocument)) {
          return;
        }
        applySeedMode(event.view.mode);
      }),
    [applySeedMode, controller, panelSessionId, stableSource]
  );

  useEffect(() => {
    const documentId = resolveDocumentId(controller, stableSource);
    const seed = peekFilesPanelViewSeed({
      panelId: panelSessionId,
      ...(documentId ? { documentId } : {}),
    });
    if (seed && seed.mode !== mode) {
      return;
    }
    rememberFilesPanelViewMode(panelSessionId, mode);
  }, [controller, mode, panelSessionId, stableSource]);

  const setMode = useCallback(
    (next: FileViewMode) => {
      appliedTransferSeedRef.current = true;
      setModeState(next);
      rememberFilesPanelViewMode(panelSessionId, next);
      if (
        language === "markdown" &&
        (next === "preview" || next === "source")
      ) {
        writeMarkdownOpenMode(next);
      }
    },
    [language, panelSessionId]
  );

  return { mode, setMode };
}
