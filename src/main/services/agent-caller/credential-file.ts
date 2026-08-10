/**
 * 从私有文件加载 AgentCaller 凭证材料（T3）。
 * Unix：拒绝非 owner、过宽权限、symlink（经 realpath + lstat 策略）。
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  type AgentCallerCredentialMaterial,
  agentCallerCredentialMaterialSchema,
} from "@shared/contracts/local-control/agent-credential.ts";

export type LoadCredentialFileResult =
  | { ok: true; material: AgentCallerCredentialMaterial }
  | { ok: false; message: string };

export function loadAgentCallerCredentialFile(
  filePath: string,
  opts?: { expectedUid?: number; platform?: NodeJS.Platform }
): LoadCredentialFileResult {
  const platform = opts?.platform ?? process.platform;
  try {
    const st = lstatSync(filePath);
    if (st.isSymbolicLink()) {
      return { ok: false, message: "credential path must not be a symlink" };
    }
    if (!st.isFile()) {
      return { ok: false, message: "credential path must be a regular file" };
    }
    if (platform !== "win32") {
      let expectedUid = opts?.expectedUid ?? null;
      if (expectedUid === null && typeof process.geteuid === "function") {
        expectedUid = process.geteuid();
      }
      if (expectedUid === null && typeof process.getuid === "function") {
        expectedUid = process.getuid();
      }
      if (expectedUid !== null && st.uid !== expectedUid) {
        return { ok: false, message: "credential file owner mismatch" };
      }
      // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
      const mode = st.mode & 0o777;
      // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
      if ((mode & 0o077) !== 0) {
        return { ok: false, message: "credential file permissions too open" };
      }
    }
    const real = realpathSync(filePath);
    const raw = readFileSync(real, "utf8");
    const json: unknown = JSON.parse(raw);
    const material = agentCallerCredentialMaterialSchema.parse(json);
    return { ok: true, material };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
