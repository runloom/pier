import { homedir } from "node:os";
import { join } from "node:path";
import { resolveProjectIdentity } from "./project-identity.ts";

export const PIER_MEMORY_STORE_ENV = "PIER_MEMORY_STORE";

/**
 * v3 T6:智能体/任务/AI one-shot 环境注入记忆 store 绝对路径。
 * 启动器以此为权威解析(env 优先),不依赖各智能体拉起 stdio server 的
 * cwd 行为差异;非 git 注册项目也因此获得确定身份(启动器 cwd 兜底仅限 git)。
 * 解析失败(cwd 缺失/不可达)返回空补丁,绝不阻塞会话创建。
 */
export async function memoryStoreEnvPatch(
  cwd: string | undefined,
  home: string = homedir()
): Promise<Record<string, string>> {
  if (!cwd) {
    return {};
  }
  try {
    const identity = await resolveProjectIdentity(cwd);
    return {
      [PIER_MEMORY_STORE_ENV]: join(
        home,
        ".pier",
        "memory",
        identity.key,
        "memory.jsonl"
      ),
    };
  } catch {
    return {};
  }
}

/** 与 extra-root 同语义:不覆盖调用方已显式设置的键。 */
export function mergeMemoryStoreEnv(
  env: Record<string, string>,
  patch: Record<string, string>
): Record<string, string> {
  const next = { ...env };
  for (const [key, value] of Object.entries(patch)) {
    if (next[key]) {
      continue;
    }
    next[key] = value;
  }
  return next;
}
