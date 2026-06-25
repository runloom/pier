import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_BACKDROP_FILTER = /backdrop-(?:blur|filter)|backdropFilter/;
const FORBIDDEN_FIXED_SCRIM = /bg-black\/30/;
const SOURCE_FILE_EXTENSION = /\.(css|tsx?|jsx?)$/;
const SOURCE_ROOT = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (SOURCE_FILE_EXTENSION.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("renderer overlay effects", () => {
  it("does not use backdrop filters because Pier renders native terminal surfaces under transparent web chrome", () => {
    const offenders = sourceFiles(SOURCE_ROOT).filter((file) =>
      FORBIDDEN_BACKDROP_FILTER.test(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("uses theme-aware overlay scrims instead of fixed black opacity", () => {
    const offenders = sourceFiles(SOURCE_ROOT).filter((file) =>
      FORBIDDEN_FIXED_SCRIM.test(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });
});
