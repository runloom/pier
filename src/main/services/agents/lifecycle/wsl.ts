/**
 * Wrap a posix command for execution inside a WSL distro from Windows host.
 */

const DISTRO_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SHELL_RE = /^(sh|bash|zsh|fish|dash)$/;

export function isValidWslDistroName(name: string): boolean {
  return DISTRO_NAME_RE.test(name);
}

export function wrapCommandForWsl(options: {
  command: string;
  distro: string;
  shell?: string;
}): string {
  if (!isValidWslDistroName(options.distro)) {
    throw new Error(`Invalid WSL distro name: ${options.distro}`);
  }
  const shell = options.shell ?? "sh";
  if (!SHELL_RE.test(shell)) {
    throw new Error(`Invalid WSL shell: ${shell}`);
  }
  // Escape double quotes for cmd-style arg to wsl.exe
  const quoted = `"${options.command.replace(/"/g, '\\"')}"`;
  return `wsl.exe -d ${options.distro} -- ${shell} -lc ${quoted}`;
}

/** Heuristic: UNC path under \\wsl$\Distro\... */
export function wslDistroFromPath(path: string): string | null {
  const normalized = path.replace(/\//g, "\\");
  const match = /^\\\\wsl\$\\([^\\]+)\\/i.exec(normalized);
  if (!match?.[1]) {
    return null;
  }
  return isValidWslDistroName(match[1]) ? match[1] : null;
}
