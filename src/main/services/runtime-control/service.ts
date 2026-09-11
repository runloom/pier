/**
 * RuntimeControlService：持久 agent 运行控制门面（W3）。
 * 不持有任务台账；不产生工作完成结论。
 */
import type {
  AgentsScreenResult,
  AgentsStartResult,
  AgentsTurnResult,
} from "@shared/contracts/local-control/agents-runtime.ts";
import type { RuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { matchRuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { clampScreenText } from "./screen-text.ts";
import { assembleStartPrompt } from "./start-prompt.ts";
import type {
  CreateRuntimeControlServiceOptions,
  RuntimeControlResult,
  RuntimeControlService,
  RuntimeControlTargetInput,
  RuntimeRecord,
} from "./types.ts";
import { runWaitLoop, runWatchLoop } from "./wait-watch.ts";

export type {
  CreateRuntimeControlServiceOptions,
  RuntimeControlService,
} from "./types.ts";
export function createRuntimeControlService(
  options: CreateRuntimeControlServiceOptions
): RuntimeControlService {
  const { bootId, backend } = options;
  const nowMs = options.nowMs ?? (() => Date.now());
  const byRuntimeId = new Map<string, RuntimeRecord>();
  /** 同 runtimeId（常=panelId）换代：原子递增，旧 generation 拒写。 */
  const generationByRuntimeId = new Map<string, number>();
  /** 同 runtime 变更类 op 串行，避免 turn∥terminate 竞态 */
  const runtimeQueues = new Map<string, Promise<unknown>>();
  const released = new Set<string>();
  function release(record: RuntimeRecord): void {
    const key = `${record.runtime.runtimeId}:${record.runtime.generation}`;
    if (released.has(key)) return;
    released.add(key);
    options.releaseReservation?.(record.runtime.runtimeId);
  }

  function enqueueRuntime<T>(
    runtimeId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const prev = runtimeQueues.get(runtimeId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(task);
    runtimeQueues.set(
      runtimeId,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  function lookup(
    input: RuntimeControlTargetInput,
    lookupOpts?: { allowClosed?: boolean | undefined }
  ): RuntimeControlResult<RuntimeRecord> {
    const record = byRuntimeId.get(input.runtimeId);
    const match = matchRuntimeRef({
      expected: {
        bootId: input.bootId,
        runtimeId: input.runtimeId,
        generation: input.generation,
      },
      actual: record?.runtime,
    });
    if (!match.ok) {
      let message = "runtime not found or gone";
      if (match.code === "boot_changed") {
        message =
          "expectedBootId / bootId does not match current control-plane boot";
      } else if (match.code === "stale_generation") {
        message = "runtime generation is stale";
      }
      return {
        ok: false,
        code: match.code,
        message,
      };
    }
    if (!record) {
      return {
        ok: false,
        code: "runtime_gone",
        message: "runtime not found",
      };
    }
    if (
      (record.closed || record.fact === "exited") &&
      !lookupOpts?.allowClosed
    ) {
      return {
        ok: false,
        code: "runtime_gone",
        message: "runtime is closed",
      };
    }
    if (record.runtime.bootId !== bootId) {
      return {
        ok: false,
        code: "boot_changed",
        message: "runtime belongs to a different boot",
      };
    }
    return { ok: true, data: record };
  }

  return {
    listRuntimeIds() {
      return [...byRuntimeId.keys()];
    },

    listRuntimeSummaries() {
      return [...byRuntimeId.values()].map((record) => ({
        bootId: record.runtime.bootId,
        runtimeId: record.runtime.runtimeId,
        generation: record.runtime.generation,
        agentId: record.agentId,
        panelId: record.panelId,
        windowId: record.windowId,
        fact:
          record.fact === "exited"
            ? "exited"
            : (options.resolveFact?.(record) ?? record.fact),
        closed: record.closed,
        ...(record.worktreeKey ? { worktreeKey: record.worktreeKey } : {}),
        ...(record.cwd ? { cwd: record.cwd } : {}),
      }));
    },

    async start(input) {
      if (!input.agentId.trim()) {
        return {
          ok: false,
          code: "invalid_command",
          message: "agents.start requires agentId",
        };
      }
      const assembled = assembleStartPrompt(input);
      if (!assembled.ok) {
        return assembled.error;
      }
      try {
        const created = await backend.create({
          agentId: input.agentId,
          promptText: assembled.text,
          cwd: input.cwd,
          windowId: input.windowId,
          ...(input.originPanelId && input.windowId
            ? {
                origin: {
                  panelId: input.originPanelId,
                  windowId: input.windowId,
                },
              }
            : {}),
          ...(input.placement ? { placement: input.placement } : {}),
        });
        const prevGen = generationByRuntimeId.get(created.runtimeId) ?? 0;
        // Native create receipts carry generation. Backends that never spawn
        // (fake) omit it and use a control-plane counter. Do not invent a
        // number that later fails process matching against a live PTY.
        if (created.generation === undefined && created.lifecycleId)
          return {
            ok: false,
            code: "provider_unavailable",
            message: "native terminal generation was not confirmed",
          };
        const generation = created.generation ?? prevGen + 1;
        generationByRuntimeId.set(created.runtimeId, generation);
        const runtime: RuntimeRef = {
          bootId,
          runtimeId: created.runtimeId,
          generation,
        };
        const record: RuntimeRecord = {
          runtime,
          agentId: input.agentId,
          panelId: created.panelId,
          windowId: created.windowId,
          cwd: created.cwd ?? input.cwd,
          worktreeKey: input.worktreeKey,
          incarnationId: input.incarnationId,
          lifecycleId: created.lifecycleId,
          fact: created.fact ?? "running",
          closed: false,
        };
        byRuntimeId.set(runtime.runtimeId, record);
        const data: AgentsStartResult = {
          runtime,
          creationStatus:
            created.fact === "unavailable" ? "unconfirmed" : "created",
          ...(created.inputDisposition
            ? { inputDisposition: created.inputDisposition }
            : {}),
          agentId: input.agentId,
          panelId: created.panelId,
          windowId: created.windowId,
          ...(record.cwd ? { cwd: record.cwd, canonicalPath: record.cwd } : {}),
          ...(record.worktreeKey ? { worktreeKey: record.worktreeKey } : {}),
          ...(record.incarnationId
            ? { incarnationId: record.incarnationId }
            : {}),
        };
        if (record.fact === "exited") release(record);
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          code: "provider_unavailable",
          message:
            error instanceof Error ? error.message : "failed to start runtime",
        };
      }
    },

    releaseForPanel(panelId) {
      const record = [...byRuntimeId.values()].find(
        (candidate) => candidate.panelId === panelId && !candidate.closed
      );
      if (!record) {
        return;
      }
      record.closed = true;
      release(record);
    },

    observeProcess(input) {
      const record = byRuntimeId.get(input.panelId);
      if (!record || input.generation < record.runtime.generation) return;
      if (input.generation > record.runtime.generation) {
        record.runtime = { ...record.runtime, generation: input.generation };
        generationByRuntimeId.set(input.panelId, input.generation);
        record.fact = input.created === false ? "unavailable" : "running";
      } else if (record.lifecycleId && input.lifecycleId !== record.lifecycleId)
        return;
      record.lifecycleId = input.lifecycleId;
      record.windowId = input.windowId;
      record.closed = input.closed;
      if (input.exited || input.closed) {
        record.fact = "exited";
        release(record);
      } else if (input.created) record.fact = "running";
    },

    async turn(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input);
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        if (!input.text || input.text.length === 0) {
          return {
            ok: false,
            code: "invalid_command",
            message: "agents.turn requires non-empty text",
          };
        }
        let ok: boolean;
        try {
          ok = await backend.sendText(
            record.panelId,
            input.text,
            input.submit,
            record
          );
        } catch (error) {
          return {
            ok: false,
            code: "prompt_undeliverable",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "terminal rejected input",
          };
        }
        const data: AgentsTurnResult = {
          accepted: true,
          runtime: record.runtime,
        };
        return { ok: true, data };
      });
    },

    async screen(input) {
      const found = lookup(input, { allowClosed: true });
      if (!found.ok) {
        return found;
      }
      const record = found.data;
      const viewport = await backend.readViewport(record.panelId, record);
      if (!viewport) {
        return {
          ok: false,
          code: "runtime_gone",
          message: "viewport unavailable",
        };
      }
      const clamped = clampScreenText(
        viewport.text,
        input.maxLines,
        input.maxBytes
      );
      const data: AgentsScreenResult = {
        screen: {
          text: clamped.text,
          capturedAt: nowMs(),
          rows: clamped.rows,
          cols: viewport.cols,
          truncated: clamped.truncated,
          maxLines: input.maxLines,
          maxBytes: input.maxBytes,
        },
        runtime: record.runtime,
        ...(record.cwd ? { cwd: record.cwd, canonicalPath: record.cwd } : {}),
        ...(record.worktreeKey ? { worktreeKey: record.worktreeKey } : {}),
        ...(record.incarnationId
          ? { incarnationId: record.incarnationId }
          : {}),
      };
      return { ok: true, data };
    },

    async wait(input) {
      const found = lookup(input, { allowClosed: true });
      if (!found.ok) {
        return found;
      }
      return runWaitLoop({
        input,
        byRuntimeId,
        resolveFact: options.resolveFact,
        nowMs,
        initial: found.data,
      });
    },

    async watch(input) {
      const found = lookup(input, { allowClosed: true });
      if (!found.ok) {
        return found;
      }
      return runWatchLoop({
        input,
        byRuntimeId,
        resolveFact: options.resolveFact,
        nowMs,
        initial: found.data,
      });
    },

    async interrupt(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input);
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        const ok = await backend.interrupt(record.panelId, record);
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "interrupt failed",
          };
        }
        return {
          ok: true,
          data: { interrupted: true as const, runtime: record.runtime },
        };
      });
    },

    async terminate(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input, { allowClosed: true });
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        let ok: boolean;
        try {
          ok =
            record.fact === "exited" ||
            (await backend.terminate(record.panelId, record));
        } catch (error) {
          return {
            ok: false,
            code: "provider_unavailable",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "terminate failed",
          };
        }
        record.fact = "exited";
        release(record);
        return {
          ok: true,
          data: { terminated: true as const, runtime: record.runtime },
        };
      });
    },

    async focus(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input, { allowClosed: true });
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        if (backend.focus) {
          const ok = await backend.focus(
            record.panelId,
            record.windowId,
            record
          );
          if (!ok) {
            return {
              ok: false,
              code: "panel_gone",
              message: "focus failed",
            };
          }
        }
        return {
          ok: true,
          data: {
            panelId: record.panelId,
            windowId: record.windowId,
            runtime: record.runtime,
          },
        };
      });
    },
  };
}
