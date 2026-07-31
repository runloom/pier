import { LSPPlugin } from "@codemirror/lsp-client";
import type { ViewUpdate } from "@codemirror/view";
import {
  jumpToFilesLspDefinition,
  navigateFilesLspDefinition,
} from "./definition-navigate.ts";
import type { HoverControllerHost } from "./hover-controller-actions.ts";
import {
  clickDefinition,
  requestTransient,
  runManual,
} from "./hover-controller-actions.ts";
import {
  clientHasCapability,
  type DefinitionJumpIntent,
  DOCUMENTATION_DELAY_MS,
  FilesLspHoverControllerBase,
  type ManualHoverIntent,
  type TransientHoverMode,
} from "./hover-controller-base.ts";
import {
  createFilesLspHoverModel,
  type FilesLspHoverCandidate,
  FilesLspOwnedMapping,
  prepareFilesLspDefinitions,
  sameFilesLspHoverCandidate,
} from "./hover-data.ts";
import type { FilesLspPreparedDefinition } from "./hover-types.ts";

export class FilesLspHoverController extends FilesLspHoverControllerBase {
  update(update: ViewUpdate): void {
    const plugin = LSPPlugin.get(this._view);
    if (plugin !== this._plugin) {
      this._plugin = plugin;
      this._clear(false, true);
      this._scheduleTooltipClear(plugin);
    }
    if (update.docChanged || update.selectionSet) {
      this._lastPointer = null;
      // Affordance clears via StateField on doc/selection transactions.
      this._clear(false);
      return;
    }
    if (plugin && this._manualQueued) {
      this._scheduleManual(plugin, this._manualQueued);
    }
    if (plugin && this._definitionJumpQueued) {
      this._scheduleDefinitionJump(plugin, this._definitionJumpQueued);
    }
  }

  destroy(): void {
    this._destroyed = true;
    this._view.contentDOM.removeEventListener("mousemove", this._onMouseMove);
    this._view.contentDOM.removeEventListener("mouseleave", this._onMouseLeave);
    this._view.contentDOM.removeEventListener(
      "mousedown",
      this._onMouseDown,
      true
    );
    this._view.dom.removeEventListener("focusout", this._onFocusOut);
    this._window?.removeEventListener("keydown", this._onKeyDown, true);
    this._window?.removeEventListener("keyup", this._onKeyUp, true);
    this._window?.removeEventListener("blur", this._onWindowBlur);
    this._syncAffordance(null);
    this._clear(false);
  }

  clear(): void {
    this._clear();
  }

  cancelQueuedManual(): void {
    this._manualQueued = null;
    this._definitionJumpQueued = null;
  }

  async showManual(): Promise<"shown" | "queued" | "unavailable"> {
    this._clear();
    const position = this._view.state.selection.main.head;
    const word = this._view.state.wordAt(position);
    const intent: ManualHoverIntent = {
      candidate: word
        ? { from: word.from, position, to: word.to }
        : { from: position, position, to: position },
    };
    this._manualQueued = intent;
    const pluginBeforePrepare = LSPPlugin.get(this._view);
    const availability = this._input.prepareForManual(this._view);
    if (availability === "unavailable") {
      if (this._manualQueued === intent) {
        this._manualQueued = null;
      }
      return "unavailable";
    }
    const plugin = LSPPlugin.get(this._view);
    if (
      !plugin ||
      (availability === "pending" && plugin === pluginBeforePrepare)
    ) {
      return "queued";
    }
    if (this._manualQueued !== intent) {
      return "queued";
    }
    this._manualQueued = null;
    await this._runManual(plugin, intent.candidate);
    return "shown";
  }

