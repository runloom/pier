import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PIER_HOOK_COMMAND_GENERATION } from "../agent-hooks-install.ts";
import { atomicWriteFile } from "./shared.ts";

/**
 * 整文件托管插件/扩展的世代：与 shell hooks 的 pier-hook-gen 对齐。
 * 旧客户端不得覆盖磁盘上更高世代的托管文件。
 */
export const PIER_MANAGED_PLUGIN_GENERATION = PIER_HOOK_COMMAND_GENERATION;

/** 标准托管 marker：`pier-agent-status:v{N} (managed by Pier)` */
export function pierManagedPluginMarker(
  generation: number = PIER_MANAGED_PLUGIN_GENERATION
): string {
  return `pier-agent-status:v${generation} (managed by Pier)`;
}

const VERSIONED_MARKER_RE = /pier-agent-status:v(\d+)\s*\(managed by Pier\)/;

/**
 * 从托管文件内容解析世代。
 * - `pier-agent-status:v5 (managed by Pier)` → 5
 * - 仅有历史短语 `managed by Pier`（无 vN）→ 1
 * - 文案含 “not managed by pier” 不算托管（测试/用户文件常见否定句）
 * - 非托管 → null
 */
export function pierManagedPluginGeneration(content: string): number | null {
  const versioned = VERSIONED_MARKER_RE.exec(content);
  if (versioned) {
    const value = Number(versioned[1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  // 去掉否定短语后再匹配，避免 “// not managed by pier” 被误判为托管。
  const withoutNegation = content.replace(/not\s+managed by Pier/gi, "");
  if (/managed by Pier/i.test(withoutNegation)) {
    return 1;
  }
  return null;
}

/** 是否为 Pier 托管内容（任意世代）。 */
export function isPierManagedPluginContent(content: string): boolean {
  return pierManagedPluginGeneration(content) !== null;
}

export type ManagedPluginWriteResult =
  | "written"
  | "unchanged"
  | "skipped-unmanaged"
  | "skipped-newer";

export interface WriteManagedPluginFileOptions {
  /**
   * 本进程声称的世代（默认 PIER_MANAGED_PLUGIN_GENERATION）。
   * 磁盘已有更高世代时跳过写入。
   */
  generation?: number;
  /** 日志标签（agent id）。 */
  label: string;
  /** 写入后 chmod（如 cline hook 脚本 0o755）。 */
  mode?: number;
  /** 落盘绝对路径。 */
  path: string;
  /** 完整文件内容（须内含当前世代 marker）。 */
  source: string;
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 只前进写入托管插件/扩展文件：
 * - 非托管同名文件 → 跳过并 warn
 * - 磁盘世代 > 本进程 → 跳过（旧客户端不得降级）
 * - 字节相同 → 不落盘
 * - 否则 atomicWrite（+ 可选 chmod）
 */
export async function writeManagedPluginFile(
  options: WriteManagedPluginFileOptions
): Promise<ManagedPluginWriteResult> {
  const generation = options.generation ?? PIER_MANAGED_PLUGIN_GENERATION;
  const existing = await readTextFile(options.path);

  if (existing !== null) {
    const existingGen = pierManagedPluginGeneration(existing);
    if (existingGen === null) {
      console.warn(
        `[agent-hooks:${options.label}] unmanaged plugin file present, skip install:`,
        options.path
      );
      return "skipped-unmanaged";
    }
    if (existingGen > generation) {
      return "skipped-newer";
    }
    if (existing === options.source) {
      // 内容相同仍确保可执行位（cline 等依赖 [ -x ]；sync/手工可能丢 +x）。
      if (options.mode !== undefined) {
        await chmod(options.path, options.mode);
      }
      return "unchanged";
    }
  }

  await mkdir(dirname(options.path), { recursive: true });
  await atomicWriteFile(options.path, options.source);
  if (options.mode !== undefined) {
    await chmod(options.path, options.mode);
  }
  return "written";
}
