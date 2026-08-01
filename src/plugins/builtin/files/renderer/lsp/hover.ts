import {
  EditorSelection,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  layer,
  RectangleMarker,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { FilesLspHoverController } from "./hover-controller.ts";
import type { FilesLspHoverInput } from "./hover-types.ts";

export type { FilesLspHoverInput } from "./hover-types.ts";

const controllers = new WeakMap<EditorView, FilesLspHoverController>();

const setAffordanceEffect = StateEffect.define<{
  from: number;
  to: number;
} | null>();

export interface FilesLspAffordanceRange {
  from: number;
  to: number;
}

/**
 * Cursor-only mark. Underline is drawn by a layer so it stays continuous when
 * syntax highlighting splits the range into multiple inline spans.
 */
const affordanceCursorMark = Decoration.mark({
  attributes: {
    class: "cm-lsp-definition-affordance",
  },
});

function affordanceDecorations(
  range: FilesLspAffordanceRange | null
): DecorationSet {
  if (!range || range.from >= range.to) {
    return Decoration.none;
  }
  return Decoration.set([affordanceCursorMark.range(range.from, range.to)]);
}

const affordanceField = StateField.define<FilesLspAffordanceRange | null>({
  create: () => null,
  provide: (field) =>
    EditorView.decorations.from(field, (range) => affordanceDecorations(range)),
  update(value, transaction) {
    // Drop affordance on edit/selection without a nested ViewPlugin dispatch.
    if (transaction.docChanged || transaction.selection !== undefined) {
      return null;
    }
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(setAffordanceEffect)) {
        continue;
      }
      if (effect.value === null) {
        next = null;
        continue;
      }
      const { from, to } = effect.value;
      if (from >= to) {
        next = null;
        continue;
      }
      next = { from, to };
    }
    return next;
  },
});

/**
 * Continuous underline under the full affordance range (one rect per visual
 * line / bidi piece). Avoids per-token text-decoration gaps.
 */
const affordanceUnderlineLayer = layer({
  above: false,
  class: "cm-lsp-definition-affordance-layer",
  markers(view) {
    const range = view.state.field(affordanceField);
    if (!range || range.from >= range.to) {
      return [];
    }
    return RectangleMarker.forRange(
      view,
      "cm-lsp-definition-affordance-rect",
      EditorSelection.range(range.from, range.to)
    );
  },
  update(update) {
    return (
      update.startState.field(affordanceField) !==
        update.state.field(affordanceField) ||
      update.docChanged ||
      update.geometryChanged ||
      update.viewportChanged
    );
  },
});

export function filesLspHoverExtension(input: FilesLspHoverInput): Extension {
  const setTooltip = StateEffect.define<Tooltip | null>();
  const tooltipField = StateField.define<Tooltip | null>({
    create: () => null,
    provide: (field) => showTooltip.from(field),
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection !== undefined) {
        return null;
      }
      for (const effect of transaction.effects) {
        if (effect.is(setTooltip)) {
          return effect.value;
        }
      }
      return value;
    },
  });
  const controllerPlugin = ViewPlugin.fromClass(
    class {
      readonly controller: FilesLspHoverController;
      readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.controller = new FilesLspHoverController(
          view,
          input,
          setTooltip,
          setAffordanceEffect
        );
        controllers.set(view, this.controller);
      }

      update(update: ViewUpdate): void {
        this.controller.update(update);
      }

      destroy(): void {
        this.controller.destroy();
        if (controllers.get(this.view) === this.controller) {
          controllers.delete(this.view);
        }
      }
    }
  );
  return [
    tooltipField,
    affordanceField,
    affordanceUnderlineLayer,
    controllerPlugin,
    filesLspDefinitionKeymap(),
  ];
}

export async function showFilesLspHover(
  view: EditorView
): Promise<"shown" | "queued" | "unavailable"> {
  const controller = controllers.get(view);
  return controller ? controller.showManual() : "unavailable";
}

export function clearFilesLspHover(view: EditorView): void {
  controllers.get(view)?.clear();
}

export function cancelQueuedFilesLspHover(view: EditorView): void {
  controllers.get(view)?.cancelQueuedManual();
}

/** F12 / command: Go to Definition through the shared Pier path. */
export function jumpToFilesLspDefinitionCommand(view: EditorView): boolean {
  const controller = controllers.get(view);
  if (!controller) {
    return false;
  }
  controller.jumpToDefinition().catch(() => undefined);
  return true;
}

export function filesLspDefinitionKeymap(): Extension {
  return keymap.of([
    {
      key: "F12",
      preventDefault: true,
      run: jumpToFilesLspDefinitionCommand,
    },
  ]);
}
