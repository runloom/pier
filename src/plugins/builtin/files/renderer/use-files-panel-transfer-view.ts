import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import {
  peekFilesPanelViewSeed,
  rememberFilesPanelViewMode,
} from "./files-panel-transfer-state.ts";

export function useFilesPanelTransferView(input: {
  controller: FileEditorController;
  panelSessionId: string;
  stableSource: FilesDocumentPanelSource | null;
}): {
  mode: FileViewMode;
  setMode: (mode: FileViewMode) => void;
} {
  const [mode, setMode] = useState<FileViewMode>("source");
  const appliedTransferSeedRef = useRef(false);

  useLayoutEffect(() => {
    if (appliedTransferSeedRef.current) {
      return;
    }
    const seed = peekFilesPanelViewSeed({
      panelId: input.panelSessionId,
      ...(input.stableSource
        ? { documentId: input.controller.documentId(input.stableSource) }
        : {}),
    });
    if (!seed) {
      return;
    }
    appliedTransferSeedRef.current = true;
    setMode(seed.mode);
  }, [input.controller, input.panelSessionId, input.stableSource]);

  useEffect(() => {
    rememberFilesPanelViewMode(input.panelSessionId, mode);
  }, [input.panelSessionId, mode]);

  return { mode, setMode };
}
