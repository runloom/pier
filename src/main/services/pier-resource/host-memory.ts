import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 进程生命周期内缓存 pagesize，避免每拍再调一次。 */
let cachedDarwinPageSize: number | null = null;

/**
 * 主机「可用」内存（字节）——异步，供 2s 采样路径使用。
 *
 * - macOS：free + inactive + speculative + purgeable
 * - 其它平台：os.freemem()
 */
export async function readHostMemoryAvailableBytes(): Promise<number> {
  if (process.platform === "darwin") {
    const fromVm = await readDarwinAvailableBytes();
    if (fromVm !== null) {
      return fromVm;
    }
  }
  return os.freemem();
}

export function readHostMemoryTotalBytes(): number {
  return os.totalmem();
}

export function readHostLogicalCpuCount(): number {
  const count = os.cpus().length;
  return count > 0 ? count : 1;
}

/**
 * 解析 `vm_stat`。页大小优先读文件头 "page size of N"，否则 pageSizeFallback。
 * 导出供单测注入输出。
 */
export function parseDarwinVmStatAvailableBytes(
  output: string,
  pageSizeFallback: number
): number | null {
  const pageSizeMatch = /page size of\s+(\d+)/i.exec(output);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : pageSizeFallback;
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  const pages = (label: string): number => {
    // "Pages free:                               12345."
    const re = new RegExp(`Pages\\s+${label}:\\s+([\\d.]+)`, "i");
    const match = re.exec(output);
    if (!match?.[1]) {
      return 0;
    }
    const value = Number(match[1].replace(/\./g, ""));
    return Number.isFinite(value) ? value : 0;
  };

  // free + inactive + speculative + purgeable ≈ 可快速回收
  const free = pages("free");
  const inactive = pages("inactive");
  const speculative = pages("speculative");
  const purgeable = pages("purgeable");
  const totalPages = free + inactive + speculative + purgeable;
  if (totalPages <= 0 && free === 0 && inactive === 0) {
    return null;
  }
  return totalPages * pageSize;
}

async function darwinPageSizeFallback(): Promise<number> {
  if (cachedDarwinPageSize !== null) {
    return cachedDarwinPageSize;
  }
  try {
    const { stdout } = await execFileAsync("pagesize", [], {
      encoding: "utf8",
      timeout: 500,
    });
    const value = Number(stdout.trim());
    if (Number.isFinite(value) && value > 0) {
      cachedDarwinPageSize = value;
      return value;
    }
  } catch {
    // fall through
  }
  // Apple Silicon 常见 16K；Intel 4K
  cachedDarwinPageSize = process.arch === "arm64" ? 16_384 : 4096;
  return cachedDarwinPageSize;
}

async function readDarwinAvailableBytes(): Promise<number | null> {
  try {
    const [{ stdout }, pageSize] = await Promise.all([
      execFileAsync("vm_stat", [], {
        encoding: "utf8",
        timeout: 1000,
      }),
      darwinPageSizeFallback(),
    ]);
    return parseDarwinVmStatAvailableBytes(stdout, pageSize);
  } catch {
    return null;
  }
}

/** 测试用 */
export function resetHostMemoryCacheForTests(): void {
  cachedDarwinPageSize = null;
}
