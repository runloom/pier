import type { PluginManifest } from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { PluginServiceError } from "./plugin-service-error.ts";

function guessManifestId(raw: unknown): string | null {
  if (!(raw && typeof raw === "object" && "id" in raw)) {
    return null;
  }
  const id = (raw as { id: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function formatManifestParseIssues(
  issues: readonly { message: string; path: readonly PropertyKey[] }[]
): string {
  return issues
    .slice(0, 8)
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parsePluginManifest(raw: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const id = guessManifestId(raw);
    const detail = formatManifestParseIssues(parsed.error.issues);
    throw new PluginServiceError(
      "invalid_manifest",
      id
        ? `invalid plugin manifest (${id}): ${detail}`
        : `invalid plugin manifest: ${detail}`
    );
  }
  return parsed.data;
}

export async function readLocalPluginManifest(
  path: string,
  readTextFile: (path: string) => Promise<string>
): Promise<PluginManifest> {
  try {
    return parsePluginManifest(JSON.parse(await readTextFile(path)));
  } catch (err) {
    if (err instanceof PluginServiceError) {
      throw err;
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new PluginServiceError(
      "invalid_manifest",
      `invalid plugin manifest: failed to read ${path}: ${reason}`
    );
  }
}
