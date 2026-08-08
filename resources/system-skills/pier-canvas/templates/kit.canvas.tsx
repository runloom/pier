import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Input,
  Row,
  Separator,
  Stack,
  Text,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "pier/canvas";
import { useState } from "react";

/**
 * kit 起手稿：分区展示组件与状态。优先换成项目真实组件。
 */
export const canvas = {
  description: "组件目录：按用途分组，展示关键状态与变体。",
  kind: "kit" as const,
  title: "组件目录",
};

export default function KitCanvas() {
  const [tone, setTone] = useState("default");

  return (
    <Frame maxWidth={1040}>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="success">kit</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            组件目录
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            按用途分组。优先 import 项目设计系统中的真实组件，而不是复制宿主源码。
          </Text>
        </Stack>

        <Stack gap={10}>
          <Text as="h2" className="text-base font-semibold">
            按钮
          </Text>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">变体</CardTitle>
              <CardDescription>默认密度 28px；图标用 data-icon。</CardDescription>
            </CardHeader>
            <CardContent>
              <Row gap={8} wrap>
                <Button type="button">默认</Button>
                <Button type="button" variant="outline">
                  描边
                </Button>
                <Button type="button" variant="secondary">
                  次要
                </Button>
                <Button type="button" variant="destructive">
                  危险
                </Button>
                <Button disabled type="button">
                  禁用
                </Button>
              </Row>
            </CardContent>
          </Card>
        </Stack>

        <Separator />

        <Stack gap={10}>
          <Text as="h2" className="text-base font-semibold">
            输入与开关
          </Text>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-4">
              <Row className="items-center" gap={12} wrap>
                <Input
                  className="max-w-xs"
                  placeholder="占位文案"
                  readOnly
                  value="示例输入"
                />
                <Toggle aria-label="示例开关" type="button">
                  切换
                </Toggle>
              </Row>
              <ToggleGroup
                onValueChange={(value) => {
                  if (value) {
                    setTone(value);
                  }
                }}
                type="single"
                value={tone}
                variant="outline"
              >
                <ToggleGroupItem value="default">默认</ToggleGroupItem>
                <ToggleGroupItem value="quiet">安静</ToggleGroupItem>
                <ToggleGroupItem value="emphasis">强调</ToggleGroupItem>
              </ToggleGroup>
              <Text tone="secondary" className="text-xs">
                当前：{tone}
              </Text>
            </CardContent>
          </Card>
        </Stack>

        <Stack gap={10}>
          <Text as="h2" className="text-base font-semibold">
            状态徽标
          </Text>
          <Row gap={8} wrap>
            <Badge variant="info">信息</Badge>
            <Badge variant="success">成功</Badge>
            <Badge variant="warning">警告</Badge>
            <Badge variant="destructive">错误</Badge>
            <Badge variant="secondary">中性</Badge>
            <Badge variant="outline">描边</Badge>
          </Row>
        </Stack>
      </Stack>
    </Frame>
  );
}
