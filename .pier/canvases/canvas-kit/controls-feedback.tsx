import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Kbd,
  KbdGroup,
  Progress,
  Row,
  Skeleton,
  Spinner,
  StatusIcon,
} from "pier/canvas";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

export function FeedbackControls() {
  return (
    <KitSection hint="状态、列表行和占位。" title="反馈与展示">
      <KitGrid>
        <MaterialCard
          install='import { Alert, AlertDescription, AlertTitle } from "pier/canvas"'
          lead="页内提示"
          name="Alert"
        >
          <Alert>
            <AlertTitle>页内提示</AlertTitle>
            <AlertDescription>说明下一步做什么。</AlertDescription>
          </Alert>
        </MaterialCard>
        <MaterialCard
          install='import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "pier/canvas"'
          lead="空态"
          name="Empty"
        >
          <Empty className="min-h-24 py-6" role="status">
            <EmptyHeader>
              <EmptyTitle>还没有内容</EmptyTitle>
              <EmptyDescription>空态用来说明下一步做什么。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </MaterialCard>
        <MaterialCard
          install='import { Badge } from "pier/canvas"'
          lead="短状态或分类标记"
          name="Badge"
        >
          <Row gap={8} wrap>
            <Badge>默认</Badge>
            <Badge variant="secondary">次要</Badge>
            <Badge variant="outline">描边</Badge>
            <Badge variant="info">信息</Badge>
            <Badge variant="success">成功</Badge>
            <Badge variant="warning">警告</Badge>
          </Row>
        </MaterialCard>
        <MaterialCard
          install='import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "pier/canvas"'
          lead="头像"
          name="Avatar"
        >
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>甲</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>乙</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+2</AvatarGroupCount>
          </AvatarGroup>
        </MaterialCard>
        <MaterialCard
          install='import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "pier/canvas"'
          lead="内容卡片"
          name="Card"
        >
          <Card className="w-48 shadow-none">
            <CardHeader>
              <CardTitle>标题</CardTitle>
              <CardDescription>说明</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-sm">内容</span>
            </CardContent>
          </Card>
        </MaterialCard>
        <MaterialCard
          install='import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "pier/canvas"'
          lead="列表行"
          name="Item"
        >
          <ItemGroup className="w-56">
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>标题</ItemTitle>
                <ItemDescription>说明</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </MaterialCard>
        <MaterialCard
          install='import { Kbd, KbdGroup } from "pier/canvas"'
          lead="键盘按键"
          name="Kbd"
        >
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </MaterialCard>
        <MaterialCard
          install='import { Progress } from "pier/canvas"'
          lead="进度条"
          name="Progress"
        >
          <Progress aria-label="进度" className="w-40" value={40} />
        </MaterialCard>
        <MaterialCard
          install='import { Skeleton } from "pier/canvas"'
          lead="加载占位"
          name="Skeleton"
        >
          <Skeleton className="h-6 w-32" />
        </MaterialCard>
        <MaterialCard
          install='import { Spinner } from "pier/canvas"'
          lead="转圈加载"
          name="Spinner"
        >
          <Spinner />
        </MaterialCard>
        <MaterialCard
          install='import { StatusIcon } from "pier/canvas"'
          lead="状态图标"
          name="StatusIcon"
        >
          <Row gap={10}>
            <StatusIcon kind="info" />
            <StatusIcon kind="success" />
            <StatusIcon kind="warning" />
            <StatusIcon kind="error" />
          </Row>
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