  /**
   * F12 / command palette: single target jumps; multi opens definition card.
   */
  async jumpToDefinition(): Promise<boolean> {
    const position = this._view.state.selection.main.head;
    const word = this._view.state.wordAt(position);
    const candidate: FilesLspHoverCandidate = word
      ? { from: word.from, position, to: word.to }
      : { from: position, position, to: position };
    if (!(await this._ensurePluginForDefinitionJump(candidate))) {
      return true;
    }
    const result = await jumpToFilesLspDefinition(this._view);
    if (result.ok && result.multi) {
      const prepared = prepareFilesLspDefinitions({
        targets: result.targets,
      });
      this._clear();
      this._mode = "definition";
      this._sticky = true;
      const word = this._view.state.wordAt(
        this._view.state.selection.main.head
      );
      const position = this._view.state.selection.main.head;
      this._candidate = word
        ? { from: word.from, position, to: word.to }
        : { from: position, position, to: position };
      this._mapping = new FilesLspOwnedMapping(result.mapping);
      this._preparedPlugin = result.plugin;
      const epoch = this._epoch;
      const model = createFilesLspHoverModel({
        definitions: prepared,
        definitionsTruncated: result.truncated,
        definitionsTotal: result.total,
        error: false,
        hoverInput: this._input,
        hoverResult: null,
        mode: "definition",
        plugin: result.plugin,
      });
      this._card.show(model, this._candidate, result.plugin, epoch);
      return true;
    }
    if (result.ok) {
      this._clear();
      return true;
    }
    if (result.reason === "empty") {
      return true;
    }
    this._reportNavigateFailure(result.reason);
    return result.reason !== "unavailable";
  }

