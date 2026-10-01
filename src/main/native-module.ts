import { createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);

/** src/main and bundled out/main have the same depth relative to native/. */
export function loadNativeBinding<T>(): { addon: T; addonPath: string } {
  const addonPath = nativeRequire.resolve(
    "../../native/build/Release/ghostty_native.node"
  );
  return { addon: nativeRequire(addonPath), addonPath };
}
