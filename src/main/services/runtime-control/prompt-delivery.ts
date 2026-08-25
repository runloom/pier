/**
 * 首轮 prompt 投递重试核心（与 native addon 解耦，可无头单测）。
 * 门控（OSC7/painted 等待）留在 host-backend；这里只管「贴不上→退避重贴；
 * 已贴上但回车丢→只补回车；预算耗尽→放弃」。
 */

/** 对齐 create-post-actions 重试节奏；尾部延长覆盖慢 shell 启动。 */
export const PROMPT_DELIVER_RETRY_DELAYS_MS = [
  50, 100, 200, 400, 800, 800, 800,
];
export const DELIVER_PROMPT_TOTAL_BUDGET_MS = 10_000;

export interface PromptDeliveryIo {
  /** 贴入并提交（pasteTerminalText submit:true）。 */
  paste(text: string): Promise<{
    ok: boolean;
    textDelivered?: boolean | undefined;
  }>;
  /** 只补合成回车（sendTerminalSubmitReturn）。 */
  submitReturn(): Promise<boolean>;
}

export interface PromptDeliveryOptions {
  budgetMs?: number;
  delays?: readonly number[];
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export function deliverPromptWithBackoff(
  io: PromptDeliveryIo,
  text: string,
  options: PromptDeliveryOptions = {}
): Promise<boolean> {
  const delays = options.delays ?? PROMPT_DELIVER_RETRY_DELAYS_MS;
  const budgetMs = options.budgetMs ?? DELIVER_PROMPT_TOTAL_BUDGET_MS;
  const nowMs = options.nowMs ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const deadline = nowMs() + budgetMs;

  const attemptLoop = async (attempt: number, delivered: boolean) => {
    const result = delivered
      ? { ok: await io.submitReturn(), textDelivered: true }
      : await io.paste(text);
    if (result.ok) {
      return true;
    }
    const waitMs = delays[attempt];
    if (waitMs === undefined || nowMs() >= deadline) {
      return false;
    }
    await sleep(waitMs);
    return attemptLoop(attempt + 1, delivered || result.textDelivered === true);
  };

  return attemptLoop(0, false);
}
