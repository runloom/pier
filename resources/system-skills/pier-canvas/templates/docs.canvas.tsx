import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  DocsShell,
  Row,
  Stack,
  Text,
} from "pier/canvas";
import { useState } from "react";

/**
 * docs 起手稿：DocsShell（左目录 + 右正文）+ 章节内容。
 * 布局用宿主 DocsShell（inline flex），勿手写双 ScrollArea / 任意 grid 当命脉。
 */
export const canvas = {
  description: "说明文档：DocsShell 章节导航 + 正文。",
  kind: "docs" as const,
  title: "说明文档",
};

const NAV = [
  { id: "intro", label: "简介" },
  { id: "when", label: "何时使用" },
  { id: "steps", label: "步骤" },
] as const;

type NavId = (typeof NAV)[number]["id"];

export default function DocsCanvas() {
  const [navId, setNavId] = useState<NavId>("intro");

  const header = (
    <Stack gap={8}>
      <Row gap={8} wrap>
        <Badge variant="secondary">docs</Badge>
      </Row>
      <Text as="h1" className="text-2xl font-semibold tracking-tight">
        文档标题
      </Text>
      <Text tone="secondary" className="text-sm leading-relaxed">
        写清读者是谁、读完能完成什么。避免堆砌实现细节。
      </Text>
    </Stack>
  );

  return (
    <DocsShell
      header={header}
      nav={[...NAV]}
      navId={navId}
      onNavChange={(id) => {
        if (id === "intro" || id === "when" || id === "steps") {
          setNavId(id);
        }
      }}
    >
      {navId === "intro" ? (
        <Stack gap={12}>
          <Text as="h2" className="text-base font-semibold">
            简介
          </Text>
          <Alert>
            <AlertTitle>先读这一段</AlertTitle>
            <AlertDescription>
              用两到三句说明前提与边界。没有这些上下文时，后面的步骤可能无意义。
            </AlertDescription>
          </Alert>
        </Stack>
      ) : null}
      {navId === "when" ? (
        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            何时使用
          </Text>
          <Text className="text-sm leading-relaxed">· 适合：……</Text>
          <Text className="text-sm leading-relaxed">· 不适合：……</Text>
        </Stack>
      ) : null}
      {navId === "steps" ? (
        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            步骤
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            清单类内容用一份可展开列表；已实现项不必打「已实现」标，仅标暂未实现。
            禁止「表格扫一遍 + 下方再 Accordion 一遍」双份清单。
          </Text>
        </Stack>
      ) : null}
    </DocsShell>
  );
}
