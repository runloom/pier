import { EventEmitter } from "node:events";
import {
  fetchCodexUsage,
  parseRateLimitsResult,
  type SpawnFn,
} from "@main/services/agent-accounts/codex-usage.ts";
import { describe, expect, it } from "vitest";

interface RpcMsg {
  id?: number;
  method?: string;
}

/**
 * 假 codex app-server 子进程：按写入的 JSON-RPC 请求驱动响应。
 * 响应经 setTimeout(0) 延后，确保发生在源码注册 stdout 监听器之后。
 */
function makeFakeSpawn(
  respond: (msg: RpcMsg, emit: (obj: unknown) => void) => void
): SpawnFn {
  return () => {
    const stdout = new EventEmitter();
    const emit = (obj: unknown): void => {
      setTimeout(
        () => stdout.emit("data", Buffer.from(`${JSON.stringify(obj)}\n`)),
        0
      );
    };
    const stdin = Object.assign(new EventEmitter(), {
      write(data: string) {
        for (const line of data.split("\n").filter(Boolean)) {
          try {
            respond(JSON.parse(line) as RpcMsg, emit);
          } catch {
            /* ignore */
          }
        }
        return true;
      },
    });
    const child = Object.assign(new EventEmitter(), {
      kill: () => {
        /* no-op */
      },
      stdin,
      stdout,
    });
    return child as unknown as ReturnType<SpawnFn>;
  };
}

/** 本机 codex-cli 0.142.5 实测响应（account/rateLimits/read）。 */
const REAL_RPC_RESULT = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: {
      usedPercent: 11,
      windowDurationMins: 300,
      resetsAt: 1_783_283_542,
    },
    secondary: {
      usedPercent: 49,
      windowDurationMins: 10_080,
      resetsAt: 1_783_389_343,
    },
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    individualLimit: null,
    planType: "pro",
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {},
  rateLimitResetCredits: { availableCount: 1 },
};

describe("parseRateLimitsResult", () => {
  it("解析实测完整响应", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.status).toBe("ok");
    expect(usage.session).toEqual({
      usedPercent: 11,
      windowMinutes: 300,
      resetsAt: 1_783_283_542_000, // epoch 秒 ×1000 → 毫秒
    });
    expect(usage.weekly).toEqual({
      usedPercent: 49,
      windowMinutes: 10_080,
      resetsAt: 1_783_389_343_000,
    });
  });

  it("resetsAt 从 epoch 秒转为 epoch 毫秒", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    // 验证毫秒级时间戳（2026 年范围）
    expect(usage.session?.resetsAt).toBeGreaterThan(1_700_000_000_000);
    expect(usage.weekly?.resetsAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("windowDurationMins 映射到 windowMinutes", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.session?.windowMinutes).toBe(300);
    expect(usage.weekly?.windowMinutes).toBe(10_080);
  });

  it("缺少 rateLimits 时返回 error", () => {
    const usage = parseRateLimitsResult({});
    expect(usage.status).toBe("error");
    expect(usage.error).toBeDefined();
  });

  it("缺少 primary/secondary 时对应字段为 undefined", () => {
    const usage = parseRateLimitsResult({
      rateLimits: { limitId: "codex" },
    });
    expect(usage.status).toBe("ok");
    expect(usage.session).toBeUndefined();
    expect(usage.weekly).toBeUndefined();
  });

  it("null 输入返回 error", () => {
    const usage = parseRateLimitsResult(null);
    expect(usage.status).toBe("error");
  });
});

describe("fetchCodexUsage JSON-RPC", () => {
  it("initialize 返回 error 时透传真实错误（不盲目往下走）", async () => {
    const spawnImpl = makeFakeSpawn((msg, emit) => {
      if (msg.method === "initialize") {
        emit({ error: { message: "unsupported client version" }, id: msg.id });
      }
      // 若未修复：initialize 的 error 被忽略、继续发 rateLimits，
      // 这里不响应 rateLimits → 最终超时/退出，错误信息丢失
    });
    const result = await fetchCodexUsage(new AbortController().signal, {
      spawnImpl,
    });
    expect(result.status).toBe("error");
    expect(result.error).toBe("unsupported client version");
  });

  it("正常握手 → 返回解析后的用量", async () => {
    const spawnImpl = makeFakeSpawn((msg, emit) => {
      if (msg.method === "initialize") {
        emit({ id: msg.id, result: {} });
      } else if (msg.method === "account/rateLimits/read") {
        emit({ id: msg.id, result: REAL_RPC_RESULT });
      }
    });
    const result = await fetchCodexUsage(new AbortController().signal, {
      spawnImpl,
    });
    expect(result.status).toBe("ok");
    expect(result.session?.usedPercent).toBe(11);
  });
});
