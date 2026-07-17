export type ParsedTerminalOpenUrl =
  | { kind: "remote"; url: string }
  | { kind: "local-path"; path: string }
  | { kind: "unresolved"; reason: "relative-without-cwd" | "invalid" };

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveAgainstAbsoluteCwd(cwd: string, relative: string): string {
  const cwdNorm = cwd.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const segments = relative.replace(/\\/g, "/").split("/");
  const stack = cwdNorm === "/" ? [""] : cwdNorm.split("/");
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 1 && stack[0] === "") {
    return "/";
  }
  return stack.join("/");
}

function fileUrlToPath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "file:") {
      return null;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname.length > 0 ? pathname : null;
  } catch {
    return null;
  }
}

function hasRemoteScheme(raw: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.toLowerCase().startsWith("file:")
  );
}

export function parseTerminalOpenUrl(
  rawInput: string,
  cwd: string | null
): ParsedTerminalOpenUrl {
  const raw = rawInput.trim();
  if (!raw) {
    return { kind: "unresolved", reason: "invalid" };
  }
  if (hasRemoteScheme(raw)) {
    return { kind: "remote", url: raw };
  }
  if (raw.toLowerCase().startsWith("file:")) {
    const path = fileUrlToPath(raw);
    if (!path) {
      return { kind: "unresolved", reason: "invalid" };
    }
    return { kind: "local-path", path };
  }
  if (isAbsolutePath(raw)) {
    return { kind: "local-path", path: raw };
  }
  if (!(cwd && isAbsolutePath(cwd))) {
    return { kind: "unresolved", reason: "relative-without-cwd" };
  }
  return {
    kind: "local-path",
    path: resolveAgainstAbsoluteCwd(cwd, raw),
  };
}
