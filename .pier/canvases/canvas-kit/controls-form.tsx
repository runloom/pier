import {
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Label,
  RadioGroup,
  RadioGroupItem,
  Row,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
} from "pier/canvas";
import { useState } from "react";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

export function FormControls() {
  const [on, setOn] = useState(true);
  return (
    <KitSection hint="输入、选择和表单字段。" title="表单">
      <KitGrid>
        <MaterialCard
          install='import { Input } from "pier/canvas"'
          lead="单行输入"
          name="Input"
        >
          <Input className="max-w-xs" placeholder="输入" />
        </MaterialCard>
        <MaterialCard
          install='import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "pier/canvas"'
          lead="带附加元素的输入"
          name="InputGroup"
        >
          <InputGroup className="max-w-xs">
            <InputGroupInput placeholder="搜索" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>⌘K</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </MaterialCard>
        <MaterialCard
          install='import { Textarea } from "pier/canvas"'
          lead="多行输入"
          name="Textarea"
        >
          <Textarea className="max-w-xs" placeholder="说明" rows={3} />
        </MaterialCard>
        <MaterialCard
          install='import { Label } from "pier/canvas"'
          lead="控件标签"
          name="Label"
        >
          <Stack gap={6}>
            <Label htmlFor="kit-label-demo">名称</Label>
            <Input id="kit-label-demo" placeholder="输入" />
          </Stack>
        </MaterialCard>
        <MaterialCard
          install='import { Field, FieldDescription, FieldLabel, Input } from "pier/canvas"'
          lead="表单字段"
          name="Field"
        >
          <Field className="max-w-xs">
            <FieldLabel>标题</FieldLabel>
            <Input placeholder="输入" />
            <FieldDescription>给这一项起个名字。</FieldDescription>
          </Field>
        </MaterialCard>
        <MaterialCard
          install='import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "pier/canvas"'
          lead="从列表里选一项"
          name="Select"
        >
          <Select defaultValue="outline">
            <SelectTrigger aria-label="外观" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="outline">描边</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </MaterialCard>
        <MaterialCard
          install='import { Checkbox } from "pier/canvas"'
          lead="多选开关"
          name="Checkbox"
        >
          <Row align="center" gap={8}>
            <Checkbox aria-label="同意" defaultChecked />
            <Text className="text-sm">同意</Text>
          </Row>
        </MaterialCard>
        <MaterialCard
          install='import { RadioGroup, RadioGroupItem } from "pier/canvas"'
          lead="单选一组"
          name="RadioGroup"
        >
          <RadioGroup defaultValue="a">
            <Row gap={12}>
              <RadioGroupItem aria-label="甲" value="a" />
              <RadioGroupItem aria-label="乙" value="b" />
            </Row>
          </RadioGroup>
        </MaterialCard>
        <MaterialCard
          install='import { Switch } from "pier/canvas"'
          lead="开关"
          name="Switch"
        >
          <Row align="center" gap={8}>
            <Switch
              aria-label="启用"
              checked={on}
              onCheckedChange={setOn}
            />
            <Text className="text-sm">{on ? "开" : "关"}</Text>
          </Row>
        </MaterialCard>
        <MaterialCard
          install='import { Slider } from "pier/canvas"'
          lead="滑块"
          name="Slider"
        >
          <Slider
            aria-label="数值"
            className="w-40"
            defaultValue={[40]}
            max={100}
          />
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
