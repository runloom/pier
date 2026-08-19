import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Row,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "pier/canvas";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

export function ActionControls() {
  return (
    <KitSection hint="主操作、切换、菜单和路径。" title="动作与导航">
      <KitGrid>
        <MaterialCard
          install='import { Button } from "pier/canvas"'
          lead="触发主操作。默认、描边、次要、破坏四种外观。"
          name="Button"
        >
          <Row gap={8} wrap>
            <Button type="button">默认</Button>
            <Button type="button" variant="outline">
              描边
            </Button>
            <Button type="button" variant="secondary">
              次要
            </Button>
            <Button type="button" variant="destructive">
              破坏
            </Button>
          </Row>
        </MaterialCard>
        <MaterialCard
          install='import { Toggle } from "pier/canvas"'
          lead="点一下后保持按下"
          name="Toggle"
        >
          <Toggle aria-label="加粗">加粗</Toggle>
        </MaterialCard>
        <MaterialCard
          install='import { ToggleGroup, ToggleGroupItem } from "pier/canvas"'
          lead="一组互斥或多选切换"
          name="ToggleGroup"
        >
          <ToggleGroup defaultValue="a" type="single">
            <ToggleGroupItem value="a">甲</ToggleGroupItem>
            <ToggleGroupItem value="b">乙</ToggleGroupItem>
          </ToggleGroup>
        </MaterialCard>
        <MaterialCard
          install='import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "pier/canvas"'
          lead="下拉菜单"
          name="DropdownMenu"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                打开
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>保存</DropdownMenuItem>
                <DropdownMenuItem>更多</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </MaterialCard>
        <MaterialCard
          install='import { Tabs, TabsContent, TabsList, TabsTrigger } from "pier/canvas"'
          lead="同一页里切换分段"
          name="Tabs"
        >
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">一段</TabsTrigger>
              <TabsTrigger value="two">二段</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-3" value="one">
              第一段
            </TabsContent>
            <TabsContent className="mt-3" value="two">
              第二段
            </TabsContent>
          </Tabs>
        </MaterialCard>
        <MaterialCard
          install='import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "pier/canvas"'
          lead="分页"
          name="Pagination"
        >
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#kit-prev" text="上一页" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#kit-1" isActive>
                  1
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#kit-next" text="下一页" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </MaterialCard>
        <MaterialCard
          install='import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "pier/canvas"'
          lead="路径导航"
          name="Breadcrumb"
        >
          <Breadcrumb pageTitle="当前页">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#kit-home">首页</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>物料</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
