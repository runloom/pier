import { UNTITLED_DOCUMENT_ID_PREFIX } from "./files-document-draft-records.ts";

let nextUntitledIndex = 1;

export function syncNextUntitledIndex(documentId: string, name: string): void {
  if (!documentId.startsWith(UNTITLED_DOCUMENT_ID_PREFIX)) return;
  const index = Number.parseInt(
    /^Untitled-(\d+)\.md$/.exec(name)?.[1] ?? "",
    10
  );
  if (Number.isInteger(index) && index >= nextUntitledIndex) {
    nextUntitledIndex = index + 1;
  }
}

export function nextUntitledIdentity(input: {
  idExists: (id: string) => boolean;
  nameExists: (name: string) => boolean;
}): { id: string; index: number; name: string } {
  let index = nextUntitledIndex;
  let id = `${UNTITLED_DOCUMENT_ID_PREFIX}${crypto.randomUUID()}`;
  let name = `Untitled-${index}.md`;
  while (input.idExists(id) || input.nameExists(name)) {
    index += 1;
    id = `${UNTITLED_DOCUMENT_ID_PREFIX}${crypto.randomUUID()}`;
    name = `Untitled-${index}.md`;
  }
  nextUntitledIndex = index + 1;
  return { id, index, name };
}

export function resetUntitledIdentityForTests(): void {
  nextUntitledIndex = 1;
}
