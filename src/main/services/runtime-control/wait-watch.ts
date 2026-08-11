/**
 * wait / watch 轮询与谓词（从 service 拆出，控制文件行数）。
 */
import type {
  AgentsWaitResult,
  AgentsWaitUntil,
  AgentsWatchResult,
  AgentsWatchSample,
} from "@shared/contracts/local-control/agents-runtime.ts";
import { matchRuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";
import type {
  RuntimeControlResult,
  RuntimeControlWaitInput,
  RuntimeControlWatchInput,
  RuntimeRecord,
} from "./types.ts";

export function factMatches(
  until: AgentsWaitUntil,
  fact: string,
  closed: boolean
): boolean {
  if (until === "exited") {
    return closed || fact === "exited" || fact === "stopped";
  }
  if (until === "waiting") {
    return fact === "waiting" || fact === "waiting_input";
  }
  if (until === "attention") {
    // Index 常用 waiting；与 waiting_input / error 一并视作需人处理
    return (
      fact === "attention" ||
      fact === "waiting" ||
      fact === "waiting_input" ||
      fact === "error"
    );
  }
  // ready：空闲/可输入，绝不把 processing/running 当 ready
  return fact === "ready" || fact === "idle";
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWaitLoop(args: {
  input: RuntimeControlWaitInput;
  byRuntimeId: Map<string, RuntimeRecord>;
  resolveFact?: ((record: RuntimeRecord) => string | undefined) | undefined;
  nowMs: () => number;
  initial: RuntimeRecord;
}): Promise<RuntimeControlResult<AgentsWaitResult>> {
  const { input, byRuntimeId, resolveFact, nowMs, initial } = args;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const clock = input.nowMs ?? nowMs;
  const sleep = input.sleepMs ?? defaultSleep;
  const deadline = clock() + timeoutMs;

  while (true) {
    const record = byRuntimeId.get(input.runtimeId);
    if (!record) {
      return {
        ok: false,
        code: "runtime_gone",
        message: "runtime gone during wait",
      };
    }
    const match = matchRuntimeRef({
      expected: {
        bootId: input.bootId,
        runtimeId: input.runtimeId,
        generation: input.generation,
      },
      actual: record.runtime,
    });
    if (!match.ok) {
      return {
        ok: false,
        code: match.code,
        message: "runtime identity changed during wait",
      };
    }
    let fact: string;
    try {
      fact = resolveFact?.(record) ?? (record.closed ? "exited" : record.fact);
    } catch (error) {
      return {
        ok: false,
        code: "internal_error",
        message:
          error instanceof Error
            ? `resolveFact failed: ${error.message}`
            : "resolveFact failed",
      };
    }
    if (factMatches(input.until, fact, record.closed)) {
      const data: AgentsWaitResult = {
        until: input.until,
        reached: true,
        fact,
        runtime: record.runtime,
      };
      return { ok: true, data };
    }
    if (clock() >= deadline) {
      const data: AgentsWaitResult = {
        until: input.until,
        reached: false,
        fact,
        runtime: record.runtime,
      };
      return { ok: true, data };
    }
    const remaining = Math.max(1, Math.min(50, deadline - clock()));
    try {
      await sleep(remaining, input.signal);
    } catch (error) {
      const aborted =
        error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        // 与 watch reason=cancelled 对齐：ok:true，勿映射 timeout→CLI 124
        const data: AgentsWaitResult = {
          until: input.until,
          reached: false,
          fact,
          runtime: record.runtime,
          cancelled: true,
        };
        return { ok: true, data };
      }
      return {
        ok: false,
        code: "internal_error",
        message: "wait failed",
      };
    }
  }
  // initial keeps callers' type path explicit; loop always returns
  return {
    ok: true,
    data: {
      until: input.until,
      reached: false,
      runtime: initial.runtime,
    },
  };
}

export async function runWatchLoop(args: {
  input: RuntimeControlWatchInput;
  byRuntimeId: Map<string, RuntimeRecord>;
  resolveFact?: ((record: RuntimeRecord) => string | undefined) | undefined;
  nowMs: () => number;
  initial: RuntimeRecord;
}): Promise<RuntimeControlResult<AgentsWatchResult>> {
  const { input, byRuntimeId, resolveFact, nowMs, initial } = args;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const pollMs = input.pollMs ?? 100;
  const clock = input.nowMs ?? nowMs;
  const sleep = input.sleepMs ?? defaultSleep;
  const deadline = clock() + timeoutMs;
  const samples: AgentsWatchSample[] = [];
  let lastFact: string | undefined;
  let reason: AgentsWatchResult["reason"] = "timeout";

  while (true) {
    if (input.signal?.aborted) {
      reason = "cancelled";
      break;
    }
    const record = byRuntimeId.get(input.runtimeId);
    if (!record) {
      reason = "gone";
      break;
    }
    const match = matchRuntimeRef({
      expected: {
        bootId: input.bootId,
        runtimeId: input.runtimeId,
        generation: input.generation,
      },
      actual: record.runtime,
    });
    if (!match.ok) {
      reason = "gone";
      break;
    }
    let fact: string;
    try {
      fact = resolveFact?.(record) ?? (record.closed ? "exited" : record.fact);
    } catch {
      reason = "gone";
      break;
    }
    if (fact !== lastFact) {
      const sample: AgentsWatchSample = {
        fact,
        ts: clock(),
        runtime: record.runtime,
      };
      samples.push(sample);
      lastFact = fact;
      input.onSample?.(sample);
    }
    if (record.closed || fact === "exited" || fact === "stopped") {
      reason = "exited";
      break;
    }
    if (clock() >= deadline) {
      reason = "timeout";
      break;
    }
    const remaining = Math.max(1, Math.min(pollMs, deadline - clock()));
    try {
      await sleep(remaining, input.signal);
    } catch {
      reason = "cancelled";
      break;
    }
  }

  const record = byRuntimeId.get(input.runtimeId);
  const runtime = record?.runtime ?? initial.runtime;
  const data: AgentsWatchResult = {
    ended: true,
    reason,
    samples,
    runtime,
  };
  return { ok: true, data };
}
