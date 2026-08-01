import { dirname } from "node:path";

/**
 * PATH for spawning agent hook shell commands that invoke
 * `#!/usr/bin/env node` helpers (extract-stdin-meta, emit).
 *
 * Prefer the current process Node binary's directory over mise/asdf shims so
 * untrusted shim configs cannot exit 1 and silently drop tool identity fields.
 */
export function pathForHookSpawn(
  originalPath = process.env.PATH ?? ""
): string {
  const nodeDir = dirname(process.execPath);
  // Always put this process's Node directory first so `#!/usr/bin/env node`
  // cannot resolve a broken mise/asdf shim ahead of a working binary.
  const rest = originalPath
    .split(":")
    .filter((segment) => segment.length > 0 && segment !== nodeDir)
    .join(":");
  return rest ? `${nodeDir}:${rest}` : nodeDir;
}
