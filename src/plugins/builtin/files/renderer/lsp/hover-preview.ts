import type { LSPPlugin } from "@codemirror/lsp-client";
import type { StateEffectType } from "@codemirror/state";
import type { EditorView, Tooltip } from "@codemirror/view";
import { loadFilesLspDefinitionPreview } from "./definition-preview.ts";
import { createFilesLspHoverTooltip } from "./hover-card.tsx";
import type { FilesLspHoverCandidate } from "./hover-data.ts";
import type {
  FilesLspHoverCardModel,
  FilesLspHoverInput,
  FilesLspPreparedDefinition,
} from "./hover-types.ts";

interface FilesLspHoverCardSessionInput {
  hoverInput: FilesLspHoverInput;
  isCurrent(
    epoch: number,
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): boolean;
  onActivateDefinition(target: FilesLspPreparedDefinition): void;
  onDismiss(): void;
  onMakeSticky(): void;
  setTooltip: StateEffectType<Tooltip | null>;
  view: EditorView;
}

interface CardContext {
  candidate: FilesLspHoverCandidate;
  epoch: number;
  plugin: LSPPlugin;
}

function sameDefinitionTarget(
  left: FilesLspPreparedDefinition,
  right: FilesLspPreparedDefinition
): boolean {
  return (
    left.uri === right.uri &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character
  );
}

export class FilesLspHoverCardSession {
  #context: CardContext | null = null;
  #dom: HTMLElement | null = null;
  #identity: object | null = null;
  readonly #input: FilesLspHoverCardSessionInput;
  #model: FilesLspHoverCardModel | null = null;
  #pending: Array<{ target: FilesLspPreparedDefinition }> = [];
  #update: ((model: FilesLspHoverCardModel) => void) | null = null;

  constructor(input: FilesLspHoverCardSessionInput) {
    this.#input = input;
  }

  contains(node: Node): boolean {
    return this.#dom?.contains(node) ?? false;
  }

  isMounted(): boolean {
    return this.#dom !== null;
  }

  currentModel(): FilesLspHoverCardModel | null {
    return this.#model;
  }

  show(
    model: FilesLspHoverCardModel,
    candidate: FilesLspHoverCandidate,
    plugin: LSPPlugin,
    epoch: number
  ): void {
    const identity = {};
    const initialModel = { ...model, activePreviewTarget: null };
    this.#context = { candidate, epoch, plugin };
    this.#identity = identity;
    this.#model = initialModel;
    this.#pending = [];
    this.#update = null;
    this.#mount(identity, true);
  }

  clear(dispatch: boolean): void {
    this.#context = null;
    this.#dom = null;
    this.#identity = null;
    this.#model = null;
    this.#pending = [];
    this.#update = null;
    if (dispatch) {
      this.#input.view.dispatch({ effects: this.#input.setTooltip.of(null) });
    }
  }

  #mount(identity: object, requestFirst: boolean): void {
    const context = this.#context;
    const model = this.#model;
    if (!(context && model) || this.#identity !== identity) {
      return;
    }
    const tooltip = createFilesLspHoverTooltip({
      end: context.candidate.to,
      model,
      onActivateDefinition: this.#input.onActivateDefinition,
      onCardDom: (dom) => {
        if (this.#identity === identity) {
          this.#dom = dom;
        }
      },
      onCardUpdate: (update) => {
        if (this.#identity === identity) {
          this.#update = update;
        }
      },
      onDismiss: this.#input.onDismiss,
      onMakeSticky: this.#input.onMakeSticky,
      onRequestPreview: (target) => {
        this.#requestPreview(identity, target).catch(() => undefined);
      },
      pos: context.candidate.from,
      view: this.#input.view,
    });
    this.#input.view.dispatch({ effects: this.#input.setTooltip.of(tooltip) });
    if (requestFirst && model.definitions[0]) {
      this.#requestPreview(identity, model.definitions[0]).catch(
        () => undefined
      );
    }
  }

  async #requestPreview(
    identity: object,
    requestedTarget: FilesLspPreparedDefinition
  ): Promise<void> {
    const context = this.#context;
    const model = this.#model;
    if (this.#identity !== identity || !context || !model) {
      return;
    }
    const target = model.definitions.find((definition) =>
      sameDefinitionTarget(definition, requestedTarget)
    );
    if (!target) {
      return;
    }

    const selectedModel = { ...model, activePreviewTarget: target };
    this.#model = selectedModel;
    this.#update?.(selectedModel);
    if (
      target.preview !== undefined ||
      this.#pending.some((pending) =>
        sameDefinitionTarget(pending.target, target)
      )
    ) {
      return;
    }

    const pending = { target };
    this.#pending.push(pending);
    const preview = await loadFilesLspDefinitionPreview({
      currentDocument: this.#input.view.state.doc,
      currentUri: context.plugin.uri,
      readDocument: this.#input.hoverInput.readDocument,
      serverRoot: this.#input.hoverInput.rootPath,
      target,
    });
    const pendingIndex = this.#pending.indexOf(pending);
    if (pendingIndex === -1) {
      return;
    }
    this.#pending.splice(pendingIndex, 1);
    if (
      this.#identity !== identity ||
      this.#context !== context ||
      !this.#input.isCurrent(context.epoch, context.plugin, context.candidate)
    ) {
      return;
    }

    const currentModel = this.#model;
    const currentTarget = currentModel?.definitions.find((definition) =>
      sameDefinitionTarget(definition, target)
    );
    if (!(currentModel && currentTarget)) {
      return;
    }
    const resolvedTarget = { ...currentTarget, preview };
    const nextModel = {
      ...currentModel,
      activePreviewTarget:
        currentModel.activePreviewTarget &&
        sameDefinitionTarget(currentModel.activePreviewTarget, target)
          ? resolvedTarget
          : currentModel.activePreviewTarget,
      definitions: currentModel.definitions.map((definition) =>
        sameDefinitionTarget(definition, target) ? resolvedTarget : definition
      ),
    };
    this.#model = nextModel;
    if (this.#update) {
      this.#update(nextModel);
      return;
    }

    const nextIdentity = {};
    this.#identity = nextIdentity;
    this.#pending = [];
    this.#mount(nextIdentity, false);
  }
}
