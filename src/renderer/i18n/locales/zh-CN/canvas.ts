export const canvas = {
  file: {
    conflict: "{{name}} 已被其他地方改动，请先重新加载再保存。",
    invalidName: "画布只能读写自己目录里的文件。",
    readFailed: "读不到 {{name}}，它不是文本文件。",
    unavailable: "当前画布不是从文件打开的，无法保存。",
    writeFailed: "保存 {{name}} 失败。",
  },
} as const;
