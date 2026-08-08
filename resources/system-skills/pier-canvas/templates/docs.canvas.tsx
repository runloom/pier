import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Frame,
  Row,
  Separator,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";

/**
 * docs 起手稿：目标读者 → 何时用 → 步骤/表 → 注意点。
 */
export const canvas = {
  description: "说明文档：围绕读者目标组织章节与示例。",
  kind: "docs" as const,
  title: "说明文档",
};

export default function DocsCanvas() {
  return (
    <Frame maxWidth={800}>
      <Stack gap={20}>
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

        <Alert>
          <AlertTitle>先读这一段</AlertTitle>
          <AlertDescription>
            用两到三句说明前提与边界。没有这些上下文时，后面的步骤可能无意义。
          </AlertDescription>
        </Alert>

        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            何时使用
          </Text>
          <Stack gap={4}>
            <Text className="text-sm leading-relaxed">
              · 适合：……
            </Text>
            <Text className="text-sm leading-relaxed">
              · 不适合：……
            </Text>
          </Stack>
        </Stack>

        <Separator />

        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            步骤
          </Text>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">步骤</TableHead>
                  <TableHead>做什么</TableHead>
                  <TableHead>结果</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">1</TableCell>
                  <TableCell className="text-sm">……</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    ……
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">2</TableCell>
                  <TableCell className="text-sm">……</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    ……
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Stack>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">示例</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {`# 可运行或可抄写的示例
command --flag value`}
            </pre>
          </CardContent>
        </Card>
      </Stack>
    </Frame>
  );
}
