import { UNTITLED_DOCUMENT_ID_PREFIX } from "./draft-records.ts";

export type UntitledNameKind = "markdown" | "plain";

const UNTITLED_INDEX_PATTERN = /^Untitled-(\d+)(?:\.md)?$/;

let nextUntitledIndex = 1;

export function untitledDisplayName(
  index: number,
  kind: UntitledNameKind = "plain"
): string {
  return kind === "markdown" ? `Untitled-${index}.md` : `Untitled-${index}`;
}

export function syncNextUntitledIndex(documentId: string, name: string): void {
  if (!documentId.startsWith(UNTITLED_DOCUMENT_ID_PREFIX)) return;
  const index = Number.parseInt(
    UNTITLED_INDEX_PATTERN.exec(name)?.[1] ?? "",
    10
  );
  if (Number.isInteger(index) && index >= nextUntitledIndex) {
    nextUntitledIndex = index + 1;
  }
}

export function nextUntitledIdentity(input: {
  idExists: (id: string) => boolean;
  nameExists: (name: string) => boolean;
  nameKind?: UntitledNameKind;
}): { id: string; index: number; name: string } {
  const nameKind = input.nameKind ?? "plain";
  let index = nextUntitledIndex;
  let id = `${UNTITLED_DOCUMENT_ID_PREFIX}${crypto.randomUUID()}`;
  let name = untitledDisplayName(index, nameKind);
  while (input.idExists(id) || input.nameExists(name)) {
    index += 1;
    id = `${UNTITLED_DOCUMENT_ID_PREFIX}${crypto.randomUUID()}`;
    name = untitledDisplayName(index, nameKind);
  }
  nextUntitledIndex = index + 1;
  return { id, index, name };
}

export function resetUntitledIdentityForTests(): void {
  nextUntitledIndex = 1;
}
