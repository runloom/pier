/**
 * RuntimeControlService：持久 agent 运行控制门面（W3）。
 * 不持有任务台账；不产生工作完成结论。
 */
import type {
  AgentsScreenResult,
  AgentsStartResult,
  AgentsTurnResult,
  AgentsWaitResult,
  AgentsWatchResult,
} from "@shared/contracts/local-control/agents-runtime.ts";
import type { RuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { matchRuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { clampScreenText } from "./screen-text.ts";
import type {
  RuntimeControlResult,
  RuntimeControlScreenInput,
  RuntimeControlStartInput,
  RuntimeControlTargetInput,
  RuntimeControlTurnInput,
  RuntimeControlWaitInput,
  RuntimeControlWatchInput,
  RuntimeRecord,
  TerminalBackend,
} from "./types.ts";
import { runWaitLoop, runWatchLoop } from "./wait-watch.ts";

export interface RuntimeControlService {
  focus(input: RuntimeControlTargetInput): Promise<
    RuntimeControlResult<{
      panelId: string;
      windowId: string;
      runtime: RuntimeRef;
    }>
  >;
  interrupt(
    input: RuntimeControlTargetInput
  ): Promise<RuntimeControlResult<{ interrupted: true; runtime: RuntimeRef }>>;
  /** 测试/诊断：当前 boot 内登记数。 */
  listRuntimeIds(): string[];
  screen(
    input: RuntimeControlScreenInput
  ): Promise<RuntimeControlResult<AgentsScreenResult>>;
  start(
    input: RuntimeControlStartInput
  ): Promise<RuntimeControlResult<AgentsStartResult>>;
  terminate(
    input: RuntimeControlTargetInput
  ): Promise<RuntimeControlResult<{ terminated: true; runtime: RuntimeRef }>>;
  turn(
    input: RuntimeControlTurnInput
  ): Promise<RuntimeControlResult<AgentsTurnResult>>;
  wait(
    input: RuntimeControlWaitInput
  ): Promise<RuntimeControlResult<AgentsWaitResult>>;
  watch(
    input: RuntimeControlWatchInput
  ): Promise<RuntimeControlResult<AgentsWatchResult>>;
}

export interface CreateRuntimeControlServiceOptions {
  backend: TerminalBackend;
  bootId: string;
  nowMs?: (() => number) | undefined;
  /**
   * 解析 wait 谓词。默认：closed → exited；否则 fact 字符串匹配。
   */
  resolveFact?: ((record: RuntimeRecord) => string | undefined) | undefined;
}

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
    if (record.closed && !lookupOpts?.allowClosed) {
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

    async start(input) {
      if (!input.agentId.trim()) {
        return {
          ok: false,
          code: "invalid_command",
          message: "agents.start requires agentId",
        };
      }
      try {
        const created = await backend.create({
          agentId: input.agentId,
          cwd: input.cwd,
          windowId: input.windowId,
        });
        const prevGen = generationByRuntimeId.get(created.runtimeId) ?? 0;
        const generation = prevGen + 1;
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
          fact: "running",
          closed: false,
        };
        byRuntimeId.set(runtime.runtimeId, record);
        const data: AgentsStartResult = {
          runtime,
          agentId: input.agentId,
          panelId: created.panelId,
          windowId: created.windowId,
          ...(record.cwd ? { cwd: record.cwd, canonicalPath: record.cwd } : {}),
          ...(record.worktreeKey ? { worktreeKey: record.worktreeKey } : {}),
          ...(record.incarnationId
            ? { incarnationId: record.incarnationId }
            : {}),
        };
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
        const ok = await backend.sendText(record.panelId, input.text);
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "terminal rejected input",
          };
        }
        record.fact = "running";
        const data: AgentsTurnResult = {
          accepted: true,
          runtime: record.runtime,
        };
        return { ok: true, data };
      });
    },

    async screen(input) {
      const found = lookup(input);
      if (!found.ok) {
        return found;
      }
      const record = found.data;
      const viewport = await backend.readViewport(record.panelId);
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
        const ok = await backend.interrupt(record.panelId);
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "interrupt failed",
          };
        }
        record.fact = "interrupted";
        return {
          ok: true,
          data: { interrupted: true as const, runtime: record.runtime },
        };
      });
    },

    async terminate(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input);
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        const ok = await backend.terminate(record.panelId);
        if (!ok) {
          return {
            ok: false,
            code: "runtime_gone",
            message: "terminate failed",
          };
        }
        record.closed = true;
        record.fact = "exited";
        return {
          ok: true,
          data: { terminated: true as const, runtime: record.runtime },
        };
      });
    },

    async focus(input) {
      return enqueueRuntime(input.runtimeId, async () => {
        const found = lookup(input);
        if (!found.ok) {
          return found;
        }
        const record = found.data;
        if (backend.focus) {
          const ok = await backend.focus(record.panelId, record.windowId);
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
