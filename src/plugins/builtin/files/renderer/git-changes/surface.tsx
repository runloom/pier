import { Popover, PopoverAnchor, PopoverContent } from "@pier/ui/popover.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getDocument } from "../document/store.ts";
import type { FileViewMode } from "../document/types.ts";
import { filesEditorEndInset } from "../editor/layout.ts";
import type { FilesTranslate } from "../i18n.ts";
import { FileChangeSurfaceContext } from "./context.ts";
import { focusAfterClosingDialog } from "./focus.ts";
import { revealMarkdownChange } from "./markdown-reveal.ts";
import { FileChangePeekContent } from "./peek-content.tsx";
import {
  type FileChangeRequest,
  getFileChangeEditor,
  registerFileChangeRequests,
} from "./requests.ts";
import { SourceGutterTooltip } from "./source-tooltip.tsx";
import { mountFileChangePeek } from "./source-widget.ts";
import { useFileChanges } from "./use-resource.ts";

interface OpenPeek {
  index: number | null;
  keyboard: boolean;
  line: number;
  pendingKind?: "current" | "next" | "previous";
  version: number;
}
export function FileChangesSurface({
  context,
  documentId,
  editorSessionId,
  mode,
  panelContext,
  t,
  children,
}: {
  context: RendererPluginContext | undefined;
  documentId: string;
  editorSessionId: string;
  mode: FileViewMode;
  panelContext: PanelContext | undefined;
  t: FilesTranslate;
  children: ReactNode;
}) {
  const { resource, snapshot } = useFileChanges(context, documentId);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const originFocus = useRef<HTMLElement | null>(null);
  const focusHandoff = useRef(false);
  const [open, setOpen] = useState<OpenPeek | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 640, height: 600 });
  const active =
    open &&
    (open.index === null || open.version === snapshot.version) &&
    mode !== "diff"
      ? open
      : null;
  const close = useCallback(
    (restore = false) => {
      setOpen(null);
      if (restore) {
        const editor = getFileChangeEditor(editorSessionId);
        if (mode === "source" && editor) editor.focus();
        else {
          const origin = originFocus.current?.isConnected
            ? originFocus.current
            : document.querySelector<HTMLElement>(
                `[data-file-changes-trigger="${CSS.escape(editorSessionId)}"]`
              );
          origin?.focus({ preventScroll: true });
        }
      }
    },
    [editorSessionId, mode]
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      );
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting === false) close();
          });
    visibility?.observe(root);
    return () => {
      resize.disconnect();
      visibility?.disconnect();
    };
  }, [close]);
  // A visible excerpt is an immutable snapshot; updates close it before repaint.
  useEffect(() => {
    setOpen((current) =>
      current?.index !== null && current?.version !== snapshot.version
        ? null
        : current
    );
  }, [snapshot.version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity/mode changes invalidate the panel-local peek.
  useEffect(() => {
    close();
  }, [close, documentId, mode]);

  const select = useCallback(
    (request: FileChangeRequest) => {
      if (request.kind === "close") {
        close();
        return;
      }
      if (mode === "diff") return;
      const keyboard = request.keyboard === true;
      const editor = getFileChangeEditor(editorSessionId);
      const root = rootRef.current;
      let line =
        mode === "source" && editor
          ? editor.state.doc.lineAt(editor.state.selection.main.head).number
          : 1;
      if (mode === "preview" && root) {
        const bounds = root.getBoundingClientRect();
        const visible = [
          ...root.querySelectorAll<HTMLElement>("[data-git-change-id]"),
        ].find(
          (node) =>
            node.getBoundingClientRect().bottom >= bounds.top &&
            node.getBoundingClientRect().top < bounds.bottom
        );
        const range = snapshot.ranges.find(
          (item) => item.id === visible?.dataset.gitChangeId
        );
        if (range) line = range.newLineFrom;
      }
      if (request.kind === "line") line = request.line;
      if (!open)
        originFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      setOpen((current) => {
        if (snapshot.status !== "ready")
          return {
            index: null,
            version: snapshot.version,
            keyboard,
            line,
            pendingKind:
              request.kind === "next" || request.kind === "previous"
                ? request.kind
                : "current",
          };
        let index = snapshot.ranges.findIndex(
          (range) => range.newLineTo >= line
        );
        if (index < 0) index = snapshot.ranges.length - 1;
        if (request.kind === "range")
          index = snapshot.ranges.findIndex((range) => range.id === request.id);
        if (request.kind === "next")
          index =
            current?.index == null
              ? snapshot.ranges.findIndex((range) => range.newLineFrom > line)
              : current.index + 1;
        if (request.kind === "previous")
          index =
            current?.index == null
              ? snapshot.ranges.findLastIndex((range) => range.newLineTo < line)
              : current.index - 1;
        if (index < 0 || index >= snapshot.ranges.length) return current;
        if (
          (request.kind === "range" || request.kind === "line") &&
          current?.index === index
        )
          return null;
        return {
          index,
          version: snapshot.version,
          keyboard,
          line:
            request.kind === "line"
              ? line
              : (snapshot.ranges[index]?.newLineFrom ?? 1),
        };
      });
    },
    [close, editorSessionId, mode, snapshot, open]
  );
  useEffect(
    () => registerFileChangeRequests(editorSessionId, select),
    [editorSessionId, select]
  );
  useEffect(() => {
    if (
      open?.index === null &&
      snapshot.status === "ready" &&
      snapshot.ranges.length
    ) {
      setOpen((current) => {
        if (!current) return null;
        let index = snapshot.ranges.findIndex(
          (range) => range.newLineTo >= current.line
        );
        if (index < 0) index = snapshot.ranges.length - 1;
        if (current.pendingKind === "next")
          index = snapshot.ranges.findIndex(
            (range) => range.newLineFrom > current.line
          );
        if (current.pendingKind === "previous")
          index = snapshot.ranges.findLastIndex(
            (range) => range.newLineTo < current.line
          );
        if (index < 0) return null;
        return {
          ...current,
          index,
          version: snapshot.version,
          line: snapshot.ranges[index]?.newLineFrom ?? 1,
        };
      });
    }
  }, [open?.index, snapshot]);

  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      const inside = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.matches(
              "[data-slot='file-change-peek'], [data-file-changes-trigger], [data-git-change-id], .cm-git-gutter"
            )
        );
      if (!inside) close();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", handleEscape, true);
    const dialogs = new MutationObserver(() => {
      if (
        document.querySelector(
          "[data-slot='dialog-content']:not([data-state='closed']), [role='alertdialog']:not([data-state='closed'])"
        )
      )
        close();
    });
    dialogs.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", handleEscape, true);
      dialogs.disconnect();
    };
  }, [active, close]);

  useLayoutEffect(() => {
    if (!(active && mode === "source")) {
      setPortal(null);
      return;
    }
    const view = getFileChangeEditor(editorSessionId);
    if (!view) return;
    const host = document.createElement("div");
    host.contentEditable = "false";
    host.className = "min-w-0 py-2";
    const unmount = mountFileChangePeek(view, active.line, host);
    setPortal(host);
    const frame = requestAnimationFrame(() => {
      const bounds = view.scrollDOM.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      if (box.bottom > bounds.bottom)
        view.scrollDOM.scrollTop += Math.min(
          box.bottom - bounds.bottom,
          Math.max(0, box.top - bounds.top)
        );
      if (active.keyboard)
        host
          .querySelector<HTMLElement>("button:not(:disabled)")
          ?.focus({ preventScroll: true });
      view.requestMeasure();
    });
    return () => {
      cancelAnimationFrame(frame);
      unmount();
    };
  }, [active, mode, editorSessionId]);

  const virtualAnchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const root = rootRef.current;
          const id =
            active?.index == null ? null : snapshot.ranges[active.index]?.id;
          const marker = id
            ? root?.querySelector<HTMLElement>(
                `[data-git-change-id="${CSS.escape(id)}"]`
              )
            : null;
          if (marker) return marker.getBoundingClientRect();
          const rect = root?.getBoundingClientRect();
          return new DOMRect(
            (rect?.left ?? 0) + 12,
            (rect?.top ?? 0) + 12,
            1,
            1
          );
        },
      },
    }),
    [active?.index, snapshot.ranges]
  );
  useEffect(() => {
    if (!(active && mode === "preview")) return;
    const root = rootRef.current;
    const range = active.index === null ? null : snapshot.ranges[active.index];
    if (root && range) return revealMarkdownChange(root, range, close);
  }, [active, mode, snapshot.ranges, close]);

  useEffect(() => {
    if (!(active?.keyboard && mode === "preview")) return;
    popupRef.current
      ?.querySelector<HTMLElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [active, mode]);

  useEffect(() => {
    if (!active?.keyboard) return;
    return focusAfterClosingDialog(
      () =>
        (mode === "source"
          ? portal
          : popupRef.current
        )?.querySelector<HTMLElement>("button:not(:disabled)") ?? null,
      (value) => {
        focusHandoff.current = value;
      }
    );
  }, [active?.keyboard, mode, portal]);

  const value = useMemo(
    () => ({
      snapshot,
      openRange: (id: string) => select({ kind: "range", id }),
    }),
    [snapshot, select]
  );
  const content =
    active && context && resource ? (
      <FileChangePeekContent
        context={context}
        framed={mode === "source"}
        height={Math.min(320, size.height * 0.45)}
        index={active.index}
        key={active.version}
        mode={
          mode === "preview" && getDocument(documentId)?.language === "markdown"
            ? "preview"
            : "source"
        }
        onClose={close}
        onMove={(kind) => select({ kind, keyboard: true })}
        panelContext={panelContext}
        resource={resource}
        snapshot={snapshot}
        t={t}
      />
    ) : null;
  return (
    <FileChangeSurfaceContext value={value}>
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        data-slot="file-changes-surface"
        ref={rootRef}
        style={
          {
            "--files-editor-end-inset": `${filesEditorEndInset(size.width)}px`,
          } as CSSProperties
        }
      >
        {children}
        <SourceGutterTooltip
          enabled={mode === "source" && !active && snapshot.status === "ready"}
          label={t("filePanel.changes.show", "View changes")}
          rootRef={rootRef}
        />
        {portal && mode === "source" ? createPortal(content, portal) : null}
        {active && mode === "preview" ? (
          <Popover
            modal={false}
            onOpenChange={(next) => {
              if (!next) close();
            }}
            open
          >
            <PopoverAnchor virtualRef={virtualAnchor} />
            <PopoverContent
              align="start"
              aria-label={t("filePanel.changes.preview", "Change preview")}
              className="gap-0 overflow-hidden rounded-md p-0"
              collisionBoundary={rootRef.current}
              collisionPadding={12}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onFocusOutside={(event) => {
                if (focusHandoff.current) event.preventDefault();
              }}
              onInteractOutside={(event) => {
                if (
                  (event.target as Element)?.closest?.(
                    "[data-git-change-id], [data-file-changes-trigger]"
                  )
                )
                  event.preventDefault();
              }}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                if (active.keyboard)
                  popupRef.current
                    ?.querySelector<HTMLElement>("button:not(:disabled)")
                    ?.focus();
              }}
              ref={popupRef}
              side="bottom"
              sideOffset={4}
              sticky="always"
              style={{
                width: Math.min(640, Math.max(1, size.width - 24)),
                maxHeight: Math.max(1, size.height - 24),
              }}
              updatePositionStrategy="always"
            >
              {content}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </FileChangeSurfaceContext>
  );
}
