import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { runtimeEntrySignature } from "../runtime/entry-signature.ts";
import type { PendingExternalAttempt } from "../runtime/external-invalidation.ts";

export function queueExternalActivation(options: {
  activate: (signature: string, token: symbol) => Promise<void>;
  entry: PluginRegistryEntry;
  pending: Map<string, PendingExternalAttempt>;
}): void {
  const pluginId = options.entry.manifest.id;
  const signature = runtimeEntrySignature(options.entry);
  const token = Symbol(pluginId);
  options.pending.set(pluginId, {
    abortController: new AbortController(),
    signature,
    token,
  });
  options.activate(signature, token).catch((error) => {
    console.error(
      `[renderer-plugin-runtime] external ${pluginId} attempt failed:`,
      error
    );
  });
}

export function enqueuePendingExternalActivations(options: {
  activate: (entry: PluginRegistryEntry) => Promise<void>;
  active: ReadonlyMap<string, unknown>;
  desired: ReadonlyMap<string, PluginRegistryEntry>;
  externalTransitionGate: { has(pluginId: string): boolean };
  pending: Map<string, PendingExternalAttempt>;
}): void {
  for (const entry of options.desired.values()) {
    const pluginId = entry.manifest.id;
    if (
      entry.runtime.kind !== "external" ||
      !entry.runtime.rendererEntryUrl ||
      options.active.has(pluginId) ||
      options.pending.has(pluginId) ||
      options.externalTransitionGate.has(pluginId)
    ) {
      continue;
    }
    queueExternalActivation({
      activate: () => options.activate(entry),
      entry,
      pending: options.pending,
    });
  }
}

/**
 * 串行过渡队列：外部插件 disable/reload 的互斥执行（原 RendererPluginRuntime
 * 内联状态，抽出以便复用与单测）。lastError 供 diagnostics 面板读取。
 */
export class SerialTransitionQueue {
  private lastError: Error | null = null;
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => {
        this.lastError = null;
      },
      (error: unknown) => {
        this.lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    );
    return result;
  }

  get lastTransitionError(): Error | null {
    return this.lastError;
  }
}
