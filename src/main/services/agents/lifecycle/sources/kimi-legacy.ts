import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";

const PEEK_BYTES = 1024;

function posixLower(binPath: string): string {
  return binPath.replaceAll("\\", "/").toLowerCase();
}

function tryRealpath(binPath: string): string {
  try {
    return realpathSync(binPath);
  } catch {
    return binPath;
  }
}

/** Official Kimi Code layout / npm package — never leftover Python CLI. */
export function isKimiCodeInstallPath(binPath: string): boolean {
  const p = posixLower(binPath);
  return (
    p.includes("/.kimi-code/") ||
    p.includes("/kimi-code/") ||
    p.includes("@moonshot-ai/kimi-code")
  );
}

/** Path-segment check (no fs). */
export function isLegacyKimiCliPath(binPath: string): boolean {
  const p = posixLower(binPath);
  return (
    p.endsWith("/kimi-cli") ||
    p.endsWith("/kimi-cli.exe") ||
    p.includes("/kimi-cli/")
  );
}

function isNativeExecutableHeader(buf: Buffer): boolean {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
    return true;
  }
  if (buf.length < 4) {
    return false;
  }
  const b0 = buf[0];
  const b1 = buf[1];
  const b2 = buf[2];
  const b3 = buf[3];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  ) {
    return false;
  }
  // ELF
  if (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) {
    return true;
  }
  // Mach-O 32/64 + universal (BE/LE)
  return (
    (b0 === 0xfe &&
      b1 === 0xed &&
      b2 === 0xfa &&
      (b3 === 0xce || b3 === 0xcf)) ||
    (b0 === 0xce && b1 === 0xfa && b2 === 0xed && b3 === 0xfe) ||
    (b0 === 0xcf && b1 === 0xfa && b2 === 0xed && b3 === 0xfe) ||
    (b0 === 0xca && b1 === 0xfe && b2 === 0xba && b3 === 0xbe) ||
    (b0 === 0xbe && b1 === 0xba && b2 === 0xfe && b3 === 0xca)
  );
}

function readPeek(binPath: string): Buffer | null {
  try {
    const fd = openSync(binPath, "r");
    try {
      const buf = Buffer.alloc(PEEK_BYTES);
      const n = readSync(fd, buf, 0, PEEK_BYTES, 0);
      return buf.subarray(0, n);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function peekIsLegacyKimiCli(text: string): boolean {
  return /\bkimi-cli\b/i.test(text) || /\bkimi_cli\b/.test(text);
}

function peekIsKimiCode(text: string): boolean {
  return /kimi-code/i.test(text) || /@moonshot-ai\/kimi-code/.test(text);
}

function hasKimiCliSibling(binPath: string): boolean {
  const dir = dirname(binPath);
  return (
    existsSync(join(dir, "kimi-cli")) || existsSync(join(dir, "kimi-cli.exe"))
  );
}

/**
 * Leftover Python `kimi-cli` (uv tool), not Kimi Code.
 * Follows realpath so PATH `~/.local/bin/kimi` → uv `.../kimi-cli/...` is skipped;
 * also catches copies/trampolines whose reported path has no `kimi-cli` segment.
 */
export function isLegacyKimiCliInstall(binPath: string): boolean {
  const resolved = tryRealpath(binPath);
  const candidates = resolved === binPath ? [binPath] : [binPath, resolved];
  if (candidates.some((p) => isKimiCodeInstallPath(p))) {
    return false;
  }
  if (candidates.some((p) => isLegacyKimiCliPath(p))) {
    return true;
  }

  const peekPath = resolved;
  const peek = readPeek(peekPath);
  if (peek && isNativeExecutableHeader(peek)) {
    return false;
  }
  const text = peek ? peek.toString("latin1") : "";
  if (text && peekIsKimiCode(text)) {
    return false;
  }
  if (text && peekIsLegacyKimiCli(text)) {
    return true;
  }
  return candidates.some((p) => hasKimiCliSibling(p));
}
