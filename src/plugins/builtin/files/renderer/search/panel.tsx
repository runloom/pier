/**
 * Project content search panel (Cmd+Shift+F).
 * Design: docs/superpowers/specs/2026-07-27-files-content-search-design.md
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { FileContentQueryItem } from "@shared/contracts/file/query.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
} from "../../settings.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFilesTranslate } from "../i18n.ts";
import { filePanelProjectRoot } from "../tree/preferences.ts";
import { SearchPanelBody } from "./body.tsx";
import {
  contentSearchStatusText,
  FilesContentSearchChrome,
} from "./chrome.tsx";
import {
  type ContentQuerySnapshot,
  createFilesContentQueryClient,
} from "./client.ts";
import { popupSearchResultContextMenu } from "./context-actions.ts";
import { openContentSearchHit } from "./open.ts";
import {
  conditionsFromPanelParams,
  conditionsToPanelParams,
  DEFAULT_CONTENT_SEARCH_CONDITIONS,
  type FilesContentSearchConditions,
  parseContentSearchPanelParams,
} from "./params.ts";
import { groupHitsByPath } from "./result-row.tsx";

function readExcludePatterns(context: RendererPluginContext): string {
  const raw = context.configuration.get<string>(
    FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY
  );
  return typeof raw === "string" && raw.length > 0
    ? raw
    : FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
}

function panelContextFromParams(params: unknown): PanelContext | null {
  if (!(params && typeof params === "object" && "context" in params)) {
    return null;
  }
  const value = (params as { context?: unknown }).context;
  if (!(value && typeof value === "object")) {
    return null;
  }
  return value as PanelContext;
}

export function createFilesContentSearchPanel(
  context: RendererPluginContext,
  controller: FileEditorController
) {
  return function FilesContentSearchPanel(
    props: IDockviewPanelProps
  ): React.JSX.Element {
    const t = createFilesTranslate(context);
    const fallbackRoot = filePanelProjectRoot(
      panelContextFromParams(props.params) ?? context.panels.getActiveContext()
    );
    const [seeded] = useState(() =>
      conditionsFromPanelParams(props.params, fallbackRoot)
    );
    const appliedGenerationRef = useRef<number | null>(
      typeof parseContentSearchPanelParams(props.params).openGeneration ===
        "number"
        ? (parseContentSearchPanelParams(props.params).openGeneration ?? null)
        : null
    );

    const [conditions, setConditions] = useState<FilesContentSearchConditions>(
      () =>
        seeded ?? {
          ...DEFAULT_CONTENT_SEARCH_CONDITIONS,
          root: fallbackRoot ?? "",
          scopeDir: undefined,
        }
    );
    const [snapshot, setSnapshot] = useState<ContentQuerySnapshot>({
      items: [],
      status: "idle",
      truncated: false,
    });
    const [activeIndex, setActiveIndex] = useState(0);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const cancelRef = useRef<(() => void) | null>(null);
    const clientRef = useRef(createFilesContentQueryClient(context.files));
    const lastParamsJson = useRef<string>("");
    const contextRef = useRef(context);
    const controllerRef = useRef(controller);
    contextRef.current = context;
    controllerRef.current = controller;
    const owner = useMemo(
      () => `content-search:${props.api.id}`,
      [props.api.id]
    );

    // Re-apply conditions when host openInstance bumps openGeneration
    // (Find in Folder / re-open while panel is already live).
    useEffect(() => {
      const parsed = parseContentSearchPanelParams(props.params);
      const gen = parsed.openGeneration;
      if (typeof gen !== "number") {
        return;
      }
      if (appliedGenerationRef.current === gen) {
        return;
      }
      const next = conditionsFromPanelParams(props.params, fallbackRoot);
      if (!next) {
        return;
      }
      appliedGenerationRef.current = gen;
      lastParamsJson.current = JSON.stringify(conditionsToPanelParams(next));
      setConditions(next);
      setActiveIndex(0);
    }, [fallbackRoot, props.params]);

    // Persist query conditions only (never result sets).
    useEffect(() => {
      if (!conditions.root) {
        return;
      }
      const next = conditionsToPanelParams(conditions);
      const json = JSON.stringify(next);
      if (json === lastParamsJson.current) {
        return;
      }
      lastParamsJson.current = json;
      const existing =
        typeof props.params === "object" && props.params
          ? (props.params as Record<string, unknown>)
          : {};
      props.api.updateParameters({
        ...existing,
        ...next,
        ...(typeof appliedGenerationRef.current === "number"
          ? { openGeneration: appliedGenerationRef.current }
          : {}),
      });
    }, [conditions, props.api, props.params]);

    useEffect(() => {
      cancelRef.current?.();
      cancelRef.current = null;
      if (!conditions.root) {
        setSnapshot({ items: [], status: "idle", truncated: false });
        return;
      }
      cancelRef.current = clientRef.current.search({
        conditions,
        excludePatterns: readExcludePatterns(contextRef.current),
        onUpdate: setSnapshot,
        owner,
      });
      return () => {
        cancelRef.current?.();
        cancelRef.current = null;
      };
    }, [conditions, owner]);

    useEffect(() => {
      if (activeIndex >= snapshot.items.length) {
        setActiveIndex(0);
      }
    }, [activeIndex, snapshot.items.length]);

    const groups = useMemo(
      () => groupHitsByPath(snapshot.items),
      [snapshot.items]
    );

    const openHit = useCallback(
      (hit: FileContentQueryItem) => {
        if (!conditions.root) {
          return;
        }
        const pluginContext = contextRef.current;
        openContentSearchHit({
          context: pluginContext,
          controller: controllerRef.current,
          hit,
          panelContext:
            panelContextFromParams(props.params) ??
            pluginContext.panels.getActiveContext(),
          root: conditions.root,
        });
      },
      [conditions.root, props.params]
    );

    const onResultContextMenu = useCallback(
      (event: ReactMouseEvent, hit: FileContentQueryItem) => {
        if (!conditions.root) {
          return;
        }
        const pluginContext = contextRef.current;
        const panelContext =
          panelContextFromParams(props.params) ??
          pluginContext.panels.getActiveContext();
        popupSearchResultContextMenu(pluginContext, {
          hit,
          panelContext,
          point: { x: event.clientX, y: event.clientY },
          root: conditions.root,
          ...(panelContext?.projectRootPath
            ? { projectRoot: panelContext.projectRootPath }
            : {}),
          ...(typeof props.api.group?.id === "string"
            ? { sourcePanelGroupId: props.api.group.id }
            : {}),
          sourcePanelId: props.api.id,
        }).catch((error: unknown) => {
          pluginContext.dialogs
            .alert({
              body: error instanceof Error ? error.message : String(error),
              title: t(
                "filePanel.contentSearch.contextMenuFailed",
                "Unable to open menu"
              ),
            })
            .catch(() => undefined);
        });
      },
      [conditions.root, props.api, props.params, t]
    );

    const patchConditions = useCallback(
      (patch: Partial<FilesContentSearchConditions>) => {
        setConditions((prev) => ({ ...prev, ...patch }));
        setActiveIndex(0);
      },
      []
    );

    const stopSearch = useCallback(() => {
      cancelRef.current?.();
      cancelRef.current = null;
      setSnapshot((prev) =>
        prev.status === "loading"
          ? {
              ...prev,
              status: "done",
              // User stop is not a max-results truncation.
              truncated: false,
            }
          : prev
      );
    }, []);

    const statusText = contentSearchStatusText({ conditions, snapshot, t });

    return (
      <div
        className="flex h-full min-h-0 flex-col bg-background"
        data-testid="files-content-search-panel"
      >
        <FilesContentSearchChrome
          activeIndex={activeIndex}
          conditions={conditions}
          onOpenHit={openHit}
          onPatchConditions={patchConditions}
          onSetActiveIndex={setActiveIndex}
          onStopSearch={stopSearch}
          optionsOpen={optionsOpen}
          setOptionsOpen={setOptionsOpen}
          snapshot={snapshot}
          statusText={statusText}
          t={t}
        />
        <div className="min-h-0 flex-1">
          <SearchPanelBody
            activeIndex={activeIndex}
            conditions={conditions}
            groups={groups}
            onContextMenu={onResultContextMenu}
            onOpenHit={openHit}
            onSetActiveIndex={setActiveIndex}
            snapshot={snapshot}
            t={t}
          />
        </div>
      </div>
    );
  };
}
