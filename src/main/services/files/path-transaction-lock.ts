import { isAbsolute, normalize, relative, sep } from "node:path";

interface LockRequest {
  paths: readonly string[];
  resolve: (release: () => void) => void;
  token: symbol;
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  const fromAncestor = relative(ancestor, path);
  return (
    fromAncestor === "" ||
    (fromAncestor !== ".." &&
      !fromAncestor.startsWith(`..${sep}`) &&
      !isAbsolute(fromAncestor))
  );
}

function pathsConflict(left: readonly string[], right: readonly string[]) {
  return left.some((leftPath) =>
    right.some(
      (rightPath) =>
        isSameOrDescendant(leftPath, rightPath) ||
        isSameOrDescendant(rightPath, leftPath)
    )
  );
}

/** 主进程文件写入和路径变更共用的层级锁；目录锁覆盖全部后代。 */
export class FilePathTransactionLock {
  readonly #active = new Map<symbol, readonly string[]>();
  readonly #pending: LockRequest[] = [];

  async run<T>(paths: readonly string[], operation: () => Promise<T>) {
    const release = await this.acquire(paths);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  acquire(paths: readonly string[]): Promise<() => void> {
    const normalizedPaths = [...new Set(paths.map((path) => normalize(path)))];
    const token = Symbol("file-path-transaction");
    return new Promise((resolve) => {
      this.#pending.push({ paths: normalizedPaths, resolve, token });
      this.#drain();
    });
  }

  #drain(): void {
    for (let index = 0; index < this.#pending.length; ) {
      const request = this.#pending[index];
      if (
        !request ||
        this.#pending
          .slice(0, index)
          .some((earlier) => pathsConflict(earlier.paths, request.paths)) ||
        [...this.#active.values()].some((paths) =>
          pathsConflict(paths, request.paths)
        )
      ) {
        index += 1;
        continue;
      }
      this.#pending.splice(index, 1);
      this.#active.set(request.token, request.paths);
      let released = false;
      request.resolve(() => {
        if (released) {
          return;
        }
        released = true;
        this.#active.delete(request.token);
        this.#drain();
      });
    }
  }
}
