import { isProjectCanvasPath } from "@shared/live-module-canvas-path.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import {
  readMarkdownOpenMode,
  writeMarkdownOpenMode,
} from "../markdown/preview-preferences.ts";
import {
  peekFilesPanelViewSeed,
  rememberFilesPanelViewMode,
  subscribeFilesPanelViewSeed,
  takeFilesPanelViewSeed,
} from "./transfer-state.ts";

function resolveDocumentId(
  controller: FileEditorController,
  source: FilesDocumentPanelSource | null
): string | undefined {
  return source ? controller.documentId(source) : undefined;
}

function sourceIdentityKey(source: FilesDocumentPanelSource | null): string {
  if (!source) {
    return "";
  }
  if (source.kind === "untitled") {
    return `untitled:${source.id}`;
  }
  return `disk:${source.root}\0${source.path}`;
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

function isCanvasSource(
  source: FilesDocumentPanelSource | null,
  language: string | null | undefined
): boolean {
  if (language === "canvas") {
    return true;
  }
  return source?.kind === "disk" && isProjectCanvasPath(source.path);
}

function defaultModeForSource(
  source: FilesDocumentPanelSource | null,
  language: string | null | undefined
): FileViewMode {
  if (source && language === "markdown") {
    return readMarkdownOpenMode();
  }
  // Canvas: default preview. Use path when language has not hydrated yet.
  if (isCanvasSource(source, language)) {
    return "preview";
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
  const sourceKey = sourceIdentityKey(stableSource);
  const [mode, setModeState] = useState<FileViewMode>(
    () =>
      resolveSeedMode({ controller, panelSessionId, stableSource }) ??
      defaultModeForSource(stableSource, language)
  );
  /** User/transfer explicitly chose a mode for the *current* source. */
  const pinnedModeForSourceRef = useRef(
    resolveSeedMode({ controller, panelSessionId, stableSource }) !== null
  );
  const lastSourceKeyRef = useRef(sourceKey);

  const applySeedMode = useCallback((next: FileViewMode) => {
    pinnedModeForSourceRef.current = true;
    setModeState((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    if (lastSourceKeyRef.current !== sourceKey) {
      lastSourceKeyRef.current = sourceKey;
      // New document: allow default mode (canvas → preview) unless transfer seed.
      pinnedModeForSourceRef.current = false;
    }

    // take（而非 peek）：panelId 种子只施加一次，避免 tab 切回时重复强加。
    const seeded = takeFilesPanelViewSeed({ panelId: panelSessionId });
    if (seeded) {
      applySeedMode(seeded.mode);
      return;
    }
    if (!pinnedModeForSourceRef.current) {
      const fallback = defaultModeForSource(stableSource, language);
      setModeState((current) => (current === fallback ? current : fallback));
    }
  }, [applySeedMode, language, panelSessionId, sourceKey, stableSource]);

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
        // 事件到达时消费 panelId 种子，避免 tab 切换时重复施加。
        const consumed = takeFilesPanelViewSeed({ panelId: panelSessionId });
        applySeedMode((consumed ?? event.view).mode);
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
      pinnedModeForSourceRef.current = true;
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
