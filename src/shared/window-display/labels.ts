import type { WindowDisplayCopy } from "./copy.ts";
import { isDistinctQualifier, pathParentBasename } from "./identity.ts";
import type { WindowDisplay, WindowDisplayDraft } from "./types.ts";

function uniqueQualifiers(
  drafts: readonly WindowDisplayDraft[],
  indices: readonly number[],
  pick: (draft: WindowDisplayDraft) => string | undefined
): string[] | null {
  const values: string[] = [];
  for (const index of indices) {
    const draft = drafts[index];
    if (!draft) {
      return null;
    }
    const value = pick(draft)?.trim();
    if (!(value && isDistinctQualifier(value, draft.baseLabel))) {
      return null;
    }
    values.push(value);
  }
  if (new Set(values).size !== values.length) {
    return null;
  }
  return values;
}

function withQualifier(identity: string, qualifier: string): string {
  return `${identity} · ${qualifier}`;
}

function applyUniqueQualifiers(
  drafts: readonly WindowDisplayDraft[],
  indices: readonly number[],
  menuLabels: string[],
  values: readonly string[]
): void {
  indices.forEach((index, offset) => {
    const draft = drafts[index];
    const qualifier = values[offset];
    if (draft && qualifier) {
      menuLabels[index] = withQualifier(draft.baseLabel, qualifier);
    }
  });
}

function computeMenuLabels(
  drafts: readonly WindowDisplayDraft[],
  copy: WindowDisplayCopy
): string[] {
  const groups = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const list = groups.get(draft.baseLabel);
    if (list) {
      list.push(index);
    } else {
      groups.set(draft.baseLabel, [index]);
    }
  });

  const menuLabels = drafts.map((draft) => draft.baseLabel);
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      continue;
    }
    const branches = uniqueQualifiers(drafts, indices, (draft) => draft.branch);
    if (branches) {
      applyUniqueQualifiers(drafts, indices, menuLabels, branches);
      continue;
    }
    const parents = uniqueQualifiers(drafts, indices, (draft) =>
      draft.projectPath
        ? (pathParentBasename(draft.projectPath) ?? undefined)
        : undefined
    );
    if (parents) {
      applyUniqueQualifiers(drafts, indices, menuLabels, parents);
      continue;
    }
    const tabs = uniqueQualifiers(
      drafts,
      indices,
      (draft) => draft.tabQualifier
    );
    if (tabs) {
      applyUniqueQualifiers(drafts, indices, menuLabels, tabs);
      continue;
    }
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const draft = index === undefined ? undefined : drafts[index];
      if (index === undefined || !draft) {
        continue;
      }
      menuLabels[index] =
        i === 0
          ? draft.baseLabel
          : `${draft.baseLabel}${copy.sameNameIndex(i + 1)}`;
    }
  }
  return menuLabels;
}

export function disambiguateWindowLabels(
  drafts: readonly WindowDisplayDraft[],
  copy: WindowDisplayCopy
): WindowDisplay[] {
  const menuLabels = computeMenuLabels(drafts, copy);

  return drafts.map((draft, index) => {
    const menuLabel = menuLabels[index] ?? draft.baseLabel;
    const description =
      draft.description && isDistinctQualifier(draft.description, menuLabel)
        ? draft.description
        : undefined;
    const disambiguated = menuLabel === draft.baseLabel ? undefined : menuLabel;
    return {
      id: draft.id,
      label: menuLabel,
      menuLabel,
      recordId: draft.recordId,
      searchTerms: [
        ...draft.searchTerms,
        ...(disambiguated ? [disambiguated] : []),
      ],
      ...(description ? { description } : {}),
      ...(draft.detail ? { detail: draft.detail } : {}),
      ...(draft.iconKind ? { iconKind: draft.iconKind } : {}),
    };
  });
}
