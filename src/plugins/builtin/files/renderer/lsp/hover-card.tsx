import type { EditorView, Tooltip } from "@codemirror/view";
import { cn } from "@pier/ui/utils.ts";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { a11yTitle, HoverBody } from "./hover-card-parts.tsx";
import type {
  FilesLspHoverCardModel,
  FilesLspPreparedDefinition,
} from "./hover-types.ts";

export interface FilesLspHoverCardProps {
  focusOnMount?: boolean;
  model: FilesLspHoverCardModel;
  onActivateDefinition(target: FilesLspPreparedDefinition): void;
  onDismiss(): void;
  onMakeSticky(): void;
  onRequestPreview?(target: FilesLspPreparedDefinition): void;
}

export interface MountedFilesLspHoverCard {
  destroy(): void;
  update(props: FilesLspHoverCardProps): void;
}

export function FilesLspHoverCard({
  focusOnMount,
  model,
  onActivateDefinition,
  onDismiss,
  onMakeSticky,
  onRequestPreview,
}: FilesLspHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const focusOnInitialMount = useRef(focusOnMount ?? model.mode === "symbol");
  const titleId = useId();
  const title = a11yTitle(model);
  const isSymbol = model.mode === "symbol";
  // Only Mod+I symbol panel uses a dialog; mouse hovers stay non-modal regions.
  const isDialog = isSymbol;
  const showVisibleTitle = isSymbol;
  const [layout, setLayout] = useState<"split" | "stack">("stack");

  useLayoutEffect(() => {
    const root = cardRef.current?.closest(
      "[data-slot='files-lsp-hover-tooltip-root']"
    );
    const width = Number(root?.getAttribute("data-available-width") ?? 0);
    setLayout(width >= 560 ? "split" : "stack");
  }, []);

  useLayoutEffect(() => {
    if (!focusOnInitialMount.current) {
      return;
    }
    if (firstActionRef.current) {
      firstActionRef.current.focus();
      return;
    }
    cardRef.current?.focus();
  }, []);

  return (
    // role is always dialog (Mod+I) or region (pointer hover); handlers are
    // for sticky/dismiss chrome, not generic static interactivity.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: hover card is a focusable region/dialog with Esc + sticky pointer handlers.
    // biome-ignore lint/a11y/noStaticElementInteractions: same as above — role is set dynamically to dialog|region.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-labelledby is valid for both dialog and region.
    <div
      aria-labelledby={titleId}
      aria-modal={isDialog ? false : undefined}
      className={cn(
        "cm-lsp-hover-tooltip flex max-h-full min-h-0 w-max min-w-0 flex-col overflow-hidden text-sm",
        // Vertical rhythm stays on chrome; horizontal gutter sinks into body
        // content so the scrollbar sits on the card edge (activity widget).
        model.mode === "documentation" ? "gap-0 py-2" : "gap-1.5 py-1.5"
      )}
      data-mode={model.mode}
      data-slot="files-lsp-hover-card"
      onFocusCapture={onMakeSticky}
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      onPointerEnter={onMakeSticky}
      ref={cardRef}
      role={isDialog ? "dialog" : "region"}
      style={
        model.mode === "documentation"
          ? {
              maxHeight: "min(320px, var(--files-lsp-editor-available-height))",
              maxWidth: "min(480px, var(--files-lsp-editor-available-width))",
            }
          : {
              maxHeight: "min(360px, var(--files-lsp-editor-available-height))",
              maxWidth:
                model.definitions.length > 1
                  ? "min(640px, var(--files-lsp-editor-available-width))"
                  : "min(520px, var(--files-lsp-editor-available-width))",
            }
      }
      tabIndex={-1}
    >
      <div
        className={cn(
          "shrink-0 font-medium text-xs",
          showVisibleTitle ? "px-1.5 text-muted-foreground" : "sr-only"
        )}
        data-slot="files-lsp-hover-title"
        id={titleId}
      >
        {title}
      </div>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
        data-scrollbar="stable"
        data-slot="files-lsp-hover-body"
      >
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col gap-1.5",
            model.mode === "documentation" ? "px-2" : "px-1.5"
          )}
        >
          <HoverBody
            firstActionRef={firstActionRef}
            layout={layout}
            model={model}
            onActivateDefinition={onActivateDefinition}
            {...(onRequestPreview ? { onRequestPreview } : {})}
          />
        </div>
      </div>
    </div>
  );
}

export function mountFilesLspHoverCard(
  container: HTMLElement,
  props: FilesLspHoverCardProps
): MountedFilesLspHoverCard {
  const root: Root = createRoot(container);
  const render = (
    nextProps: FilesLspHoverCardProps,
    focusOnMount: boolean
  ): void => {
    flushSync(() => {
      root.render(
        <FilesLspHoverCard {...nextProps} focusOnMount={focusOnMount} />
      );
    });
  };
  render(props, props.model.mode === "symbol");
  let destroyed = false;
  return {
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      flushSync(() => {
        root.unmount();
      });
    },
    update(nextProps) {
      if (!destroyed) {
        render(nextProps, false);
      }
    },
  };
}

interface FilesLspHoverTooltipInput extends FilesLspHoverCardProps {
  end: number;
  onCardDom(dom: HTMLElement | null): void;
  onCardUpdate?(update: ((model: FilesLspHoverCardModel) => void) | null): void;
  pos: number;
  view: EditorView;
}

function setEditorSize(view: EditorView, dom: HTMLElement): void {
  const availableWidth = Math.max(0, view.dom.clientWidth - 16);
  const availableHeight = Math.max(0, view.dom.clientHeight - 16);
  dom.dataset.availableWidth = String(availableWidth);
  dom.dataset.availableHeight = String(availableHeight);
  dom.style.setProperty(
    "--files-lsp-editor-available-width",
    `${availableWidth}px`
  );
  dom.style.setProperty(
    "--files-lsp-editor-available-height",
    `${availableHeight}px`
  );
}

export function createFilesLspHoverTooltip(
  input: FilesLspHoverTooltipInput
): Tooltip {
  return {
    above: true,
    arrow: false,
    end: input.end,
    pos: input.pos,
    create: () => {
      const dom = input.view.dom.ownerDocument.createElement("div");
      dom.dataset.slot = "files-lsp-hover-tooltip-root";
      dom.style.background = "transparent";
      dom.style.border = "none";
      dom.style.padding = "0";
      input.onCardDom(dom);
      setEditorSize(input.view, dom);
      const mounted = mountFilesLspHoverCard(dom, input);
      input.onCardUpdate?.((model) => {
        mounted.update({ ...input, model });
      });
      return {
        destroy: () => {
          input.onCardUpdate?.(null);
          mounted.destroy();
          input.onCardDom(null);
        },
        dom,
        update: () => setEditorSize(input.view, dom),
        mount: () => {
          if (input.model.mode !== "symbol") {
            return;
          }
          const card = dom.querySelector<HTMLElement>(
            '[data-slot="files-lsp-hover-card"]'
          );
          const focusTarget =
            card?.querySelector<HTMLElement>("button") ?? card;
          focusTarget?.focus();
        },
      };
    },
  };
}
