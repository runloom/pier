/**
 * Node 原生跑 relay TS 时解析 tsconfig 的 `@shared/*`。
 * vitest 不走这里；仅 `pnpm dev:relay` 与容器 CMD 使用。
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@shared/")) {
    const mapped = pathToFileURL(
      join(repoRoot, "src/shared", specifier.slice("@shared/".length))
    );
    return nextResolve(mapped.href, context);
  }
  return nextResolve(specifier, context);
}
