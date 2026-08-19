import { Stack } from "pier/canvas";
import { DocCode, DocSection, FieldTable } from "./host-docs.tsx";

export function CanvasFileApiDocs() {
  return (
    <Stack gap={16}>
      <DocSection title="签名">
        <DocCode>{"function useCanvasFile(): CanvasFileApi"}</DocCode>
      </DocSection>
      <DocSection title="安装">
        <DocCode>{'import { useCanvasFile } from "pier/canvas"'}</DocCode>
      </DocSection>
      <DocSection title="用法">
        <DocCode
        >{`const file = useCanvasFile()
if (!file.available) {
  return
}
const { contents, revision } = await file.read("data.json")
const outcome = await file.write("data.json", contents, revision)
if (outcome.kind === "conflict") {
  await file.read("data.json")
}`}</DocCode>
      </DocSection>
      <DocSection title="返回值">
        <DocCode
        >{`interface CanvasFileApi {
  available: boolean
  directory: string
  read(fileName: string): Promise<CanvasFileReadResult>
  write(
    fileName: string,
    contents: string,
    expectedRevision: string | null
  ): Promise<CanvasFileWriteOutcome>
}`}</DocCode>
        <FieldTable
          rows={[
            {
              description: "从文件打开、有相邻文件作用域时为真。",
              name: "available",
              type: "boolean",
            },
            {
              description: "画布所在的项目相对目录。",
              name: "directory",
              type: "string",
            },
            {
              description: "读取相邻文本文件，返回内容和 revision。",
              name: "read",
              type: "(fileName: string) => Promise<CanvasFileReadResult>",
            },
            {
              description:
                "写入相邻文件。传入 read 得到的 revision；仅当文件必须不存在时才传 null。",
              name: "write",
              type: "(fileName: string, contents: string, expectedRevision: string | null) => Promise<CanvasFileWriteOutcome>",
            },
          ]}
        />
      </DocSection>
      <DocSection title="嵌套类型">
        <Stack gap={6}>
          <DocCode
          >{`interface CanvasFileReadResult {
  contents: string
  revision: string
}`}</DocCode>
          <FieldTable
            rows={[
              {
                description: "相邻文件的文本。",
                name: "contents",
                type: "string",
              },
              {
                description: "不透明标记，写回时原样传入 write。",
                name: "revision",
                type: "string",
              },
            ]}
          />
        </Stack>
        <Stack gap={6}>
          <DocCode
          >{`type CanvasFileWriteOutcome =
  | { kind: "written"; revision: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string }`}</DocCode>
          <FieldTable
            rows={[
              {
                description: "写入成功。下次用这个 revision。",
                name: "written",
                type: '{ kind: "written"; revision: string }',
              },
              {
                description: "文件已被改动。重新 read，再决定。",
                name: "conflict",
                type: '{ kind: "conflict"; message: string }',
              },
              {
                description: "写入失败，见 message。",
                name: "failed",
                type: '{ kind: "failed"; message: string }',
              },
            ]}
          />
        </Stack>
      </DocSection>
    </Stack>
  );
}
