import { LSPPlugin } from "@codemirror/lsp-client";
import type { StateEffectType } from "@codemirror/state";
import type { EditorView, Tooltip } from "@codemirror/view";
import type { FilesLspDefinitionTarget } from "./definitions.ts";
import {
  exactFilesLspDefinitionModifier,
  type FilesLspHoverCandidate,
  type FilesLspOwnedMapping,
  filesLspEventHasNoModifiers,
  filesLspHoverCandidateAt,
  sameFilesLspHoverCandidate,
} from "./hover-data.ts";
import { FilesLspHoverCardSession } from "./hover-preview.ts";
import { FilesLspHoverRequests } from "./hover-requests.ts";
import type {
  FilesLspHoverInput,
  FilesLspPreparedDefinition,
} from "./hover-types.ts";

export const DOCUMENTATION_DELAY_MS = 300;

export type TransientHoverMode = "definition" | "documentation";
export type HoverMode = TransientHoverMode | "symbol";
export interface ManualHoverIntent {
  candidate: FilesLspHoverCandidate;
}

export interface DefinitionJumpIntent {
  candidate: FilesLspHoverCandidate;
}

/**
 * Cmd/Ctrl+hover definition-link preflight. Affordance is shown only when
 * status is "ready" (non-empty definition targets).
 */
export interface DefinitionAffordanceCache {
  candidate: FilesLspHoverCandidate;
  range: { from: number; to: number } | null;
  /**
   * - pending: definition preflight in flight
   * - ready: non-empty targets (underline shown)
   * - empty: server returned ok with no targets (click may no-op)
   * - failed: request error (click must re-request / report)
   * - unavailable: no plugin or definitionProvider
   */
  status: "pending" | "empty" | "ready" | "failed" | "unavailable";
  targets: FilesLspDefinitionTarget[];
  total: number;
  truncated: boolean;
}

/**
 * Runtime API on @codemirror/lsp-client's LSPClient; missing from published .d.ts.
 */
export function clientHasCapability(client: object, name: string): boolean {
  const probe = client as { hasCapability?: (capability: string) => boolean };
  if (typeof probe.hasCapability !== "function") {
    return true;
  }
  return probe.hasCapability(name) !== false;
}

export abstract class FilesLspHoverControllerBase {
  protected readonly _input: FilesLspHoverInput;
  protected readonly _view: EditorView;
  protected readonly _window: Window | null;
  protected readonly _card: FilesLspHoverCardSession;
  protected readonly _setTooltip: StateEffectType<Tooltip | null>;
  protected readonly _setAffordance: StateEffectType<{
    from: number;
    to: number;
  } | null>;
  protected _candidate: FilesLspHoverCandidate | null = null;
  protected _destroyed = false;
  protected _epoch = 0;
  protected _lastPointer: { x: number; y: number } | null = null;
  protected _manualQueued: ManualHoverIntent | null = null;
  /** Cmd/Ctrl+Click or F12 while LSP is still connecting. */
  protected _definitionJumpQueued: DefinitionJumpIntent | null = null;
  /** Token for definition-link preflight; bumped when candidate/modifier path resets. */
  protected _affordanceToken = 0;
  protected _affordanceCache: DefinitionAffordanceCache | null = null;
  protected _mapping: FilesLspOwnedMapping | null = null;
  protected _mode: HoverMode | null = null;
  protected readonly _requests = new FilesLspHoverRequests();
  protected _plugin: LSPPlugin | null;
  protected _preparedPlugin: LSPPlugin | null = null;
  protected _sticky = false;
  protected _timer: ReturnType<typeof setTimeout> | null = null;

  /** Subclass implements; used from card session callbacks in the base constructor. */
  protected abstract _isCurrent(
    epoch: number,
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): boolean;

  /** Subclass implements; used from card session callbacks in the base constructor. */
  protected abstract _activateDefinition(
    target: FilesLspPreparedDefinition
  ): Promise<void>;

  protected readonly _onMouseMove = (event: MouseEvent): void => {
    this._lastPointer = { x: event.clientX, y: event.clientY };
    const candidate = filesLspHoverCandidateAt(
      this._view,
      event.clientX,
      event.clientY
    );

    if (this._sticky && this._card.isMounted()) {
      if (this._card.contains(event.target as Node)) {
        this._syncAffordance(null);
        return;
      }
      if (
        candidate &&
        sameFilesLspHoverCandidate(this._candidate, candidate) &&
        !exactFilesLspDefinitionModifier(event)
      ) {
        return;
      }
      if (
        candidate &&
        !sameFilesLspHoverCandidate(this._candidate, candidate)
      ) {
        this._sticky = false;
      } else if (!(candidate || exactFilesLspDefinitionModifier(event))) {
        return;
      }
    }

    if (!candidate) {
      this._clearDefinitionAffordance();
      this._clear();
      return;
    }

    // Scheme Z: Cmd/Ctrl+hover preflights definition and underlines only when
    // jump targets exist. No definition preview card — navigate via Click / F12.
    if (exactFilesLspDefinitionModifier(event)) {
      if (this._mode === "documentation" || this._timer !== null) {
        this._cancelDocumentationOnly();
      }
      this._beginDefinitionAffordance(candidate);
      return;
    }

    this._clearDefinitionAffordance();
    if (filesLspEventHasNoModifiers(event)) {
      this._begin("documentation", candidate);
      return;
    }
    this._clear();
  };