  /** Hide/cancel documentation hover without wiping jump queues. */
  protected _cancelDocumentationOnly(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._mode === "documentation") {
      this._epoch += 1;
      this._requests.cancel();
      this._mode = null;
      this._candidate = null;
      this._sticky = false;
      this._card.clear(!this._destroyed);
    }
  }

  protected _begin(
    mode: TransientHoverMode,
    candidate: FilesLspHoverCandidate
  ): void {
    // Scheme Z: pointer path only opens documentation (never definition cards).
    if (mode !== "documentation") {
      return;
    }
    if (
      this._mode === mode &&
      sameFilesLspHoverCandidate(this._candidate, candidate)
    ) {
      return;
    }
    this._clear();
    this._mode = mode;
    this._candidate = candidate;
    const epoch = this._epoch;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (
        this._epoch === epoch &&
        sameFilesLspHoverCandidate(this._candidate, candidate)
      ) {
        this._requestTransient("documentation", candidate).catch(
          () => undefined
        );
      }
    }, DOCUMENTATION_DELAY_MS);
  }

  async _requestTransient(
    mode: "definition" | "documentation",
    candidate: FilesLspHoverCandidate
  ): Promise<void> {
    return requestTransient(
      this as unknown as HoverControllerHost,
      mode,
      candidate
    );
  }

  async _runManual(
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): Promise<void> {
    return runManual(this as unknown as HoverControllerHost, plugin, candidate);
  }

  async _clickDefinition(candidate: FilesLspHoverCandidate): Promise<void> {
    return clickDefinition(this as unknown as HoverControllerHost, candidate);
  }

  async _ensurePluginForDefinitionJump(
    candidate: FilesLspHoverCandidate
  ): Promise<boolean> {
    let plugin = LSPPlugin.get(this._view);
    if (plugin && clientHasCapability(plugin.client, "definitionProvider")) {
      this._definitionJumpQueued = null;
      return true;
    }
    // Cold start: wake the language service (same path as Mod+I) and queue jump.
    this._definitionJumpQueued = { candidate };
    const pluginBefore = plugin;
    const availability = this._input.prepareForManual(this._view);
    if (availability === "unavailable") {
      this._definitionJumpQueued = null;
      this._reportNavigateFailure("unavailable");
      return false;
    }
    plugin = LSPPlugin.get(this._view);
    if (
      !plugin ||
      (availability === "pending" && plugin === pluginBefore) ||
      !clientHasCapability(plugin.client, "definitionProvider")
    ) {
      // Stays queued until ViewPlugin update sees a ready LSPPlugin.
      return false;
    }
    this._definitionJumpQueued = null;
    return true;
  }

  protected _candidateFromLspRange(
    plugin: LSPPlugin,
    range: {
      start: { character: number; line: number };
      end: { character: number; line: number };
    },
    fallbackPosition: number
  ): FilesLspHoverCandidate {
    try {
      const from = plugin.fromPosition(range.start, this._view.state.doc);
      const to = plugin.fromPosition(range.end, this._view.state.doc);
      return {
        from: Math.min(from, to),
        position: fallbackPosition,
        to: Math.max(from, to),
      };
    } catch {
      return {
        from: fallbackPosition,
        position: fallbackPosition,
        to: fallbackPosition,
      };
    }
  }

  protected _isCurrent(
    epoch: number,
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): boolean {
    return (
      !this._destroyed &&
      epoch === this._epoch &&
      sameFilesLspHoverCandidate(this._candidate, candidate) &&
      this._plugin === plugin &&
      LSPPlugin.get(this._view) === plugin
    );
  }

  protected async _activateDefinition(
    target: FilesLspPreparedDefinition
  ): Promise<void> {
    const mapping = this._mapping;
    const plugin = this._preparedPlugin;
    if (!(mapping && plugin)) {
      return;
    }
    this._mapping = null;
    this._clear();
    try {
      const result = await navigateFilesLspDefinition({
        mapping: mapping.value,
        plugin,
        sourceView: this._view,
        target,
      });
      if (!result.ok) {
        this._reportNavigateFailure(result.reason);
      }
    } finally {
      mapping.destroy();
    }
  }

  protected _reportNavigateFailure(
    reason:
      | "empty"
      | "map-failed"
      | "open-failed"
      | "request-failed"
      | "unavailable"
  ): void {
    if (reason === "empty") {
      return;
    }
    const labels = this._input.getLabels();
    const message =
      reason === "unavailable"
        ? labels.goToDefinitionUnavailable
        : labels.goToDefinitionFailed;
    this._input.notifyError?.(message);
  }

  protected _syncAffordance(candidate: FilesLspHoverCandidate | null): void {
    if (this._destroyed) {
      return;
    }
    // Never dispatch from ViewPlugin.update — queue to the next microtask.
    const effect = this._setAffordance.of(
      candidate ? { from: candidate.from, to: candidate.to } : null
    );
    queueMicrotask(() => {
      if (!this._destroyed) {
        this._view.dispatch({ effects: effect });
      }
    });
  }

  protected _scheduleDefinitionJump(
    plugin: LSPPlugin,
    intent: DefinitionJumpIntent
  ): void {
    queueMicrotask(() => {
      if (
        this._destroyed ||
        this._plugin !== plugin ||
        LSPPlugin.get(this._view) !== plugin ||
        this._definitionJumpQueued !== intent
      ) {
        return;
      }
      this._definitionJumpQueued = null;
      this._clickDefinition(intent.candidate).catch(() => undefined);
    });
  }

  protected _clear(dispatch = true, preserveManual = false): void {
    this._epoch += 1;
    if (!preserveManual) {
      this._manualQueued = null;
      this._definitionJumpQueued = null;
    }
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._requests.cancel();
    this._mapping?.destroy();
    this._mapping = null;
    this._preparedPlugin = null;
    this._candidate = null;
    this._mode = null;
    this._sticky = false;
    this._card.clear(dispatch && !this._destroyed);
  }

  protected _scheduleManual(
    plugin: LSPPlugin,
    intent: ManualHoverIntent
  ): void {
    queueMicrotask(() => {
      if (
        this._destroyed ||
        this._plugin !== plugin ||
        LSPPlugin.get(this._view) !== plugin ||
        this._manualQueued !== intent
      ) {
        return;
      }
      this._manualQueued = null;
      this._runManual(plugin, intent.candidate).catch(() => undefined);
    });
  }

  protected _scheduleTooltipClear(plugin: LSPPlugin | null): void {
    queueMicrotask(() => {
      if (
        !this._destroyed &&
        this._plugin === plugin &&
        !this._card.isMounted()
      ) {
        this._view.dispatch({ effects: this._setTooltip.of(null) });
      }
    });
  }
}
