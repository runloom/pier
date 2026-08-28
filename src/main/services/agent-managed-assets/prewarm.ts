import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_PACKAGE } from "./serializers.ts";

const PREWARM_TIMEOUT_MS = 180_000;

export type MemoryPrewarmRunner = () => Promise<void>;

/**
 * 预热 npx 包缓存:enable 后后台跑一次引擎,首个智能体会话不再等冷启动下载。
 * stdio 服务器在 stdin EOF 后退出;超时强杀视为失败(下次 enable 事件重试)。
 *
 * Class A(shell-env parity):spawn env 由调用方经 processEnvironment.resolve
 * 预解析注入(见 app-core/pier-home.ts onEnabled 接线),不直接消费 process.env。
 */
export function createNpxMemoryPrewarmRunner(options: {
  resolveEnv: () => Promise<NodeJS.ProcessEnv>;
}): MemoryPrewarmRunner {
  return async () => {
    const env = await options.resolveEnv();
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npx", ["-y", ENGINE_PACKAGE], {
        env: {
          ...env,
          MEMORY_FILE_PATH: join(
            tmpdir(),
            `pier-memory-prewarm-${process.pid}.jsonl`
          ),
        },
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.stdin?.end();
      let killedByTimeout = false;
      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGKILL");
      }, PREWARM_TIMEOUT_MS);
      timer.unref();
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (killedByTimeout) {
          // 超时强杀不能当成功:缓存未必完整,保留下次 enable 事件重试。
          reject(new Error("engine prewarm timed out"));
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npx exited with code ${String(code)}`));
        }
      });
    });
  };
}

let inflight: Promise<void> | null = null;
let warmed = false;

/** 进程内一次成功即终身有效;失败(如离线)允许下次 enable 事件重试。 */
export function prewarmMemoryEngine(run: MemoryPrewarmRunner): Promise<void> {
  if (warmed) {
    return Promise.resolve();
  }
  if (!inflight) {
    inflight = run()
      .then(() => {
        warmed = true;
      })
      .catch((err: unknown) => {
        // 预热失败不面向用户:离线时首个会话自然回退到 npx 冷启动。
        console.error("[memory] engine prewarm failed:", err);
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function resetMemoryEnginePrewarmForTests(): void {
  inflight = null;
  warmed = false;
}