  protected readonly _onMouseLeave = (event: MouseEvent): void => {
    const related = event.relatedTarget;
    if (related instanceof Node && this._card.contains(related)) {
      return;
    }
    if (related instanceof Node && this._view.contentDOM.contains(related)) {
      return;
    }
    this._lastPointer = null;
    this._clearDefinitionAffordance();
    if (this._mode === "symbol") {
      return;
    }
    this._clear();
  };

  /**
   * Go to Definition on mousedown (capture), before CodeMirror multi-selection.
   * Multi-cursor is Alt+Click only (clickAddsSelectionRange facet).
   */
  protected readonly _onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !exactFilesLspDefinitionModifier(event)) {
      return;
    }
    const candidate = filesLspHoverCandidateAt(
      this._view,
      event.clientX,
      event.clientY
    );
    if (!candidate) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this._clickDefinition(candidate).catch(() => undefined);
  };

  protected readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (this._card.isMounted()) {
        event.preventDefault();
        event.stopPropagation();
        this._clear();
        this._view.focus();
      }
      return;
    }
    if (!exactFilesLspDefinitionModifier(event)) {
      if (!filesLspEventHasNoModifiers(event) && this._mode !== "symbol") {
        this._clearDefinitionAffordance();
        if (!this._sticky) {
          this._clear();
        }
      }
      return;
    }
    // Modifier alone: preflight definition-link (no preview card).
    if (!this._lastPointer) {
      return;
    }
    const candidate = filesLspHoverCandidateAt(
      this._view,
      this._lastPointer.x,
      this._lastPointer.y
    );
    if (candidate) {
      if (this._mode === "documentation" || this._timer !== null) {
        this._cancelDocumentationOnly();
      }
      this._beginDefinitionAffordance(candidate);
    }
  };

  protected readonly _onKeyUp = (event: KeyboardEvent): void => {
    if (
      event.key !== "Meta" &&
      event.key !== "Control" &&
      event.key !== "MetaLeft" &&
      event.key !== "MetaRight" &&
      event.key !== "ControlLeft" &&
      event.key !== "ControlRight"
    ) {
      return;
    }
    if (exactFilesLspDefinitionModifier(event)) {
      return;
    }
    this._clearDefinitionAffordance();
    // Resume ordinary documentation hover when the pointer is still over a symbol.
    if (this._mode === "symbol" || this._sticky) {
      return;
    }
    if (this._lastPointer) {
      const candidate = filesLspHoverCandidateAt(
        this._view,
        this._lastPointer.x,
        this._lastPointer.y
      );
      if (candidate) {
        this._begin("documentation", candidate);
      }
    }
  };

  protected readonly _onFocusOut = (): void => {
    queueMicrotask(() => {
      const active = this._view.dom.ownerDocument.activeElement;
      if (
        !this._destroyed &&
        active !== null &&
        !this._view.dom.contains(active) &&
        !this._card.contains(active)
      ) {
        this._lastPointer = null;
        this._clearDefinitionAffordance();
        this._clear();
      }
    });
  };

  protected readonly _onWindowBlur = (): void => {
    this._lastPointer = null;
    this._clearDefinitionAffordance();
    this._clear();
  };

  protected abstract _begin(
    mode: "definition" | "documentation" | "symbol",
    candidate: FilesLspHoverCandidate
  ): void;
  protected abstract _beginDefinitionAffordance(
    candidate: FilesLspHoverCandidate
  ): void;
  protected abstract _cancelDocumentationOnly(): void;
  protected abstract _clear(dispatch?: boolean, preserveManual?: boolean): void;
  protected abstract _clearDefinitionAffordance(): void;
  protected abstract _syncAffordance(
    range: { from: number; to: number } | null
  ): void;
  protected abstract _clickDefinition(
    candidate: FilesLspHoverCandidate
  ): Promise<void>;
  protected abstract _scheduleDefinitionJump(
    plugin: LSPPlugin,
    intent: { candidate: FilesLspHoverCandidate }
  ): void;
  protected abstract _scheduleManual(
    plugin: LSPPlugin,
    intent: { candidate: FilesLspHoverCandidate }
  ): void;
  protected abstract _scheduleTooltipClear(plugin: LSPPlugin | null): void;
  protected abstract _runManual(
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): Promise<void>;

  constructor(
    view: EditorView,
    input: FilesLspHoverInput,
    setTooltip: StateEffectType<Tooltip | null>,
    setAffordance: StateEffectType<{ from: number; to: number } | null>
  ) {
    this._view = view;
    this._input = input;
    this._setTooltip = setTooltip;
    this._setAffordance = setAffordance;
    this._plugin = LSPPlugin.get(view) ?? null;
    this._window = view.dom.ownerDocument.defaultView;
    this._card = new FilesLspHoverCardSession({
      hoverInput: input,
      isCurrent: (epoch, plugin, candidate) =>
        this._isCurrent(epoch, plugin, candidate),
      onActivateDefinition: (target) => {
        this._activateDefinition(target).catch(() => undefined);
      },
      onDismiss: () => {
        this._clear();
        this._view.focus();
      },
      onMakeSticky: () => {
        this._sticky = true;
      },
      setTooltip,
      view,
    });
    view.contentDOM.addEventListener("mousemove", this._onMouseMove);
    view.contentDOM.addEventListener("mouseleave", this._onMouseLeave);
    view.contentDOM.addEventListener("mousedown", this._onMouseDown, true);
    view.dom.addEventListener("focusout", this._onFocusOut);
    this._window?.addEventListener("keydown", this._onKeyDown, true);
    this._window?.addEventListener("keyup", this._onKeyUp, true);
    this._window?.addEventListener("blur", this._onWindowBlur);
  }
}
