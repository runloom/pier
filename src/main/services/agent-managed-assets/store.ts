import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export class MemoryStoreManager {
  readonly #baseDir: string;

  constructor(options: { baseDir: string }) {
    this.#baseDir = options.baseDir;
  }

  async ensure(key: string): Promise<{ storePath: string }> {
    const dir = join(this.#baseDir, key);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storePath = join(dir, "memory.jsonl");
    const handle = await open(storePath, "a", 0o600);
    await handle.close();
    return { storePath };
  }

  async stats(storePath: string): Promise<{
    entities: number | null;
    observations: number | null;
  }> {
    const info = await stat(storePath).catch(() => null);
    if (!info || info.size > MAX_SCAN_BYTES) {
      return { entities: null, observations: null };
    }
    let entities = 0;
    let observations = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(storePath, { encoding: "utf8" });
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk;
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          this.#countLine(
            buffer.slice(0, idx),
            (entityDelta, observationDelta) => {
              entities += entityDelta;
              observations += observationDelta;
            }
          );
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        this.#countLine(buffer, (entityDelta, observationDelta) => {
          entities += entityDelta;
          observations += observationDelta;
        });
        resolve();
      });
      stream.on("error", reject);
    });
    return { entities, observations };
  }

  #countLine(
    line: string,
    sink: (entities: number, observations: number) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const row = JSON.parse(trimmed) as {
        observations?: unknown[];
        type?: string;
      };
      if (row.type === "entity") {
        sink(1, Array.isArray(row.observations) ? row.observations.length : 0);
      }
    } catch {
      // 破损行容忍
    }
  }
}
