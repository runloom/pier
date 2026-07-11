import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export async function computePackageContentHash(
  packageDir: string
): Promise<string> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error(`unsupported package entry: ${path}`);
      }
    }
  }
  await visit(packageDir);
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const path of files) {
    const relativePath = relative(packageDir, path).split(sep).join("/");
    const content = await readFile(path);
    hash.update(String(Buffer.byteLength(relativePath)));
    hash.update(":");
    hash.update(relativePath);
    hash.update(":");
    hash.update(String(content.byteLength));
    hash.update(":");
    hash.update(content);
  }
  return hash.digest("hex");
}
