import { type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
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

const affordanceMark = Decoration.mark({
  attributes: {
    class: "cm-lsp-definition-affordance",
  },
});

const affordanceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  provide: (field) => EditorView.decorations.from(field),
  update(value, transaction) {
    // Drop affordance on edit/selection without a nested ViewPlugin dispatch.
    if (transaction.docChanged || transaction.selection !== undefined) {
      return Decoration.none;
    }
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(setAffordanceEffect)) {
        continue;
      }
      if (effect.value === null) {
        next = Decoration.none;
        continue;
      }
      const { from, to } = effect.value;
      if (from >= to) {
        next = Decoration.none;
        continue;
      }
      next = Decoration.set([affordanceMark.range(from, to)]);
    }
    return next;
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
