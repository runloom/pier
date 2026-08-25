/**
 * RuntimeControlService：持久 agent 运行控制门面（W3）。
 * 不持有任务台账；不产生工作完成结论。
 */
import {
  AGENTS_START_ASSEMBLED_MAX_BYTES,
  type AgentsScreenResult,
  type AgentsStartResult,
  type AgentsTurnResult,
  type AgentsWaitResult,
  type AgentsWatchResult,
} from "@shared/contracts/local-control/agents-runtime.ts";
import type { RuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { matchRuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import { clampScreenText } from "./screen-text.ts";
import type {
  RuntimeControlErr,
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
  /** E11：snapshot.runtimes 投影（摘要，无 screen 全文）。 */
  listRuntimeSummaries(): Array<{
    bootId: string;
    runtimeId: string;
    generation: number;
    agentId: string;
    panelId: string;
    windowId: string;
    fact: string;
    closed: boolean;
    worktreeKey?: string | undefined;
    cwd?: string | undefined;
  }>;
  /**
   * UI 关面板 → 释放：按 panelId 标记 closed 并释放子额占位。
   * 未登记 / 已 closed 的 panelId 静默忽略。
   */
  releaseForPanel(panelId: string): void;
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
  /** UI 关面板释放占额时的回调（ops 层注入 capability-hot-path）。 */
  releaseReservation?: ((runtimeId: string) => void) | undefined;
  /**
   * 解析 wait 谓词。默认：closed → exited；否则 fact 字符串匹配。
   */
  resolveFact?: ((record: RuntimeRecord) => string | undefined) | undefined;
}

type AssembledStartPrompt =
  | { ok: false; error: RuntimeControlErr }
  | { ok: true; text: string | undefined };

/**
 * 组装委派 marker + promptText（create 之前做，超限不建面）。
 * text 为 undefined 表示普通 start（无委派 prompt）。
 */
function assembleStartPrompt(
  input: RuntimeControlStartInput
): AssembledStartPrompt {
  if (input.promptText === undefined) {
    return { ok: true, text: undefined };
  }
  const kind = input.originAgentKind ?? "unknown";
  const panel = input.originPanelId ?? "unknown";
  const marker = `[Delegated by parent ${kind} panel ${panel}]\n\n`;
  const assembled = `${marker}${input.promptText}`;
  if (Buffer.byteLength(assembled, "utf8") > AGENTS_START_ASSEMBLED_MAX_BYTES) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "prompt_too_long",
        message: `assembled agents.start prompt exceeds ${AGENTS_START_ASSEMBLED_MAX_BYTES} bytes`,
      },
    };
  }
  return { ok: true, text: assembled };
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

    listRuntimeSummaries() {
      return [...byRuntimeId.values()].map((record) => ({
        bootId: record.runtime.bootId,
        runtimeId: record.runtime.runtimeId,
        generation: record.runtime.generation,
        agentId: record.agentId,
        panelId: record.panelId,
        windowId: record.windowId,
        fact: record.fact,
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
        if (assembled.text !== undefined) {
          // R17 投递补偿：create 成功但 prompt 送不到 → terminate 回滚清场。
          const delivered = await backend.deliverInitialPrompt(
            record.panelId,
            assembled.text
          );
          if (!delivered) {
            record.closed = true;
            await backend.terminate(record.panelId);
            return {
              ok: false,
              code: "prompt_undeliverable",
              message:
                "initial prompt could not be delivered; the spawned panel was terminated",
            };
          }
        }
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
      options.releaseReservation?.(record.runtime.runtimeId);
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
