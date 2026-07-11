export function readVersionedSnapshot<T>(version: number, read: () => T): T {
  if (!(Number.isSafeInteger(version) && version >= 0)) {
    throw new Error(`invalid external-store version: ${version}`);
  }
  return read();
}
