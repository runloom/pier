import type { ReactNode } from "react";

/**
 * 画板内联图标。live-module 围栏只放行 react / pier/canvas，
 * 不能 import 图标库，所以 24 网格线性图标直接写路径。
 */
export type IconName =
  | "bell"
  | "branch"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "clipboard"
  | "corner-up-left"
  | "file"
  | "folder"
  | "keyboard"
  | "laptop"
  | "lock"
  | "mini"
  | "panels"
  | "refresh"
  | "scan"
  | "search"
  | "studio"
  | "terminal"
  | "x";

const PATHS: Record<IconName, ReactNode> = {
  bell: (
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21h4" />
    </>
  ),
  branch: (
    <>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  clipboard: (
    <>
      <rect height="4" rx="1" width="8" x="8" y="2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  "corner-up-left": (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  keyboard: (
    <>
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
    </>
  ),
  laptop: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4z" />
      <path d="M2 19h20" />
    </>
  ),
  lock: (
    <>
      <rect height="10" rx="2" width="16" x="4" y="11" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  mini: (
    <>
      <rect height="8" rx="2.5" width="18" x="3" y="8" />
      <path d="M7 12h.01" />
      <path d="M11 12h6" />
    </>
  ),
  panels: (
    <>
      <rect height="14" rx="2" width="14" x="3" y="7" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>
  ),
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  studio: (
    <>
      <rect height="16" rx="2.5" width="14" x="5" y="4" />
      <path d="M9 8h.01" />
      <path d="M9 12h6" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 17 6-5-6-5" />
      <path d="M12 19h8" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
};

export function Icon(props: {
  name: IconName;
  className?: string | undefined;
  strokeWidth?: number | undefined;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className={props.className ?? "size-5"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={props.strokeWidth ?? 1.75}
      viewBox="0 0 24 24"
    >
      {PATHS[props.name]}
    </svg>
  );
}
