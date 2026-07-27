export const canvas = {
  file: {
    conflict: "{{name}} changed on disk. Reload it before saving again.",
    invalidName: "A canvas may only read or write files next to itself.",
    readFailed: "Couldn’t read {{name}} — it isn’t a text file.",
    unavailable: "This canvas isn’t opened from a file, so it can’t save.",
    writeFailed: "Couldn’t save {{name}}.",
  },
} as const;
