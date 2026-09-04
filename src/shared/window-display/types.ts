export type WindowDisplayIconKind = "folder" | "git";

export interface WindowDisplay {
  description?: string;
  detail?: string;
  iconKind?: WindowDisplayIconKind;
  id: string;
  label: string;
  /** Single-line label for native menus / OS title. */
  menuLabel: string;
  recordId: string;
  searchTerms: readonly string[];
}

/** Renderer → main identity fields. `baseLabel` omitted means empty window. */
export interface WindowIdentityDraft {
  baseLabel?: string;
  branch?: string;
  iconKind?: WindowDisplayIconKind;
  id: string;
  projectPath?: string;
  recordId: string;
  stableTabQualifier?: string;
}

export interface WindowDisplayDraft {
  baseLabel: string;
  branch?: string;
  description?: string;
  detail?: string;
  iconKind?: WindowDisplayIconKind;
  id: string;
  projectPath?: string;
  recordId: string;
  searchTerms: string[];
  tabQualifier?: string;
}
