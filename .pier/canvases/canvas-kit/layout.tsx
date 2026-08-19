import {
  Artboard,
  ArtboardStage,
  AspectRatio,
  Badge,
  DocsShell,
  Frame,
  Row,
  ScrollArea,
  ScrollBar,
  Separator,
  Stack,
  Text,
} from "pier/canvas";
import { useState } from "react";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

function DocsShellSpecimen() {
  const [id, setId] = useState("one");
  return (
    <DocsShell
      maxWidth={280}
      nav={[
        { id: "one", label: "一段" },
        { id: "two", label: "二段" },
      ]}
      navId={id}
      navWidth={72}
      onNavChange={setId}
    >
      <Text className="text-sm">{id === "one" ? "正文一" : "正文二"}</Text>
    </DocsShell>
  );
}

export function LayoutPage() {
  return (
    <KitSection
      hint="页面骨架。Frame 是阅读栏，Artboard 是定宽设计稿。"
      title="布局"
    >
      <KitGrid>
        <MaterialCard
          install='import { Frame } from "pier/canvas"'
          lead="固定最大宽度的阅读容器"
          name="Frame"
        >
          <Frame className="rounded-md border p-3" maxWidth={160}>
            <Text className="text-sm">阅读栏</Text>
          </Frame>
        </MaterialCard>
        <MaterialCard
          install='import { Stack } from "pier/canvas"'
          lead="纵向排列子项"
          name="Stack"
        >
          <Stack className="w-28" gap={6}>
            <div className="h-3 rounded-sm bg-muted-foreground/25" />
            <div className="h-3 rounded-sm bg-muted-foreground/25" />
            <div className="h-3 w-2/3 rounded-sm bg-muted-foreground/25" />
          </Stack>
        </MaterialCard>
        <MaterialCard
          install='import { Row } from "pier/canvas"'
          lead="横向排列子项，可换行"
          name="Row"
        >
          <Row className="w-36" gap={6} wrap>
            <Badge variant="secondary">Row</Badge>
            <Badge variant="outline">换行</Badge>
          </Row>
        </MaterialCard>
        <MaterialCard
          install='import { Text } from "pier/canvas"'
          lead="正文与标题"
          name="Text"
        >
          <Stack gap={4}>
            <Text as="h3">标题</Text>
            <Text className="text-sm" tone="secondary">
              说明
            </Text>
          </Stack>
        </MaterialCard>
        <MaterialCard
          install='import { DocsShell } from "pier/canvas"'
          lead="文档页的左右栏阅读壳"
          name="DocsShell"
        >
          <DocsShellSpecimen />
        </MaterialCard>
        <MaterialCard
          install='import { Artboard, ArtboardStage } from "pier/canvas"'
          lead="带标题的设计稿帧"
          name="Artboard"
        >
          <Artboard height={72} label="K1" title="列表" width={200}>
            <div className="h-full bg-muted/60" />
          </Artboard>
        </MaterialCard>
        <MaterialCard
          install='import { Artboard, ArtboardStage } from "pier/canvas"'
          lead="多帧画板舞台，全屏才缩放平移"
          name="ArtboardStage"
        >
          <ArtboardStage
            expandable={false}
            gap={12}
            padding={12}
            title="舞台"
            worldWidth={280}
          >
            <Artboard height={56} title="帧" width={120}>
              <div className="h-full bg-muted/60" />
            </Artboard>
          </ArtboardStage>
        </MaterialCard>
        <MaterialCard
          install='import { Separator } from "pier/canvas"'
          lead="分隔线"
          name="Separator"
        >
          <Stack className="w-32" gap={8}>
            <Text className="text-sm">上</Text>
            <Separator />
            <Text className="text-sm">下</Text>
          </Stack>
        </MaterialCard>
        <MaterialCard
          install='import { ScrollArea, ScrollBar } from "pier/canvas"'
          lead="可滚动区域"
          name="ScrollArea"
        >
          <ScrollArea className="h-24 w-40 rounded-md border">
            <Stack className="p-3" gap={6}>
              <Text className="text-sm">一行</Text>
              <Text className="text-sm">二行</Text>
              <Text className="text-sm">三行</Text>
              <Text className="text-sm">四行</Text>
              <Text className="text-sm">五行</Text>
            </Stack>
            <ScrollBar />
          </ScrollArea>
        </MaterialCard>
        <MaterialCard
          install='import { AspectRatio } from "pier/canvas"'
          lead="固定宽高比盒子"
          name="AspectRatio"
        >
          <AspectRatio className="w-40 overflow-hidden rounded-md border" ratio={16 / 9}>
            <div className="h-full w-full bg-muted" />
          </AspectRatio>
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
